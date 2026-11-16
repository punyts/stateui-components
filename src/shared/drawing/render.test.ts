import { afterEach, describe, expect, it } from 'vitest';
import { createFakeRenderer } from './fakeRenderer.js';
import type { FakeRenderer } from './fakeRenderer.js';
import { RENDERERS, createDrawingRenderer, isRendererKind, registerDrawingRenderer } from './render.js';
import type { DrawingRendererOptions, ShapeEvent } from './render.js';
import { readShapeTree } from './tree.js';

const ROOT = '$.app.children.map.children';

const { shapes } = readShapeTree(
    {
        sea: { component: 'rect', x: 0, y: 0, width: 100, height: 100 },
        boat: { component: 'drawGroup', x: 40, y: 40, children: { hull: { component: 'circle', cx: 0, cy: 0, r: 5, interactive: true } } }
    },
    ROOT
);

const options = (events: ShapeEvent[] = []): DrawingRendererOptions => ({
    renderer: 'svg',
    reducedMotion: () => false,
    readProperty: (name) => (name === 'fit' ? 'contain' : undefined),
    onEvent: (event) => events.push(event)
});

describe('createDrawingRenderer', () => {
    const removers: (() => void)[] = [];
    afterEach(() => removers.splice(0).forEach((remove) => remove()));

    it('should make the registered renderer of the kind the options name', () => {
        // Arrange
        removers.push(registerDrawingRenderer('svg', createFakeRenderer));
        const target = document.createElement('div');

        // Act
        const renderer = createDrawingRenderer(target, options()) as FakeRenderer;

        // Assert
        expect(renderer.target).toBe(target);
        expect(renderer.options.readProperty('fit')).toBe('contain');
    });

    it('should refuse a kind with no registered renderer, and forget a removed one', () => {
        // Arrange
        const remove = registerDrawingRenderer('canvas', createFakeRenderer);
        remove();

        // Assert
        expect(() => createDrawingRenderer(document.createElement('div'), { ...options(), renderer: 'canvas' })).toThrow(/no "canvas" renderer/);
    });

    it('should name the two renderer kinds', () => {
        // Assert
        expect(RENDERERS).toEqual(['svg', 'canvas']);
        expect(isRendererKind('canvas')).toBe(true);
        expect(isRendererKind('webgl')).toBe(false);
    });
});

describe('the fake renderer', () => {
    it('should keep each tree and answer hit and boundsOf from the last one', () => {
        // Arrange
        const renderer = createFakeRenderer(document.createElement('div'), options());

        // Act
        renderer.update(shapes);

        // Assert
        expect(renderer.updates).toEqual([shapes]);
        expect(renderer.hit(41, 41)?.path).toBe(`${ROOT}.boat.children.hull`);
        expect(renderer.hit(10, 10)).toBeUndefined();
        expect(renderer.boundsOf(`${ROOT}.boat.children.hull`)).toEqual({ x: 35, y: 35, width: 10, height: 10 });
        expect(renderer.boundsOf(`${ROOT}.nothing`)).toBeUndefined();
        expect(renderer.elementOf(`${ROOT}.sea`)).toBeUndefined();
    });

    it('should pass events to onEvent, and do nothing once disposed', () => {
        // Arrange
        const events: ShapeEvent[] = [];
        const renderer = createFakeRenderer(document.createElement('div'), options(events));
        renderer.update(shapes);
        const press: ShapeEvent = { name: 'press', shape: `${ROOT}.boat.children.hull`, key: 'hull', x: 40, y: 40 };

        // Act
        renderer.emit(press);
        renderer.dispose();
        renderer.emit(press);
        renderer.update([]);

        // Assert
        expect(events).toEqual([press]);
        expect(renderer.disposed).toBe(true);
        expect(renderer.updates).toHaveLength(1);
        expect(renderer.hit(41, 41)).toBeUndefined();
        expect(renderer.boundsOf(`${ROOT}.sea`)).toBeUndefined();
    });
});
