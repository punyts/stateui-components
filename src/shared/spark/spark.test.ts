import { describe, expect, it } from 'vitest';
import { fillSummary, sparkShape, sparkValues } from './spark.js';

describe('sparkShape', () => {
    it('should run the line across the box with the highest value at the top', () => {
        // Act
        const shape = sparkShape([0, 10]);

        // Assert
        expect(shape.line).toBe('M0 30 L100 2');
        expect(shape.area).toBe('M0 30 L100 2 L100 32 L0 32 Z');
    });

    it('should grow bars up and down from zero with keys that are not integer-like', () => {
        // Act
        const shape = sparkShape([5, -5]);

        // Assert
        expect(Object.keys(shape.bars)).toEqual(['b0', 'b1']);
        expect(shape.bars['b0']?.y).toBe('2');
        expect(shape.bars['b1']?.y).toBe('16');
        expect(shape.bars['b1']?.negative).toBe(true);
    });

    it('should draw nothing for no values and keep only numbers', () => {
        // Act and Assert
        expect(sparkShape([])).toEqual({ line: '', area: '', bars: {} });
        expect(sparkValues([1, '2', null, Number.NaN, 3])).toEqual([1, 3]);
    });
});

describe('fillSummary', () => {
    it('should fill known placeholders and keep unknown ones', () => {
        // Act and Assert
        expect(fillSummary('{first} to {last} {other}', { first: '1', last: '2' })).toBe('1 to 2 {other}');
    });
});
