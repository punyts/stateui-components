import { describe, expect, it } from 'vitest';
import { bandOffset, columnsFor, gridWindow, rowsFor } from './gridViewport.js';

describe('columnsFor', () => {
    it('should fit whole items of the minimum width', () => {
        // Act and Assert
        expect(columnsFor(1000, 240)).toBe(4);
        expect(columnsFor(720, 240)).toBe(3);
        expect(columnsFor(239, 240)).toBe(1);
    });

    it('should give one column while a size is unknown', () => {
        // Act and Assert
        expect(columnsFor(0, 240)).toBe(1);
        expect(columnsFor(500, 0)).toBe(1);
        expect(columnsFor(Number.NaN, 240)).toBe(1);
    });
});

describe('rowsFor', () => {
    it('should round up to whole rows', () => {
        // Act and Assert
        expect(rowsFor(10, 3)).toBe(4);
        expect(rowsFor(9, 3)).toBe(3);
        expect(rowsFor(0, 3)).toBe(0);
    });
});

describe('gridWindow', () => {
    it('should list whole rows from the topmost one that reaches into the viewport', () => {
        // Act and Assert
        expect(gridWindow(0, 200, 100, 3)).toEqual({ first: 0, count: 6 });
        expect(gridWindow(150, 200, 100, 3)).toEqual({ first: 3, count: 9 });
        expect(gridWindow(200, 200, 100, 4)).toEqual({ first: 8, count: 8 });
    });

    it('should show nothing while a size is unknown', () => {
        // Act and Assert
        expect(gridWindow(0, 0, 100, 3)).toEqual({ first: 0, count: 0 });
        expect(gridWindow(0, 200, 0, 3)).toEqual({ first: 0, count: 0 });
    });
});

describe('bandOffset', () => {
    it('should move only as far as needed, or put the band at the top', () => {
        // Act and Assert
        expect(bandOffset(300, 100, 0, 200, 1000, 'nearest')).toBe(200);
        expect(bandOffset(50, 100, 100, 200, 1000, 'nearest')).toBe(50);
        expect(bandOffset(120, 100, 100, 200, 1000, 'nearest')).toBe(100);
        expect(bandOffset(300, 100, 0, 200, 1000, 'start')).toBe(300);
    });

    it('should never scroll past the end of the content', () => {
        // Act and Assert
        expect(bandOffset(900, 100, 0, 200, 1000, 'start')).toBe(800);
    });
});
