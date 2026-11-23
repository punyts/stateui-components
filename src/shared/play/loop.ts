import type { JsonValue } from '@punyts/stateui-app/core';
import type { Scene3dTree } from '../scene3d/tree.js';
import { DEFAULT_GRAVITY, MAX_MOVERS, MAX_SOLIDS, MAX_STEPS_PER_FRAME, PlayWorld, STEP_SECONDS, geometryHalf, readBody, readBounds, readVector, sphereRadius, turnedHalf } from './play.js';
import type { PlayBody, PlayContact, Vec3 } from './play.js';

/**
 * The game loop of a `scene3d` (docs/design/stateui-game-loop.md): it reads the bodies of the node tree whenever the
 * scene draws, steps them on the animation frame while `play.running` is true and something moves, and gives the scene
 * the tree with the bodies where they are now. State hears of a body only at a contact (its own and the other body's
 * position and velocity, then `contact`), when it comes to rest, and when the game stops. A state value that differs
 * from what the loop last wrote or read (logic set a velocity, moved a body) is taken as the body's new value. The
 * copies of a `repeat3d` whose row has a `body` are bodies too (F2), keyed by their record and named with their repeat
 * in a contact; they collide with the bodies beside the repeat when it is not moved, turned or scaled, else only with
 * each other.
 */

/** The 3D nodes that may be bodies */
const BODY_KINDS: ReadonlySet<Scene3dTree['kind']> = new Set(['mesh', 'group3d', 'model']);

/** What the loop needs from its scene */
export interface SceneLoopOptions {
    /** Writes one value to the store: a body's `position` or `velocity`; false when it has nowhere to go (a copy's unlinked `velocity`) */
    write(path: string, value: Vec3): boolean;
    /** Tells a contact (the controller raises `contact` on the element) */
    contact(contact: PlayContact): void;
    /** Gives the scene the tree to draw with the bodies where they are now */
    draw(tree: readonly Scene3dTree[]): void;
    /** Half the size of a `group3d` or `model` as the scene draws it; undefined while it draws nothing */
    measure(path: string): Vec3 | undefined;
    /** Reports a problem once per reason and path: a key `control` names that is not a scene key, a game over the limits */
    problem(reason: string, path: string): void;
    /** The animation frame (`requestAnimationFrame` and `cancelAnimationFrame` in the page) */
    frame(callback: (time: number) => void): number;
    cancel(handle: number): void;
}

/** The values the loop last wrote or read of a body, as JSON text, to tell its own writes from logic's */
interface Known {
    position: string;
    velocity: string;
}

const text = (value: readonly number[]): string => JSON.stringify(value);

export class SceneLoop {
    private world: PlayWorld | undefined;
    private tree: readonly Scene3dTree[] = [];
    private gravity: Vec3 = [...DEFAULT_GRAVITY];
    private readonly held = new Set<string>();
    private readonly known = new Map<string, Known>();
    private keys: readonly string[] = [];
    private handle: number | undefined;
    private last: number | undefined;
    private spare = 0;
    private disposed = false;

    constructor(private readonly options: SceneLoopOptions) {}

    /** The key names the bodies' `control` lists while the game runs: the scene takes them as it takes `keys` */
    controlKeys(): readonly string[] {
        return this.keys;
    }

    /** True while the game runs */
    get running(): boolean {
        return this.world !== undefined;
    }

    /**
     * Takes the scene's tree and `play` as state holds them now, on every draw, and gives the tree to draw: the same
     * tree while the game does not run, else the bodies at their positions in the game
     */
    sync(tree: readonly Scene3dTree[], play: JsonValue | undefined): readonly Scene3dTree[] {
        if (this.disposed) return tree;
        const settings = typeof play === 'object' && play !== null && !Array.isArray(play) ? play : {};
        const running = settings.running === true;
        this.tree = tree;
        if (!running) {
            if (this.world !== undefined) this.stop();
            return tree;
        }
        this.gravity = readVector(settings.gravity, DEFAULT_GRAVITY);
        const bodies = this.readBodies(tree);
        const movers = bodies.filter((body) => body.velocity.some((value) => value !== 0) || body.spec.falls || Object.keys(body.spec.control).length > 0);
        const solids = bodies.filter((body) => body.spec.solid);
        if (movers.length > MAX_MOVERS || solids.length > MAX_SOLIDS) {
            const what = movers.length > MAX_MOVERS ? `${movers.length} moving bodies, more than the ${MAX_MOVERS}` : `${solids.length} solid bodies, more than the ${MAX_SOLIDS}`;
            this.options.problem(`it has ${what} a game moves, so the game does not run`, '');
            if (this.world !== undefined) this.stop();
            return tree;
        }
        this.world = new PlayWorld(bodies, this.world);
        this.keys = [...new Set(bodies.flatMap((body) => Object.keys(body.spec.control)))];
        for (const name of [...this.held]) if (!this.keys.includes(name)) this.held.delete(name);
        this.wake();
        return this.shown();
    }

