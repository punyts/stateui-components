import { describe, expect, it } from 'vitest';
import { themeTokenLookup, libraryFromCatalog, validateDocument } from '@punyts/stateui-app/core';
import { formatError } from '@punyts/stateui-app/build';
import type { Catalog, RootCatalogEntry, ShapeCatalogEntry } from '@punyts/stateui-app/build';
import catalogJson from '../.test-build/real/components/catalog.json';
import { SHAPE_PROPERTIES } from '../src/shared/drawing/tree.js';

const catalog = catalogJson as unknown as Catalog;
const hasToken = themeTokenLookup(libraryFromCatalog(catalog));

/** The 2D shape components (G1.3 of the graphics epic 1) and the group folders they sit in */
const SHAPES = {
    rect: 'atom',
    circle: 'atom',
    ellipse: 'atom',
    line: 'atom',
    polyline: 'atom',
    polygon: 'atom',
    path: 'atom',
    drawText: 'atom',
    drawImage: 'atom',
    drawGroup: 'molecule',
    drawRepeat: 'molecule'
} as const;

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

/** One node of each shape, with the properties that make it draw something */
const ONE_OF_EACH: Record<string, Record<string, unknown>> = {
    box: { component: 'rect', x: 10, y: 10, width: 40, height: 20, radius: 4, fill: '{color.accent.base}', stroke: 'sky' },
    dot: { component: 'circle', cx: 80, cy: 20, r: 6, fill: '#ff8800', interactive: true, _label: 'Dot' },
    oval: { component: 'ellipse', cx: 120, cy: 20, rx: 10, ry: 6, opacity: 0.5 },
    rule: { component: 'line', points: [[0, 60], [200, 60]], stroke: '{color.border.base}', strokeWidth: 2, dash: [4, 2], cap: 'round' },
    trend: { component: 'polyline', points: [[0, 90], [50, 70], [100, 80]], stroke: 'rgb(0, 0, 0)', join: 'round' },
    area: { component: 'polygon', points: [[0, 100], [40, 120], [0, 140]], fill: 'sky', rotate: 15, origin: [10, 120] },
    wave: { component: 'path', d: 'M0 150 Q 50 120 100 150 T 200 150', stroke: 'hsl(200, 50%, 40%)', transition: { duration: 200, easing: 'standard' } },
    label: { component: 'drawText', _text: 'Total', x: 100, y: 180, anchor: 'middle', baseline: 'middle', font: '{text.body.family}', fontSize: 12 },
    picture: { component: 'drawImage', src: PNG, x: 150, y: 80, width: 40, height: 40, fit: 'cover' },
    cluster: {
        component: 'drawGroup',
        x: 20,
        scale: [2, 1],
        clip: { component: 'rect', width: 50, height: 50 },
        children: { inner: { component: 'circle', r: 3, animate: { name: 'pulse', duration: 800, loop: true } } }
    },
    seats: {
        component: 'drawRepeat',
        '<-records': '$.data.seats',
        row: { component: 'rect', '<-x': '$row.x', '<-y': '$row.y', width: 8, height: 8, '<-fill': '$row.fill', interactive: true, '<-_label': '$row.name' }
    }
};

const SEATS = { a: { x: 0, y: 0, fill: '{color.accent.base}', name: 'A1' } };

function drawingDocument(children: Record<string, unknown>, own: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        locale: 'en',
        data: { seats: SEATS },
        app: {
            component: 'drawing',
            viewBox: { x: 0, y: 0, width: 200, height: 200 },
            paints: { sky: { kind: 'linear', angle: 90, stops: { top: { offset: 0, color: '{color.accent.soft}' }, bottom: { offset: 1, color: '#ffffff' } } } },
            ...own,
            children
        }
    };
}

const validate = (document: Record<string, unknown>) => validateDocument(document, catalog, { hasToken });

describe('the drawing and the 2D shapes in the catalog', () => {
    it('should hold the drawing as a root composite with its properties, tokens and German title', () => {
        // Arrange
        const entry = catalog.components.find((candidate) => candidate.name === 'drawing') as RootCatalogEntry;

        // Assert
        expect(entry.tier).toBe('root');
        expect(entry.tag).toBe('ui-drawing');
        expect(entry.size).toBe('composite');
        expect(entry.category).toBe('graphics');
        expect(entry.own).toEqual(['renderer', 'viewBox', 'fit', 'paints', '_title', '_description']);
        expect(entry.shape.properties.renderer?.default).toBe('svg');
        expect(entry.shape.properties.fit?.values).toEqual(['contain', 'cover', 'stretch']);
        expect(Object.keys(entry.shape.properties.viewBox?.validators.fields ?? {})).toEqual(['x', 'y', 'width', 'height']);
        expect(entry.shape.childComponents).toEqual(Object.keys(SHAPES));
        expect((entry.tokens ?? []).map((token) => token.path)).toEqual(['drawing.background', 'drawing.height']);
        expect(entry.locales).toEqual(['de']);
    });

    it.each(Object.entries(SHAPES))('should hold %s as a shape of size %s with the shared paint, transform, interaction and motion properties', (name, size) => {
        // Arrange
        const entry = catalog.components.find((candidate) => candidate.name === name) as ShapeCatalogEntry;

        // Assert
        expect(entry.tier).toBe('shape');
        expect(entry.size).toBe(size);
        expect(entry.category).toBe('graphics');
        expect(entry.purposes?.length).toBeGreaterThanOrEqual(3);
        expect(entry.events).toEqual(['press', 'hover', 'dragEnd']);
        expect(Object.keys(entry.shape.properties)).toEqual(
            expect.arrayContaining(['fill', 'stroke', 'strokeWidth', 'opacity', 'dash', 'cap', 'join', 'x', 'y', 'rotate', 'scale', 'origin', 'interactive', '_label', 'draggable', 'bounds', 'step', 'transition', 'animate'])
        );
        expect(entry.shape.properties.fill?.validators).toEqual({ color: true });
    });

    it.each(Object.keys(SHAPES))('should list the properties of %s in SHAPE_PROPERTIES, which the drawing reads linked values by', (name) => {
        // Arrange
        const entry = catalog.components.find((candidate) => candidate.name === name) as ShapeCatalogEntry;
        const declared = Object.entries(entry.shape.properties)
            .filter(([, property]) => property.type !== 'node')
            .map(([key]) => key);

        // Assert
        expect([...SHAPE_PROPERTIES[name as keyof typeof SHAPES]].sort()).toEqual(declared.sort());
    });
});

