import { describe, expect, it } from 'vitest';
import { createScheduler, cubicBezier } from '../drawing/scheduler.js';
import type { Scheduler } from '../drawing/scheduler.js';
import type { ShapeTree } from '../drawing/tree.js';
import { buildScene } from './chart.js';
import { primitivePath, sceneToTree } from './drawingTree.js';
import { createChartMotion, geometryOf, withGeometry } from './motion.js';
import type { ChartInput, ChartType, Sector } from './scene.js';

/** A scheduler on a fake clock: `tick(ms)` moves the clock and runs the frame that was asked for */
function fakeScheduler(): { scheduler: Scheduler; tick(ms: number): void; requested(): number } {
    let time = 1000;
    let pending: (() => void) | undefined;
    let requests = 0;
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
        onFrame: () => undefined
    });
    return {
        scheduler,
        tick(ms) {
            time += ms;
            const run = pending;
            pending = undefined;
            run?.();
        },
        requested: () => requests
    };
}

const LINEAR = { duration: 100, easing: cubicBezier(0, 0, 1, 1) };

const input = (type: ChartType, values: readonly number[], overrides: Partial<ChartInput> = {}): ChartInput => ({
    type,
    categories: ['Jan', 'Feb', 'Mar'],
    series: [{ key: 'a', label: 'A', values }],
    stacked: false,
    width: 400,
    height: 200,
    format: String,
    percent: (share) => `${Math.round(share * 100)}%`,
    hidden: new Set(),
    texts: { total: 'Total', category: 'Category', value: 'Value', share: 'Share' },
    ...overrides
});

/** The tree and the slice sectors of a chart, as the controller hands them to the motion */
function treeOf(chart: ChartInput): { shapes: readonly ShapeTree[]; sectors: Map<string, Sector> } {
    const scene = buildScene(chart);
    const sectors = new Map<string, Sector>();
    for (const primitive of scene.primitives) if (primitive.sector !== undefined) sectors.set(primitivePath(primitive), primitive.sector);
    return { shapes: sceneToTree(scene).shapes, sectors };
}

const mark = (shapes: readonly ShapeTree[], path: string): ShapeTree => {
    const found = shapes.find((shape) => shape.key === 'marks')?.children.find((shape) => shape.path === path);
    if (!found) throw new Error(`no mark ${path}`);
    return found;
};
const numberOf = (shapes: readonly ShapeTree[], path: string, name: string): number => mark(shapes, path).properties[name] as number;
const between = (value: number, a: number, b: number): boolean => value > Math.min(a, b) + 1e-6 && value < Math.max(a, b) - 1e-6;

describe('geometryOf and withGeometry', () => {
    it('should read a bar, a point and the numbers of path data, and write them back', () => {
        // Arrange
        const { shapes } = treeOf(input('line', [10, 20, 30]));
        const line = mark(shapes, 'marks.line:a');
        const dot = mark(shapes, 'marks.dot:a:1');

        // Act
        const lineGeometry = geometryOf(line)!;
        const dotGeometry = geometryOf(dot)!;
        const moved = withGeometry(line, lineGeometry, lineGeometry.values.map((value) => value + 1));

        // Assert
        expect(lineGeometry.form).toBe('d:M# # L# # L# #');
        expect(lineGeometry.values).toHaveLength(6);
        expect(dotGeometry).toEqual({ form: 'circle', values: [dot.properties.cx, dot.properties.cy, 3] });
        expect(geometryOf(moved)?.values).toEqual(lineGeometry.values.map((value) => value + 1));
        expect(geometryOf({ ...line, kind: 'drawText' })).toBeUndefined();
    });

    it('should read a slice as its two angles and draw it again from them', () => {
        // Arrange
        const { shapes, sectors } = treeOf(input('donut', [10, 20, 30]));
        const slice = mark(shapes, 'marks.slice:1');
        const sector = sectors.get('marks.slice:1')!;

        // Act
        const geometry = geometryOf(slice, sector)!;
        const same = withGeometry(slice, geometry, geometry.values, sector);

        // Assert
        expect(geometry).toEqual({ form: 'sector', values: [sector.from, sector.to] });
        expect(same.properties.d).toBe(slice.properties.d);
    });
});

