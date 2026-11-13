import { describe, expect, it } from 'vitest';
import { DEFAULT_STARS, ratingForKey, ratingOf, starsOf } from './rating.js';

describe('starsOf', () => {
    it('should take a whole max from 1 to 10 and fall back to five stars otherwise', () => {
        // Assert
        expect(starsOf(3)).toBe(3);
        expect(starsOf(10)).toBe(10);
        expect([0, 11, 2.5, '4', undefined].map(starsOf)).toEqual([DEFAULT_STARS, DEFAULT_STARS, DEFAULT_STARS, DEFAULT_STARS, DEFAULT_STARS]);
    });
});

describe('ratingOf', () => {
    it('should round the value and keep it from 0 to the number of stars', () => {
        // Assert
        expect(ratingOf(2.6, 5)).toBe(3);
        expect(ratingOf(-1, 5)).toBe(0);
        expect(ratingOf(9, 5)).toBe(5);
    });

    it('should read a value that is not a number as 0', () => {
        // Assert
        expect(ratingOf('', 5)).toBe(0);
        expect(ratingOf(Number.NaN, 5)).toBe(0);
    });
});

describe('ratingForKey', () => {
    it('should step by one with the arrows and stay from 0 to the number of stars', () => {
        // Assert
        expect(ratingForKey('ArrowRight', 2, 5)).toBe(3);
        expect(ratingForKey('ArrowUp', 5, 5)).toBe(5);
        expect(ratingForKey('ArrowLeft', 2, 5)).toBe(1);
        expect(ratingForKey('ArrowDown', 0, 5)).toBe(0);
    });

    it('should swap Left and Right in right-to-left text', () => {
        // Assert
        expect(ratingForKey('ArrowLeft', 2, 5, true)).toBe(3);
        expect(ratingForKey('ArrowRight', 2, 5, true)).toBe(1);
    });

    it('should go to 0 on Home, to the last star on End and to a digit not above the stars', () => {
        // Assert
        expect(ratingForKey('Home', 3, 5)).toBe(0);
        expect(ratingForKey('End', 3, 5)).toBe(5);
        expect(ratingForKey('4', 0, 5)).toBe(4);
        expect(ratingForKey('7', 0, 5)).toBeUndefined();
    });

    it('should leave other keys alone', () => {
        // Assert
        expect(ratingForKey('Tab', 3, 5)).toBeUndefined();
        expect(ratingForKey('a', 3, 5)).toBeUndefined();
    });
});
