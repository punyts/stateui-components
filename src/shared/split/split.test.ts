import { describe, expect, it } from 'vitest';
import { clampSplit, readBounds, splitForDrag, splitForKey } from './split.js';

const bounds = readBounds(20, 80);

describe('readBounds', () => {
    it('should default to 20 and 80 and keep both inside 0 to 100', () => {
        // Assert
        expect(readBounds(undefined, '')).toEqual({ min: 20, max: 80 });
        expect(readBounds(-10, 400)).toEqual({ min: 0, max: 100 });
    });

    it('should never put max below min', () => {
        // Assert
        expect(readBounds(60, 30)).toEqual({ min: 60, max: 60 });
    });
});

describe('clampSplit', () => {
    it('should keep the split inside the bounds and round to two decimals', () => {
        // Assert
        expect(clampSplit(5, bounds)).toBe(20);
        expect(clampSplit(95, bounds)).toBe(80);
        expect(clampSplit(33.33333, bounds)).toBe(33.33);
    });

    it('should use 40 for a split that is not a number', () => {
        // Assert
        expect(clampSplit('', bounds)).toBe(40);
        expect(clampSplit(undefined, bounds)).toBe(40);
    });
});

describe('splitForKey', () => {
    it('should move by 5 percent with the arrows and stop at the bounds', () => {
        // Assert
        expect(splitForKey('ArrowRight', 40, bounds, false)).toBe(45);
        expect(splitForKey('ArrowDown', 40, bounds, false)).toBe(45);
        expect(splitForKey('ArrowLeft', 40, bounds, false)).toBe(35);
        expect(splitForKey('ArrowUp', 40, bounds, false)).toBe(35);
        expect(splitForKey('ArrowRight', 80, bounds, false)).toBe(80);
        expect(splitForKey('ArrowLeft', 20, bounds, false)).toBe(20);
    });

    it('should go to min and max with Home and End', () => {
        // Assert
        expect(splitForKey('Home', 40, bounds, false)).toBe(20);
        expect(splitForKey('End', 40, bounds, false)).toBe(80);
    });

    it('should swap Left and Right for right-to-left text and ignore other keys', () => {
        // Assert
        expect(splitForKey('ArrowLeft', 40, bounds, true)).toBe(45);
        expect(splitForKey('ArrowRight', 40, bounds, true)).toBe(35);
        expect(splitForKey('a', 40, bounds, false)).toBeUndefined();
        expect(splitForKey('Enter', 40, bounds, false)).toBeUndefined();
    });
});

describe('splitForDrag', () => {
    it('should turn pixels into percent of the container, clamped', () => {
        // Assert
        expect(splitForDrag(40, 100, 1000, bounds)).toBe(50);
        expect(splitForDrag(40, -150, 1000, bounds)).toBe(25);
        expect(splitForDrag(40, 900, 1000, bounds)).toBe(80);
        expect(splitForDrag(40, -900, 1000, bounds)).toBe(20);
    });

    it('should keep the start split when the container has no size', () => {
        // Assert
        expect(splitForDrag(40, 100, 0, bounds)).toBe(40);
    });
});