describe('a drawing document', () => {
    it('should validate with one of each shape, a gradient, tokens and a repeat over records', () => {
        // Act
        const result = validate(drawingDocument(ONE_OF_EACH));

        // Assert
        expect(result.errors.map(formatError)).toEqual([]);
        expect(result.valid).toBe(true);
    });

    it('should refuse the same shapes under a panel', () => {
        // Act
        const result = validate({ locale: 'en', data: { seats: SEATS }, app: { component: 'panel', children: ONE_OF_EACH } });
        const refused = result.errors.filter((error) => error.code === 'SUI-NODE-CHILD').map((error) => error.statePath);

        // Assert
        expect(result.valid).toBe(false);
        expect(refused).toEqual(Object.keys(ONE_OF_EACH).map((key) => `$.app.children.${key}`));
    });

    it('should report a paint name the drawing does not define as SUI-STATE-PAINT', () => {
        // Act
        const result = validate(drawingDocument({ box: { component: 'rect', width: 1, height: 1, fill: 'sea' } }));

        // Assert
        expect(result.errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-STATE-PAINT', '$.app.children.box.fill']]);
    });

    it('should report an unknown token as SUI-STATE-TOKEN, and accept the drawing token', () => {
        // Act
        const unknown = validate(drawingDocument({ box: { component: 'rect', fill: '{color.nope.base}' } }));
        const own = validate(drawingDocument({ box: { component: 'rect', fill: '{drawing.background}' } }));

        // Assert
        expect(unknown.errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-STATE-TOKEN', '$.app.children.box.fill']]);
        expect(own.errors.map(formatError)).toEqual([]);
    });

    it('should warn for an interactive shape without a _label', () => {
        // Act
        const result = validate(drawingDocument({ dot: { component: 'circle', r: 4, interactive: true } }));

        // Assert
        expect(result.valid).toBe(true);
        expect(result.errors.map((error) => [error.code, error.severity, error.statePath])).toEqual([['SUI-STATE-LABEL', 'warning', '$.app.children.dot']]);
    });

    it('should refuse a line with three points, path data that does not parse and an unknown easing', () => {
        // Act
        const result = validate(
            drawingDocument({
                rule: { component: 'line', points: [[0, 0], [1, 1], [2, 2]] },
                wave: { component: 'path', d: 'M0 0 X' },
                dot: { component: 'circle', r: 1, transition: { easing: 'bounce' } }
            })
        );

        // Assert
        expect(result.errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-STATE-INVALID', '$.app.children.rule.points'],
            ['SUI-STATE-INVALID', '$.app.children.wave.d'],
            ['SUI-STATE-INVALID', '$.app.children.dot.transition']
        ]);
    });

    it('should take a transition duration in milliseconds or as a motion.duration name, and refuse another name (G1.8)', () => {
        // Act
        const result = validate(
            drawingDocument({
                ms: { component: 'circle', r: 1, transition: { duration: 300, easing: 'enter' } },
                named: { component: 'circle', r: 1, transition: { duration: 'slow' } },
                unknown: { component: 'circle', r: 1, transition: { duration: 'medium' } },
                negative: { component: 'circle', r: 1, transition: { duration: -5 } }
            })
        );

        // Assert
        expect(result.errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-STATE-INVALID', '$.app.children.unknown.transition'],
            ['SUI-STATE-INVALID', '$.app.children.negative.transition']
        ]);
    });

    it('should take the four animate names and refuse any other name or a missing one (G1.8b)', () => {
        // Act
        const result = validate(
            drawingDocument({
                spin: { component: 'rect', width: 1, height: 1, animate: { name: 'spin', duration: 1000, loop: true, delay: 100 } },
                pulse: { component: 'circle', r: 1, animate: { name: 'pulse' } },
                fade: { component: 'circle', r: 1, animate: { name: 'fade', loop: false } },
                blink: { component: 'circle', r: 1, animate: { name: 'blink', duration: 400 } },
                bob: { component: 'circle', r: 1, animate: { name: 'bob' } },
                nameless: { component: 'circle', r: 1, animate: { duration: 400 } }
            })
        );

        // Assert
        expect(result.errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-STATE-INVALID', '$.app.children.bob.animate'],
            ['SUI-STATE-INVALID', '$.app.children.nameless.animate']
        ]);
    });
});
