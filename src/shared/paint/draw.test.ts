import { describe, expect, it } from 'vitest';
import { createFakeBitmap, createFakeContext, createFakeSurface } from '../../../test/harness/fakePaintCanvas.ts';
import type { FakeBitmap } from '../../../test/harness/fakePaintCanvas.ts';
import { compositeOf, createPainter, drawStroke, shapeEnds, smoothPath } from './draw.js';
import type { Painter, PathStep } from './draw.js';
import { addPoint } from './strokes.js';
import type { PaintPoint } from './strokes.js';

const WIDTH = 48;
const HEIGHT = 36;

function setup(limit?: number): { painter: Painter; bitmap: FakeBitmap } {
    const bitmap = createFakeBitmap(WIDTH, HEIGHT);
    const painter = createPainter({ context: createFakeContext(bitmap), width: WIDTH, height: HEIGHT, createSurface: createFakeSurface, limit });
    return { painter, bitmap };
}

const pixel = (bitmap: FakeBitmap, x: number, y: number): number[] => [...bitmap.data.slice((y * bitmap.width + x) * 4, (y * bitmap.width + x) * 4 + 4)];

/** A small pseudo-random sequence, so a long test is the same every run */
function random(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
    };
}

const COLORS = ['#e03030', 'rgba(20, 120, 220, 0.5)', '#30a050', 'rgba(0, 0, 0, 0.25)'];

/** Draws stroke `n` of a fixed sequence: short strokes in mixed colours and sizes, every seventh an eraser */
function drawNumbered(painter: Painter, next: () => number, n: number): void {
    const tool = n % 7 === 0 ? 'eraser' : 'brush';
    const x = next() * WIDTH;
    const y = next() * HEIGHT;
    const count = 1 + Math.floor(next() * 3);
    expect(painter.begin({ tool, color: COLORS[n % COLORS.length], size: 1 + Math.floor(next() * 4) }, { x, y })).toBe(true);
    for (let i = 0; i < count; i++) painter.extend({ x: x + (next() - 0.5) * 16, y: y + (next() - 0.5) * 16 });
    painter.end();
}

describe('smoothPath', () => {
    it('should make a dot of one point and a line of two', () => {
        expect(smoothPath([])).toEqual([]);
        expect(smoothPath([{ x: 1, y: 2 }])).toEqual([{ kind: 'move', x: 1, y: 2 }]);
        expect(smoothPath([{ x: 1, y: 2 }, { x: 5, y: 6 }])).toEqual([
            { kind: 'move', x: 1, y: 2 },
            { kind: 'line', x: 5, y: 6 }
        ]);
    });

    it('should curve through the middle points to the midpoints', () => {
        expect(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toEqual([
            { kind: 'move', x: 0, y: 0 },
            { kind: 'quad', cx: 10, cy: 0, x: 10, y: 5 },
            { kind: 'quad', cx: 10, cy: 10, x: 5, y: 10 },
            { kind: 'line', x: 0, y: 10 }
        ]);
    });

    it('should keep every coordinate inside the canvas for points thrown far outside it', () => {
        const next = random(7);
        const points: PaintPoint[] = [];
        for (let i = 0; i < 400; i++) addPoint(points, { x: (next() - 0.25) * WIDTH * 4, y: (next() - 0.25) * HEIGHT * 4 }, WIDTH, HEIGHT);
        const steps = smoothPath(points);
        expect(steps.length).toBeGreaterThan(100);
        const coordinates = steps.flatMap((step: PathStep) => (step.kind === 'quad' ? [[step.cx, step.cy], [step.x, step.y]] : [[step.x, step.y]]));
        for (const [x, y] of coordinates) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(WIDTH);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(HEIGHT);
        }
    });
});

