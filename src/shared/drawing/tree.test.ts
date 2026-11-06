import type { JsonObject, JsonValue } from '@punyts/stateui-app/core';
import { describe, expect, it } from 'vitest';
import { SHAPE_KINDS, isShapeAttr, isShapeKind, locateShape, readShapeTree, shapeAttrs } from './tree.js';

const ROOT = '$.app.children.map.children';

/** A drawing's `children` as the store holds them: defaults merged, links taken out */
const fixture: JsonObject = {
    sea: { component: 'rect', x: 0, y: 0, width: 100, height: 50, fill: '{color.accent.base}', on: { press: [] } },
    marker: {
        component: 'drawGroup',
        x: 10,
        y: 20,
        children: {
            dot: { component: 'circle', cx: 0, cy: 0, r: 4, interactive: true, _label: 'Harbour' },
            note: { component: 'button', _text: 'Not a shape' },
            tip: { component: 'drawText', _text: 'Harbour', x: 0, y: -8 }
        },
        clip: { component: 'rect', x: -5, y: -5, width: 10, height: 10 }
    },
    stray: { component: 'chart' },
    empty: null,
    seats: {
        component: 'drawRepeat',
        records: [],
        row: { component: 'rect', x: 0, y: 0, width: 5, height: 5 }
    }
};

describe('readShapeTree', () => {
    it('should read the shapes in the order of the map, with their keys, paths and properties', () => {
        // Act
        const { shapes } = readShapeTree(fixture, ROOT);

        // Assert
        expect(shapes.map((shape) => [shape.kind, shape.key, shape.path])).toEqual([
            ['rect', 'sea', `${ROOT}.sea`],
            ['drawGroup', 'marker', `${ROOT}.marker`],
            ['drawRepeat', 'seats', `${ROOT}.seats`]
        ]);
        expect(shapes[0].properties).toEqual({ x: 0, y: 0, width: 100, height: 50, fill: '{color.accent.base}' });
        expect(shapes[0].children).toEqual([]);
        expect(shapes[0].attrs).toBeUndefined();
    });

    it('should read a group with its children and clip, and a repeat with its row template', () => {
        // Act
        const { shapes } = readShapeTree(fixture, ROOT);
        const [, group, repeat] = shapes;

        // Assert
        expect(group.properties).toEqual({ x: 10, y: 20 });
        expect(group.children.map((child) => child.path)).toEqual([`${ROOT}.marker.children.dot`, `${ROOT}.marker.children.tip`]);
        expect(group.children[0].properties).toEqual({ cx: 0, cy: 0, r: 4, interactive: true, _label: 'Harbour' });
        expect(group.clip).toMatchObject({ kind: 'rect', key: 'clip', path: `${ROOT}.marker.clip` });
        expect(repeat.properties).toEqual({ records: [] });
        expect(repeat.row).toMatchObject({ kind: 'rect', key: 'row', path: `${ROOT}.seats.row` });
    });

    it('should leave out a node of an unknown kind with its subtree, report it with its path, and skip an empty entry', () => {
        // Act
        const { unknown } = readShapeTree(fixture, ROOT);

        // Assert
        expect(unknown).toEqual([
            { path: `${ROOT}.marker.children.note`, component: 'button' },
            { path: `${ROOT}.stray`, component: 'chart' }
        ]);
    });

    it('should report a value that is not a node', () => {
        // Act
        const { shapes, unknown } = readShapeTree({ a: 3, b: { x: 1 } }, ROOT);

        // Assert
        expect(shapes).toEqual([]);
        expect(unknown).toEqual([
            { path: `${ROOT}.a`, component: '' },
            { path: `${ROOT}.b`, component: '' }
        ]);
    });

    it('should give an empty tree for a missing or empty map', () => {
        // Assert
        expect(readShapeTree(undefined, ROOT)).toEqual({ shapes: [], unknown: [] });
        expect(readShapeTree({}, ROOT)).toEqual({ shapes: [], unknown: [] });
    });

    it('should read every property through the store when given a reader, which follows links', () => {
        // Arrange
        const store: Record<string, JsonValue> = { [`${ROOT}.sea.x`]: 42, [`${ROOT}.sea.fill`]: 'red' };
        const reads: string[] = [];

        // Act
        const { shapes } = readShapeTree({ sea: fixture.sea }, ROOT, {
            read: (path) => {
                reads.push(path);
                return store[path];
            }
        });

        // Assert
        expect(shapes[0].properties).toMatchObject({ x: 42, fill: 'red', width: 100 });
        expect(reads).toContain(`${ROOT}.sea.width`);
        expect(reads).not.toContain(`${ROOT}.sea.on`);
    });

    it('should take a linked property from its target when the node object has no value for it', () => {
        // Act
        const { shapes } = readShapeTree({ dot: { component: 'circle', r: 2, '<-cx': '$row.x' } }, ROOT, {
            read: (path) => (path === `${ROOT}.dot.cx` ? 7 : undefined)
        });

        // Assert
        expect(shapes[0].properties).toEqual({ r: 2, cx: 7 });
    });

    it('should never write to the value it reads', () => {
        // Arrange
        const copy = JSON.parse(JSON.stringify(fixture)) as JsonObject;

        // Act
        readShapeTree(fixture, ROOT);

        // Assert
        expect(fixture).toEqual(copy);
    });
});

describe('shape kinds and attrs', () => {
    it('should name the eleven 2D shapes', () => {
        // Assert
        expect(SHAPE_KINDS).toHaveLength(11);
        expect(isShapeKind('drawRepeat')).toBe(true);
        expect(isShapeKind('text')).toBe(false);
        expect(isShapeKind(3)).toBe(false);
    });

    it('should allow only class, role, tabindex, aria-* and data-* attributes', () => {
        // Assert
        expect(['class', 'role', 'tabindex', 'aria-label', 'data-point'].every(isShapeAttr)).toBe(true);
        expect(['style', 'onclick', 'href', 'fill', 'aria-', 'xlink:href'].some(isShapeAttr)).toBe(false);
        expect(shapeAttrs({ class: 'mark s1', style: 'color: red', onclick: 'x()', 'data-point': '3' })).toEqual({ class: 'mark s1', 'data-point': '3' });
        expect(shapeAttrs(undefined)).toEqual({});
    });
});

describe('locateShape', () => {
    it('should give the shape at a path with its ancestors, through children, clip and row', () => {
        // Arrange
        const { shapes } = readShapeTree(fixture, ROOT);

        // Assert
        expect(locateShape(shapes, `${ROOT}.marker.children.dot`)?.map((shape) => shape.key)).toEqual(['marker', 'dot']);
        expect(locateShape(shapes, `${ROOT}.marker.clip`)?.map((shape) => shape.key)).toEqual(['marker', 'clip']);
        expect(locateShape(shapes, `${ROOT}.seats.row`)?.map((shape) => shape.key)).toEqual(['seats', 'row']);
        expect(locateShape(shapes, `${ROOT}.sea`)?.map((shape) => shape.key)).toEqual(['sea']);
        expect(locateShape(shapes, `${ROOT}.marker.children.note`)).toBeUndefined();
        expect(locateShape(shapes, `${ROOT}.se`)).toBeUndefined();
    });
});
