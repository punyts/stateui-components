import { DEFAULT_GRAVITY, PlayWorld, STEP_SECONDS, geometryHalf, readBody, readBounds, sphereRadius, turnedHalf } from './play.js';
import type { PlayBody, Vec3 } from './play.js';

const NONE = new Set<string>();

/** A body of the scene `$.s` with a unit box by default */
const body = (key: string, extra: Partial<Omit<PlayBody, 'spec'>> & { spec?: Parameters<typeof readBody>[0] } = {}): PlayBody => ({
    path: `$.s.children.${key}`,
    key,
    parent: '$.s.children',
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    half: [0.5, 0.5, 0.5],
    ...extra,
    spec: readBody(extra.spec ?? { solid: true }) as PlayBody['spec']
});

/** Runs `count` steps and gives every contact and rest */
function run(world: PlayWorld, count: number, held: ReadonlySet<string> = NONE, gravity: Readonly<Vec3> = DEFAULT_GRAVITY) {
    const contacts = [];
    const rested = [];
    for (let index = 0; index < count; index += 1) {
        const result = world.step(STEP_SECONDS, gravity, held);
        contacts.push(...result.contacts);
        rested.push(...result.rested);
    }
    return { contacts, rested };
}

describe('reading a body', () => {
    it('should read the body, keep only scene keys in control, and stop by default', () => {
        // Act
        const spec = readBody({ control: { ArrowLeft: [-6, 0, 0], Shift: [1, 0, 0], a: [0, 0, 9999] }, falls: true });

        // Assert
        expect(spec).toEqual({ control: { ArrowLeft: [-6, 0, 0], a: [0, 0, 1000] }, falls: true, solid: false, onContact: 'stop', unknownKeys: ['Shift'] });
        expect(readBody(undefined)).toBeUndefined();
        expect(readBody({ onContact: 'bounce' })?.onContact).toBe('bounce');
    });

    it('should give the half size of each geometry with the renderer\'s defaults, and of a turned and scaled box', () => {
        // Assert
        expect(geometryHalf({ kind: 'box', width: 2, height: 4, depth: 6 })).toEqual([1, 2, 3]);
        expect(geometryHalf({ kind: 'sphere' })).toEqual([0.5, 0.5, 0.5]);
        expect(geometryHalf({ kind: 'plane', width: 10, height: 8 })).toEqual([5, 4, 0]);
        expect(geometryHalf({ kind: 'capsule' })).toEqual([0.25, 0.5, 0.25]);
        expect(geometryHalf(undefined)).toEqual([0.5, 0.5, 0.5]);
        // A plane turned flat (-90° about x) is a floor: wide in x and z, no height
        expect(turnedHalf([5, 4, 0], [1, 1, 1], [-90, 0, 0])).toEqual([5, 0, 4]);
        expect(turnedHalf([1, 2, 3], [2, 1, 1], [0, 0, 0])).toEqual([2, 2, 3]);
    });

    it('should read bounds as the range of the position', () => {
        expect(readBounds({ x: -4, z: -2, width: 8, depth: 4 })).toEqual({ minX: -4, maxX: 4, minZ: -2, maxZ: 2 });
        expect(readBounds({ x: 0, z: 0, width: -1, depth: 1 })).toBeUndefined();
    });
});