describe('drawStroke', () => {
    it('should paint with the brush and take away with the eraser', () => {
        expect(compositeOf('brush')).toBe('source-over');
        expect(compositeOf('eraser')).toBe('destination-out');
        const bitmap = createFakeBitmap(20, 20);
        const context = createFakeContext(bitmap);
        drawStroke(context, { tool: 'brush', color: '#ff0000', size: 4, points: [{ x: 2, y: 10 }, { x: 18, y: 10 }] });
        expect(pixel(bitmap, 10, 10)).toEqual([255, 0, 0, 255]);
        expect(pixel(bitmap, 10, 2)).toEqual([0, 0, 0, 0]);
        drawStroke(context, { tool: 'eraser', color: '#ff0000', size: 2, points: [{ x: 10.5, y: 10.5 }] });
        expect(pixel(bitmap, 10, 10)[3]).toBe(0);
        expect(pixel(bitmap, 14, 10)).toEqual([255, 0, 0, 255]);
        expect(context.globalCompositeOperation).toBe('source-over');
    });
});

describe('createPainter', () => {
    it('should show a stroke while it is drawn, and drop it on cancel', () => {
        const { painter, bitmap } = setup();
        expect(painter.begin({ tool: 'brush', color: '#0000ff', size: 3 }, { x: 4, y: 4 })).toBe(true);
        painter.extend({ x: 20, y: 4 }, { x: 30, y: 4 });
        expect(painter.drawing).toBe(true);
        expect(pixel(bitmap, 25, 4)).toEqual([0, 0, 255, 255]);
        painter.cancel();
        expect(painter.drawing).toBe(false);
        expect(pixel(bitmap, 25, 4)).toEqual([0, 0, 0, 0]);
        expect(painter.canUndo).toBe(false);
    });

    it('should refuse a stroke it cannot draw', () => {
        const { painter } = setup();
        expect(painter.begin({ tool: 'spray' as 'brush', color: '#000', size: 2 }, { x: 1, y: 1 })).toBe(false);
        expect(painter.begin({ tool: 'brush', color: '{color.accent.base}', size: 2 }, { x: 1, y: 1 })).toBe(false);
        expect(painter.begin({ tool: 'brush', color: '#000', size: 'big' }, { x: 1, y: 1 })).toBe(false);
        expect(painter.begin({ tool: 'brush', color: '#000', size: 2 }, { x: 'a', y: 1 })).toBe(false);
        expect(painter.begin({ tool: 'eraser', size: 2 }, { x: 1, y: 1 })).toBe(true);
    });

    it('should resolve a token colour once, when the stroke begins', () => {
        let accent = '#00ff00';
        const bitmap = createFakeBitmap(WIDTH, HEIGHT);
        const painter = createPainter({
            context: createFakeContext(bitmap),
            width: WIDTH,
            height: HEIGHT,
            createSurface: createFakeSurface,
            read: (name) => (name === '--ui-color-accent-base' ? accent : '')
        });
        painter.begin({ tool: 'brush', color: '{color.accent.base}', size: 4 }, { x: 10, y: 10 });
        const stroke = painter.end();
        expect(stroke?.color).toBe('#00ff00');
        accent = '#ff00ff';
        painter.begin({ tool: 'brush', color: '#000', size: 2 }, { x: 40, y: 30 });
        painter.end();
        painter.undo();
        painter.render();
        expect(pixel(bitmap, 10, 10)).toEqual([0, 255, 0, 255]);
    });

    it('should undo, redo and clear', () => {
        const { painter, bitmap } = setup();
        painter.begin({ tool: 'brush', color: '#ff0000', size: 4 }, { x: 5, y: 5 });
        painter.extend({ x: 40, y: 5 });
        painter.end();
        painter.begin({ tool: 'eraser', size: 6 }, { x: 20, y: 5 });
        painter.end();
        expect(pixel(bitmap, 20, 5)[3]).toBe(0);
        expect(painter.undo()).toBe(true);
        expect(pixel(bitmap, 20, 5)).toEqual([255, 0, 0, 255]);
        expect(painter.redo()).toBe(true);
        expect(pixel(bitmap, 20, 5)[3]).toBe(0);
        expect(painter.blank).toBe(false);
        expect(painter.clear()).toBe(true);
        expect(painter.blank).toBe(true);
        expect(pixel(bitmap, 30, 5)[3]).toBe(0);
        expect(painter.clear()).toBe(false);
        expect(painter.undo()).toBe(true);
        expect(pixel(bitmap, 30, 5)).toEqual([255, 0, 0, 255]);
        expect(painter.redo()).toBe(true);
        expect(painter.redo()).toBe(false);
        expect(pixel(bitmap, 30, 5)[3]).toBe(0);
    });

    it('should forget everything on reset', () => {
        const { painter, bitmap } = setup(2);
        for (let i = 0; i < 4; i++) {
            painter.begin({ tool: 'brush', color: '#ff0000', size: 4 }, { x: 5 + i * 8, y: 5 });
            painter.end();
        }
        painter.reset();
        expect(painter.canUndo).toBe(false);
        expect(painter.blank).toBe(true);
        expect(bitmap.data.every((byte) => byte === 0)).toBe(true);
    });

    it('should give the bitmap after stroke 50 back after 250 strokes and 200 undos, pixel for pixel', () => {
        const { painter, bitmap } = setup();
        const next = random(42);
        let after50: Uint8ClampedArray | undefined;
        for (let n = 1; n <= 250; n++) {
            drawNumbered(painter, next, n);
            if (n === 50) after50 = bitmap.data.slice();
        }
        expect(after50?.some((byte) => byte !== 0)).toBe(true);
        expect(bitmap.data).not.toEqual(after50);
        for (let i = 0; i < 200; i++) expect(painter.undo()).toBe(true);
        expect(bitmap.data).toEqual(after50);
        expect(painter.undo()).toBe(false);
        expect(bitmap.data).toEqual(after50);
        // Redo walks forward again over the flattened base
        expect(painter.redo()).toBe(true);
        expect(bitmap.data).not.toEqual(after50);
    });

    it('should do nothing after dispose', () => {
        const { painter } = setup();
        painter.dispose();
        expect(painter.begin({ tool: 'brush', color: '#000', size: 2 }, { x: 1, y: 1 })).toBe(false);
        expect(painter.undo()).toBe(false);
        expect(painter.clear()).toBe(false);
    });
});

