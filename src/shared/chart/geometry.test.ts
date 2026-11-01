import { describe, expect, it } from 'vitest';
import { buildScene, seriesClass } from './geometry.js';
import type { ChartInput, Primitive } from './geometry.js';

const base: ChartInput = {
    type: 'bar',
    categories: ['Jan', 'Feb', 'Mar'],
    series: [
        { key: 'a', values: [10, 20, 30] },
        { key: 'b', values: [5, 15, 25] }
    ],
    stacked: false,
    width: 400,
    height: 200,
    format: String
};

const marks = (primitives: readonly Primitive[], prefix: string): Primitive[] => primitives.filter((primitive) => primitive.id.startsWith(prefix));
const number = (primitive: Primitive, name: string): number => Number(primitive.attrs[name]);

describe('buildScene', () => {
    it('should give nothing to draw for a chart without a size', () => {
        // Assert
        expect(buildScene({ ...base, width: 0 }).primitives).toEqual([]);
        expect(buildScene({ ...base, height: 10 }).primitives).toEqual([]);
    });

    it('should draw one bar per series and category, in key order and with the series colour', () => {
        // Act
        const bars = marks(buildScene(base).primitives, 'bar:');

        // Assert
        expect(bars).toHaveLength(6);
        expect(bars.filter((bar) => bar.attrs['data-series'] === 'a').every((bar) => bar.className === 'bar s1')).toBe(true);
        expect(bars.filter((bar) => bar.attrs['data-series'] === 'b').every((bar) => bar.className === 'bar s2')).toBe(true);
    });

    it('should draw taller bars for larger values on a shared baseline', () => {
        // Act
        const bars = marks(buildScene(base).primitives, 'bar:a:');
        const bottoms = bars.map((bar) => number(bar, 'y') + number(bar, 'height'));

        // Assert
        expect(number(bars[2] as Primitive, 'height')).toBeGreaterThan(number(bars[0] as Primitive, 'height'));
        expect(new Set(bottoms.map((bottom) => bottom.toFixed(1))).size).toBe(1);
    });

    it('should put the bars of a category side by side, and stack them on one another when stacked', () => {
        // Act
        const side = marks(buildScene(base).primitives, 'bar:');
        const stacked = marks(buildScene({ ...base, stacked: true }).primitives, 'bar:');
        const at = (list: Primitive[], key: string): Primitive => list.find((bar) => bar.id === `bar:${key}:0`) as Primitive;

        // Assert
        expect(number(at(side, 'a'), 'x')).not.toBe(number(at(side, 'b'), 'x'));
        expect(number(at(stacked, 'a'), 'x')).toBe(number(at(stacked, 'b'), 'x'));
        expect(number(at(stacked, 'b'), 'y') + number(at(stacked, 'b'), 'height')).toBeCloseTo(number(at(stacked, 'a'), 'y'), 1);
    });

    it('should draw a negative stacked bar below the baseline', () => {
        // Act
        const scene = buildScene({ ...base, stacked: true, series: [{ key: 'a', values: [10, -10, 5] }] });
        const baseline = number(scene.primitives.find((primitive) => primitive.id === 'baseline') as Primitive, 'y1');
        const bars = marks(scene.primitives, 'bar:a:');

        // Assert
        expect(number(bars[1] as Primitive, 'y')).toBeCloseTo(baseline, 1);
        expect(number(bars[0] as Primitive, 'y') + number(bars[0] as Primitive, 'height')).toBeCloseTo(baseline, 1);
    });

    it('should draw a line and a point per value for a line chart, and no area', () => {
        // Act
        const { primitives } = buildScene({ ...base, type: 'line' });

        // Assert
        expect(marks(primitives, 'line:')).toHaveLength(2);
        expect(marks(primitives, 'dot:')).toHaveLength(6);
        expect(marks(primitives, 'area:')).toHaveLength(0);
        expect(marks(primitives, 'bar:')).toHaveLength(0);
        expect(marks(primitives, 'line:')[0]?.attrs['d']).toMatch(/^M[\d.]+ [\d.]+ L/);
    });

    it('should close the area down to the baseline, or to the series below when stacked', () => {
        // Act
        const plain = marks(buildScene({ ...base, type: 'area' }).primitives, 'area:');
        const stacked = marks(buildScene({ ...base, type: 'area', stacked: true }).primitives, 'area:');

        // Assert
        expect(plain).toHaveLength(2);
        expect(plain[0]?.attrs['d']).toMatch(/Z$/);
        expect(stacked[1]?.attrs['d']).not.toBe(plain[1]?.attrs['d']);
    });

    it('should label the value axis with the formatter and the categories with their text', () => {
        // Act
        const { primitives } = buildScene({ ...base, format: (value) => `${value}!` });

        // Assert
        expect(marks(primitives, 'ytick:').every((tick) => tick.text?.endsWith('!'))).toBe(true);
        expect(marks(primitives, 'xtick:').map((tick) => tick.text)).toEqual(['Jan', 'Feb', 'Mar']);
    });

    it('should skip category labels that would overlap', () => {
        // Act
        const categories = Array.from({ length: 40 }, (_value, at) => `Category ${at}`);
        const { primitives } = buildScene({ ...base, categories, series: [{ key: 'a', values: categories.map((_c, at) => at) }] });

        // Assert
        expect(marks(primitives, 'xtick:').length).toBeLessThan(20);
        expect(marks(primitives, 'xtick:')[0]?.id).toBe('xtick:0');
    });

    it('should be the same scene for the same input and change only the primitive of a changed value', () => {
        // Act
        const first = buildScene(base).primitives;
        const second = buildScene({ ...base, series: [{ key: 'a', values: [10, 21, 30] }, { key: 'b', values: [5, 15, 25] }] }).primitives;
        const changed = second.filter((primitive, at) => JSON.stringify(primitive) !== JSON.stringify(first[at])).map((primitive) => primitive.id);

        // Assert
        expect(buildScene(base).primitives).toEqual(first);
        expect(changed).toEqual(['bar:a:1']);
    });

    it('should draw a chart without series or records as axes only', () => {
        // Act
        const { primitives } = buildScene({ ...base, categories: [], series: [] });

        // Assert
        expect(marks(primitives, 'bar:')).toEqual([]);
        expect(marks(primitives, 'grid:').length).toBeGreaterThan(0);
    });
});

describe('seriesClass', () => {
    it('should give s1 to s8 and then start again', () => {
        // Assert
        expect([0, 7, 8, 9].map(seriesClass)).toEqual(['s1', 's8', 's1', 's2']);
    });
});
