import { describe, expect, it } from 'vitest';
import { createFakeBitmap, createFakeContext, createFakeSurface } from '../../../test/harness/fakePaintCanvas.ts';
import type { FakeBitmap } from '../../../test/harness/fakePaintCanvas.ts';
import { compositeOf, createPainter, drawStroke, smoothPath } from './draw.js';
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
        expect(painter.begin({ tool: 'fill' as 'brush', color: '#000', size: 2 }, { x: 1, y: 1 })).toBe(false);
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