describe('a step of the world', () => {
    it('should move a body by its velocity and the keys held on its control, and rest it when they stop', () => {
        // Arrange
        const paddle = body('paddle', { spec: { control: { ArrowRight: [6, 0, 0] } } });
        const world = new PlayWorld([paddle]);

        // Act
        const held = run(world, 30, new Set(['ArrowRight']));
        const released = run(world, 2);

        // Assert
        expect(paddle.position[0]).toBeCloseTo(3, 6);
        expect(paddle.velocity).toEqual([0, 0, 0]);
        expect(held.rested).toEqual([]);
        expect(released.rested).toEqual(['$.s.children.paddle']);
        expect(world.anyMoves(NONE)).toBe(false);
    });

    it('should rest a body whose key came up before the next step, once', () => {
        // Arrange
        const paddle = body('paddle', { spec: { control: { ArrowRight: [6, 0, 0] } } });
        const world = new PlayWorld([paddle]);
        run(world, 3, new Set(['ArrowRight']));

        // Act
        const first = world.settle(new Set(['ArrowRight']));
        const second = world.settle(NONE);
        const third = world.settle(NONE);

        // Assert
        expect(first).toEqual([]);
        expect(second).toEqual(['$.s.children.paddle']);
        expect(third).toEqual([]);
        expect(run(world, 1).rested).toEqual([]);
    });

    it('should let a falling body land on a solid floor, tell the contact once, and rest it there', () => {
        // Arrange
        const ball = body('ball', { position: [0, 3, 0], spec: { solid: true, falls: true } });
        const floor = body('floor', { position: [0, -0.5, 0], half: [5, 0.5, 5] });
        const world = new PlayWorld([ball, floor]);

        // Act
        const { contacts, rested } = run(world, 120);

        // Assert
        expect(ball.position[1]).toBeCloseTo(0.5, 6);
        expect(ball.velocity).toEqual([0, 0, 0]);
        expect(contacts).toEqual([
            { path: '$.s.children.ball', key: 'ball', with: 'floor', side: 'bottom' },
            { path: '$.s.children.floor', key: 'floor', with: 'ball', side: 'top' }
        ]);
        expect(rested).toEqual(['$.s.children.ball']);
        expect(world.movesNow(ball, NONE)).toBe(false);
    });

    it('should bounce a body off a wall and tell the hit, and let a passing body go through and tell it once', () => {
        // Arrange
        const ball = body('ball', { velocity: [10, 0, 0], spec: { solid: true, onContact: 'bounce' } });
        const wall = body('wall', { position: [3, 0, 0], half: [0.5, 2, 2] });
        const ghost = body('ghost', { position: [3.4, 0, 5], velocity: [0, 0, -10], spec: { solid: true, onContact: 'pass' } });
        const world = new PlayWorld([ball, wall, ghost]);

        // Act
        const { contacts } = run(world, 30, NONE, [0, 0, 0]);

        // Assert
        expect(ball.velocity[0]).toBe(-10);
        expect(ball.position[0]).toBeLessThan(2);
        expect(contacts.filter((contact) => contact.key === 'ball' && contact.with === 'wall')).toEqual([{ path: '$.s.children.ball', key: 'ball', with: 'wall', side: 'right' }]);
        expect(ghost.position[2]).toBeCloseTo(0, 6);
        expect(ghost.velocity).toEqual([0, 0, -10]);
        expect(contacts.filter((contact) => contact.key === 'ghost')).toEqual([{ path: '$.s.children.ghost', key: 'ghost', with: 'wall', side: 'back' }]);
    });

    it('should keep a body in its bounds, telling the side it reached', () => {
        // Arrange
        const runner = body('runner', { velocity: [-20, 0, 0], bounds: readBounds({ x: -2, z: -1, width: 4, depth: 2 }), spec: {} });
        const world = new PlayWorld([runner]);

        // Act
        const { contacts, rested } = run(world, 20, NONE, [0, 0, 0]);

        // Assert
        expect(runner.position[0]).toBe(-2);
        expect(runner.velocity).toEqual([0, 0, 0]);
        expect(contacts).toEqual([{ path: '$.s.children.runner', key: 'runner', with: 'bounds', side: 'left' }]);
        expect(rested).toEqual(['$.s.children.runner']);
    });

    it('should meet a thin wall at a high speed, and not collide with a body of another parent', () => {
        // Arrange
        const bullet = body('bullet', { velocity: [600, 0, 0], half: [0.1, 0.1, 0.1] });
        const wall = body('wall', { position: [5, 0, 0], half: [0, 2, 2] });
        const elsewhere = body('elsewhere', { parent: '$.s.children.group.children', position: [2, 0, 0] });
        const world = new PlayWorld([bullet, wall, elsewhere]);

        // Act
        const { contacts } = run(world, 3, NONE, [0, 0, 0]);

        // Assert
        expect(bullet.position[0]).toBeCloseTo(4.9, 6);
        expect(contacts.map((contact) => `${contact.key}:${contact.with}`)).toEqual(['bullet:wall', 'wall:bullet']);
    });

    it('should tell no contact for what touches when the world is made', () => {
        // Arrange
        const box = body('box', { position: [0, 0.5, 0] });
        const floor = body('floor', { position: [0, -0.5, 0], half: [5, 0.5, 5] });

        // Act
        const { contacts } = run(new PlayWorld([box, floor]), 5);

        // Assert
        expect(contacts).toEqual([]);
    });
});