describe('shape tools (G2.6b)', () => {
    /** Where each shape from (8, 8) to (40, 28) paints, and where it does not */
    const SHAPES = [
        { tool: 'line', on: [[24, 18]], off: [[8, 28], [40, 8]] },
        { tool: 'rect', on: [[24, 8], [40, 18], [24, 28], [8, 18]], off: [[24, 18]] },
        { tool: 'ellipse', on: [[24, 8], [40, 18], [24, 28], [8, 18]], off: [[24, 18], [9, 9]] }
    ] as const;

    it.each(SHAPES)('should preview a $tool that follows the pointer and commit it on release', ({ tool, on, off }) => {
        const { painter, bitmap } = setup();
        expect(painter.begin({ tool, color: '#ff0000', size: 2 }, { x: 8, y: 8 })).toBe(true);
        painter.extend({ x: 46, y: 34 });
        const first = bitmap.data.slice();
        painter.extend({ x: 30, y: 30 }, { x: 40, y: 28 });
        // The preview moved: the earlier one left no trail
        expect(bitmap.data).not.toEqual(first);
        for (const [x, y] of on) expect(pixel(bitmap, x, y)).toEqual([255, 0, 0, 255]);
        expect(pixel(bitmap, 46, 34)[3]).toBe(0);
        expect(painter.canUndo).toBe(false);

        const stroke = painter.end();
        expect(stroke).toMatchObject({ tool, points: [{ x: 8, y: 8 }, { x: 40, y: 28 }] });
        for (const [x, y] of on) expect(pixel(bitmap, x, y)).toEqual([255, 0, 0, 255]);
        for (const [x, y] of off) expect(pixel(bitmap, x, y)).toEqual([0, 0, 0, 0]);
        expect(painter.blank).toBe(false);
        expect(painter.undo()).toBe(true);
        expect(bitmap.data.every((byte) => byte === 0)).toBe(true);
        expect(painter.redo()).toBe(true);
        for (const [x, y] of on) expect(pixel(bitmap, x, y)).toEqual([255, 0, 0, 255]);
    });

    it.each(SHAPES)('should leave the bitmap unchanged when a $tool is cancelled before release', ({ tool }) => {
        const { painter, bitmap } = setup();
        painter.begin({ tool: 'brush', color: '#0000ff', size: 3 }, { x: 2, y: 30 });
        painter.extend({ x: 46, y: 30 });
        painter.end();
        const before = bitmap.data.slice();
        painter.begin({ tool, color: '#ff0000', size: 2 }, { x: 8, y: 8 });
        painter.extend({ x: 40, y: 28 });
        expect(bitmap.data).not.toEqual(before);
        painter.cancel();
        expect(bitmap.data).toEqual(before);
        expect(painter.end()).toBeUndefined();
        expect(painter.undo()).toBe(true);
        expect(bitmap.data.every((byte) => byte === 0)).toBe(true);
    });

    it('should commit nothing for a shape pressed and released on one point', () => {
        const { painter, bitmap } = setup();
        painter.begin({ tool: 'rect', color: '#ff0000', size: 4 }, { x: 10, y: 10 });
        expect(painter.end()).toBeUndefined();
        expect(painter.canUndo).toBe(false);
        expect(bitmap.data.every((byte) => byte === 0)).toBe(true);
        expect(shapeEnds([{ x: 1, y: 1 }])).toBeUndefined();
        expect(shapeEnds([{ x: 1, y: 1 }, { x: 1, y: 1 }])).toBeUndefined();
        expect(shapeEnds([{ x: 1, y: 1 }, { x: 2, y: 1 }])).toEqual([{ x: 1, y: 1 }, { x: 2, y: 1 }]);
    });

    it('should keep a shape inside the canvas', () => {
        const { painter } = setup();
        painter.begin({ tool: 'line', color: '#000', size: 2 }, { x: 4, y: 4 });
        painter.extend({ x: 500, y: -40 });
        expect(painter.end()?.points).toEqual([{ x: 4, y: 4 }, { x: WIDTH, y: 0 }]);
    });
});

