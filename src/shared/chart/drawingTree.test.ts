import { describe, expect, it } from 'vitest';
import { createSvgRenderer } from '../drawing/svgRenderer.js';
import type { ShapeTree } from '../drawing/tree.js';
import { buildScene } from './chart.js';
import { primitivePath, sceneToTree, seriesToken } from './drawingTree.js';
import type { ChartInput, ChartType, Scene } from './scene.js';

const input = (type: ChartType, overrides: Partial<ChartInput> = {}): ChartInput => ({
    type,
    categories: ['Jan', 'Feb', 'Mar'],
    series: [
        { key: 'a', label: 'A', values: [10, 20, 30] },
        { key: 'b', label: 'B', values: [5, 15, 25] }
    ],
    stacked: false,
    width: 400,
    height: 200,
    format: String,
    percent: (share) => `${Math.round(share * 100)}%`,
    hidden: new Set(),
    texts: { total: 'Total', category: 'Category', value: 'Value', share: 'Share' },
    ...overrides
});

/** Every shape of a tree below its groups, in drawing order */
const flatten = (shapes: readonly ShapeTree[]): ShapeTree[] => shapes.flatMap((shape) => (shape.kind === 'drawGroup' ? flatten(shape.children) : [shape]));

const group = (shapes: readonly ShapeTree[], name: string): ShapeTree => shapes.find((shape) => shape.key === name) as ShapeTree;

/** How many shapes of each kind a layer has */
const kinds = (shape: ShapeTree): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const child of shape.children) counts[child.kind] = (counts[child.kind] ?? 0) + 1;
    return counts;
};

/**
 * What the old SVG scene (`svgScene.ts`, removed in G2.2) wrote for each primitive, by the primitive id: an element of
 * its tag with its `className` as `class`, its `attrs` as given and its text. The chart's parity test
 * (`test/composites/chart-parity.browser.test.ts`) holds that scene's output for four charts as captured literals
 */
function svgSceneOutput(scene: Scene): Map<string, { tag: string; attrs: Record<string, string>; text: string }> {
    const output = new Map<string, { tag: string; attrs: Record<string, string>; text: string }>();
    for (const primitive of scene.primitives) output.set(primitive.id, { tag: primitive.tag, attrs: { class: primitive.className, ...primitive.attrs }, text: primitive.text ?? '' });
    return output;
}

const TAG_OF_KIND: Record<string, string> = { line: 'line', drawText: 'text', rect: 'rect', path: 'path', circle: 'circle' };
const NUMERIC = ['x', 'y', 'width', 'height', 'cx', 'cy', 'r'];