    /** A key went down in the scene: true when a body's `control` names it (the scene then takes the press) */
    keyDown(name: string): boolean {
        if (this.world === undefined || !this.keys.includes(name)) return false;
        this.held.add(name);
        this.wake();
        return true;
    }

    /** A key came up */
    keyUp(name: string): void {
        if (!this.held.delete(name)) return;
        this.wake();
    }

    /** Focus left the scene: no key is held any longer */
    releaseAll(): void {
        if (this.held.size === 0) return;
        this.held.clear();
        this.wake();
    }

    dispose(): void {
        this.disposed = true;
        if (this.handle !== undefined) this.options.cancel(this.handle);
        this.handle = undefined;
        this.world = undefined;
    }

    /** Ends the game: every body's position and velocity are written once, so state holds where it stopped */
    private stop(): void {
        const world = this.world as PlayWorld;
        this.world = undefined;
        this.held.clear();
        this.keys = [];
        if (this.handle !== undefined) this.options.cancel(this.handle);
        this.handle = undefined;
        this.last = undefined;
        this.spare = 0;
        for (const body of world.bodies) this.save(body);
        this.known.clear();
    }

    /** Asks for a frame when something moves and none is asked for; when nothing moves, saves what came to rest */
    private wake(): void {
        const world = this.world;
        if (this.disposed || world === undefined || this.handle !== undefined) return;
        if (world.anyMoves(this.held)) {
            this.handle = this.options.frame((time) => this.onFrame(time));
            return;
        }
        for (const path of world.settle(this.held)) {
            const body = world.body(path);
            if (body !== undefined) this.save(body);
        }
    }

    private onFrame(time: number): void {
        this.handle = undefined;
        const world = this.world;
        if (this.disposed || world === undefined) return;
        const seconds = this.last === undefined ? 0 : Math.max(0, (time - this.last) / 1000);
        this.last = time;
        this.spare = Math.min(this.spare + seconds, MAX_STEPS_PER_FRAME * STEP_SECONDS);
        const contacts: PlayContact[] = [];
        const rested: string[] = [];
        while (this.spare >= STEP_SECONDS - 1e-9) {
            this.spare -= STEP_SECONDS;
            const result = world.step(STEP_SECONDS, this.gravity, this.held);
            contacts.push(...result.contacts);
            rested.push(...result.rested);
        }
        this.options.draw(this.shown());
        const moving = world.anyMoves(this.held);
        if (!moving) {
            // At rest: the next movement starts its clock afresh, and what stopped without a step this frame rests too
            this.last = undefined;
            this.spare = 0;
            rested.push(...world.settle(this.held));
        }
        // The writes and the events go last: logic they wake may change the scene, which is read again on its draw
        for (const path of new Set([...contacts.map((contact) => contact.path), ...rested])) {
            const body = world.body(path);
            if (body !== undefined) this.save(body);
        }
        for (const contact of contacts) this.options.contact(contact);
        if (this.world === world && moving) this.wake();
    }

    /**
     * Writes a body's position and velocity where they differ from what state holds. A value that has nowhere to go is
     * not known as written, so state's own value stays what the loop compares with
     */
    private save(body: PlayBody): void {
        const known = this.known.get(body.path);
        const next: Known = { position: text(body.position), velocity: text(body.velocity) };
        for (const property of ['position', 'velocity'] as const) {
            if (known?.[property] === next[property]) continue;
            if (!this.options.write(`${body.path}.${property}`, [...body[property]]) && known !== undefined) next[property] = known[property];
        }
        this.known.set(body.path, next);
    }

