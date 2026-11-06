import { report } from '@punyts/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCanvasRenderer } from '../../src/shared/drawing/canvasRenderer.js';
import { createDrawingRenderer } from '../../src/shared/drawing/render.js';
import type { DrawingRendererOptions } from '../../src/shared/drawing/render.js';
import '../../src/shared/drawing/svgRenderer.js';
import type { ShapeTree } from '../../src/shared/drawing/tree.js';
import { medianMs } from '../harness/medianMs.js';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent, MountOptions, NodeState } from '../harness/createMountComponent.js';

const ROOT = '$.app.children';

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Lets the queued microtasks run (the drawing's own scheduling is one microtask) */
const microtasks = async (): Promise<void> => {
    for (let at = 0; at < 5; at += 1) await Promise.resolve();
};

/** Waits until the drawing says it is drawn (`data-render="ready"`), at most 50 frames */
async function drawn(mounted: MountedComponent): Promise<void> {
    await Promise.resolve();
    for (let at = 0; at < 50; at += 1) {
        if (mounted.element.getAttribute('data-render') === 'ready') return;
        await frame();
    }
    throw new Error(`the drawing is still ${mounted.element.getAttribute('data-render')}`);
}

/**
 * Mounts a canvas drawing of `width` by `height` CSS pixels (its `viewBox` the same size, so a drawing unit is a CSS
 * pixel) and waits until it is drawn
 */
async function mountCanvas(node: NodeState, options: MountOptions = {}, width = 200, height = 100): Promise<MountedComponent> {
    const mounted = mountComponent('drawing', { renderer: 'canvas', viewBox: { x: 0, y: 0, width, height }, ...node }, options);
    mounted.host.style.width = `${width}px`;
    (mounted.element as HTMLElement).style.setProperty('--ui-drawing-height', `${height}px`);
    await drawn(mounted);
    return mounted;
}

const canvasOf = (mounted: MountedComponent): HTMLCanvasElement => {
    const found = mounted.element.shadowRoot?.querySelector<HTMLCanvasElement>('.surface > canvas');
    if (!found) throw new Error('no canvas');
    return found;
};

/** The RGBA of the bitmap at a point in CSS pixels (drawing units in these tests) */
function pixel(mounted: MountedComponent, x: number, y: number): [number, number, number, number] {
    const canvas = canvasOf(mounted);
    const ratio = canvas.width / canvas.clientWidth;
    const data = canvas.getContext('2d')!.getImageData(Math.floor(x * ratio), Math.floor(y * ratio), 1, 1).data;
    return [data[0]!, data[1]!, data[2]!, data[3]!];
}

/** True when any pixel of the box is painted */
function painted(mounted: MountedComponent, x: number, y: number, width: number, height: number): boolean {
    const canvas = canvasOf(mounted);
    const ratio = canvas.width / canvas.clientWidth;
    const data = canvas.getContext('2d')!.getImageData(x * ratio, y * ratio, width * ratio, height * ratio).data;
    for (let at = 3; at < data.length; at += 4) if (data[at]! > 0) return true;
    return false;
}

const EMPTY: [number, number, number, number] = [0, 0, 0, 0];

const calls = (spy: { mock: { calls: unknown[][] } }, code: string): unknown[][] =>
    spy.mock.calls.filter((call) => (call[1] as { code?: string } | undefined)?.code === code);

const options = (overrides: Partial<DrawingRendererOptions> = {}): DrawingRendererOptions => ({
    renderer: 'canvas',
    reducedMotion: () => false,
    readProperty: () => undefined,
    onEvent: () => undefined,
    ...overrides
});

const shape = (kind: ShapeTree['kind'], key: string, properties: ShapeTree['properties'], children: ShapeTree[] = []): ShapeTree => ({
    kind,
    key,
    path: `${ROOT}.${key}`,
    properties,
    children
});

describe('drawing with the canvas renderer in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('should draw each shape kind at its place', async () => {
        // Act
        const mounted = await mountCanvas({
            children: {
                box: { component: 'rect', x: 10, y: 10, width: 30, height: 30, fill: '#ff0000' },
                dot: { component: 'circle', cx: 60, cy: 25, r: 10, fill: '#00ff00' },
                oval: { component: 'ellipse', cx: 90, cy: 25, rx: 12, ry: 6, fill: '#0000ff' },
                rule: { component: 'line', points: [[0, 60], [200, 60]], stroke: '#ff00ff', strokeWidth: 4 },
                zig: { component: 'polyline', points: [[110, 10], [130, 10], [130, 30]], fill: 'transparent', stroke: '#00ffff', strokeWidth: 4 },
                tri: { component: 'polygon', points: [[150, 10], [170, 10], [160, 30]], fill: '#ffff00' },
                wave: { component: 'path', d: 'M 180 10 L 195 10 L 195 30 Z', fill: '#804000' },
                label: { component: 'drawText', _text: 'MMMM', x: 10, y: 95, fontSize: 20, fill: '#000000' }
            }
        });

        // Assert
        expect(pixel(mounted, 25, 25)).toEqual([255, 0, 0, 255]);
        expect(pixel(mounted, 45, 25)).toEqual(EMPTY);
        expect(pixel(mounted, 60, 25)).toEqual([0, 255, 0, 255]);
        expect(pixel(mounted, 60, 38)).toEqual(EMPTY);
        expect(pixel(mounted, 90, 25)).toEqual([0, 0, 255, 255]);
        expect(pixel(mounted, 90, 34)).toEqual(EMPTY);
        expect(pixel(mounted, 100, 60)).toEqual([255, 0, 255, 255]);
        expect(pixel(mounted, 120, 10)).toEqual([0, 255, 255, 255]);
        expect(pixel(mounted, 120, 20)).toEqual(EMPTY);
        expect(pixel(mounted, 160, 15)).toEqual([255, 255, 0, 255]);
        expect(pixel(mounted, 192, 15)).toEqual([128, 64, 0, 255]);
        expect(painted(mounted, 10, 78, 60, 17)).toBe(true);
        expect(painted(mounted, 100, 70, 100, 25)).toBe(false);
        expect(mounted.element.shadowRoot?.querySelector('[data-shape-path]')).toBeNull();
    });

    it('should draw transforms, clips, gradients, dash, opacity and a group paint its shapes inherit', async () => {
        // Act
        const mounted = await mountCanvas({
            paints: { ramp: { kind: 'linear', angle: 0, stops: { a: { offset: 0, color: '#000000' }, b: { offset: 1, color: '#ffffff' } } } },
            children: {
                set: {
                    component: 'drawGroup',
                    x: 100,
                    y: 70,
                    fill: '#123456',
                    clip: { component: 'rect', x: 0, y: 0, width: 5, height: 10 },
                    children: { a: { component: 'rect', x: 0, y: 0, width: 10, height: 10 } }
                },
                bar: { component: 'rect', x: 150, y: 70, width: 20, height: 4, rotate: 90, fill: '#00ff00' },
                ramp: { component: 'rect', x: 10, y: 10, width: 100, height: 10, fill: 'ramp' },
                dashed: { component: 'line', points: [[0, 40], [200, 40]], stroke: '#000000', strokeWidth: 2, dash: [10, 10] },
                faint: { component: 'rect', x: 10, y: 50, width: 10, height: 10, fill: '#ff0000', opacity: 0.5 }
            }
        });

        // Assert
        expect(pixel(mounted, 102, 75)).toEqual([0x12, 0x34, 0x56, 255]);
        expect(pixel(mounted, 107, 75)).toEqual(EMPTY);
        expect(pixel(mounted, 160, 80)).toEqual([0, 255, 0, 255]);
        expect(pixel(mounted, 152, 72)).toEqual(EMPTY);
        const left = pixel(mounted, 12, 15);
        const right = pixel(mounted, 107, 15);
        expect(left[0]).toBeLessThan(30);
        expect(right[0]).toBeGreaterThan(225);
        expect(pixel(mounted, 5, 40)[3]).toBe(255);
        expect(pixel(mounted, 15, 40)).toEqual(EMPTY);
        const half = pixel(mounted, 15, 55);
        expect(half[3]).toBeGreaterThan(110);
        expect(half[3]).toBeLessThan(145);
    });

    it('should recolour a token fill when the dark mode overlay is switched on', async () => {
        // Arrange
        const mounted = await mountCanvas({ children: { a: { component: 'rect', width: 20, height: 20, fill: '{color.surface.base}' } } });
        const light = pixel(mounted, 5, 5);

        // Act
        mounted.setTheme('mode', 'dark');
        const pending = mounted.element.getAttribute('data-render');
        await drawn(mounted);

        // Assert
        expect(pending).toBe('pending');
        expect(light[3]).toBe(255);
        expect(pixel(mounted, 5, 5)).not.toEqual(light);
        expect(pixel(mounted, 5, 5)[3]).toBe(255);
    });

    it('should draw a drawText in its font token and fall back to the page font for one the theme lacks', async () => {
        // Arrange
        const error = vi.spyOn(report, 'error').mockImplementation(() => undefined);

        // Act
        const mounted = await mountCanvas({
            children: {
                mono: { component: 'drawText', _text: 'iiiiii', x: 10, y: 40, fontSize: 20, font: '{font.family.mono}', fill: '#000000' },
                lost: { component: 'drawText', _text: 'iiiiii', x: 110, y: 40, fontSize: 20, font: '{font.family.nowhere}', fill: '#000000' }
            }
        });

        // Assert: a monospaced i is as wide as an m (six reach past x 60); the page font's i is narrow (six end well before x 165)
        expect(painted(mounted, 60, 20, 30, 25)).toBe(true);
        expect(painted(mounted, 110, 20, 30, 25)).toBe(true);
        expect(painted(mounted, 165, 20, 35, 25)).toBe(false);
        expect(calls(error, 'SUI-RUN-DRAW')).toHaveLength(0);
    });

    it('should draw once per frame however many state changes come before it', async () => {
        // Arrange
        const mounted = await mountCanvas({ children: { a: { component: 'rect', width: 10, height: 10, fill: '#ff0000' } } });
        const other = await mountCanvas({ children: { b: { component: 'rect', width: 10, height: 10, fill: '#ff0000' } } });
        // No frame the first draws asked for is still to come
        await frame();
        await frame();
        const clears = vi.spyOn(canvasOf(mounted).getContext('2d')!, 'clearRect');
        const otherClears = vi.spyOn(canvasOf(other).getContext('2d')!, 'clearRect');
        const frames = vi.spyOn(window, 'requestAnimationFrame');

        // Act
        mounted.store.set(`${ROOT}.a.width`, 20);
        mounted.store.set(`${ROOT}.a.width`, 30);
        await microtasks();
        mounted.store.set(`${ROOT}.a.width`, 40);
        mounted.store.set(`${ROOT}.a.height`, 40);
        await microtasks();
        const asked = frames.mock.calls.length;
        await drawn(mounted);
        await frame();

        // Assert
        expect(asked).toBe(1);
        expect(clears).toHaveBeenCalledTimes(1);
        expect(otherClears).not.toHaveBeenCalled();
        expect(pixel(mounted, 35, 35)).toEqual([255, 0, 0, 255]);
    });

    it('should size the bitmap at the pixel ratio, at most 2, and draw again on a resize', async () => {
        // Arrange
        vi.stubGlobal('devicePixelRatio', 2);
        const mounted = await mountCanvas({ children: { a: { component: 'rect', x: 0, y: 0, width: 200, height: 100, fill: '#ff0000' } } });
        const first = [canvasOf(mounted).width, canvasOf(mounted).height];

        // Act
        vi.stubGlobal('devicePixelRatio', 3);
        mounted.host.style.width = '100px';
        await frame();
        await frame();

        // Assert
        expect(first).toEqual([400, 200]);
        expect([canvasOf(mounted).width, canvasOf(mounted).height]).toEqual([200, 200]);
        // The viewBox is fitted into 100 by 100: the rect is 100 by 50, centred
        expect(pixel(mounted, 50, 50)).toEqual([255, 0, 0, 255]);
        expect(pixel(mounted, 50, 10)).toEqual(EMPTY);
    });

    it('should hit the interactive shape on top, as the SVG renderer does for the same tree', async () => {
        // Arrange
        const tree: ShapeTree[] = [
            shape('rect', 'under', { x: 0, y: 0, width: 50, height: 50, interactive: true }),
            shape('circle', 'over', { cx: 40, cy: 40, r: 10, interactive: true }),
            shape('rect', 'cover', { x: 0, y: 0, width: 10, height: 10 }),
            shape('drawGroup', 'set', { x: 100, y: 0, rotate: 45, interactive: true }, [
                { kind: 'rect', key: 'r', path: `${ROOT}.set.children.r`, properties: { width: 20, height: 20 }, children: [] }
            ])
        ];
        const hosts = [document.createElement('div'), document.createElement('div')];
        for (const host of hosts) document.body.append(host);
        const canvas = createDrawingRenderer(hosts[0]!, options());
        const svg = createDrawingRenderer(hosts[1]!, options({ renderer: 'svg' }));
        canvas.update(tree);
        svg.update(tree);
        const points: [number, number][] = [
            [40, 40],
            [20, 20],
            [5, 5],
            [100, 10],
            [110, 10],
            [80, 80]
        ];

        // Act
        const hits = points.map(([x, y]) => canvas.hit(x, y)?.path);

        // Assert
        expect(hits).toEqual(points.map(([x, y]) => svg.hit(x, y)?.path));
        expect(hits.slice(0, 3)).toEqual([`${ROOT}.over`, `${ROOT}.under`, undefined]);
        expect(canvas.boundsOf(`${ROOT}.over`)).toEqual({ x: 30, y: 30, width: 20, height: 20 });
        canvas.dispose();
        svg.dispose();
        for (const host of hosts) host.remove();
    });

    it('should draw 20,000 circles with a median first draw under 1,000 ms', async () => {
        // Arrange
        const host = document.createElement('div');
        host.style.width = '400px';
        host.style.height = '400px';
        document.body.append(host);
        const renderer = createCanvasRenderer(host, options({ viewBox: { x: 0, y: 0, width: 400, height: 400 } }));
        renderer.update([]);
        await renderer.drawn();
        const trees = Array.from({ length: 5 }, (_tree, run) =>
            Array.from({ length: 20000 }, (_circle, index) => shape('circle', `c${run}-${index}`, { cx: (index % 200) * 2 + 1, cy: Math.floor(index / 200) * 4 + 1, r: 1, fill: '#0000ff' }))
        );
        let run = 0;

        // Act
        const median = medianMs(
            () => {
                renderer.update(trees[run++]!);
                renderer.paint();
            },
            5,
            0
        );
        console.log(`canvas: 20,000 circles, median first draw ${median.toFixed(1)} ms`);

        // Assert
        expect(median).toBeLessThan(1000);
        const data = renderer.canvas.getContext('2d')!.getImageData(0, 0, renderer.canvas.width, renderer.canvas.height).data;
        let blue = 0;
        for (let at = 0; at < data.length; at += 4) if (data[at + 2]! > 0) blue += 1;
        expect(blue).toBeGreaterThan(20000);
        renderer.dispose();
        host.remove();
    });

    it('should draw a drawRepeat of 20,500 records as 20,000 copies with one SUI-RUN-CAP, and no element or store entry per record', async () => {
        // Arrange
        const error = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        const points = Array.from({ length: 20500 }, (_value, index) => ({ x: index % 200, y: Math.floor(index / 200) }));

        // Act
        const mounted = await mountCanvas(
            { children: { dots: { component: 'drawRepeat', '<-records': '$.data.points', row: { component: 'rect', width: 1, height: 1, fill: '#000000', '<-x': '$row.x', '<-y': '$row.y' } } } },
            { data: { points } },
            200,
            103
        );

        // Assert
        expect(pixel(mounted, 0, 0)[3]).toBe(255);
        expect(pixel(mounted, 199, 99)[3]).toBe(255);
        expect(pixel(mounted, 0, 100)).toEqual(EMPTY);
        expect(pixel(mounted, 199, 102)).toEqual(EMPTY);
        expect(calls(error, 'SUI-RUN-CAP')).toHaveLength(1);
        expect(String(calls(error, 'SUI-RUN-CAP')[0]?.[0])).toContain('20000');
        expect(mounted.element.shadowRoot?.querySelector('[data-shape-path]')).toBeNull();
        expect(mounted.store.get(`${ROOT}.dots.rows`)).toBeUndefined();
    });

    it('should skip a shape with an unusable value with one report while its neighbours draw', async () => {
        // Arrange
        const error = vi.spyOn(report, 'error').mockImplementation(() => undefined);

        // Act
        const mounted = await mountCanvas(
            {
                children: {
                    a: { component: 'rect', width: 10, height: 10, fill: '#ff0000' },
                    bad: { component: 'circle', '<-cx': '$.data.where', cy: 50, r: 5, fill: '#ff0000' },
                    c: { component: 'circle', cx: 30, cy: 5, r: 5, fill: '#ff0000' }
                }
            },
            { data: { where: 'left' } }
        );
        mounted.store.set(`${ROOT}.c.r`, 6);
        await drawn(mounted);

        // Assert
        const reports = calls(error, 'SUI-RUN-DRAW');
        expect(reports).toHaveLength(1);
        expect(String(reports[0]?.[0])).toContain(`${ROOT}.bad`);
        expect(String(reports[0]?.[0])).toContain('property "cx" is not a number');
        expect(pixel(mounted, 5, 5)[3]).toBe(255);
        expect(pixel(mounted, 30, 5)[3]).toBe(255);
        expect(painted(mounted, 0, 40, 20, 20)).toBe(false);
    });

    it('should be pending from a state change until the frame is drawn, then ready', async () => {
        // Arrange
        const mounted = await mountCanvas({ children: { a: { component: 'rect', width: 10, height: 10, fill: '#ff0000' } } });
        const first = mounted.element.getAttribute('data-render');

        // Act
        mounted.store.set(`${ROOT}.a.width`, 20);
        const during = mounted.element.getAttribute('data-render');
        await drawn(mounted);

        // Assert
        expect(first).toBe('ready');
        expect(during).toBe('pending');
        expect(pixel(mounted, 15, 5)).toEqual([255, 0, 0, 255]);
    });
});