describe('sceneToTree', () => {
    it('should turn a bar scene into gridlines, ticks and one rect per bar', () => {
        // Act
        const { shapes, data } = sceneToTree(buildScene(input('bar')));

        // Assert
        expect(shapes.map((shape) => [shape.kind, shape.key, shape.path, shape.attrs?.class])).toEqual([
            ['drawGroup', 'grid', 'grid', 'layer grid'],
            ['drawGroup', 'axes', 'axes', 'layer axes'],
            ['drawGroup', 'marks', 'marks', 'layer marks']
        ]);
        const ticks = group(shapes, 'grid').children.length;
        expect(kinds(group(shapes, 'grid'))).toEqual({ line: ticks });
        expect(kinds(group(shapes, 'axes'))).toEqual({ drawText: ticks + 3, line: 1 });
        expect(kinds(group(shapes, 'marks'))).toEqual({ rect: 6 });
        expect(Object.keys(data)).toHaveLength(6);
        const bar = group(shapes, 'marks').children.find((shape) => shape.key === 'bar:b:1') as ShapeTree;
        expect(bar.path).toBe('marks.bar:b:1');
        expect(bar.properties.fill).toBe('{color.data.categorical.2}');
        expect(bar.properties.stroke).toBeUndefined();
        expect(bar.attrs).toEqual({ class: 'bar', 'data-series': 'b', 'data-index': '1', role: 'img', 'aria-label': 'B, Feb: 15', tabindex: '-1', 'data-point': 'bar:b:1' });
        expect(data['marks.bar:b:1']).toMatchObject({ id: 'bar:b:1', series: 1, index: 1, title: 'Feb' });
        expect(data['marks.bar:b:1']?.rows).toHaveLength(2);
    });

    it('should turn a line scene into a stroked path and a point circle per value', () => {
        // Act
        const { shapes, data } = sceneToTree(buildScene(input('line')));
        const marks = group(shapes, 'marks');

        // Assert
        expect(kinds(marks)).toEqual({ path: 2, circle: 6 });
        expect(Object.keys(data)).toHaveLength(6);
        const line = marks.children.find((shape) => shape.key === 'line:a') as ShapeTree;
        expect(line.properties).toMatchObject({ fill: 'transparent', stroke: '{color.data.categorical.1}', strokeWidth: 2, cap: 'round', join: 'round' });
        expect(line.attrs).toEqual({ class: 'line', 'data-series': 'a' });
        const dot = marks.children.find((shape) => shape.key === 'dot:b:2') as ShapeTree;
        expect(dot.properties).toMatchObject({ fill: '{color.data.categorical.2}', stroke: '{color.surface.base}', r: 3 });
        expect(data['marks.dot:b:2']).toMatchObject({ id: 'dot:b:2', series: 1, index: 2, title: 'Mar' });
        expect(data['marks.line:a']).toBeUndefined();
    });

    it('should turn an area scene into a filled area at 0.2 opacity under each line', () => {
        // Act
        const { shapes } = sceneToTree(buildScene(input('area')));
        const marks = group(shapes, 'marks');

        // Assert
        expect(kinds(marks)).toEqual({ path: 4, circle: 6 });
        const area = marks.children.find((shape) => shape.key === 'area:b') as ShapeTree;
        expect(area.properties).toMatchObject({ fill: '{color.data.categorical.2}', opacity: 0.2 });
        expect(area.properties.stroke).toBeUndefined();
        expect(area.attrs?.class).toBe('area');
    });

    it('should turn a donut scene into a slice path per record and the total texts', () => {
        // Act
        const { shapes, data } = sceneToTree(buildScene(input('donut')));

        // Assert
        expect(group(shapes, 'grid').children).toEqual([]);
        expect(kinds(group(shapes, 'axes'))).toEqual({ drawText: 2 });
        expect(kinds(group(shapes, 'marks'))).toEqual({ path: 3 });
        expect(Object.keys(data)).toEqual(['marks.slice:0', 'marks.slice:1', 'marks.slice:2']);
        const slice = group(shapes, 'marks').children[2] as ShapeTree;
        expect(slice.properties).toMatchObject({ fill: '{color.data.categorical.3}', stroke: '{color.surface.base}', strokeWidth: 1 });
        const label = group(shapes, 'axes').children.find((shape) => shape.key === 'total-label') as ShapeTree;
        expect(label.properties).toMatchObject({ _text: 'Total', baseline: 'hanging', anchor: 'middle' });
        expect(data['marks.slice:1']?.rows.map((row) => row.label)).toEqual(['A', 'Share']);
    });

    it('should give the three empty layers and no shape for an empty chart', () => {
        // Act
        const { shapes, data } = sceneToTree(buildScene(input('bar', { width: 0 })));

        // Assert
        expect(shapes.map((shape) => shape.children.length)).toEqual([0, 0, 0]);
        expect(data).toEqual({});
    });

    it('should colour series past the eighth from the first again', () => {
        // Arrange
        const series = Array.from({ length: 10 }, (_unused, at) => ({ key: `k${at}`, label: `K${at}`, values: [at + 1] }));

        // Act
        const { shapes } = sceneToTree(buildScene(input('bar', { categories: ['One'], series })));
        const fills = group(shapes, 'marks').children.map((shape) => shape.properties.fill);

        // Assert
        expect(fills).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 1, 2].map((n) => `{color.data.categorical.${n}}`));
        expect(seriesToken(9)).toBe('{color.data.categorical.1}');
    });

    it('should start every path with the given path', () => {
        // Act
        const { shapes, data } = sceneToTree(buildScene(input('bar')), { path: '$.app.children.sales' });

        // Assert
        expect(group(shapes, 'marks').path).toBe('$.app.children.sales.marks');
        expect(group(shapes, 'marks').children[0]?.path).toBe('$.app.children.sales.marks.bar:a:0');
        expect(Object.keys(data)[0]).toBe('$.app.children.sales.marks.bar:a:0');
        expect(primitivePath({ id: 'bar:a:0', layer: 'marks' }, { path: 'p' })).toBe('p.marks.bar:a:0');
    });

    it('should change one entry and keep every path when one value changes', () => {
        // Arrange
        const before = flatten(sceneToTree(buildScene(input('bar'))).shapes);
        const changed = input('bar', {
            series: [
                { key: 'a', label: 'A', values: [10, 22, 30] },
                { key: 'b', label: 'B', values: [5, 15, 25] }
            ]
        });

        // Act
        const after = flatten(sceneToTree(buildScene(changed)).shapes);

        // Assert
        expect(after.map((shape) => shape.path)).toEqual(before.map((shape) => shape.path));
        const differing = after.filter((shape, at) => JSON.stringify(shape) !== JSON.stringify(before[at]));
        expect(differing.map((shape) => shape.path)).toEqual(['marks.bar:a:1']);
    });

    it.each(['bar', 'line', 'area', 'donut'] as const)('should draw a %s tree on the SVG renderer with no problem reported', (type) => {
        // Arrange
        const issues: unknown[] = [];
        const target = document.createElement('div');
        const renderer = createSvgRenderer(target, {
            renderer: 'svg',
            viewBox: { x: 0, y: 0, width: 400, height: 200 },
            reducedMotion: () => true,
            readProperty: () => undefined,
            onEvent: () => undefined,
            onIssue: (issue) => issues.push(issue)
        });

        // Act
        const { shapes, data } = sceneToTree(buildScene(input(type)));
        renderer.update(shapes);

        // Assert
        expect(issues).toEqual([]);
        for (const path of Object.keys(data)) expect(renderer.elementOf(path)?.getAttribute('data-point')).toBe(data[path]?.id);
        const first = renderer.elementOf(Object.keys(data)[0] as string) as Element;
        expect(first.getAttribute('fill')).toBe('var(--ui-color-data-categorical-1)');
        expect(target.querySelectorAll('rect').length).toBe(type === 'bar' ? 6 : 0);
        renderer.dispose();
    });

    it.each(['bar', 'line', 'area', 'donut'] as const)('should carry over or map every attribute the SVG scene wrote for a %s chart', (type) => {
        // Arrange
        const scene = buildScene(input(type, { stacked: type === 'area' }));
        const written = svgSceneOutput(scene);

        // Act
        const { shapes } = sceneToTree(scene);
        const byKey = new Map(flatten(shapes).map((shape) => [shape.key, shape]));

        // Assert
        expect(byKey.size).toBe(written.size);
        for (const [id, element] of written) {
            const shape = byKey.get(id) as ShapeTree;
            expect(TAG_OF_KIND[shape.kind]).toBe(element.tag);
            for (const [name, value] of Object.entries(element.attrs)) {
                if (name === 'class') {
                    const series = value.split(' ').find((word) => /^s\d+$/.test(word));
                    expect(shape.attrs?.class).toBe(value.split(' ').filter((word) => word !== series).join(' '));
                    if (series !== undefined) {
                        const token = seriesToken(Number(series.slice(1)));
                        expect([shape.properties.fill, shape.properties.stroke]).toContain(token);
                    }
                } else if (NUMERIC.includes(name)) {
                    expect(shape.properties[name]).toBe(Number(value));
                } else if (['x1', 'y1', 'x2', 'y2'].includes(name)) {
                    const [[x1, y1], [x2, y2]] = shape.properties.points as [[number, number], [number, number]];
                    expect({ x1, y1, x2, y2 }[name]).toBe(Number(value));
                } else if (name === 'd') {
                    expect(shape.properties.d).toBe(value);
                } else if (name === 'dy') {
                    expect(shape.properties.baseline).toBe({ '0.32em': 'middle', '1em': 'hanging' }[value]);
                } else {
                    expect(shape.attrs?.[name], `${id} ${name}`).toBe(value);
                }
            }
            if (element.tag === 'text') expect(shape.properties._text).toBe(element.text);
        }
    });
});
