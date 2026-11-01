import { describe, expect, it } from 'vitest';
import { buildDonut } from './donut.js';
import type { ChartInput, Primitive } from './scene.js';

const base: ChartInput = {
    type: 'donut',
    categories: ['Food', 'Rent', 'Fun'],
    series: [{ key: 'spend', label: 'Spend', values: [50, 30, 20] }],
    stacked: false,
    width: 300,
    height: 240,
    format: (value) => `${value} EUR`,
    percent: (share) => `${Math.round(share * 100)} %`,
    hidden: new Set(),
    texts: { total: 'Total', category: 'Category', value: 'Value', share: 'Share' }
};

const find = (primitives: readonly Primitive[], id: string): Primitive | undefined => primitives.find((primitive) => primitive.id === id);

describe('buildDonut', () => {
    it('should draw one arc per record, coloured in order, and the total with its label in the centre', () => {
        // Act
        const { primitives } = buildDonut(base);
        const slices = primitives.filter((primitive) => primitive.id.startsWith('slice:'));

        // Assert
        expect(slices.map((slice) => slice.className)).toEqual(['slice s1', 'slice s2', 'slice s3']);
        expect(slices.every((slice) => /^M.* Z$/.test(slice.attrs['d'] as string))).toBe(true);
        expect(find(primitives, 'total')?.text).toBe('100 EUR');
        expect(find(primitives, 'total-label')?.text).toBe('Total');
    });

    it('should give each arc a name, a share and a tooltip with its value', () => {
        // Act
        const scene = buildDonut(base);
        const rent = scene.points.find((point) => point.id === 'slice:1');

        // Assert
        expect(find(scene.primitives, 'slice:1')?.attrs['aria-label']).toBe('Rent: 30 EUR (30 %)');
        expect(rent?.title).toBe('Rent');
        expect(rent?.rows).toEqual([
            { label: 'Spend', value: '30 EUR', colour: 's2', current: true },
            { label: 'Share', value: '30 %', colour: '', current: false }
        ]);
    });

    it('should leave a hidden record out of the arcs and the total and keep the other colours', () => {
        // Act
        const { primitives, points } = buildDonut({ ...base, hidden: new Set(['Rent']) });

        // Assert
        expect(find(primitives, 'slice:1')).toBeUndefined();
        expect(find(primitives, 'slice:2')?.className).toBe('slice s3');
        expect(find(primitives, 'total')?.text).toBe('70 EUR');
        expect(points.map((point) => point.index)).toEqual([0, 1]);
    });

    it('should draw a single record as a whole ring', () => {
        // Act
        const { primitives } = buildDonut({ ...base, categories: ['All'], series: [{ key: 'spend', label: 'Spend', values: [7] }] });

        // Assert
        expect((find(primitives, 'slice:0')?.attrs['d'] ?? '').match(/A/g)).toHaveLength(4);
    });

    it('should draw no arcs and a total of 0 when every value is zero, and ignore negative values', () => {
        // Act
        const zero = buildDonut({ ...base, series: [{ key: 'spend', label: 'Spend', values: [0, -4, 0] }] });

        // Assert
        expect(zero.primitives.filter((primitive) => primitive.id.startsWith('slice:'))).toEqual([]);
        expect(find(zero.primitives, 'total')?.text).toBe('0 EUR');
    });

    it('should draw nothing in a box that is too small', () => {
        // Assert
        expect(buildDonut({ ...base, width: 20 }).primitives).toEqual([]);
    });
});
