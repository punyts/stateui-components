import { describe, expect, it } from 'vitest';
import { DEFAULT_ANIMATION_DURATION, FADE_LOW, PULSE_GROWTH, animatedProperties, createAnimations, readAnimation } from './animate.js';
import type { Animations } from './animate.js';
import { createScheduler } from './scheduler.js';
import type { Scheduler } from './scheduler.js';
import type { ShapeTree } from './tree.js';

/** Animations on a scheduler with a fake clock: `tick(ms)` moves the clock and runs the frame that was asked for */
function fakeAnimations(): { animations: Animations; scheduler: Scheduler; tick(ms: number): void; requested(): number; frames(): number } {
    let time = 1000;
    let pending: (() => void) | undefined;
    let requests = 0;
    let frames = 0;
    const scheduler = createScheduler({
        now: () => time,
        requestFrame(callback) {
            requests += 1;
            pending = callback;
            return requests;
        },
        cancelFrame() {
            pending = undefined;
        },
        onFrame() {
            frames += 1;
        }
    });
    return {
        animations: createAnimations(scheduler),
        scheduler,
        tick(ms) {
            time += ms;
            const run = pending;
            pending = undefined;
            run?.();
        },
        requested: () => requests,
        frames: () => frames
    };
}

const shape = (properties: Record<string, unknown>, children: ShapeTree[] = []): ShapeTree => ({
    kind: children.length > 0 ? 'drawGroup' : 'rect',
    key: 'a',
    path: '$.app.children.a',
    properties: { x: 0, y: 0, width: 10, height: 10, ...properties } as ShapeTree['properties'],
    children
});

const propertyOf = (tree: readonly ShapeTree[], name: string): unknown => tree[0]!.properties[name];

describe('readAnimation', () => {
    it('should read a named animation with its defaults, and nothing for another name or a value that is not an object', () => {
        // Act / Assert
        expect(readAnimation({ name: 'spin' })).toEqual({ name: 'spin', duration: DEFAULT_ANIMATION_DURATION, loop: true, delay: 0 });
        expect(readAnimation({ name: 'blink', duration: 400, loop: false, delay: 50 })).toEqual({ name: 'blink', duration: 400, loop: false, delay: 50 });
        expect(readAnimation({ name: 'wobble' })).toBeUndefined();
        expect(readAnimation('spin')).toBeUndefined();
        expect(readAnimation(undefined)).toBeUndefined();
    });
});

describe('animatedProperties', () => {
    const at = (name: string, p: number, properties: Record<string, unknown> = {}): Record<string, unknown> =>
        animatedProperties(shape(properties), readAnimation({ name })!, p);

    it('should turn spin a full turn from the shape own rotate', () => {
        expect(at('spin', 0, { rotate: 10 })).toEqual({ rotate: 10 });
        expect(at('spin', 0.25, { rotate: 10 })).toEqual({ rotate: 100 });
    });

    it('should grow pulse at the middle of the cycle, a list scale too, and rest at the ends', () => {
        expect(at('pulse', 0).scale).toBeCloseTo(1);
        expect(at('pulse', 0.5).scale).toBeCloseTo(1 + PULSE_GROWTH);
        expect(at('pulse', 0.5, { scale: [2, 1] }).scale).toEqual([2 * (1 + PULSE_GROWTH), 1 + PULSE_GROWTH]);
    });

    it('should dim fade at the middle of the cycle and hide blink in the second half', () => {
        expect(at('fade', 0.5, { opacity: 0.5 }).opacity).toBeCloseTo(0.5 * FADE_LOW);
        expect(at('fade', 0).opacity).toBeCloseTo(1);
        expect(at('blink', 0.25, { opacity: 0.8 }).opacity).toBe(0.8);
        expect(at('blink', 0.75).opacity).toBe(0);
    });
});

