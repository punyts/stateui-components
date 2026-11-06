import { describe, expect, it } from 'vitest';
import { DEFAULT_SIZES, MAX_BRUSH_SIZE, MAX_CANVAS_SIZE, MAX_SIZES, clampBrushSize, clampCanvasSize, clampDimension, clampSizes, pickSize } from './size.js';

describe('clampDimension', () => {
    it.each([
        [0, 1],
        [1, 1],
        [4096, 4096],
        [4097, 4096],
        [-20, 1],
        [300.4, 300],
        [300.6, 301],
        [0.4, 1]
    ])('should clamp %s to %s', (value, expected) => {
        expect(clampDimension(value, 400)).toBe(expected);
    });

    it.each([['300'], [null], [undefined], [Number.NaN], [Number.POSITIVE_INFINITY], [{}], [[300]], [true]])('should take the fallback for %s', (value) => {
        expect(clampDimension(value, 400)).toBe(400);
    });

    it('should clamp the fallback too', () => {
        expect(clampDimension('x', 5000)).toBe(MAX_CANVAS_SIZE);
        expect(clampDimension('x', 0)).toBe(1);
        expect(clampDimension('x', Number.NaN)).toBe(1);
    });

    it('should clamp a width and a height together', () => {
        expect(clampCanvasSize(4097, 'tall', { width: 400, height: 200 })).toEqual({ width: 4096, height: 200 });
    });
});

describe('clampBrushSize', () => {
    it('should round and clamp a number', () => {
        expect(clampBrushSize(0)).toBe(1);
        expect(clampBrushSize(1)).toBe(1);
        expect(clampBrushSize(7.6)).toBe(8);
        expect(clampBrushSize(MAX_BRUSH_SIZE + 1)).toBe(MAX_BRUSH_SIZE);
    });

    it('should give nothing for a value that is not a number', () => {
        expect(clampBrushSize('4')).toBeUndefined();
        expect(clampBrushSize(Number.NaN)).toBeUndefined();
        expect(clampBrushSize(undefined)).toBeUndefined();
    });
});

describe('clampSizes', () => {
    it('should keep usable sizes in order, clamped and without repeats', () => {
        expect(clampSizes([8, 2, '4', 0, 1, 2, 999, Number.NaN, 8.2])).toEqual([8, 2, 1, MAX_BRUSH_SIZE]);
    });

    it('should keep at most twelve sizes', () => {
        expect(clampSizes(Array.from({ length: 20 }, (_, i) => i + 1))).toHaveLength(MAX_SIZES);
    });

    it.each([[undefined], ['2,4'], [[]], [['a', null]], [{ 0: 2 }]])('should give the default sizes for %s', (value) => {
        expect(clampSizes(value)).toEqual(DEFAULT_SIZES);
    });

    it('should give a new list each time', () => {
        expect(clampSizes(undefined)).not.toBe(DEFAULT_SIZES);
    });
});

describe('pickSize', () => {
    it('should take the size when it is a number, else the first of the list', () => {
        expect(pickSize(12, [2, 4])).toBe(12);
        expect(pickSize(0, [2, 4])).toBe(1);
        expect(pickSize('big', [6, 4])).toBe(6);
        expect(pickSize(undefined, [])).toBe(DEFAULT_SIZES[0]);
    });
});
