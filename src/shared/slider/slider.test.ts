import { describe, expect, it } from 'vitest';
import { limitsOf, nearestThumb, percentOf, readScale, readThumbs, snapValue, valueAtFraction, valueForKey } from './slider.js';

const scale = readScale(0, 100, 5);
const ends = { lower: 0, upper: 100 };

describe('readScale', () => {
    it('should fall back to 0, 100 and a step of 1 for settings that are not numbers', () => {
        // Act
        const result = readScale(undefined, '', 0);

        // Assert
        expect(result).toEqual({ min: 0, max: 100, step: 1 });
    });

    it('should never put max below min', () => {
        // Act
        const result = readScale(10, 4, 2);

        // Assert
        expect(result).toEqual({ min: 10, max: 10, step: 2 });
    });
});

describe('snapValue', () => {
    it('should snap to the nearest step counted from min', () => {
        // Arrange
        const odd = readScale(3, 30, 5);

        // Assert
        expect(snapValue(12, scale)).toBe(10);
        expect(snapValue(13, scale)).toBe(15);
        expect(snapValue(12, odd)).toBe(13);
    });

    it('should keep decimals exact and stay inside the limits', () => {
        // Arrange
        const tenths = readScale(0, 1, 0.1);

        // Assert
        expect(snapValue(0.30000000000000004, tenths)).toBe(0.3);
        expect(snapValue(250, scale)).toBe(100);
        expect(snapValue(-20, scale)).toBe(0);
        expect(snapValue(80, scale, { lower: 0, upper: 55 })).toBe(55);
    });
});

describe('readThumbs', () => {
    it('should read a number, clamped, and sit at the start without one', () => {
        // Assert
        expect(readThumbs(40, false, scale).low).toBe(40);
        expect(readThumbs(400, false, scale).low).toBe(100);
        expect(readThumbs('', false, scale).low).toBe(0);
    });

    it('should read a pair in order and sit at both ends without one', () => {
        // Assert
        expect(readThumbs([70, 20], true, scale)).toEqual({ low: 20, high: 70 });
        expect(readThumbs('', true, scale)).toEqual({ low: 0, high: 100 });
        expect(readThumbs([10], true, scale)).toEqual({ low: 0, high: 100 });
    });
});

describe('percentOf and valueAtFraction', () => {
    it('should map a value onto 0 to 100 and back', () => {
        // Arrange
        const wide = readScale(20, 220, 1);

        // Assert
        expect(percentOf(120, wide)).toBe(50);
        expect(percentOf(500, wide)).toBe(100);
        expect(percentOf(5, readScale(5, 5, 1))).toBe(0);
        expect(valueAtFraction(0.25, wide)).toBe(70);
        expect(valueAtFraction(2, wide)).toBe(220);
    });
});

describe('valueForKey', () => {
    it('should step with the arrows, ten steps with the page keys, and go to the limits with Home and End', () => {
        // Assert
        expect(valueForKey('ArrowRight', 50, scale, ends, false)).toBe(55);
        expect(valueForKey('ArrowUp', 50, scale, ends, false)).toBe(55);
        expect(valueForKey('ArrowLeft', 50, scale, ends, false)).toBe(45);
        expect(valueForKey('ArrowDown', 50, scale, ends, false)).toBe(45);
        expect(valueForKey('PageUp', 20, scale, ends, false)).toBe(70);
        expect(valueForKey('PageDown', 20, scale, ends, false)).toBe(0);
        expect(valueForKey('Home', 50, scale, ends, false)).toBe(0);
        expect(valueForKey('End', 50, scale, ends, false)).toBe(100);
        expect(valueForKey('a', 50, scale, ends, false)).toBeUndefined();
    });

    it('should swap Left and Right for right-to-left text', () => {
        // Assert
        expect(valueForKey('ArrowLeft', 50, scale, ends, true)).toBe(55);
        expect(valueForKey('ArrowRight', 50, scale, ends, true)).toBe(45);
        expect(valueForKey('ArrowUp', 50, scale, ends, true)).toBe(55);
    });

    it('should stop at the other thumb of a range', () => {
        // Arrange
        const current = { low: 30, high: 40 };

        // Assert
        expect(valueForKey('End', 30, scale, limitsOf('low', true, current, scale), false)).toBe(40);
        expect(valueForKey('PageUp', 30, scale, limitsOf('low', true, current, scale), false)).toBe(40);
        expect(valueForKey('Home', 40, scale, limitsOf('high', true, current, scale), false)).toBe(30);
    });
});

describe('nearestThumb', () => {
    it('should pick the nearer thumb and split a tie by side', () => {
        // Arrange
        const current = { low: 20, high: 60 };

        // Assert
        expect(nearestThumb(30, current)).toBe('low');
        expect(nearestThumb(55, current)).toBe('high');
        expect(nearestThumb(40, current)).toBe('high');
        expect(nearestThumb(0, { low: 20, high: 20 })).toBe('low');
    });
});
