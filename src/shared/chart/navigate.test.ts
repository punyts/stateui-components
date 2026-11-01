import { describe, expect, it } from 'vitest';
import { pointAfter, tabStop } from './navigate.js';
import type { Point } from './scene.js';

const point = (series: number, index: number): Point => ({ id: `p${series}${index}`, series, index, x: 0, y: 0, title: '', rows: [], label: '' });
const grid = [point(0, 0), point(0, 1), point(0, 2), point(1, 0), point(1, 1), point(1, 2)];

describe('pointAfter', () => {
    it('should move along the series with Left and Right and stop at the ends', () => {
        // Assert
        expect(pointAfter(grid, 'p01', 'ArrowRight')).toBe('p02');
        expect(pointAfter(grid, 'p01', 'ArrowLeft')).toBe('p00');
        expect(pointAfter(grid, 'p02', 'ArrowRight')).toBeUndefined();
        expect(pointAfter(grid, 'p00', 'ArrowLeft')).toBeUndefined();
    });

    it('should swap Left and Right in right-to-left text', () => {
        // Assert
        expect(pointAfter(grid, 'p01', 'ArrowLeft', { rtl: true })).toBe('p02');
        expect(pointAfter(grid, 'p01', 'ArrowRight', { rtl: true })).toBe('p00');
    });

    it('should move between series at the same category with Up and Down', () => {
        // Assert
        expect(pointAfter(grid, 'p01', 'ArrowDown')).toBe('p11');
        expect(pointAfter(grid, 'p11', 'ArrowUp')).toBe('p01');
        expect(pointAfter(grid, 'p11', 'ArrowDown')).toBeUndefined();
    });

    it('should go to the first and last category of the series with Home and End', () => {
        // Assert
        expect(pointAfter(grid, 'p11', 'Home')).toBe('p10');
        expect(pointAfter(grid, 'p11', 'End')).toBe('p12');
    });

    it('should step round the slices of a ring with all four arrows', () => {
        // Arrange
        const ring = [point(0, 0), point(0, 1), point(0, 2)];

        // Assert
        expect(pointAfter(ring, 'p01', 'ArrowDown', { ring: true })).toBe('p02');
        expect(pointAfter(ring, 'p01', 'ArrowUp', { ring: true })).toBe('p00');
        expect(pointAfter(ring, 'p01', 'ArrowDown')).toBeUndefined();
    });

    it('should answer nothing for an unknown point or another key', () => {
        // Assert
        expect(pointAfter(grid, 'zz', 'ArrowRight')).toBeUndefined();
        expect(pointAfter(grid, 'p01', 'a')).toBeUndefined();
    });
});

describe('tabStop', () => {
    it('should keep the preferred point while it is shown, and otherwise take the first', () => {
        // Assert
        expect(tabStop(grid, 'p11')).toBe('p11');
        expect(tabStop(grid, 'gone')).toBe('p00');
        expect(tabStop([], undefined)).toBeUndefined();
    });
});
