import type { JsonValue } from '@punyts/stateui-app/core';
import { describe, expect, it } from 'vitest';
import {
    applyMatrix,
    boundsAt,
    fitViewBox,
    hitLocal,
    hitTest,
    invert,
    localBounds,
    multiply,
    preserveAspectRatioOf,
    readFit,
    readViewBox,
    shapeBounds,
    toDrawing,
    transformOf,
    treeBounds
} from './geometry.js';
import type { Bounds } from './geometry.js';
import type { ShapeKind, ShapeTree } from './tree.js';

const shape = (kind: ShapeKind, key: string, properties: Record<string, JsonValue>, children: ShapeTree[] = [], clip?: ShapeTree): ShapeTree => ({
    kind,
    key,
    path: `$.d.${key}`,
    properties,
    children,
    ...(clip ? { clip } : {})
});

const close = (box: Bounds | undefined, expected: Bounds): void => {
    expect(box).toBeDefined();
    for (const name of ['x', 'y', 'width', 'height'] as const) expect(box![name]).toBeCloseTo(expected[name], 6);
};

describe('viewBox and fit', () => {
    const viewBox = { x: 0, y: 0, width: 100, height: 50 };

    it('should contain the viewBox whole, centred', () => {
        // Act
        const viewport = fitViewBox(viewBox, 400, 400, 'contain');

        // Assert
        expect(viewport).toEqual({ scaleX: 4, scaleY: 4, offsetX: 0, offsetY: 100 });
        expect(toDrawing(viewport, 200, 200)).toEqual([50, 25]);
    });

    it('should cover the box, centred, and stretch each axis on its own', () => {
        // Assert
        expect(fitViewBox(viewBox, 400, 400, 'cover')).toEqual({ scaleX: 8, scaleY: 8, offsetX: -200, offsetY: 0 });
        expect(fitViewBox(viewBox, 400, 400, 'stretch')).toEqual({ scaleX: 4, scaleY: 8, offsetX: 0, offsetY: 0 });
    });

    it('should move by the viewBox origin', () => {
        // Act
        const viewport = fitViewBox({ x: -50, y: 10, width: 100, height: 100 }, 200, 200, 'contain');

        // Assert
        expect(toDrawing(viewport, 0, 0)).toEqual([-50, 10]);
        expect(toDrawing(viewport, 200, 200)).toEqual([50, 110]);
    });

    it('should read viewBox and fit values, and name the SVG aspect ratio of each fit', () => {
        // Assert
        expect(readViewBox({ x: 1, y: 2, width: 3, height: 4 })).toEqual({ x: 1, y: 2, width: 3, height: 4 });
        expect(readViewBox({ width: 3, height: 4 })).toEqual({ x: 0, y: 0, width: 3, height: 4 });
        expect(readViewBox({ width: 0, height: 4 })).toBeUndefined();
        expect(readViewBox('0 0 10 10')).toBeUndefined();
        expect(readFit('cover')).toBe('cover');
        expect(readFit('zoom')).toBe('contain');
        expect(preserveAspectRatioOf('contain')).toBe('xMidYMid meet');
        expect(preserveAspectRatioOf('cover')).toBe('xMidYMid slice');
        expect(preserveAspectRatioOf('stretch')).toBe('none');
    });
});