    /** The bodies of the tree, each where the game has it unless state changed it since the loop last wrote or read it */
    private readBodies(tree: readonly Scene3dTree[]): PlayBody[] {
        const bodies: PlayBody[] = [];
        const seen = new Set<string>();
        const add = (node: Scene3dTree, parent: string, repeat?: string): void => {
            if (!BODY_KINDS.has(node.kind)) return;
            const spec = readBody(node.properties.body);
            if (spec === undefined) return;
            for (const name of spec.unknownKeys) this.options.problem(`its body's control names "${name}", which is not a key a scene takes`, repeat === undefined ? node.path : node.path.slice(0, node.path.lastIndexOf('.rows.')));
            const half = this.halfOf(node);
            if (half === undefined) return;
            seen.add(node.path);
            bodies.push(this.bodyOf(node, parent, spec, half, repeat));
        };
        const visit = (nodes: readonly Scene3dTree[], parent: string): void => {
            for (const node of nodes) {
                if (node.kind === 'group3d') visit(node.children, `${node.path}.children`);
                if (node.kind === 'repeat3d') {
                    // Copies share the repeat's parent while the repeat sits where its parent's space is; else only each other
                    const placed = ['position', 'rotation'].some((name) => readVector(node.properties[name], [0, 0, 0]).some((value) => value !== 0)) || readVector(node.properties.scale, [1, 1, 1]).some((value) => value !== 1);
                    for (const copy of node.children) add(copy, placed ? `${node.path}.rows` : parent, node.key);
                    continue;
                }
                add(node, parent);
            }
        };
        const first = tree[0];
        visit(tree, first === undefined ? '' : first.path.slice(0, first.path.lastIndexOf('.')));
        for (const path of [...this.known.keys()]) if (!seen.has(path)) this.known.delete(path);
        return bodies;
    }

    private bodyOf(node: Scene3dTree, parent: string, spec: PlayBody['spec'], half: Vec3, repeat: string | undefined): PlayBody {
        const position = readVector(node.properties.position, [0, 0, 0]);
        const velocity = readVector(node.properties.velocity, [0, 0, 0]);
        const before = this.world?.body(node.path);
        const known = this.known.get(node.path);
        const state = { position: text(position), velocity: text(velocity) };
        const radius = node.kind === 'mesh' ? sphereRadius(node.properties.geometry, readVector(node.properties.scale, [1, 1, 1])) : undefined;
        const body: PlayBody = {
            path: node.path,
            key: node.key,
            parent,
            // What state holds when the loop has not seen it yet or state changed it; else where the game has it
            position: before !== undefined && known?.position === state.position ? before.position : position,
            velocity: before !== undefined && known?.velocity === state.velocity ? before.velocity : velocity,
            spec,
            half,
            ...(radius !== undefined && { radius }),
            ...(readBounds(node.properties.bounds) !== undefined && { bounds: readBounds(node.properties.bounds) }),
            ...(repeat !== undefined && { repeat })
        };
        if (before === undefined || known?.position !== state.position || known.velocity !== state.velocity) this.known.set(node.path, state);
        return body;
    }

    /** The half size of a body's box in its parent's space: a mesh's from its geometry, a group's or model's as drawn */
    private halfOf(node: Scene3dTree): Vec3 | undefined {
        const scale = readVector(node.properties.scale, [1, 1, 1]);
        const rotation = readVector(node.properties.rotation, [0, 0, 0]);
        if (node.kind === 'mesh') return turnedHalf(geometryHalf(node.properties.geometry), scale, rotation);
        return this.options.measure(node.path);
    }

    /** The tree with each body at its position in the game, and without its `transition`, which would ease each frame */
    private shown(): readonly Scene3dTree[] {
        const world = this.world;
        if (world === undefined) return this.tree;
        const place = (nodes: readonly Scene3dTree[]): Scene3dTree[] =>
            nodes.map((node) => {
                const body = world.body(node.path);
                const children = node.kind === 'group3d' || node.kind === 'repeat3d' ? place(node.children) : node.children;
                if (body === undefined) return children === node.children ? node : { ...node, children };
                const { transition: _transition, ...properties } = node.properties;
                return { ...node, children, properties: { ...properties, position: [...body.position], velocity: [...body.velocity] } };
            });
        return place(this.tree);
    }
}
