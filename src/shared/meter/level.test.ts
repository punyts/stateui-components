import { describe, expect, it } from 'vitest';
import { meterLevel } from './level.js';

describe('meterLevel', () => {
    it('should be good everywhere without low and high', () => {
        // Act and Assert
        expect([0, 50, 100].map((value) => meterLevel(value, 0, 100))).toEqual(['good', 'good', 'good']);
    });

    it('should grade a high-is-good value by its distance from the optimum region', () => {
        // Act and Assert
        expect([10, 60, 90].map((value) => meterLevel(value, 0, 100, 30, 80, 100))).toEqual(['danger', 'warning', 'good']);
    });

    it('should treat both ends as warnings when the optimum is in the middle', () => {
        // Act and Assert
        expect([10, 50, 90].map((value) => meterLevel(value, 0, 100, 30, 70, 50))).toEqual(['warning', 'good', 'warning']);
    });
});
