import { afterEach, describe, expect, it } from 'vitest';
import { createPainter } from '../../src/shared/paint/draw.ts';
import type { Painter } from '../../src/shared/paint/draw.ts';
import { medianMsAsync } from '../harness/medianMs.ts';

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

describe('shape and fill tools on a canvas (G2.6b)', () => {
    /**
     * Where each shape from (20, 20) to (140, 100) paints (opaque red) and where it leaves the canvas clear; `trail` is a
     * point the preview to (150, 115) paints and the final shape does not
     */
    const SHAPES = [
        { tool: 'line', trail: [150, 115], on: [[80, 60], [30, 27]], off: [[80, 30], [140, 20]] },
        { tool: 'rect', trail: [150, 115], on: [[80, 20], [140, 60], [80, 100], [20, 60], [20, 20]], off: [[80, 60], [80, 30]] },
        { tool: 'ellipse', trail: [150, 67], on: [[80, 20], [140, 60], [80, 100], [20, 60]], off: [[80, 60], [22, 22]] }
    ] as const;

    it.each(SHAPES)('should preview a $tool while the pointer moves and draw it on release', ({ tool, trail, on, off }) => {
        const { painter, context } = setup();
        expect(painter.begin({ tool, color: '#ff0000', size: 6 }, { x: 20, y: 20 })).toBe(true);
        painter.extend({ x: 150, y: 115 });
        expect(pixel(context, trail[0], trail[1])[3]).toBeGreaterThan(0);
        painter.extend({ x: 140, y: 100 });
        // The preview follows the pointer and leaves no trail
        expect(pixel(context, trail[0], trail[1])[3]).toBe(0);
        for (const [x, y] of on) expect(pixel(context, x, y)).toEqual([255, 0, 0, 255]);

        painter.end();
        for (const [x, y] of on) expect(pixel(context, x, y)).toEqual([255, 0, 0, 255]);
        for (const [x, y] of off) expect(pixel(context, x, y)).toEqual([0, 0, 0, 0]);
        painter.undo();
        expect(bitmap(context).every((byte) => byte === 0)).toBe(true);
    });

    it.each(SHAPES)('should leave the bitmap as it was when a $tool is cancelled before release', ({ tool }) => {
        const { painter, context } = setup();
        painter.begin({ tool: 'brush', color: '#0000ff', size: 8 }, { x: 10, y: 60 });
        painter.extend({ x: 150, y: 60 });
        painter.end();
        const before = bitmap(context);
        painter.begin({ tool, color: '#ff0000', size: 6 }, { x: 20, y: 20 });
        painter.extend({ x: 140, y: 100 });
        expect(bitmap(context)).not.toEqual(before);
        painter.cancel();
        expect(bitmap(context)).toEqual(before);
        expect(painter.end()).toBeUndefined();
    });

    it('should flood fill inside a closed shape, stop at its outline, and undo the fill', async () => {
        const { painter, context } = setup();
        painter.begin({ tool: 'ellipse', color: '#000000', size: 4 }, { x: 20, y: 20 });
        painter.extend({ x: 140, y: 100 });
        painter.end();

        expect(painter.begin({ tool: 'fill', color: '#00c000', size: 2 }, { x: 80, y: 60 })).toBe(true);
        painter.end();
        await painter.idle();

        expect(pixel(context, 80, 60)).toEqual([0, 192, 0, 255]);
        expect(pixel(context, 40, 60)).toEqual([0, 192, 0, 255]);
        expect(pixel(context, 80, 20)).toEqual([0, 0, 0, 255]);
        expect(pixel(context, 5, 5)).toEqual([0, 0, 0, 0]);
        expect(pixel(context, 22, 22)).toEqual([0, 0, 0, 0]);
        painter.undo();
        expect(pixel(context, 80, 60)).toEqual([0, 0, 0, 0]);
        painter.redo();
        expect(pixel(context, 80, 60)).toEqual([0, 192, 0, 255]);
    });

    it('should flood fill the outside of a shape out to every border', async () => {
        const { painter, context } = setup();
        painter.begin({ tool: 'rect', color: '#000000', size: 4 }, { x: 40, y: 30 });
        painter.extend({ x: 120, y: 90 });
        painter.end();

        painter.begin({ tool: 'fill', color: 'rgb(0, 0, 255)', size: 2 }, { x: 0, y: 0 });
        painter.end();
        await painter.idle();

        for (const [x, y] of [[0, 0], [WIDTH - 1, 0], [0, HEIGHT - 1], [WIDTH - 1, HEIGHT - 1], [80, 10]]) expect(pixel(context, x, y)).toEqual([0, 0, 255, 255]);
        expect(pixel(context, 80, 60)).toEqual([0, 0, 0, 0]);
    });

    it('should fill a 4096 by 4096 canvas within 2,000 ms (median of five) without freezing the page for over 100 ms', async () => {
        const size = 4096;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        canvases.push(canvas);
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('No 2d canvas context');
        const painter = createPainter({ context, width: size, height: size });
        let longest = 0;

        /** One fill over the whole canvas around a ring, with a heartbeat on timers that records the longest gap */
        const run = async (): Promise<void> => {
            let last = performance.now();
            let beating = true;
            const beat = (): void => {
                const time = performance.now();
                longest = Math.max(longest, time - last);
                last = time;
                if (beating) setTimeout(beat, 0);
            };
            setTimeout(beat, 0);
            painter.begin({ tool: 'fill', color: '#3366ff', size: 2 }, { x: 0, y: 0 });
            painter.end();
            await painter.idle();
            beating = false;
            await new Promise((resolve) => setTimeout(resolve, 0));
        };
        const prepare = (): void => {
            painter.reset();
            painter.begin({ tool: 'ellipse', color: '#000000', size: 8 }, { x: 1000, y: 1000 });
            painter.extend({ x: 3000, y: 3000 });
            painter.end();
        };

        const median = await medianMsAsync(run, 5, 1, prepare);
        painter.render();

        console.log(`paint fill 4096x4096: median ${median.toFixed(0)} ms, longest pause ${longest.toFixed(0)} ms`);
        expect(pixel(context, 0, 0)).toEqual([51, 102, 255, 255]);
        expect(pixel(context, size - 1, size - 1)).toEqual([51, 102, 255, 255]);
        expect(pixel(context, 2000, 2000)).toEqual([0, 0, 0, 0]);
        expect(median).toBeLessThan(2000);
        expect(longest).toBeLessThan(100);
        painter.dispose();
    });
});
