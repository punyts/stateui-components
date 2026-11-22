import { describe, expect, it } from 'vitest';
import { buildScene } from './chart.js';
import { sceneToTree } from './drawingTree.js';
import type { ChartInput, Primitive } from './scene.js';

const base: ChartInput = {
    type: 'scatter',
    categories: ['1', '2', '4'],
    series: [
        { key: 'a', label: 'A', values: [10, 20, 30] },
        { key: 'b', label: 'B', values: [5, 15, 25] }
    ],
    stacked: false,
    width: 400,
    height: 300,
    format: String,
    percent: String,
    hidden: new Set(),
    texts: { total: 'Total', category: 'Category', value: 'Value', share: 'Share' }
};

const number = (primitive: Primitive | undefined, name: string): number => Number(primitive?.attrs[name]);
const byId = (primitives: readonly Primitive[], id: string): Primitive | undefined => primitives.find((primitive) => primitive.id === id);

describe('buildScatter', () => {
    it('should place a point per record and series by its numeric x', () => {
        // Act
        const scene = buildScene(base);
        const first = byId(scene.primitives, 'dot:a:0');
        const second = byId(scene.primitives, 'dot:a:1');
        const last = byId(scene.primitives, 'dot:a:2');

        // Assert
        expect(scene.points).toHaveLength(6);
        expect(first?.className).toBe('dot s1');
        expect(byId(scene.primitives, 'dot:b:0')?.className).toBe('dot s2');
        // 1 → 2 is half the distance of 2 → 4
        expect(number(last, 'cx') - number(second, 'cx')).toBeCloseTo((number(second, 'cx') - number(first, 'cx')) * 2, 0);
        expect(number(last, 'cy')).toBeLessThan(number(first, 'cy'));
        expect(first?.attrs['aria-label']).toBe('A, 1: 10');
    });

    it('should leave out a record whose x is not a number and format x with formatX', () => {
        // Arrange
        const input: ChartInput = { ...base, categories: ['1', 'n/a', '3'], formatX: (value) => `#${value}` };

        // Act
        const scene = buildScene(input);

        // Assert
        expect(scene.points.map((point) => point.id)).toEqual(['dot:a:0', 'dot:a:2', 'dot:b:0', 'dot:b:2']);
        expect(scene.points[0]?.title).toBe('#1');
        expect(scene.primitives.some((primitive) => primitive.className === 'tick x' && primitive.text?.startsWith('#'))).toBe(true);
    });
});

describe('buildRadar', () => {
    const radar: ChartInput = { ...base, type: 'radar', categories: ['Speed', 'Range', 'Cost', 'Comfort'] };

    it('should draw a spoke per category, rings, and an outline with a point per spoke for each series', () => {
        // Act
        const scene = buildScene(radar);
        const spokes = scene.primitives.filter((primitive) => primitive.id.startsWith('spoke:'));
        const top = byId(scene.primitives, 'spoke:0');

        // Assert
        expect(spokes).toHaveLength(4);
        expect(number(top, 'x2')).toBeCloseTo(number(top, 'x1'), 1);
        expect(number(top, 'y2')).toBeLessThan(number(top, 'y1'));
        expect(scene.primitives.some((primitive) => primitive.className === 'web')).toBe(true);
        expect(byId(scene.primitives, 'area:a')?.attrs['d']).toMatch(/Z$/);
        expect(byId(scene.primitives, 'line:b')?.className).toBe('line s2');
        expect(scene.points).toHaveLength(8);
        expect(scene.points.find((point) => point.id === 'dot:b:1')?.rows.map((row) => row.current)).toEqual([false, true]);
    });

    it('should draw nothing with fewer than three categories', () => {
        // Act
        const scene = buildScene({ ...radar, categories: ['Speed', 'Range'] });

        // Assert
        expect(scene.primitives).toEqual([]);
    });
});

describe('buildHeatmap', () => {
    const heatmap: ChartInput = { ...base, type: 'heatmap', categories: ['Mon', 'Tue', 'Wed'] };

    it('should draw a cell per series and category whose opacity grows with its value', () => {
        // Act
        const scene = buildScene(heatmap);
        const low = byId(scene.primitives, 'cell:b:0');
        const high = byId(scene.primitives, 'cell:a:2');

        // Assert
        expect(scene.points).toHaveLength(6);
        expect(low?.className).toBe('cell s1');
        expect(number(low, 'opacity')).toBeCloseTo(0.12, 2);
        expect(number(high, 'opacity')).toBeCloseTo(1, 2);
        expect(number(byId(scene.primitives, 'cell:b:0'), 'y')).toBeGreaterThan(number(byId(scene.primitives, 'cell:a:0'), 'y'));
        expect(scene.points.find((point) => point.id === 'cell:a:1')?.title).toBe('A, Tue');
        expect(scene.primitives.filter((primitive) => primitive.className === 'tick y').map((primitive) => primitive.text)).toEqual(['A', 'B']);
    });

    it('should give the cell opacity to the drawing tree as a number', () => {
        // Act
        const tree = sceneToTree(buildScene(heatmap));
        const marks = tree.shapes.find((shape) => shape.key === 'marks');
        const cell = marks?.children.find((shape) => shape.key === 'cell:a:2');

        // Assert
        expect(cell?.properties['opacity']).toBeCloseTo(1, 2);
        expect(cell?.properties['fill']).toBe('{color.data.categorical.1}');
    });
});