describe('createChartMotion', () => {
    it('should tween a bar from its old height to its new one with timing, and give the target tree at the end', () => {
        // Arrange
        const { scheduler, tick } = fakeScheduler();
        const motion = createChartMotion(scheduler);
        const before = treeOf(input('bar', [10, 20, 30]));
        const after = treeOf(input('bar', [10, 20, 15]));
        motion.apply(before.shapes, before.sectors, undefined);
        const from = numberOf(before.shapes, 'marks.bar:a:2', 'height');
        const to = numberOf(after.shapes, 'marks.bar:a:2', 'height');

        // Act
        const first = motion.apply(after.shapes, after.sectors, LINEAR);
        tick(50);
        const middle = motion.current();
        tick(60);
        const end = motion.current();

        // Assert
        expect(numberOf(first, 'marks.bar:a:2', 'height')).toBeCloseTo(from, 6);
        expect(numberOf(middle, 'marks.bar:a:2', 'height')).toBeCloseTo((from + to) / 2, 6);
        expect(end).toBe(after.shapes);
        expect(scheduler.idle).toBe(true);
    });

    it('should start a records change mid-tween from the current geometry and end at the new one', () => {
        // Arrange
        const { scheduler, tick } = fakeScheduler();
        const motion = createChartMotion(scheduler);
        const a = treeOf(input('line', [10, 20, 30]));
        const b = treeOf(input('line', [10, 20, 0]));
        const c = treeOf(input('line', [10, 20, 20]));
        motion.apply(a.shapes, a.sectors, undefined);
        motion.apply(b.shapes, b.sectors, LINEAR);
        tick(40);
        const where = numberOf(motion.current(), 'marks.dot:a:2', 'cy');

        // Act
        const restart = motion.apply(c.shapes, c.sectors, LINEAR);
        tick(50);
        const middle = numberOf(motion.current(), 'marks.dot:a:2', 'cy');
        tick(60);

        // Assert
        expect(numberOf(restart, 'marks.dot:a:2', 'cy')).toBeCloseTo(where, 6);
        expect(middle).toBeCloseTo((where + numberOf(c.shapes, 'marks.dot:a:2', 'cy')) / 2, 6);
        expect(motion.current()).toBe(c.shapes);
    });

    it('should tween the path of a line and the angles of a slice', () => {
        // Arrange
        const { scheduler, tick } = fakeScheduler();
        const lines = createChartMotion(scheduler);
        const lineA = treeOf(input('line', [10, 20, 30]));
        const lineB = treeOf(input('line', [30, 20, 10]));
        lines.apply(lineA.shapes, lineA.sectors, undefined);
        const { scheduler: donutScheduler, tick: donutTick } = fakeScheduler();
        const ring = createChartMotion(donutScheduler);
        const donutA = treeOf(input('donut', [10, 10, 20]));
        const donutB = treeOf(input('donut', [30, 10, 20]));
        ring.apply(donutA.shapes, donutA.sectors, undefined);

        // Act
        lines.apply(lineB.shapes, lineB.sectors, LINEAR);
        tick(50);
        const path = geometryOf(mark(lines.current(), 'marks.line:a'))!.values;
        ring.apply(donutB.shapes, donutB.sectors, LINEAR);
        donutTick(50);
        const slice = mark(ring.current(), 'marks.slice:0');
        const before = donutA.sectors.get('marks.slice:0')!;
        const after = donutB.sectors.get('marks.slice:0')!;
        const halfWay = withGeometry(slice, { form: 'sector', values: [] }, [after.from, (before.to + after.to) / 2], after);

        // Assert: the first point's y is half-way, and the first slice ends half-way between its two ends
        const startY = geometryOf(mark(lineA.shapes, 'marks.line:a'))!.values[1]!;
        const endY = geometryOf(mark(lineB.shapes, 'marks.line:a'))!.values[1]!;
        expect(path[1]).toBeCloseTo((startY + endY) / 2, 1);
        expect(slice.properties.d).toBe(halfWay.properties.d);
        expect(slice.properties.d).not.toBe(mark(donutA.shapes, 'marks.slice:0').properties.d);
        expect(slice.properties.d).not.toBe(mark(donutB.shapes, 'marks.slice:0').properties.d);
    });

    it('should jump without timing, for a mark that is new or changed its form, and with reduced motion ask for no frame', () => {
        // Arrange
        const { scheduler, requested } = fakeScheduler();
        const motion = createChartMotion(scheduler);
        const three = treeOf(input('line', [10, 20, 30]));
        const other = treeOf(input('line', [30, 20, 10]));
        const four = treeOf(input('line', [10, 20, 30, 40], { categories: ['Jan', 'Feb', 'Mar', 'Apr'] }));
        motion.apply(three.shapes, three.sectors, undefined);

        // Act
        const jumped = motion.apply(other.shapes, other.sectors, undefined);
        const grown = motion.apply(four.shapes, four.sectors, LINEAR);
        const grownLine = scheduler.valueOf('marks.line:a');
        motion.apply(three.shapes, three.sectors, undefined);
        scheduler.setReduced(true);
        const asked = requested();
        const reduced = motion.apply(other.shapes, other.sectors, LINEAR);

        // Assert
        expect(jumped).toBe(other.shapes);
        expect(grownLine).toBeUndefined();
        expect(mark(grown, 'marks.dot:a:3')).toBe(mark(four.shapes, 'marks.dot:a:3'));
        expect(reduced).toBe(other.shapes);
        expect(requested()).toBe(asked);
        expect(scheduler.idle).toBe(true);
    });

    it('should stop every tween with stop, and between values stay between', () => {
        // Arrange
        const { scheduler, tick } = fakeScheduler();
        const motion = createChartMotion(scheduler);
        const a = treeOf(input('bar', [10, 20, 30]));
        const b = treeOf(input('bar', [30, 20, 10]));
        motion.apply(a.shapes, a.sectors, undefined);
        motion.apply(b.shapes, b.sectors, LINEAR);
        tick(30);
        const y = numberOf(motion.current(), 'marks.bar:a:0', 'y');

        // Act
        motion.stop();

        // Assert
        expect(between(y, numberOf(a.shapes, 'marks.bar:a:0', 'y'), numberOf(b.shapes, 'marks.bar:a:0', 'y'))).toBe(true);
        expect(motion.current()).toBe(b.shapes);
    });
});
