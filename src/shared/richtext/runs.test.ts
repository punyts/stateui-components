import { describe, expect, it } from 'vitest';
import type { Run } from './model.js';
import { deleteRuns, hasMark, insertRuns, markRuns, nextBoundary, previousBoundary, sliceRuns, styleAt } from './runs.js';

const runs: Run[] = [{ text: 'ab' }, { text: 'cd', marks: ['bold'] }, { text: 'ef', link: 'https://x.example' }];

describe('sliceRuns', () => {
    it('should keep the marks and links of the characters it cuts out', () => {
        // Act
        const sliced = sliceRuns(runs, 1, 5);

        // Assert
        expect(sliced).toEqual([{ text: 'b' }, { text: 'cd', marks: ['bold'] }, { text: 'e', link: 'https://x.example' }]);
    });
});

describe('insertRuns and deleteRuns', () => {
    it('should join an inserted run with neighbours of the same style', () => {
        // Act
        const inserted = insertRuns(runs, 3, [{ text: 'X', marks: ['bold'] }]);

        // Assert
        expect(inserted).toEqual([{ text: 'ab' }, { text: 'cXd', marks: ['bold'] }, { text: 'ef', link: 'https://x.example' }]);
    });

    it('should take a range out across runs and join what is left', () => {
        // Act
        const deleted = deleteRuns([{ text: 'ab' }, { text: 'cd', marks: ['bold'] }, { text: 'ef' }], 1, 5);

        // Assert
        expect(deleted).toEqual([{ text: 'af' }]);
    });
});

describe('styleAt', () => {
    it('should take the marks of the character before the offset, and of the first character at the start', () => {
        // Act
        const after = styleAt(runs, 4);
        const start = styleAt([{ text: 'a', marks: ['italic'] }], 0);

        // Assert
        expect(after).toEqual({ marks: ['bold'] });
        expect(start).toEqual({ marks: ['italic'] });
    });

    it('should give a link inside it but not at its end', () => {
        // Act
        const inside = styleAt(runs, 5);
        const end = styleAt(runs, 6);

        // Assert
        expect(inside.link).toBe('https://x.example');
        expect(end.link).toBeUndefined();
    });
});

describe('hasMark and markRuns', () => {
    it('should add a mark to a range and tell when all of it has the mark', () => {
        // Act
        const marked = markRuns(runs, 1, 4, 'bold', true);

        // Assert
        expect(marked).toEqual([{ text: 'a' }, { text: 'bcd', marks: ['bold'] }, { text: 'ef', link: 'https://x.example' }]);
        expect(hasMark(marked, 1, 4, 'bold')).toBe(true);
        expect(hasMark(marked, 0, 4, 'bold')).toBe(false);
    });

    it('should take a mark off a range, keeping its link', () => {
        // Act
        const unmarked = markRuns([{ text: 'ab', marks: ['italic', 'bold'], link: 'https://x.example' }], 0, 1, 'bold', false);

        // Assert
        expect(unmarked).toEqual([
            { text: 'a', marks: ['italic'], link: 'https://x.example' },
            { text: 'b', marks: ['italic', 'bold'], link: 'https://x.example' }
        ]);
    });
});

describe('previousBoundary and nextBoundary', () => {
    it('should step over a whole emoji as one character', () => {
        // Arrange
        const text = 'a👍🏽b';

        // Act
        const back = previousBoundary(text, text.length - 1, 'character');
        const forward = nextBoundary(text, 1, 'character');

        // Assert
        expect(back).toBe(1);
        expect(forward).toBe(text.length - 1);
    });

    it('should reach the start of the word before, with the spaces after it', () => {
        // Act
        const back = previousBoundary('one two  ', 9, 'word');
        const forward = nextBoundary('one two', 3, 'word');

        // Assert
        expect(back).toBe(4);
        expect(forward).toBe(7);
    });

    it('should reach the start of the line, and take a line break on its own', () => {
        // Act
        const line = previousBoundary('ab\ncd', 5, 'line');
        const lineBreak = previousBoundary('ab\ncd', 3, 'line');
        const forward = nextBoundary('ab\ncd', 0, 'line');

        // Assert
        expect(line).toBe(3);
        expect(lineBreak).toBe(2);
        expect(forward).toBe(2);
    });
});
