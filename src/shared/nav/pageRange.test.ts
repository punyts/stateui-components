import { describe, expect, it } from 'vitest';
import { pageCount, pageRange } from './pageRange.js';

const shape = (page: number, pages: number, siblings = 1): string[] =>
    pageRange(page, pages, siblings).map((slot) => (slot.kind === 'page' ? String(slot.page) : '…'));

describe('pageCount', () => {
    it.each([
        [0, 10, 1],
        [1, 10, 1],
        [10, 10, 1],
        [11, 10, 2],
        [1000, 10, 100],
        [undefined, 10, 1],
        [95, 0, 95],
        [95, 'x', 95]
    ] as const)('should give %s records at %s per page as %d pages', (total, size, expected) => {
        // Assert
        expect(pageCount(total, size)).toBe(expected);
    });
});

describe('pageRange', () => {
    it('should list the only page of one page', () => {
        // Assert
        expect(shape(1, 1)).toEqual(['1']);
    });

    it('should list every page of 7 pages for one sibling, from any current page', () => {
        // Assert
        for (let page = 1; page <= 7; page++) expect(shape(page, 7)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    });

    it('should leave gaps in 100 pages and keep the list 7 places long', () => {
        // Assert
        expect(shape(1, 100)).toEqual(['1', '2', '3', '4', '5', '…', '100']);
        expect(shape(4, 100)).toEqual(['1', '2', '3', '4', '5', '…', '100']);
        expect(shape(5, 100)).toEqual(['1', '…', '4', '5', '6', '…', '100']);
        expect(shape(50, 100)).toEqual(['1', '…', '49', '50', '51', '…', '100']);
        expect(shape(96, 100)).toEqual(['1', '…', '95', '96', '97', '…', '100']);
        expect(shape(97, 100)).toEqual(['1', '…', '96', '97', '98', '99', '100']);
        expect(shape(100, 100)).toEqual(['1', '…', '96', '97', '98', '99', '100']);
    });

    it('should show more pages beside the current one with more siblings', () => {
        // Assert
        expect(shape(50, 100, 2)).toEqual(['1', '…', '48', '49', '50', '51', '52', '…', '100']);
        expect(shape(1, 100, 0)).toEqual(['1', '2', '3', '…', '100']);
        expect(shape(50, 100, 0)).toEqual(['1', '…', '50', '…', '100']);
    });

    it('should give the pages a gap stands for', () => {
        // Act
        const slots = pageRange(50, 100, 1);

        // Assert
        expect(slots.filter((slot) => slot.kind === 'gap')).toEqual([
            { kind: 'gap', from: 2, to: 48 },
            { kind: 'gap', from: 52, to: 99 }
        ]);
    });

    it('should clamp a current page outside the range', () => {
        // Assert
        expect(shape(0, 100)).toEqual(shape(1, 100));
        expect(shape(500, 100)).toEqual(shape(100, 100));
    });
});
