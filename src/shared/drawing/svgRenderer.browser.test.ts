import { afterEach, describe, expect, it } from 'vitest';
import type { JsonObject, JsonValue } from '@punyts/stateui-app/core';
import { createDrawingRenderer } from './render.js';
import type { DrawingIssue, DrawingRenderer } from './render.js';
import './svgRenderer.js';
import { readShapeTree } from './tree.js';
import type { ShapeTree } from './tree.js';

const ROOT = '$.app.children';

const treeOf = (children: JsonObject): readonly ShapeTree[] => readShapeTree(children, ROOT).shapes;

function make(properties: Record<string, JsonValue> = {}): { target: HTMLElement; renderer: DrawingRenderer; issues: DrawingIssue[] } {
    const target = document.body.appendChild(document.createElement('div'));
    const issues: DrawingIssue[] = [];
    const renderer = createDrawingRenderer(target, {
        renderer: 'svg',
        path: '$.app',
        reducedMotion: () => false,
        readProperty: (name) => properties[name],
        onEvent: () => undefined,
        onIssue: (issue) => issues.push(issue)
    });
    return { target, renderer, issues };
}

describe('createSvgRenderer in Chromium', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('should give the element of a shape, hit the topmost interactive shape and give bounds as geometry does', () => {
        // Arrange
        const { renderer } = make();

        // Act
        renderer.update(
            treeOf({
                back: { component: 'rect', x: 0, y: 0, width: 50, height: 50, interactive: true },
                front: { component: 'circle', cx: 25, cy: 25, r: 10, interactive: true }
            })
        );

        // Assert
        expect(renderer.elementOf(`${ROOT}.front`)?.localName).toBe('circle');
        expect(renderer.hit(25, 25)?.key).toBe('front');
        expect(renderer.hit(2, 2)?.key).toBe('back');
        expect(renderer.boundsOf(`${ROOT}.front`)).toEqual({ x: 15, y: 15, width: 20, height: 20 });
    });

    it('should write the attrs of a feeder as given, and only the allowed ones', () => {
        // Arrange
        const { renderer } = make();
        const [shape] = treeOf({ bar: { component: 'rect', width: 5, height: 5 } });

        // Act
        renderer.update([{ ...shape!, attrs: { class: 'mark s1', 'data-point': '3', style: 'fill: red', onclick: 'x()' } }]);

        // Assert
        const element = renderer.elementOf(`${ROOT}.bar`)!;
        expect(element.getAttribute('class')).toBe('mark s1');
        expect(element.getAttribute('data-point')).toBe('3');
        expect(element.hasAttribute('style')).toBe(false);
        expect(element.hasAttribute('onclick')).toBe(false);
    });

    it('should make a new element when a shape changes kind, and remove what it drew on dispose', () => {
        // Arrange
        const { target, renderer } = make();
        renderer.update(treeOf({ a: { component: 'rect', width: 5, height: 5 } }));
        const before = renderer.elementOf(`${ROOT}.a`);

        // Act
        renderer.update(treeOf({ a: { component: 'circle', r: 5 } }));
        const after = renderer.elementOf(`${ROOT}.a`);
        renderer.dispose();

        // Assert
        expect(before?.localName).toBe('rect');
        expect(after?.localName).toBe('circle');
        expect(before?.isConnected).toBe(false);
        expect(target.children).toHaveLength(0);
        expect(renderer.elementOf(`${ROOT}.a`)).toBeUndefined();
    });

    it('should report a shape with path data that does not parse once and draw nothing for it', () => {
        // Arrange
        const { renderer, issues } = make();
        const tree = treeOf({ bad: { component: 'path', d: 'M 0 0 L x' }, good: { component: 'path', d: 'M 0 0 L 5 5' } });

        // Act
        renderer.update(tree);
        renderer.update(tree);

        // Assert
        expect(issues).toEqual([{ code: 'SUI-RUN-DRAW', path: `${ROOT}.bad`, reason: 'property "d" is not path data that parses, so the shape is not drawn' }]);
        expect(renderer.elementOf(`${ROOT}.bad`)).toBeUndefined();
        expect(renderer.elementOf(`${ROOT}.good`)?.getAttribute('d')).toBe('M 0 0 L 5 5');
    });

    it('should leave out a hidden shape and write rotate and scale as a transform about the centre', () => {
        // Arrange
        const { renderer } = make();

        // Act
        renderer.update(
            treeOf({
                gone: { component: 'rect', width: 5, height: 5, hidden: true },
                turned: { component: 'rect', x: 0, y: 0, width: 10, height: 10, rotate: 90 }
            })
        );

        // Assert
        expect(renderer.elementOf(`${ROOT}.gone`)).toBeUndefined();
        expect(renderer.elementOf(`${ROOT}.turned`)?.getAttribute('transform')).toBe('matrix(0 1 -1 0 10 0)');
    });

    it('should use the viewBox the caller passes and resolve once drawn', async () => {
        // Arrange
        const target = document.body.appendChild(document.createElement('div'));
        const renderer = createDrawingRenderer(target, {
            renderer: 'svg',
            viewBox: { x: 0, y: 0, width: 300, height: 150 },
            reducedMotion: () => false,
            readProperty: (name) => (name === 'viewBox' ? { x: 0, y: 0, width: 1, height: 1 } : undefined),
            onEvent: () => undefined
        });

        // Act
        renderer.update(treeOf({ a: { component: 'rect', width: 5, height: 5 } }));
        await renderer.drawn();

        // Assert
        expect(target.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 300 150');
        expect(target.querySelector('svg')?.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    });
});
