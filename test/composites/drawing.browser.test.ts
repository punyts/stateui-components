import { report } from '@punyts/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent, MountOptions, NodeState } from '../harness/createMountComponent.js';

const ROOT = '$.app.children';

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Waits until the drawing says it is drawn (`data-render="ready"`), at most 50 frames */
async function drawn(mounted: MountedComponent): Promise<void> {
    await Promise.resolve();
    for (let at = 0; at < 50; at += 1) {
        if (mounted.element.getAttribute('data-render') === 'ready') return;
        await frame();
    }
    throw new Error(`the drawing is still ${mounted.element.getAttribute('data-render')}`);
}

async function mountDrawing(node: NodeState, options: MountOptions = {}): Promise<MountedComponent> {
    const mounted = mountComponent('drawing', node, options);
    await drawn(mounted);
    return mounted;
}

const svgOf = (mounted: MountedComponent): SVGSVGElement => mounted.element.shadowRoot?.querySelector('.surface > svg') as SVGSVGElement;

const shapeAt = (mounted: MountedComponent, key: string): SVGElement => {
    const found = mounted.element.shadowRoot?.querySelector<SVGElement>(`[data-shape-path="${ROOT}.${key}"]`);
    if (!found) throw new Error(`no element for ${key}`);
    return found;
};

const attrsOf = (element: Element, names: readonly string[]): Record<string, string | null> =>
    Object.fromEntries(names.map((name) => [name, element.getAttribute(name)]));

/** The order of the drawn top-level shapes, by key */
const order = (mounted: MountedComponent): string[] =>
    Array.from(svgOf(mounted).children)
        .map((child) => child.getAttribute('data-shape-path'))
        .filter((path): path is string => path !== null)
        .map((path) => path.slice(ROOT.length + 1));

const drawCalls = (spy: { mock: { calls: unknown[][] } }, code: string): unknown[][] =>
    spy.mock.calls.filter((call) => (call[1] as { code?: string } | undefined)?.code === code);