describe('fill tool (G2.6b)', () => {
    /** A painter with a closed green rectangle outline from (8, 8) to (40, 28) */
    function ring(): { painter: Painter; bitmap: FakeBitmap } {
        const made = setup();
        made.painter.begin({ tool: 'rect', color: '#00ff00', size: 2 }, { x: 8, y: 8 });
        made.painter.extend({ x: 40, y: 28 });
        made.painter.end();
        return made;
    }

    it('should fill inside the ring in slices, then show it; undo and redo take it back and put it back', async () => {
        const { painter, bitmap } = ring();
        expect(painter.begin({ tool: 'fill', color: '#0000ff', size: 2 }, { x: 24, y: 18 })).toBe(true);
        painter.extend({ x: 2, y: 2 });
        const stroke = painter.end();
        expect(stroke).toMatchObject({ tool: 'fill', color: '#0000ff', points: [{ x: 24, y: 18 }], tolerance: 32 });
        expect(painter.canUndo).toBe(true);
        await painter.idle();
        expect(painter.busy).toBe(false);
        expect(pixel(bitmap, 24, 18)).toEqual([0, 0, 255, 255]);
        expect(pixel(bitmap, 11, 11)).toEqual([0, 0, 255, 255]);
        expect(pixel(bitmap, 24, 8)).toEqual([0, 255, 0, 255]);
        expect(pixel(bitmap, 2, 2)).toEqual([0, 0, 0, 0]);
        expect(pixel(bitmap, 46, 34)).toEqual([0, 0, 0, 0]);

        expect(painter.undo()).toBe(true);
        expect(pixel(bitmap, 24, 18)).toEqual([0, 0, 0, 0]);
        expect(painter.redo()).toBe(true);
        expect(pixel(bitmap, 24, 18)).toEqual([0, 0, 255, 255]);
    });

    it('should yield between slices: a fill with a tiny slice is still under way after end', async () => {
        const bitmap = createFakeBitmap(WIDTH, HEIGHT);
        const painter = createPainter({ context: createFakeContext(bitmap), width: WIDTH, height: HEIGHT, createSurface: createFakeSurface, fillSliceMs: 0.0001 });
        painter.begin({ tool: 'fill', color: '#0000ff', size: 2 }, { x: 1, y: 1 });
        painter.end();
        expect(painter.busy).toBe(true);
        expect(pixel(bitmap, 1, 1)).toEqual([0, 0, 0, 0]);
        await painter.idle();
        expect(pixel(bitmap, 1, 1)).toEqual([0, 0, 255, 255]);
        expect(pixel(bitmap, WIDTH - 1, HEIGHT - 1)).toEqual([0, 0, 255, 255]);
    });

    it('should fill outside the ring to every border', async () => {
        const { painter, bitmap } = ring();
        painter.begin({ tool: 'fill', color: '#ff0000', size: 2 }, { x: 0, y: 0 });
        painter.end();
        await painter.idle();
        for (const [x, y] of [[0, 0], [WIDTH - 1, 0], [0, HEIGHT - 1], [WIDTH - 1, HEIGHT - 1], [24, 2]]) expect(pixel(bitmap, x, y)).toEqual([255, 0, 0, 255]);
        expect(pixel(bitmap, 24, 18)).toEqual([0, 0, 0, 0]);
    });

    it('should finish a fill under way before the next stroke, and drop it on undo or clear', async () => {
        const bitmap = createFakeBitmap(WIDTH, HEIGHT);
        const painter = createPainter({ context: createFakeContext(bitmap), width: WIDTH, height: HEIGHT, createSurface: createFakeSurface, fillSliceMs: 0.0001 });
        painter.begin({ tool: 'fill', color: '#0000ff', size: 2 }, { x: 24, y: 18 });
        painter.end();
        expect(painter.busy).toBe(true);
        painter.begin({ tool: 'brush', color: '#ff0000', size: 2 }, { x: 2, y: 2 });
        expect(painter.busy).toBe(false);
        expect(pixel(bitmap, 24, 18)).toEqual([0, 0, 255, 255]);
        painter.end();

        painter.begin({ tool: 'fill', color: '#ffffff', size: 2 }, { x: 24, y: 18 });
        painter.end();
        expect(painter.busy).toBe(true);
        expect(painter.undo()).toBe(true);
        expect(painter.busy).toBe(false);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(pixel(bitmap, 24, 18)).toEqual([0, 0, 255, 255]);

        painter.begin({ tool: 'fill', color: '#ffffff', size: 2 }, { x: 24, y: 18 });
        painter.end();
        expect(painter.clear()).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(bitmap.data.every((byte) => byte === 0)).toBe(true);
    });

    it('should keep a fill colour it can parse, and read one it cannot from a one-pixel surface', () => {
        const { painter } = setup();
        painter.begin({ tool: 'fill', color: 'rgba(10, 20, 30, 0.5)', size: 2 }, { x: 1, y: 1 });
        expect(painter.end()?.color).toBe('rgba(10, 20, 30, 0.5)');
        const probed = createPainter({
            context: createFakeContext(createFakeBitmap(4, 4)),
            width: 4,
            height: 4,
            // A surface that reads every colour as a fixed blue, as a browser reads a named colour
            createSurface: (width, height) => {
                const surface = createFakeSurface(width, height);
                const fillRect = surface.context.fillRect.bind(surface.context);
                surface.context.fillRect = (x, y, w, h) => {
                    surface.context.fillStyle = '#0000ff';
                    fillRect(x, y, w, h);
                };
                return surface;
            },
            read: (name) => (name === '--ui-color-accent-base' ? 'oklch(0.5 0.1 260)' : '')
        });
        expect(probed.begin({ tool: 'fill', color: '{color.accent.base}', size: 2 }, { x: 1, y: 1 })).toBe(true);
        expect(probed.end()?.color).toBe('rgba(0, 0, 255, 1)');
    });

    it('should draw no fill without the canvas size', () => {
        const bitmap = createFakeBitmap(10, 10);
        drawStroke(createFakeContext(bitmap), { tool: 'fill', color: '#ff0000', size: 2, points: [{ x: 1, y: 1 }] });
        expect(bitmap.data.every((byte) => byte === 0)).toBe(true);
        drawStroke(createFakeContext(bitmap), { tool: 'fill', color: '#ff0000', size: 2, points: [{ x: 1, y: 1 }] }, { width: 10, height: 10 });
        expect(pixel(bitmap, 9, 9)).toEqual([255, 0, 0, 255]);
    });
});
