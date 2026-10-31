import { describe, expect, it } from 'vitest';
import { offsetFor, windowFor } from './viewport.js';
import { sameWindow } from './window.js';

describe('windowFor', () => {
    it('should start at the row under the top edge and count the rows that reach into the viewport', () => {
        // Act and Assert
        expect(windowFor(0, 100, 20)).toEqual({ first: 0, count: 5 });
        expect(windowFor(30, 100, 20)).toEqual({ first: 1, count: 6 });
        expect(windowFor(40, 100, 20)).toEqual({ first: 2, count: 5 });
    });

    it('should show nothing while the viewport or the row height is unknown', () => {
        // Act and Assert
        expect(windowFor(50, 0, 20)).toEqual({ first: 0, count: 0 });
        expect(windowFor(50, 100, 0)).toEqual({ first: 0, count: 0 });
        expect(windowFor(50, Number.NaN, 20)).toEqual({ first: 0, count: 0 });
    });

    it('should treat a negative offset as the top', () => {
        // Act and Assert
        expect(windowFor(-40, 100, 20)).toEqual({ first: 0, count: 5 });
    });
});

describe('sameWindow', () => {
    it('should compare first and count', () => {
        // Act and Assert
        expect(sameWindow({ first: 1, count: 2 }, { first: 1, count: 2 })).toBe(true);
        expect(sameWindow({ first: 1, count: 2 }, { first: 1, count: 3 })).toBe(false);
    });
});

describe('offsetFor', () => {
    it('should put a row at the top for start and clamp at the end of the rows', () => {
        // Act and Assert
        expect(offsetFor(10, 100, 0, 100, 20, 'start')).toBe(200);
        expect(offsetFor(99, 100, 0, 100, 20, 'start')).toBe(1900);
    });

    it('should move only as far as needed for nearest', () => {
        // Act and Assert
        expect(offsetFor(2, 100, 0, 100, 20, 'nearest')).toBe(0);
        expect(offsetFor(5, 100, 0, 100, 20, 'nearest')).toBe(20);
        expect(offsetFor(1, 100, 60, 100, 20, 'nearest')).toBe(20);
    });
});
