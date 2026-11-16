import { describe, expect, it } from 'vitest';
import type { JsonValue } from '@punyts/stateui-app/core';
import { createScheduler } from './scheduler.js';
import type { Scheduler } from './scheduler.js';
import { createTransitions, formatColor, keyPath, parseColor, settleMoves } from './transition.js';
import type { Transitions } from './transition.js';
import { readShapeTree } from './tree.js';
import type { ShapeTree } from './tree.js';

const ROOT = '$.app.children';

/** A linear 100 ms transition (the theme below makes `enter` linear) */
const LINEAR = { duration: 100, easing: 'enter' };

const THEME: Record<string, string> = {
    '--ui-motion-easing-enter': 'linear',
    '--ui-motion-duration-base': '200ms',
    '--ui-motion-duration-slow': '400ms',
    '--ui-color-accent-base': '#ff0000'
};

/** Transitions on a fake clock: `tick(ms)` moves it and runs the frame asked for */
function setup(theme: Record<string, string> = THEME): { transitions: Transitions; scheduler: Scheduler; tick(ms: number): void; drawn: Set<string>[] } {
    let time = 0;
    let pending: (() => void) | undefined;
    const drawn: Set<string>[] = [];
    const scheduler = createScheduler({
        now: () => time,
        requestFrame(callback) {
            pending = callback;
            return 1;
        },
        cancelFrame() {
            pending = undefined;
        },
        onFrame: (changed) => drawn.push(new Set([...changed].map(keyPath)))
    });
    const transitions = createTransitions({ scheduler, read: (name) => theme[name] });
    return {
        transitions,
        scheduler,
        tick(ms) {
            time += ms;
            const run = pending;
            pending = undefined;
            run?.();
        },
        drawn
    };
}

/** The shape tree of a drawing's children */
const treeOf = (children: Record<string, JsonValue>): readonly ShapeTree[] => readShapeTree(children, ROOT).shapes;

const valueAt = (tree: readonly ShapeTree[], key: string, property: string): JsonValue | undefined => tree.find((shape) => shape.key === key)?.properties[property];

const dot = (cx: number, extra: Record<string, JsonValue> = {}): JsonValue => ({ component: 'circle', cx, cy: 10, r: 5, transition: LINEAR, ...extra });

describe('parseColor', () => {
    it.each([
        ['#f00', [255, 0, 0, 1]],
        ['#ff000080', [255, 0, 0, 128 / 255]],
        ['rgb(10, 20, 30)', [10, 20, 30, 1]],
        ['rgba(10, 20, 30, 0.5)', [10, 20, 30, 0.5]],
        ['rgb(10 20 30 / 50%)', [10, 20, 30, 0.5]],
        ['hsl(120, 100%, 50%)', [0, 255, 0, 1]],
        ['hsl(240deg 100% 50% / 0.25)', [0, 0, 255, 0.25]],
        ['transparent', [0, 0, 0, 0]]
    ])('should read %s', (text, rgba) => {
        const parsed = parseColor(text)!;

        rgba.forEach((value, index) => expect(parsed[index]).toBeCloseTo(value, 6));
    });

    it.each([['red'], ['oklch(0.5 0.1 200)'], ['#12'], ['rgb(1, 2)']])('should not read %s', (text) => {
        expect(parseColor(text)).toBeUndefined();
    });

    it('should write a tweened colour as an rgba() literal', () => {
        expect(formatColor([127.6, 0, 300, 0.33333])).toBe('rgba(128, 0, 255, 0.333)');
    });
});

