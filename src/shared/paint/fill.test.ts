import { describe, expect, it } from 'vitest';
import { clampTolerance, createFillSearch, DEFAULT_FILL_TOLERANCE, floodFill, parseRgba } from './fill.js';
import type { PaintPixels, Rgba } from './fill.js';

/** The colours of the fixture: `.` transparent, `#` black, `o` orange, `n` near white, `w` white */
const KEYS: Readonly<Record<string, Rgba>> = {
    '.': [0, 0, 0, 0],
    '#': [0, 0, 0, 255],
    o: [255, 128, 0, 255],
    n: [240, 240, 240, 255],
    w: [255, 255, 255, 255]
};

/**
 * The fixture bitmap: a black ring with an orange island (the hole) inside it, a white region inside the ring around
 * the island, a near-white pixel in that region and a transparent outside that runs along every border of the canvas.
 * Two transparent pixels in the bottom right corner touch the outside only diagonally, so a fill through four
 * neighbours does not reach them
 */
const FIXTURE = [
    '............',
    '.##########.',
    '.#wwwwwwww#.',
    '.#wwnwwwww#.',
    '.#www oo w#.',
    '.#www oo w#.',
    '.#wwwwwwww#.',
    '.##########.',
    '.........#.#',
    '..........#.'
].map((row) => row.replace(/ /g, 'w'));

function bitmap(rows: readonly string[]): PaintPixels {
    const height = rows.length;
    const width = rows[0].length;
    const data = new Uint8ClampedArray(width * height * 4);
    rows.forEach((row, y) => [...row].forEach((key, x) => data.set(KEYS[key], (y * width + x) * 4)));
    return { width, height, data };
}

/** The bitmap as rows of keys again, `F` for a pixel of the fill colour */
function picture(pixels: PaintPixels, fill: Rgba): string[] {
    const rows: string[] = [];
    for (let y = 0; y < pixels.height; y++) {
        let row = '';
        for (let x = 0; x < pixels.width; x++) {
            const at = (y * pixels.width + x) * 4;
            const pixel = [...pixels.data.slice(at, at + 4)];
            if (pixel.every((value, index) => value === fill[index])) row += 'F';
            else row += Object.entries(KEYS).find(([, color]) => color.every((value, index) => value === pixel[index]))?.[0] ?? '?';
        }
        rows.push(row);
    }
    return rows;
}

const RED: Rgba = [255, 0, 0, 255];