describe('matrices and transforms', () => {
    it('should invert and multiply', () => {
        // Arrange
        const m = transformOf(shape('circle', 'c', { cx: 0, cy: 0, r: 1, x: 5, y: 7, rotate: 30, scale: 2 }));

        // Act
        const back = multiply(invert(m)!, m);

        // Assert
        back.forEach((value, index) => expect(value).toBeCloseTo([1, 0, 0, 1, 0, 0][index], 9));
        expect(invert([0, 0, 0, 0, 1, 1])).toBeUndefined();
    });

    it('should offset by x and y, except for the shapes that take them as their position', () => {
        // Assert
        expect(transformOf(shape('circle', 'c', { cx: 0, cy: 0, r: 1, x: 5, y: 7 }))).toEqual([1, 0, 0, 1, 5, 7]);
        expect(transformOf(shape('rect', 'r', { x: 5, y: 7, width: 1, height: 1 }))).toEqual([1, 0, 0, 1, 0, 0]);
    });

    it('should rotate clockwise in degrees about the centre of the own bounds by default', () => {
        // Arrange
        const rect = shape('rect', 'r', { x: 0, y: 0, width: 20, height: 10, rotate: 90 });

        // Act
        const m = transformOf(rect);

        // Assert: the centre (10, 5) stays, the top left corner goes to the top right of the turned box
        applyMatrix(m, 10, 5).forEach((value, index) => expect(value).toBeCloseTo([10, 5][index], 9));
        applyMatrix(m, 0, 0).forEach((value, index) => expect(value).toBeCloseTo([15, -5][index], 9));
    });

    it('should rotate and scale about a given origin, and scale each axis from a pair', () => {
        // Arrange
        const turned = shape('rect', 'r', { x: 0, y: 0, width: 20, height: 10, rotate: 90, origin: [0, 0] });
        const scaled = shape('rect', 's', { x: 0, y: 0, width: 20, height: 10, scale: [2, 3], origin: [0, 0] });

        // Assert
        applyMatrix(transformOf(turned), 20, 0).forEach((value, index) => expect(value).toBeCloseTo([0, 20][index], 9));
        expect(applyMatrix(transformOf(scaled), 20, 10)).toEqual([40, 30]);
    });
});

describe('bounds', () => {
    it('should give the own bounds of each kind', () => {
        // Assert
        expect(localBounds(shape('rect', 'r', { x: 1, y: 2, width: 3, height: 4 }))).toEqual({ x: 1, y: 2, width: 3, height: 4 });
        expect(localBounds(shape('circle', 'c', { cx: 10, cy: 10, r: 5 }))).toEqual({ x: 5, y: 5, width: 10, height: 10 });
        expect(localBounds(shape('ellipse', 'e', { cx: 0, cy: 0, rx: 4, ry: 2 }))).toEqual({ x: -4, y: -2, width: 8, height: 4 });
        expect(localBounds(shape('polyline', 'p', { points: [[0, 0], [10, 5], [3, -2]] }))).toEqual({ x: 0, y: -2, width: 10, height: 7 });
        expect(localBounds(shape('path', 'p', { d: 'M0 0 H10 V10 Z' }))).toEqual({ x: 0, y: 0, width: 10, height: 10 });
        expect(localBounds(shape('drawImage', 'i', { x: 0, y: 0, width: 8, height: 6 }))).toEqual({ x: 0, y: 0, width: 8, height: 6 });
        expect(localBounds(shape('drawText', 't', { _text: 'abcd', x: 10, y: 20, fontSize: 10, anchor: 'middle', baseline: 'middle' }))).toEqual({
            x: -2,
            y: 15,
            width: 24,
            height: 10
        });
    });

    it('should give no bounds to a shape that draws nothing', () => {
        // Assert
        expect(localBounds(shape('rect', 'r', { x: 0, y: 0, width: -1, height: 4 }))).toBeUndefined();
        expect(localBounds(shape('circle', 'c', { cx: 0, cy: 0 }))).toBeUndefined();
        expect(localBounds(shape('path', 'p', { d: 'M0 0 X' }))).toBeUndefined();
        expect(localBounds(shape('polygon', 'p', { points: [] }))).toBeUndefined();
        expect(localBounds(shape('drawGroup', 'g', {}))).toBeUndefined();
        expect(localBounds(shape('drawRepeat', 'r', { records: [] }))).toBeUndefined();
    });

    it('should hold a group children through their transforms, cut by the clip', () => {
        // Arrange
        const group = shape('drawGroup', 'g', { x: 100, y: 0 }, [
            shape('rect', 'a', { x: 0, y: 0, width: 10, height: 10 }),
            shape('circle', 'b', { cx: 0, cy: 0, r: 5, x: 20, y: 20 })
        ]);
        const clipped = { ...group, clip: shape('rect', 'clip', { x: 0, y: 0, width: 12, height: 12 }) };

        // Assert
        expect(localBounds(group)).toEqual({ x: 0, y: 0, width: 25, height: 25 });
        expect(shapeBounds(group)).toEqual({ x: 100, y: 0, width: 25, height: 25 });
        expect(localBounds(clipped)).toEqual({ x: 0, y: 0, width: 12, height: 12 });
        expect(treeBounds([group, shape('rect', 'r', { x: -10, y: -10, width: 1, height: 1 })])).toEqual({ x: -10, y: -10, width: 135, height: 35 });
    });

    it('should give the bounds of a shape by path through every ancestor', () => {
        // Arrange
        const dot = shape('circle', 'dot', { cx: 0, cy: 0, r: 2 });
        const tree = [shape('drawGroup', 'g', { x: 50, y: 50, scale: 2, origin: [0, 0] }, [{ ...dot, path: '$.d.g.children.dot' }])];

        // Assert
        close(boundsAt(tree, '$.d.g.children.dot'), { x: 46, y: 46, width: 8, height: 8 });
        expect(boundsAt(tree, '$.d.g.children.none')).toBeUndefined();
    });
});

