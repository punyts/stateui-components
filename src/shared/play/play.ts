import type { JsonValue } from '@punyts/stateui-app/core';
import { SCENE_KEYS } from '../scene3d/keys.js';

/**
 * The game loop's step (docs/design/stateui-game-loop.md): bodies that move by their `velocity`, the keys held on
 * their `control`, and the scene's gravity, and that stop at, bounce off or pass through solids and their `bounds`.
 * Pure: no DOM, no store and no clock, so it runs in Node; the `scene3d` controller reads the bodies from its node tree,
 * runs `PlayWorld.step` on the animation frame and writes what it reports. Every body collides as its box, aligned with
 * the axes of its parent: the box of its geometry, scaled and turned by its own `scale` and `rotation`. Bodies collide
 * only with bodies of the same parent, whose positions are in the same space.
 */

export type Vec3 = [number, number, number];

/** What a body does when it meets a solid or a side of its `bounds` */
export const CONTACT_RESPONSES = ['stop', 'bounce', 'pass'] as const;
export type ContactResponse = (typeof CONTACT_RESPONSES)[number];

/** The side of a body that met something: -x, +x, -y, +y, -z, +z; `bounds` names its own side the same way */
export const CONTACT_SIDES = ['left', 'right', 'bottom', 'top', 'back', 'front'] as const;
export type ContactSide = (typeof CONTACT_SIDES)[number];

/** The length of one step: the loop steps at a fixed 60 a second */
export const STEP_SECONDS = 1 / 60;
/** The most steps one frame runs, so a slow frame or a tab that comes back does not jump bodies through walls */
export const MAX_STEPS_PER_FRAME = 5;
/** The most bodies that may move in one scene */
export const MAX_MOVERS = 256;
/** The most solid bodies in one scene */
export const MAX_SOLIDS = 5000;
/** The highest speed along an axis, in units per second */
export const MAX_SPEED = 1000;
/** The scene's gravity when `play` sets none, in units per second squared */
export const DEFAULT_GRAVITY: Readonly<Vec3> = [0, -9.8, 0];
/** The `with` of a contact with a side of the body's `bounds` */
export const BOUNDS_CONTACT = 'bounds';

/** How close two boxes are when they touch: closer than this counts as touching, deeper as overlapping */
const TOUCH = 1e-4;
/** The longest move of one sub-step along an axis, so a fast body meets a thin wall */
const MIN_SUBSTEP = 0.05;
/** The most sub-steps of one axis in a step */
const MAX_SUBSTEPS = 32;

const SIDES_BY_AXIS: readonly (readonly [ContactSide, ContactSide])[] = [
    ['left', 'right'],
    ['bottom', 'top'],
    ['back', 'front']
];

/** A body's `body` property, read */
export interface BodySpec {
    /** Key names to the velocity each adds while held */
    readonly control: Readonly<Record<string, Readonly<Vec3>>>;
    readonly falls: boolean;
    readonly solid: boolean;
    readonly onContact: ContactResponse;
    /** The names in `control` that are not scene keys (`SCENE_KEYS`), left out, for the controller to report */
    readonly unknownKeys: readonly string[];
}

/** A body's `bounds` (`{ x, z, width, depth }` of the drag), as the range its position is kept in */
export interface PlayBounds {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
}

/** One body of the world */
export interface PlayBody {
    /** The node's state path: its id */
    readonly path: string;
    /** The node's key, what a contact names as `with` */
    readonly key: string;
    /** The path of its parent: bodies collide only with bodies of the same parent */
    readonly parent: string;
    position: Vec3;
    /** Its own velocity: gravity, a stop and a bounce change it; held keys add to it without changing it */
    velocity: Vec3;
    readonly spec: BodySpec;
    /** Half the size of its box along x, y and z */
    readonly half: Readonly<Vec3>;
    readonly bounds?: PlayBounds;
}

/** Two bodies, or a body and a side of its bounds, that began to touch in a step */
export interface PlayContact {
    /** The path and key of the body that tells it */
    readonly path: string;
    readonly key: string;
    /** The other body's key, or `bounds` */
    readonly with: string;
    /** The side of the telling body that met it */
    readonly side: ContactSide;
}