describe('floodFill', () => {
    it('should fill the outside along every border and stop at the ring and at a diagonal gap', () => {
        const pixels = bitmap(FIXTURE);

        const result = floodFill(pixels, 0, 0, RED, 0);

        expect(picture(pixels, RED)).toEqual([
            'FFFFFFFFFFFF',
            'F##########F',
            'F#wwwwwwww#F',
            'F#wwnwwwww#F',
            'F#wwwwooww#F',
            'F#wwwwooww#F',
            'F#wwwwwwww#F',
            'F##########F',
            'FFFFFFFFF#.#',
            'FFFFFFFFFF#.'
        ]);
        expect(result.count).toBe(12 + 2 * 7 + 9 + 10);
        expect(result.top).toBe(0);
        expect(result.bottom).toBe(9);
    });

    it('should fill inside the ring around the hole, leaving the island and the ring as they were', () => {
        const pixels = bitmap(FIXTURE);

        const result = floodFill(pixels, 2.5, 2.5, RED, 0);

        const after = picture(pixels, RED);
        expect(after[2]).toBe('.#FFFFFFFF#.');
        expect(after[3]).toBe('.#FFnFFFFF#.');
        expect(after[4]).toBe('.#FFFFooFF#.');
        expect(after[5]).toBe('.#FFFFooFF#.');
        expect(after[0]).toBe('............');
        expect(after[1]).toBe('.##########.');
        expect(result.count).toBe(8 * 5 - 4 - 1);
        expect([result.top, result.bottom]).toEqual([2, 6]);
    });

    it('should take a pixel within the tolerance and leave one outside it', () => {
        const near = bitmap(FIXTURE);
        const exact = bitmap(FIXTURE);

        floodFill(near, 2, 2, RED, 15);
        floodFill(exact, 2, 2, RED, 14);

        expect(picture(near, RED)[3]).toBe('.#FFFFFFFF#.');
        expect(picture(exact, RED)[3]).toBe('.#FFnFFFFF#.');
    });

    it('should fill the island alone, as the hole is its own region', () => {
        const pixels = bitmap(FIXTURE);

        const result = floodFill(pixels, 6, 4, RED, 0);

        expect(result.count).toBe(4);
        expect(picture(pixels, RED)[4]).toBe('.#wwwwFFww#.');
    });

    it('should visit each pixel once when every pixel matches, the fill colour included', () => {
        const pixels = bitmap(FIXTURE);

        const result = floodFill(pixels, 2, 2, [250, 250, 250, 255], 255);

        expect(result.count).toBe(pixels.width * pixels.height);
    });

    it('should fill nothing from a seed outside the canvas or not a number', () => {
        for (const [x, y] of [
            [-1, 0],
            [0, -0.5],
            [12, 0],
            [0, 10],
            [Number.NaN, 1]
        ]) {
            const pixels = bitmap(FIXTURE);
            expect(floodFill(pixels, x, y, RED, 0).count).toBe(0);
            expect(picture(pixels, RED)).toEqual(FIXTURE);
        }
    });

    it('should fill in steps that stop at a deadline and give the same result', () => {
        const width = 300;
        const height = 200;
        const stepped = { width, height, data: new Uint8ClampedArray(width * height * 4) };
        const whole = { width, height, data: new Uint8ClampedArray(width * height * 4) };
        // A comb of walls, so the search has many spans
        for (const pixels of [stepped, whole]) {
            for (let x = 10; x < width; x += 10) for (let y = x % 20 === 0 ? 0 : 5; y < (x % 20 === 0 ? height - 5 : height); y++) pixels.data.set([0, 0, 0, 255], (y * width + x) * 4);
        }

        const search = createFillSearch(stepped, 1, 1, RED, 0);
        let steps = 0;
        while (!search.step(-1)) steps++;
        floodFill(whole, 1, 1, RED, 0);

        expect(steps).toBeGreaterThan(1);
        expect(search.done).toBe(true);
        expect(stepped.data).toEqual(whole.data);
        expect(search.result.count).toBe(width * height - 29 * (height - 5));
    });
});

describe('parseRgba and clampTolerance', () => {
    it.each([
        ['#f80', [255, 136, 0, 255]],
        ['#f808', [255, 136, 0, 136]],
        ['#ff8000', [255, 128, 0, 255]],
        ['#ff800080', [255, 128, 0, 128]],
        ['rgb(10, 20, 30)', [10, 20, 30, 255]],
        ['rgba(10, 20, 30, 0.5)', [10, 20, 30, 128]],
        ['rgb(10 20 30 / 50%)', [10, 20, 30, 128]],
        ['rgb(100%, 0%, 50%)', [255, 0, 128, 255]],
        ['hsl(0, 100%, 50%)', [255, 0, 0, 255]],
        ['hsla(120deg, 100%, 25%, 1)', [0, 128, 0, 255]],
        ['transparent', [0, 0, 0, 0]]
    ])('should read %s', (text, bytes) => {
        expect(parseRgba(text)).toEqual(bytes);
    });

    it.each(['red', 'oklch(0.5 0.1 200)', '#ff', 'rgb(1, 2)', 'rgb(a, b, c)', ''])('should not read %s', (text) => {
        expect(parseRgba(text)).toBeUndefined();
    });

    it('should clamp a tolerance to 0..255 and default anything else', () => {
        expect(clampTolerance(-4)).toBe(0);
        expect(clampTolerance(12.4)).toBe(12);
        expect(clampTolerance(400)).toBe(255);
        expect(clampTolerance('8')).toBe(DEFAULT_FILL_TOLERANCE);
        expect(clampTolerance(Number.NaN)).toBe(DEFAULT_FILL_TOLERANCE);
    });
});