describe('drawing with the SVG renderer in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
        vi.restoreAllMocks();
    });

    it('should draw each shape as its element with the fixed attributes', async () => {
        // Act
        const mounted = await mountDrawing({
            viewBox: { x: 0, y: 0, width: 200, height: 100 },
            children: {
                box: { component: 'rect', x: 1, y: 2, width: 30, height: 40, radius: 4, fill: '#ff0000' },
                dot: { component: 'circle', cx: 50, cy: 20, r: 5 },
                oval: { component: 'ellipse', cx: 70, cy: 20, rx: 8, ry: 4 },
                rule: { component: 'line', points: [[0, 90], [200, 90]], stroke: '#000000', strokeWidth: 2 },
                zig: { component: 'polyline', points: [[0, 0], [10, 10], [20, 0]] },
                tri: { component: 'polygon', points: [[100, 10], [110, 30], [90, 30]] },
                wave: { component: 'path', d: 'M 120 50 Q 130 40 140 50' },
                label: { component: 'drawText', _text: 'Hall', x: 150, y: 60, anchor: 'middle', baseline: 'hanging', font: '{font.family.mono}', fontSize: 12 },
                set: {
                    component: 'drawGroup',
                    x: 10,
                    y: 5,
                    clip: { component: 'rect', x: 0, y: 0, width: 20, height: 20 },
                    children: { seat: { component: 'circle', cx: 5, cy: 5, r: 3 } }
                }
            }
        });

        // Assert
        expect(shapeAt(mounted, 'box').localName).toBe('rect');
        expect(attrsOf(shapeAt(mounted, 'box'), ['x', 'y', 'width', 'height', 'rx', 'fill', 'data-shape-kind'])).toEqual({
            x: '1',
            y: '2',
            width: '30',
            height: '40',
            rx: '4',
            fill: '#ff0000',
            'data-shape-kind': 'rect'
        });
        expect(attrsOf(shapeAt(mounted, 'dot'), ['cx', 'cy', 'r'])).toEqual({ cx: '50', cy: '20', r: '5' });
        expect(shapeAt(mounted, 'oval').localName).toBe('ellipse');
        expect(attrsOf(shapeAt(mounted, 'oval'), ['cx', 'cy', 'rx', 'ry'])).toEqual({ cx: '70', cy: '20', rx: '8', ry: '4' });
        expect(attrsOf(shapeAt(mounted, 'rule'), ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width'])).toEqual({
            x1: '0',
            y1: '90',
            x2: '200',
            y2: '90',
            stroke: '#000000',
            'stroke-width': '2'
        });
        expect(shapeAt(mounted, 'zig').getAttribute('points')).toBe('0,0 10,10 20,0');
        expect(shapeAt(mounted, 'tri').localName).toBe('polygon');
        expect(shapeAt(mounted, 'wave').getAttribute('d')).toBe('M 120 50 Q 130 40 140 50');
        expect(shapeAt(mounted, 'label').localName).toBe('text');
        expect(attrsOf(shapeAt(mounted, 'label'), ['x', 'y', 'text-anchor', 'dominant-baseline', 'font-family', 'font-size'])).toEqual({
            x: '150',
            y: '60',
            'text-anchor': 'middle',
            'dominant-baseline': 'hanging',
            'font-family': 'var(--ui-font-family-mono)',
            'font-size': '12'
        });
        expect(shapeAt(mounted, 'label').textContent).toBe('Hall');
        const group = shapeAt(mounted, 'set');
        expect(group.localName).toBe('g');
        expect(group.getAttribute('transform')).toBe('matrix(1 0 0 1 10 5)');
        expect(shapeAt(mounted, 'set.children.seat').parentElement).toBe(group);
        const clipId = /^url\(#(.+)\)$/.exec(group.getAttribute('clip-path') ?? '')?.[1];
        const clip = mounted.element.shadowRoot?.getElementById(clipId ?? '');
        expect(clip?.localName).toBe('clipPath');
        expect(clip?.firstElementChild?.getAttribute('data-shape-path')).toBe(`${ROOT}.set.clip`);
        expect(order(mounted)).toEqual(['box', 'dot', 'oval', 'rule', 'zig', 'tri', 'wave', 'label', 'set']);
        expect(svgOf(mounted).getAttribute('style')).toBeNull();
        expect(mounted.element.shadowRoot?.querySelector('[style]')).toBeNull();
    });

    it('should resolve a var() fill written as a presentation attribute, which a stylesheet rule overrides', async () => {
        // Arrange
        const mounted = await mountDrawing({ children: { a: { component: 'rect', width: 10, height: 10, fill: '{color.accent.base}' }, b: { component: 'rect', x: 20, width: 10, height: 10, fill: '{color.accent.base}' } } });
        (mounted.element as HTMLElement).style.setProperty('--ui-color-accent-base', 'rgb(1, 2, 3)');
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(`[data-shape-path="${ROOT}.b"] { fill: rgb(4, 5, 6); }`);

        // Act
        mounted.element.shadowRoot!.adoptedStyleSheets = [...mounted.element.shadowRoot!.adoptedStyleSheets, sheet];

        // Assert
        expect(shapeAt(mounted, 'a').getAttribute('fill')).toBe('var(--ui-color-accent-base)');
        expect(getComputedStyle(shapeAt(mounted, 'a')).fill).toBe('rgb(1, 2, 3)');
        expect(getComputedStyle(shapeAt(mounted, 'b')).fill).toBe('rgb(4, 5, 6)');
    });

    it('should rewrite only the changed attribute on a state change and leave the other elements alone', async () => {
        // Arrange
        const mounted = await mountDrawing({
            viewBox: { x: 0, y: 0, width: 100, height: 20 },
            children: { a: { component: 'rect', width: 10, height: 10 }, b: { component: 'circle', cx: 30, cy: 5, r: 5 }, c: { component: 'circle', cx: 50, cy: 5, r: 5 } }
        });
        const before = ['a', 'b', 'c'].map((key) => shapeAt(mounted, key));
        const changes: MutationRecord[] = [];
        const watcher = new MutationObserver((records) => changes.push(...records));
        watcher.observe(svgOf(mounted), { attributes: true, childList: true, subtree: true, characterData: true });

        // Act
        mounted.store.set(`${ROOT}.b.r`, 8);
        await drawn(mounted);
        changes.push(...watcher.takeRecords());
        watcher.disconnect();

        // Assert
        expect(['a', 'b', 'c'].map((key) => shapeAt(mounted, key))).toEqual(before);
        expect(changes.map((change) => [change.type, change.attributeName, (change.target as Element).getAttribute('data-shape-path')])).toEqual([
            ['attributes', 'r', `${ROOT}.b`]
        ]);
        expect(shapeAt(mounted, 'b').getAttribute('r')).toBe('8');
    });

    it('should follow the order of the children map by moving elements, not making new ones', async () => {
        // Arrange
        const mounted = await mountDrawing({
            children: { a: { component: 'rect', width: 10, height: 10 }, b: { component: 'circle', r: 5 }, c: { component: 'ellipse', rx: 5, ry: 3 } }
        });
        const before = new Map(['a', 'b', 'c'].map((key) => [key, shapeAt(mounted, key)]));
        const children = JSON.parse(JSON.stringify(mounted.store.get(ROOT))) as Record<string, unknown>;

        // Act
        mounted.store.replace(ROOT, { c: children['c'], a: children['a'], b: children['b'] });
        await drawn(mounted);

        // Assert
        expect(order(mounted)).toEqual(['c', 'a', 'b']);
        for (const [key, element] of before) expect(shapeAt(mounted, key)).toBe(element);
    });

    it('should remove the element of a deleted shape', async () => {
        // Arrange
        const mounted = await mountDrawing({ children: { a: { component: 'rect', width: 10, height: 10 }, b: { component: 'circle', r: 5 } } });
        const kept = shapeAt(mounted, 'b');

        // Act
        mounted.store.delete(`${ROOT}.a` as never);
        await drawn(mounted);

        // Assert
        expect(order(mounted)).toEqual(['b']);
        expect(shapeAt(mounted, 'b')).toBe(kept);
    });

    it('should recolour a token fill when the dark mode overlay is switched on', async () => {
        // Arrange
        const mounted = await mountDrawing({ children: { a: { component: 'rect', width: 10, height: 10, fill: '{color.surface.base}' } } });
        const light = getComputedStyle(shapeAt(mounted, 'a')).fill;

        // Act
        mounted.setTheme('mode', 'dark');
        const pending = mounted.element.getAttribute('data-render');
        await drawn(mounted);

        // Assert
        expect(pending).toBe('pending');
        expect(getComputedStyle(shapeAt(mounted, 'a')).fill).not.toBe(light);
    });

    it('should fit its content when it has no viewBox, and use the viewBox and fit when it has them', async () => {
        // Arrange
        const mounted = await mountDrawing({
            children: { a: { component: 'rect', x: 10, y: 20, width: 30, height: 40 }, b: { component: 'circle', cx: 100, cy: 50, r: 10 } }
        });
        const fitted = svgOf(mounted).getAttribute('viewBox');

        // Act
        mounted.store.set('$.app.viewBox', { x: 0, y: 0, width: 400, height: 200 });
        mounted.store.set('$.app.fit', 'cover');
        await drawn(mounted);

        // Assert
        expect(fitted).toBe('10 20 100 40');
        expect(svgOf(mounted).getAttribute('viewBox')).toBe('0 0 400 200');
        expect(svgOf(mounted).getAttribute('preserveAspectRatio')).toBe('xMidYMid slice');
    });

    it('should follow a linked property of a shape node in the store', async () => {
        // Arrange
        const mounted = await mountDrawing({ children: { dot: { component: 'circle', '<-cx': '$.data.x', cy: 5, r: 5 } } }, { data: { x: 12 } });
        const before = shapeAt(mounted, 'dot').getAttribute('cx');

        // Act
        mounted.store.set('$.data.x', 40);
        await drawn(mounted);

        // Assert
        expect(before).toBe('12');
        expect(shapeAt(mounted, 'dot').getAttribute('cx')).toBe('40');
    });

    it('should skip a shape with an unusable value with one report while its neighbours draw', async () => {
        // Arrange
        const error = vi.spyOn(report, 'error').mockImplementation(() => undefined);

        // Act
        const mounted = await mountDrawing(
            {
                children: {
                    a: { component: 'rect', width: 10, height: 10 },
                    bad: { component: 'circle', '<-cx': '$.data.where', r: 5 },
                    c: { component: 'circle', cx: 30, r: 5 }
                }
            },
            { data: { where: 'left' } }
        );
        mounted.store.set(`${ROOT}.c.r`, 6);
        await drawn(mounted);

        // Assert
        const reports = drawCalls(error, 'SUI-RUN-DRAW');
        expect(reports).toHaveLength(1);
        expect(String(reports[0]?.[0])).toContain(`${ROOT}.bad`);
        expect(String(reports[0]?.[0])).toContain('property "cx" is not a number');
        expect(String(reports[0]?.[0])).not.toContain('left');
        expect(order(mounted)).toEqual(['a', 'c']);
    });

    it('should draw the shape once its linked value becomes usable', async () => {
        // Arrange
        vi.spyOn(report, 'error').mockImplementation(() => undefined);
        const mounted = await mountDrawing({ children: { bad: { component: 'circle', '<-cx': '$.data.where', r: 5 } } }, { data: { where: 'left' } });

        // Act
        mounted.store.set('$.data.where', 7);
        await drawn(mounted);

        // Assert
        expect(shapeAt(mounted, 'bad').getAttribute('cx')).toBe('7');
    });

    it('should report a paint name with no entry once and draw the shape unpainted', async () => {
        // Arrange
        const error = vi.spyOn(report, 'error').mockImplementation(() => undefined);

        // Act
        const mounted = await mountDrawing({ children: { a: { component: 'rect', width: 10, height: 10, '<-fill': '$.data.fill' } } }, { data: { fill: 'nowhere' } });
        mounted.store.set(`${ROOT}.a.width`, 12);
        await drawn(mounted);

        // Assert
        expect(drawCalls(error, 'SUI-STATE-PAINT')).toHaveLength(1);
        expect(shapeAt(mounted, 'a').getAttribute('fill')).toBe('none');
    });

    it('should paint a gradient of paints through defs', async () => {
        // Act
        const mounted = await mountDrawing({
            paints: { sky: { kind: 'linear', angle: 90, stops: { top: { offset: 0, color: '#ffffff' }, bottom: { offset: 1, color: '{color.accent.base}' } } } },
            children: { a: { component: 'rect', width: 10, height: 10, fill: 'sky' } }
        });

        // Assert
        const gradient = mounted.element.shadowRoot?.getElementById('paint-sky');
        expect(shapeAt(mounted, 'a').getAttribute('fill')).toBe('url(#paint-sky)');
        expect(gradient?.localName).toBe('linearGradient');
        expect(gradient?.parentElement?.localName).toBe('defs');
        expect(attrsOf(gradient!, ['x1', 'y1', 'x2', 'y2'])).toEqual({ x1: '0.5', y1: '0', x2: '0.5', y2: '1' });
        expect(Array.from(gradient!.children).map((stop: Element) => stop.getAttribute('stop-color'))).toEqual(['#ffffff', 'var(--ui-color-accent-base)']);
        expect(getComputedStyle(shapeAt(mounted, 'a')).fill).toContain('url(');
    });

    it('should set drawText text as text, never as markup', async () => {
        // Arrange
        const ran = vi.fn();
        (globalThis as { __drawingXss?: () => void }).__drawingXss = ran;

        // Act
        const mounted = await mountDrawing({ children: { t: { component: 'drawText', _text: '<img src="x" onerror="__drawingXss()">' } } });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Assert
        expect(shapeAt(mounted, 't').textContent).toBe('<img src="x" onerror="__drawingXss()">');
        expect(shapeAt(mounted, 't').children).toHaveLength(0);
        expect(mounted.element.shadowRoot?.querySelector('img')).toBeNull();
        expect(ran).not.toHaveBeenCalled();
    });

    it('should draw an empty svg and report nothing when it has no children', async () => {
        // Arrange
        const error = vi.spyOn(report, 'error').mockImplementation(() => undefined);

        // Act
        const mounted = await mountDrawing({});

        // Assert
        expect(svgOf(mounted)).not.toBeNull();
        expect(Array.from(svgOf(mounted).children).map((child) => child.localName)).toEqual(['defs']);
        expect(error).not.toHaveBeenCalled();
    });

    it('should be pending from a state change until the change is drawn', async () => {
        // Arrange
        const mounted = await mountDrawing({ children: { a: { component: 'rect', width: 10, height: 10 } } });
        const first = mounted.element.getAttribute('data-render');

        // Act
        mounted.store.set(`${ROOT}.a.width`, 20);
        const during = mounted.element.getAttribute('data-render');
        await drawn(mounted);

        // Assert
        expect(first).toBe('ready');
        expect(during).toBe('pending');
        expect(shapeAt(mounted, 'a').getAttribute('width')).toBe('20');
    });
});