describe('hit testing', () => {
    it('should hit a rect inside and on its stroke, and miss rounded corners', () => {
        // Arrange
        const rect = shape('rect', 'r', { x: 0, y: 0, width: 20, height: 10, strokeWidth: 4 });
        const round = shape('rect', 'r', { x: 0, y: 0, width: 20, height: 20, radius: 10, strokeWidth: 0 });

        // Assert
        expect(hitLocal(rect, 10, 5)).toBe(true);
        expect(hitLocal(rect, 21.5, 5)).toBe(true);
        expect(hitLocal(rect, 22.5, 5)).toBe(false);
        expect(hitLocal(round, 10, 10)).toBe(true);
        expect(hitLocal(round, 1, 1)).toBe(false);
        expect(hitLocal(round, 10, 0.5)).toBe(true);
    });

    it('should hit circles and ellipses inside their radii', () => {
        // Arrange
        const circle = shape('circle', 'c', { cx: 10, cy: 10, r: 5, strokeWidth: 0 });
        const ellipse = shape('ellipse', 'e', { cx: 0, cy: 0, rx: 10, ry: 2, strokeWidth: 0 });

        // Assert
        expect(hitLocal(circle, 13, 13)).toBe(true);
        expect(hitLocal(circle, 14, 14)).toBe(false);
        expect(hitLocal(ellipse, 9, 0)).toBe(true);
        expect(hitLocal(ellipse, 0, 3)).toBe(false);
    });

    it('should hit a polygon inside and a polyline or line only near its stroke', () => {
        // Arrange
        const points: JsonValue = [[0, 0], [10, 0], [10, 10], [0, 10]];
        const polygon = shape('polygon', 'p', { points, strokeWidth: 2 });
        const polyline = shape('polyline', 'p', { points, strokeWidth: 2 });
        const line = shape('line', 'l', { points: [[0, 0], [10, 10]] });

        // Assert
        expect(hitLocal(polygon, 5, 5)).toBe(true);
        expect(hitLocal(polygon, 5, -0.9)).toBe(true);
        expect(hitLocal(polygon, 5, -1.1)).toBe(false);
        expect(hitLocal(polyline, 5, 5)).toBe(false);
        expect(hitLocal(polyline, 10.8, 5)).toBe(true);
        expect(hitLocal(polyline, 0.5, 5)).toBe(false);
        expect(hitLocal(line, 5, 5.4)).toBe(true);
        expect(hitLocal(line, 5, 6)).toBe(false);
    });

    it('should hit a path through its flattened curves', () => {
        // Arrange: a half disc of radius 10 above the x axis, from an arc
        const disc = shape('path', 'p', { d: 'M-10 0 A10 10 0 0 1 10 0 Z', strokeWidth: 0 });
        const curve = shape('path', 'q', { d: 'M0 0 Q50 100 100 0', strokeWidth: 2 });

        // Assert
        expect(hitLocal(disc, 0, -9.5)).toBe(true);
        expect(hitLocal(disc, 7, -7.5)).toBe(false);
        expect(hitLocal(disc, 0, 1)).toBe(false);
        expect(hitLocal(curve, 50, 50)).toBe(true);
        expect(hitLocal(curve, 50, 52)).toBe(false);
        expect(hitLocal(shape('path', 'x', { d: 'M0 0 X' }), 0, 0)).toBe(false);
    });

    it('should give the topmost shape, later shapes on top', () => {
        // Arrange
        const under = shape('rect', 'under', { x: 0, y: 0, width: 20, height: 20 });
        const over = shape('circle', 'over', { cx: 10, cy: 10, r: 3 });

        // Assert
        expect(hitTest([under, over], 10, 10)?.key).toBe('over');
        expect(hitTest([under, over], 2, 2)?.key).toBe('under');
        expect(hitTest([under, over], 50, 50)).toBeUndefined();
    });

    it('should hit shapes in a rotated group', () => {
        // Arrange: a 20 by 4 bar from the origin, turned 90 degrees about the origin, so it points down
        const bar = shape('rect', 'bar', { x: 0, y: -2, width: 20, height: 4, strokeWidth: 0 });
        const group = shape('drawGroup', 'g', { x: 50, y: 50, rotate: 90, origin: [0, 0] }, [bar]);

        // Assert
        expect(hitTest([group], 50, 65)?.key).toBe('bar');
        expect(hitTest([group], 65, 50)).toBeUndefined();
    });

    it('should hit shapes in a scaled group, and a rotated shape inside it', () => {
        // Arrange
        const dot = shape('circle', 'dot', { cx: 10, cy: 0, r: 1, strokeWidth: 0 });
        const diamond = shape('rect', 'diamond', { x: -5, y: 15, width: 10, height: 10, rotate: 45, strokeWidth: 0 });
        const group = shape('drawGroup', 'g', { scale: 3, origin: [0, 0] }, [dot, diamond]);

        // Assert: the dot is at (30, 0) with a radius of 3; the diamond centre is at (0, 60), its corners 21.2 away
        expect(hitTest([group], 32.5, 0)?.key).toBe('dot');
        expect(hitTest([group], 10, 0)).toBeUndefined();
        expect(hitTest([group], 0, 80)?.key).toBe('diamond');
        expect(hitTest([group], 14, 74)).toBeUndefined();
    });

    it('should not hit a group outside its clip', () => {
        // Arrange
        const group = shape('drawGroup', 'g', {}, [shape('rect', 'r', { x: 0, y: 0, width: 20, height: 20 })], shape('circle', 'clip', { cx: 0, cy: 0, r: 5 }));

        // Assert
        expect(hitTest([group], 2, 2)?.key).toBe('r');
        expect(hitTest([group], 15, 15)).toBeUndefined();
    });

    it('should give the nearest interactive shape when asked, and let a shape on top hide the ones below', () => {
        // Arrange
        const seat = shape('rect', 'seat', { x: 0, y: 0, width: 10, height: 10, interactive: true });
        const label = shape('drawText', 'label', { _text: 'A', x: 0, y: 10, fontSize: 10 });
        const group = shape('drawGroup', 'row', { interactive: true }, [shape('circle', 'dot', { cx: 50, cy: 5, r: 3 })]);
        const cover = shape('rect', 'cover', { x: 100, y: 0, width: 10, height: 10 });
        const hidden = shape('rect', 'hidden', { x: 100, y: 0, width: 10, height: 10, interactive: true });

        // Assert
        expect(hitTest([seat, group], 5, 5, { interactive: true })?.key).toBe('seat');
        expect(hitTest([seat, label, group], 2, 5, { interactive: true })).toBeUndefined();
        expect(hitTest([seat, label, group], 2, 5)?.key).toBe('label');
        expect(hitTest([seat, group], 50, 5, { interactive: true })?.key).toBe('row');
        expect(hitTest([hidden, cover], 105, 5, { interactive: true })).toBeUndefined();
    });

    it('should skip a shape scaled to nothing', () => {
        // Assert
        expect(hitTest([shape('circle', 'c', { cx: 0, cy: 0, r: 5, scale: 0 })], 0, 0)).toBeUndefined();
    });
});