describe('spheres, copies and the grid (F2)', () => {
    it('should give a sphere mesh scaled evenly a radius, and none to another shape or an uneven scale', () => {
        // Act
        const even = sphereRadius({ kind: 'sphere', radius: 0.5 }, [2, 2, -2]);
        const uneven = sphereRadius({ kind: 'sphere' }, [1, 2, 1]);
        const box = sphereRadius({ kind: 'box' }, [1, 1, 1]);

        // Assert
        expect(even).toBe(1);
        expect(uneven).toBeUndefined();
        expect(box).toBeUndefined();
    });

    it('should rest a falling sphere on the edge of a box lower than a box would, where its surface meets the edge', () => {
        // Arrange
        const ball = body('ball', { position: [0.8, 3, 0], radius: 0.5, spec: { solid: true, falls: true } });
        const block = body('block', { position: [0, 0, 0] });
        const world = new PlayWorld([ball, block]);

        // Act
        const { contacts } = run(world, 120);

        // Assert
        expect(ball.position[1]).toBeCloseTo(0.9, 6);
        expect(ball.velocity).toEqual([0, 0, 0]);
        expect(contacts.map((contact) => [contact.key, contact.with])).toEqual([['ball', 'block'], ['block', 'ball']]);
        expect(world.movesNow(ball, NONE)).toBe(false);
    });

    it('should stop a sphere at another sphere it meets off centre, where their surfaces touch', () => {
        // Arrange
        const ball = body('ball', { position: [-3, 0, 0], velocity: [6, 0, 0], radius: 0.5 });
        const other = body('other', { position: [0, 0, 0.6], radius: 0.5 });
        const world = new PlayWorld([ball, other]);

        // Act
        run(world, 60, NONE, [0, 0, 0]);

        // Assert
        expect(ball.position[0]).toBeCloseTo(-0.8, 6);
        expect(ball.velocity).toEqual([0, 0, 0]);
    });

    it('should name the repeat of a copy it meets, and meet one copy among thousands of still ones by the grid', () => {
        // Arrange
        const copies: PlayBody[] = [];
        for (let x = 0; x < 50; x += 1) {
            for (let z = 0; z < 60; z += 1) copies.push({ ...body(`c${x}-${z}`, { position: [x * 2, 0, z * 2] }), path: `$.s.children.coins.rows.c${x}-${z}`, repeat: 'coins' });
        }
        const ball = body('ball', { position: [20, 5, 30], spec: { solid: true, falls: true } });
        const world = new PlayWorld([...copies, ball]);

        // Act
        const { contacts, rested } = run(world, 120);

        // Assert
        expect(ball.position[1]).toBeCloseTo(1, 6);
        expect(contacts).toEqual([
            { path: '$.s.children.ball', key: 'ball', with: 'c10-15', repeat: 'coins', side: 'bottom' },
            { path: '$.s.children.coins.rows.c10-15', key: 'c10-15', with: 'ball', side: 'top' }
        ]);
        expect(rested).toEqual(['$.s.children.ball']);
    });
});