describe('createTransitions', () => {
    it('should tween a changed number of a shape with transition, and show the new value once it ends', () => {
        // Arrange
        const { transitions, tick, drawn } = setup();
        transitions.apply(treeOf({ a: dot(10) }));

        // Act
        const first = transitions.apply(treeOf({ a: dot(90) }));
        tick(50);
        const half = transitions.current();
        tick(50);
        const end = transitions.current();

        // Assert
        expect(valueAt(first, 'a', 'cx')).toBe(10);
        expect(valueAt(half, 'a', 'cx')).toBeCloseTo(50, 6);
        expect(valueAt(end, 'a', 'cx')).toBe(90);
        expect(drawn).toEqual([new Set([`${ROOT}.a`]), new Set([`${ROOT}.a`])]);
    });

    it('should jump a property of a shape without transition, and a value that is not a number or colour', () => {
        // Arrange
        const { transitions, scheduler } = setup();
        transitions.apply(treeOf({ a: { component: 'circle', cx: 10, r: 5 }, b: { component: 'polygon', points: [[0, 0], [1, 1], [2, 0]], transition: LINEAR } }));

        // Act
        const shown = transitions.apply(treeOf({ a: { component: 'circle', cx: 90, r: 5 }, b: { component: 'polygon', points: [[0, 0], [5, 5], [2, 0]], transition: LINEAR } }));

        // Assert
        expect(valueAt(shown, 'a', 'cx')).toBe(90);
        expect(valueAt(shown, 'b', 'points')).toEqual([[0, 0], [5, 5], [2, 0]]);
        expect(scheduler.idle).toBe(true);
    });

    it('should start a new value mid-tween from the value on screen', () => {
        // Arrange
        const { transitions, tick } = setup();
        transitions.apply(treeOf({ a: dot(0) }));
        transitions.apply(treeOf({ a: dot(100) }));
        tick(50);

        // Act: back to 0 from 50
        const at = transitions.apply(treeOf({ a: dot(0) }));
        tick(50);

        // Assert
        expect(valueAt(at, 'a', 'cx')).toBeCloseTo(50, 6);
        expect(valueAt(transitions.current(), 'a', 'cx')).toBeCloseTo(25, 6);
    });

    it('should tween fill between a literal and a token colour', () => {
        // Arrange
        const { transitions, tick } = setup();
        transitions.apply(treeOf({ a: dot(0, { fill: '#000000' }) }));

        // Act
        transitions.apply(treeOf({ a: dot(0, { fill: '{color.accent.base}' }) }));
        tick(50);
        const half = valueAt(transitions.current(), 'a', 'fill');
        tick(50);

        // Assert
        expect(half).toBe('rgba(128, 0, 0, 1)');
        expect(valueAt(transitions.current(), 'a', 'fill')).toBe('{color.accent.base}');
    });

    it('should jump a colour it cannot read (a paint name)', () => {
        // Arrange
        const { transitions, scheduler } = setup();
        transitions.apply(treeOf({ a: dot(0, { fill: '#000000' }) }));

        // Act
        const shown = transitions.apply(treeOf({ a: dot(0, { fill: 'sunset' }) }));

        // Assert
        expect(valueAt(shown, 'a', 'fill')).toBe('sunset');
        expect(scheduler.idle).toBe(true);
    });

    it('should take the duration from a motion.duration name', () => {
        // Arrange
        const { transitions, tick } = setup();
        transitions.apply(treeOf({ a: dot(0, { transition: { duration: 'slow', easing: 'enter' } }) }));

        // Act
        transitions.apply(treeOf({ a: dot(400, { transition: { duration: 'slow', easing: 'enter' } }) }));
        tick(100);

        // Assert: 100 ms of 400 is a quarter of the way
        expect(valueAt(transitions.current(), 'a', 'cx')).toBeCloseTo(100, 6);
    });

    it('should jump every change with reduced motion, and end a running tween when motion becomes reduced', () => {
        // Arrange
        const { transitions, scheduler, tick } = setup();
        transitions.apply(treeOf({ a: dot(0), b: dot(0) }));
        transitions.apply(treeOf({ a: dot(100), b: dot(0) }));
        tick(50);

        // Act
        scheduler.setReduced(true);
        const ended = transitions.current();
        const jumped = transitions.apply(treeOf({ a: dot(100), b: dot(80) }));

        // Assert
        expect(valueAt(ended, 'a', 'cx')).toBe(100);
        expect(valueAt(jumped, 'b', 'cx')).toBe(80);
        expect(scheduler.idle).toBe(true);
    });

    it('should jump a duration of 0, which is what the reduced overlay makes of a named duration', () => {
        // Arrange
        const { transitions, scheduler } = setup({ ...THEME, '--ui-motion-duration-base': '0ms' });
        transitions.apply(treeOf({ a: dot(0, { transition: { duration: 'base' } }) }));

        // Act
        const shown = transitions.apply(treeOf({ a: dot(100, { transition: { duration: 'base' } }) }));

        // Assert
        expect(valueAt(shown, 'a', 'cx')).toBe(100);
        expect(scheduler.idle).toBe(true);
    });

    it('should tween a shape inside a group by its own path, and give back the same tree when nothing runs', () => {
        // Arrange
        const { transitions, tick } = setup();
        const group = (x: number): readonly ShapeTree[] => treeOf({ g: { component: 'drawGroup', children: { a: dot(x), b: { component: 'rect', width: 1, height: 1 } } } });
        transitions.apply(group(0));

        // Act
        const input = group(100);
        const moving = transitions.apply(input);
        tick(100);
        const still = group(100);
        const after = transitions.apply(still);

        // Assert
        expect(moving[0]!.children[0]!.properties.cx).toBe(0);
        expect(moving[0]!.children[1]).toBe(input[0]!.children[1]);
        expect(after).toBe(still);
    });

    it('should settle a moved position at once, so the write that follows does not tween (a drag release)', () => {
        // Arrange
        const { transitions, scheduler } = setup();
        transitions.apply(treeOf({ a: { component: 'rect', x: 10, y: 10, width: 5, height: 5, transition: LINEAR } }));
        const moves: unknown[] = [];
        const options = settleMoves({ renderer: 'svg', reducedMotion: () => false, readProperty: () => undefined, onEvent: () => undefined, onMove: (move) => moves.push(move) }, transitions);

        // Act: the drag hands the new position to the feeder, which writes it, and the next tree brings it
        options.onMove?.({ shape: `${ROOT}.a`, key: 'a', x: 60, y: 30 });
        const shown = transitions.apply(treeOf({ a: { component: 'rect', x: 60, y: 30, width: 5, height: 5, transition: LINEAR } }));

        // Assert
        expect(moves).toHaveLength(1);
        expect([valueAt(shown, 'a', 'x'), valueAt(shown, 'a', 'y')]).toEqual([60, 30]);
        expect(scheduler.idle).toBe(true);
    });

    it('should not tween a shape that is new or gone', () => {
        // Arrange
        const { transitions, scheduler, tick } = setup();
        transitions.apply(treeOf({ a: dot(0) }));
        transitions.apply(treeOf({ a: dot(100) }));

        // Act
        const gone = transitions.apply(treeOf({ b: dot(50) }));
        tick(16);

        // Assert
        expect(valueAt(gone, 'b', 'cx')).toBe(50);
        expect(scheduler.idle).toBe(true);
    });
});