/** What one step did */
export interface StepResult {
    /** The contacts that began, one for each body of a pair (one for a side of the bounds) */
    readonly contacts: readonly PlayContact[];
    /** The paths of the bodies that moved in the last step and stopped in this one */
    readonly rested: readonly string[];
}

const isRecord = (value: JsonValue | undefined): value is Record<string, JsonValue> => typeof value === 'object' && value !== null && !Array.isArray(value);

const finite = (value: JsonValue | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

const clampSpeed = (value: number): number => Math.max(-MAX_SPEED, Math.min(MAX_SPEED, value));

/** A vector of three finite numbers, or `fallback` */
export function readVector(value: JsonValue | undefined, fallback: Readonly<Vec3>): Vec3 {
    if (Array.isArray(value) && value.length === 3 && value.every((n) => finite(n))) return [value[0] as number, value[1] as number, value[2] as number];
    return [...fallback] as Vec3;
}

/** A node's `body`, read; undefined when it has none (the node is not a body) */
export function readBody(value: JsonValue | undefined): BodySpec | undefined {
    if (!isRecord(value)) return undefined;
    const control: Record<string, Vec3> = {};
    const unknownKeys: string[] = [];
    if (isRecord(value.control)) {
        for (const [name, add] of Object.entries(value.control)) {
            if (!SCENE_KEYS.includes(name)) unknownKeys.push(name);
            else control[name] = readVector(add, [0, 0, 0]).map(clampSpeed) as Vec3;
        }
    }
    const response = value.onContact;
    return {
        control,
        falls: value.falls === true,
        solid: value.solid === true,
        onContact: typeof response === 'string' && (CONTACT_RESPONSES as readonly string[]).includes(response) ? (response as ContactResponse) : 'stop',
        unknownKeys
    };
}

/** A drag's `bounds` as the range of the position, or undefined when it is not a whole box */
export function readBounds(value: JsonValue | undefined): PlayBounds | undefined {
    if (!isRecord(value)) return undefined;
    const { x, z, width, depth } = value;
    if (!finite(x) || !finite(z) || !finite(width) || !finite(depth) || width < 0 || depth < 0) return undefined;
    return { minX: x, maxX: x + width, minZ: z, maxZ: z + depth };
}

/** A size of a geometry: its value when a finite number of 0 or more, else the renderer's default */
const size = (geometry: Record<string, JsonValue>, name: string, fallback: number): number => {
    const raw = geometry[name];
    return finite(raw) && raw >= 0 ? raw : fallback;
};

/**
 * Half the size of a mesh's geometry along its own x, y and z, with the defaults the renderer draws
 * (`geometryParams` of `@punyts/stateui-3d`): a box of its width, height and depth, a sphere of its radius, a plane flat
 * in x-y (no depth), a torus around z. A value that names no kind is a unit box, as it is drawn
 */
export function geometryHalf(value: JsonValue | undefined): Vec3 {
    const geometry = isRecord(value) ? value : {};
    switch (geometry.kind) {
        case 'sphere': {
            const radius = size(geometry, 'radius', 0.5);
            return [radius, radius, radius];
        }
        case 'cylinder': {
            const radius = size(geometry, 'radius', 0.5);
            const widest = Math.max(size(geometry, 'radiusTop', radius), size(geometry, 'radiusBottom', radius));
            return [widest, size(geometry, 'height', 1) / 2, widest];
        }
        case 'cone': {
            const radius = size(geometry, 'radius', 0.5);
            return [radius, size(geometry, 'height', 1) / 2, radius];
        }
        case 'plane':
            return [size(geometry, 'width', 1) / 2, size(geometry, 'height', 1) / 2, 0];
        case 'torus': {
            const tube = size(geometry, 'tube', 0.1);
            const outer = size(geometry, 'radius', 0.4) + tube;
            return [outer, outer, tube];
        }
        case 'capsule': {
            const radius = size(geometry, 'radius', 0.25);
            return [radius, size(geometry, 'height', 0.5) / 2 + radius, radius];
        }
        default:
            return [size(geometry, 'width', 1) / 2, size(geometry, 'height', 1) / 2, size(geometry, 'depth', 1) / 2];
    }
}

/**
 * The half size of a box of half size `half` scaled by `scale` and turned by `rotation` (radians, x then y then z, as
 * three.js turns a node), as a box aligned with the parent's axes that holds it
 */
export function turnedHalf(half: Readonly<Vec3>, scale: Readonly<Vec3>, rotation: Readonly<Vec3>): Vec3 {
    const h = [Math.abs(half[0] * scale[0]), Math.abs(half[1] * scale[1]), Math.abs(half[2] * scale[2])];
    const [a, b, c] = rotation;
    const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
    // The rotation matrix of the Euler angles in the order XYZ
    const m = [
        [cb * cc, -cb * sc, sb],
        [ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb],
        [sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb]
    ];
    const clean = (value: number): number => Math.round(value * 1e9) / 1e9;
    return m.map((row) => clean(Math.abs(row[0] as number) * (h[0] as number) + Math.abs(row[1] as number) * (h[1] as number) + Math.abs(row[2] as number) * (h[2] as number))) as Vec3;
}

/** The key of a touching pair: the two paths in order, or a path and a side of its bounds */
/** What joins the two paths of a pair, and a path and the side of its bounds */
const PAIR_MARK = '\u0000';
const BOUND_MARK = '\u0001';
const pairKey = (a: string, b: string): string => (a < b ? `${a}${PAIR_MARK}${b}` : `${b}${PAIR_MARK}${a}`);

/** The bodies of a scene and what touched in the last step */
export class PlayWorld {
    readonly bodies: readonly PlayBody[];
    private touching = new Set<string>();
    private moving = new Set<string>();
    private readonly byPath: ReadonlyMap<string, PlayBody>;

    /**
     * A world of these bodies. Without `previous`, what touches when it is made is not a contact that begins; with it (the
     * same scene read again after a state change), the pairs that touched and the bodies that moved carry over, so a
     * pair that still touches is not told again and a body that stops is told to rest
     */
    constructor(bodies: readonly PlayBody[], previous?: PlayWorld) {
        this.bodies = bodies;
        this.byPath = new Map(bodies.map((body) => [body.path, body]));
        if (previous === undefined) {
            this.touching = this.touchingPairs(bodies);
            return;
        }
        const known = (path: string): boolean => this.byPath.has(path);
        // A pair is two paths, or a path and a side of its bounds; it carries over while its bodies are still here
        const kept = (pair: string): boolean => {
            const bound = pair.indexOf(BOUND_MARK);
            return bound >= 0 ? known(pair.slice(0, bound)) : pair.split(PAIR_MARK).every(known);
        };
        this.touching = new Set([...previous.touching].filter(kept));
        this.moving = new Set([...previous.moving].filter(known));
    }

    /** The body with this path */
    body(path: string): PlayBody | undefined {
        return this.byPath.get(path);
    }

    /** The velocity the body moves at with these keys held: its own and what its held keys add */
    velocityOf(body: PlayBody, held: ReadonlySet<string>): Vec3 {
        const result: Vec3 = [...body.velocity];
        for (const [name, add] of Object.entries(body.spec.control)) {
            if (!held.has(name)) continue;
            for (let axis = 0; axis < 3; axis += 1) result[axis] = (result[axis] as number) + (add[axis] as number);
        }
        return result.map(clampSpeed) as Vec3;
    }

    /** True when the body would move in a step: it has a speed, or it falls and nothing holds it up */
    movesNow(body: PlayBody, held: ReadonlySet<string>): boolean {
        if (this.velocityOf(body, held).some((value) => value !== 0)) return true;
        return body.spec.falls && !this.supported(body);
    }

    /** True when any body would move in a step with these keys held */
    anyMoves(held: ReadonlySet<string>): boolean {
        return this.bodies.some((body) => this.movesNow(body, held));
    }

    /** Runs one step of `seconds` with this gravity and these keys held */
    step(seconds: number, gravity: Readonly<Vec3>, held: ReadonlySet<string>): StepResult {
        const moved = new Set<string>();
        for (const body of this.bodies) {
            if (body.spec.falls) {
                if (this.supported(body) && body.velocity[1] <= 0 && gravity[1] <= 0) body.velocity[1] = 0;
                else for (let axis = 0; axis < 3; axis += 1) body.velocity[axis] = clampSpeed((body.velocity[axis] as number) + (gravity[axis] as number) * seconds);
            }
            const velocity = this.velocityOf(body, held);
            if (velocity.every((value) => value === 0)) continue;
            moved.add(body.path);
            for (let axis = 0; axis < 3; axis += 1) this.moveAxis(body, axis, (velocity[axis] as number) * seconds);
        }
        const now = this.touchingPairs(this.bodies);
        const contacts: PlayContact[] = [];
        for (const pair of now) {
            if (this.touching.has(pair)) continue;
            contacts.push(...this.contactsOf(pair));
        }
        this.touching = now;
        const rested = [...this.moving].filter((path) => !moved.has(path) || !this.movesNow(this.byPath.get(path) as PlayBody, held));
        this.moving = new Set([...moved].filter((path) => this.movesNow(this.byPath.get(path) as PlayBody, held)));
        return { contacts, rested };
    }

    /**
     * The bodies that moved and no longer move with these keys held, though no step ran since (a key came up between
     * two steps, logic set a velocity to zero): they are at rest now, and are told once
     */
    settle(held: ReadonlySet<string>): string[] {
        const rested = [...this.moving].filter((path) => !this.movesNow(this.byPath.get(path) as PlayBody, held));
        for (const path of rested) this.moving.delete(path);
        return rested;
    }

    /** Moves a body along one axis in sub-steps, stopped, bounced or let through by what it meets */
    private moveAxis(body: PlayBody, axis: number, distance: number): void {
        if (distance === 0) return;
        const smallest = Math.min(...body.half.filter((value) => value > 0), Number.POSITIVE_INFINITY);
        const longest = Math.max(MIN_SUBSTEP, Number.isFinite(smallest) ? smallest : MIN_SUBSTEP);
        const count = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(Math.abs(distance) / longest)));
        const part = distance / count;
        for (let index = 0; index < count; index += 1) {
            body.position[axis] = (body.position[axis] as number) + part;
            if (this.meet(body, axis, part)) return;
        }
    }

    /**
     * After a sub-step along `axis`: when the body went into a solid or out of its bounds, puts it back against it
     * unless it passes, and stops or turns its velocity on that axis. True when the rest of the move is not taken
     */
    private meet(body: PlayBody, axis: number, part: number): boolean {
        if (body.spec.onContact === 'pass') return false;
        let met = false;
        if (body.spec.solid) {
            for (const other of this.bodies) {
                if (other === body || !other.spec.solid || other.parent !== body.parent || !this.overlaps(body, other)) continue;
                const reach = (body.half[axis] as number) + (other.half[axis] as number);
                body.position[axis] = (other.position[axis] as number) + (part > 0 ? -reach : reach);
                met = true;
            }
        }
        const bounds = body.bounds;
        if (bounds !== undefined && axis !== 1) {
            const [min, max] = axis === 0 ? [bounds.minX, bounds.maxX] : [bounds.minZ, bounds.maxZ];
            const at = body.position[axis] as number;
            if (at < min || at > max) {
                body.position[axis] = Math.min(max, Math.max(min, at));
                met = true;
            }
        }
        if (!met) return false;
        const speed = body.velocity[axis] as number;
        // Only a velocity toward what it met turns or stops; a held key pushing it there is not changed
        if (speed !== 0 && Math.sign(speed) === Math.sign(part)) body.velocity[axis] = body.spec.onContact === 'bounce' ? -speed : 0;
        return true;
    }

    /** True when the boxes of two bodies go into each other, deeper than touching */
    private overlaps(a: PlayBody, b: PlayBody): boolean {
        for (let axis = 0; axis < 3; axis += 1) {
            if (Math.abs((a.position[axis] as number) - (b.position[axis] as number)) >= (a.half[axis] as number) + (b.half[axis] as number) - TOUCH) return false;
        }
        return true;
    }

    /** True when the boxes of two bodies touch or go into each other */
    private touches(a: PlayBody, b: PlayBody): boolean {
        for (let axis = 0; axis < 3; axis += 1) {
            if (Math.abs((a.position[axis] as number) - (b.position[axis] as number)) > (a.half[axis] as number) + (b.half[axis] as number) + TOUCH) return false;
        }
        return true;
    }

    /** True when a solid of the same parent holds the body up: its bottom rests on the solid's top */
    private supported(body: PlayBody): boolean {
        if (!body.spec.solid) return false;
        return this.bodies.some((other) => {
            if (other === body || !other.spec.solid || other.parent !== body.parent) return false;
            const gap = (body.position[1] - body.half[1]) - (other.position[1] + other.half[1]);
            if (gap > TOUCH || gap < -TOUCH * 10) return false;
            for (const axis of [0, 2]) {
                if (Math.abs((body.position[axis] as number) - (other.position[axis] as number)) >= (body.half[axis] as number) + (other.half[axis] as number) - TOUCH) return false;
            }
            return true;
        });
    }

    /** The pairs that touch now: two solids of the same parent, or a body at a side of its bounds */
    private touchingPairs(bodies: readonly PlayBody[]): Set<string> {
        const pairs = new Set<string>();
        for (let i = 0; i < bodies.length; i += 1) {
            const a = bodies[i] as PlayBody;
            if (a.bounds !== undefined) {
                const { minX, maxX, minZ, maxZ } = a.bounds;
                const [x, , z] = a.position;
                if (x <= minX + TOUCH) pairs.add(`${a.path}${BOUND_MARK}left`);
                if (x >= maxX - TOUCH) pairs.add(`${a.path}${BOUND_MARK}right`);
                if (z <= minZ + TOUCH) pairs.add(`${a.path}${BOUND_MARK}back`);
                if (z >= maxZ - TOUCH) pairs.add(`${a.path}${BOUND_MARK}front`);
            }
            if (!a.spec.solid) continue;
            for (let j = i + 1; j < bodies.length; j += 1) {
                const b = bodies[j] as PlayBody;
                if (b.spec.solid && b.parent === a.parent && this.touches(a, b)) pairs.add(pairKey(a.path, b.path));
            }
        }
        return pairs;
    }

    /** The contacts of a pair that began to touch: one for each body, or one for a side of the bounds */
    private contactsOf(pair: string): PlayContact[] {
        const bound = pair.indexOf(BOUND_MARK);
        if (bound >= 0) {
            const body = this.byPath.get(pair.slice(0, bound)) as PlayBody;
            return [{ path: body.path, key: body.key, with: BOUNDS_CONTACT, side: pair.slice(bound + 1) as ContactSide }];
        }
        const [first, second] = pair.split(PAIR_MARK) as [string, string];
        const a = this.byPath.get(first) as PlayBody;
        const b = this.byPath.get(second) as PlayBody;
        // The axis they are closest to coming apart on is the one they met along
        let axis = 0;
        let widest = Number.NEGATIVE_INFINITY;
        for (let index = 0; index < 3; index += 1) {
            const gap = Math.abs((a.position[index] as number) - (b.position[index] as number)) - ((a.half[index] as number) + (b.half[index] as number));
            if (gap > widest) {
                widest = gap;
                axis = index;
            }
        }
        const [low, high] = SIDES_BY_AXIS[axis] as readonly [ContactSide, ContactSide];
        const aBelow = (a.position[axis] as number) <= (b.position[axis] as number);
        return [
            { path: a.path, key: a.key, with: b.key, side: aBelow ? high : low },
            { path: b.path, key: b.key, with: a.key, side: aBelow ? low : high }
        ];
    }
}
