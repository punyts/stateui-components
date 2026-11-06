import { afterEach, describe, expect, it } from 'vitest';
import { createPainter } from '../../src/shared/paint/draw.ts';
import type { Painter } from '../../src/shared/paint/draw.ts';

const WIDTH = 160;
const HEIGHT = 120;

let canvases: HTMLCanvasElement[] = [];

afterEach(() => {
    for (const canvas of canvases) canvas.remove();
    canvases = [];
});

function setup(read?: (name: string) => string): { painter: Painter; context: CanvasRenderingContext2D } {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    document.body.append(canvas);
    canvases.push(canvas);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('No 2d canvas context');
    return { painter: createPainter({ context, width: WIDTH, height: HEIGHT, read }), context };
}

const pixel = (context: CanvasRenderingContext2D, x: number, y: number): number[] => [...context.getImageData(x, y, 1, 1).data];

const bitmap = (context: CanvasRenderingContext2D): Uint8ClampedArray => context.getImageData(0, 0, WIDTH, HEIGHT).data;

/** A small pseudo-random sequence, so a long test is the same every run */
function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

describe('painting engine on a canvas', () => {
    it('should paint a brush stroke and erase across it', () => {
        const { painter, context } = setup();
        expect(painter.begin({ tool: 'brush', color: '#ff0000', size: 10 }, { x: 10, y: 60 })).toBe(true);
        painter.extend({ x: 60, y: 58 }, { x: 110, y: 62 }, { x: 150, y: 60 });
        painter.end();
        expect(pixel(context, 80, 60)).toEqual([255, 0, 0, 255]);
        expect(pixel(context, 80, 20)).toEqual([0, 0, 0, 0]);

        expect(painter.begin({ tool: 'eraser', size: 20 }, { x: 80, y: 10 })).toBe(true);
        painter.extend({ x: 80, y: 110 });
        painter.end();
        expect(pixel(context, 80, 60)[3]).toBe(0);
        expect(pixel(context, 30, 60)).toEqual([255, 0, 0, 255]);
        expect(pixel(context, 130, 60)).toEqual([255, 0, 0, 255]);

        painter.undo();
        expect(pixel(context, 80, 60)).toEqual([255, 0, 0, 255]);
        painter.redo();
        expect(pixel(context, 80, 60)[3]).toBe(0);
        painter.clear();
        expect(bitmap(context).every((byte) => byte === 0)).toBe(true);
    });

    it('should draw a translucent stroke once where it crosses itself', () => {
        const { painter, context } = setup();
        painter.begin({ tool: 'brush', color: 'rgba(0, 0, 255, 0.5)', size: 12 }, { x: 20, y: 20 });
        painter.extend({ x: 140, y: 100 }, { x: 140, y: 20 }, { x: 20, y: 100 });
        const live = pixel(context, 80, 60);
        painter.end();
        const crossing = pixel(context, 80, 60);
        expect(crossing).toEqual(live);
        expect(crossing[3]).toBeGreaterThan(110);
        expect(crossing[3]).toBeLessThan(145);
    });

    it('should paint a token colour as it was when the stroke began', () => {
        let accent = 'rgb(0, 128, 0)';
        const { painter, context } = setup((name) => (name === '--ui-color-accent-base' ? accent : ''));
        painter.begin({ tool: 'brush', color: '{color.accent.base}', size: 8 }, { x: 40, y: 40 });
        painter.end();
        accent = 'rgb(200, 0, 200)';
        painter.render();
        expect(pixel(context, 40, 40)).toEqual([0, 128, 0, 255]);
    });

    it('should give the bitmap after stroke 50 back after 250 strokes and 200 undos, pixel for pixel', () => {
        const { painter, context } = setup();
        const next = random(2026);
        const colors = ['#e03030', 'rgba(20, 120, 220, 0.5)', '#30a050', 'rgba(0, 0, 0, 0.3)'];
        let after50: Uint8ClampedArray | undefined;
        for (let n = 1; n <= 250; n++) {
            const x = next() * WIDTH;
            const y = next() * HEIGHT;
            painter.begin({ tool: n % 7 === 0 ? 'eraser' : 'brush', color: colors[n % colors.length], size: 2 + Math.floor(next() * 12) }, { x, y });
            for (let i = 0; i < 6; i++) painter.extend({ x: x + (next() - 0.5) * 60, y: y + (next() - 0.5) * 60 });
            painter.end();
            if (n === 50) after50 = bitmap(context);
        }
        expect(bitmap(context)).not.toEqual(after50);
        for (let i = 0; i < 200; i++) expect(painter.undo()).toBe(true);
        expect(bitmap(context)).toEqual(after50);
        expect(painter.undo()).toBe(false);
        expect(bitmap(context)).toEqual(after50);
    });
});
