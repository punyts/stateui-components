import { describe, expect, it } from 'vitest';
import { buildCartesian } from './geometry.js';
import type { ChartInput, Primitive } from './scene.js';

const base: ChartInput = {
    type: 'bar',
    categories: ['Jan', 'Feb', 'Mar'],
    series: [
        { key: 'a', label: 'A', values: [10, 20, 30] },
        { key: 'b', label: 'B', values: [5, 15, 25] }
    ],
    stacked: false,
    width: 400,
    height: 200,
    format: String,
    percent: String,
    hidden: new Set(),
    texts: { total: 'Total', category: 'Category', value: 'Value', share: 'Share' }
};

const number = (primitive: Primitive, name: string): number => Number(primitive.attrs[name]);

describe('buildCartesian points and hidden series', () => {
    it('should name every mark and give each point the tooltip rows of its category', () => {
        // Act
        const scene = buildCartesian(base);
        const bar = scene.primitives.find((primitive) => primitive.id === 'bar:b:1') as Primitive;
        const point = scene.points.find((candidate) => candidate.id === 'bar:b:1');

        // Assert
        expect(scene.points).toHaveLength(6);
        expect(bar.attrs['aria-label']).toBe('B, Feb: 15');
        expect(bar.attrs['role']).toBe('img');
        expect(bar.attrs['data-point']).toBe('bar:b:1');
        expect(point?.title).toBe('Feb');
        expect(point?.rows).toEqual([
            { label: 'A', value: '20', colour: 's1', current: false },
            { label: 'B', value: '15', colour: 's2', current: true }
        ]);
    });

    it('should leave a hidden series out and keep the colours of the others', () => {
        // Act
        const scene = buildCartesian({ ...base, hidden: new Set(['a']) });

        // Assert
        expect(scene.primitives.filter((primitive) => primitive.id.startsWith('bar:a:'))).toEqual([]);
        expect(scene.primitives.filter((primitive) => primitive.id.startsWith('bar:b:')).every((bar) => bar.className === 'bar s2')).toBe(true);
        expect(scene.points.every((point) => point.series === 0)).toBe(true);
        expect(scene.points[0]?.rows).toHaveLength(1);
    });

    it('should point a bar tooltip at the middle of the top of the bar', () => {
        // Act
        const scene = buildCartesian({ ...base, series: [{ key: 'a', label: 'A', values: [10, 20, 30] }] });
        const bar = scene.primitives.find((primitive) => primitive.id === 'bar:a:2') as Primitive;
        const point = scene.points.find((candidate) => candidate.id === 'bar:a:2');

        // Assert
        expect(point?.x).toBeCloseTo(number(bar, 'x') + number(bar, 'width') / 2, 1);
        expect(point?.y).toBeCloseTo(number(bar, 'y'), 1);
    });
});