describe('createAnimations', () => {
    it('should ask for no frame when no shape animates', () => {
        // Arrange
        const { animations, scheduler, requested } = fakeAnimations();

        // Act
        const tree = [shape({ rotate: 5 })];
        const shown = animations.follow(tree);

        // Assert
        expect(shown).toBe(tree);
        expect(requested()).toBe(0);
        expect(scheduler.idle).toBe(true);
    });

    it('should spin a shape over time from its first frame, looping, and never change the tree it was given', () => {
        // Arrange
        const { animations, tick } = fakeAnimations();
        const tree = [shape({ animate: { name: 'spin', duration: 1000 } })];

        // Act
        const first = animations.follow(tree);
        tick(16);
        const start = animations.decorate(tree);
        tick(250);
        const quarter = animations.decorate(tree);
        tick(1000);
        const again = animations.decorate(tree);

        // Assert
        expect(propertyOf(first, 'rotate')).toBeUndefined();
        expect(propertyOf(start, 'rotate')).toBe(0);
        expect(propertyOf(quarter, 'rotate')).toBeCloseTo(90);
        expect(propertyOf(again, 'rotate')).toBeCloseTo(90);
        expect(tree[0]!.properties.rotate).toBeUndefined();
    });

    it('should rest during the delay, play once without loop and then stop asking for frames', () => {
        // Arrange
        const { animations, scheduler, tick, frames } = fakeAnimations();
        const tree = [shape({ animate: { name: 'spin', duration: 100, delay: 50, loop: false } })];
        animations.follow(tree);
        tick(16);

        // Act
        tick(30);
        const delayed = animations.decorate(tree);
        tick(70);
        const playing = animations.decorate(tree);
        tick(200);
        const ended = animations.decorate(tree);
        const framesAfterEnd = frames();
        tick(16);

        // Assert
        expect(propertyOf(delayed, 'rotate')).toBeUndefined();
        expect(propertyOf(playing, 'rotate')).toBeCloseTo(180);
        expect(propertyOf(ended, 'rotate')).toBeUndefined();
        expect(scheduler.idle).toBe(true);
        expect(frames()).toBe(framesAfterEnd);
    });

    it('should show the resting shape and ask for no frame while motion is reduced, then start again from its beginning', () => {
        // Arrange
        const { animations, scheduler, tick, requested } = fakeAnimations();
        const tree = [shape({ animate: { name: 'spin', duration: 1000 } })];
        animations.follow(tree);
        tick(16);
        tick(250);

        // Act: reduced
        scheduler.setReduced(true);
        const reduced = animations.follow(tree);
        const asked = requested();
        tick(100);

        // Assert
        expect(propertyOf(reduced, 'rotate')).toBeUndefined();
        expect(scheduler.idle).toBe(true);
        expect(requested()).toBe(asked);

        // Act: full motion again
        scheduler.setReduced(false);
        animations.follow(tree);
        tick(16);
        const restart = animations.decorate(tree);
        tick(100);
        const later = animations.decorate(tree);

        // Assert
        expect(propertyOf(restart, 'rotate')).toBe(0);
        expect(propertyOf(later, 'rotate')).toBeCloseTo(36);
    });

    it('should stop when the shape loses its animate or is hidden, and restart when animate changes', () => {
        // Arrange
        const { animations, scheduler, tick } = fakeAnimations();
        animations.follow([shape({ animate: { name: 'spin' } })]);
        tick(16);
        tick(100);

        // Act
        animations.follow([shape({ animate: { name: 'spin' }, hidden: true })]);
        const hiddenIdle = scheduler.idle;
        animations.follow([shape({})]);
        const goneIdle = scheduler.idle;
        const changed = [shape({ animate: { name: 'pulse', duration: 400 } })];
        animations.follow(changed);
        tick(16);
        tick(200);

        // Assert
        expect(hiddenIdle).toBe(true);
        expect(goneIdle).toBe(true);
        expect(propertyOf(animations.decorate(changed), 'scale')).toBeCloseTo(1 + PULSE_GROWTH);
    });

    it('should animate a shape inside a group', () => {
        // Arrange
        const { animations, tick } = fakeAnimations();
        const inner: ShapeTree = { kind: 'circle', key: 'dot', path: '$.app.children.a.children.dot', properties: { r: 2, animate: { name: 'blink', duration: 100 } }, children: [] };
        const tree = [shape({}, [inner])];
        animations.follow(tree);
        tick(16);

        // Act
        tick(75);
        const shown = animations.decorate(tree);

        // Assert
        expect(shown[0]!.children[0]!.properties.opacity).toBe(0);
        expect([...animations.paths()]).toEqual(['$.app.children.a.children.dot']);
    });
});
