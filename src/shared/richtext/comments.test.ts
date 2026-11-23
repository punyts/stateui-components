import { describe, expect, it } from 'vitest';
import { normalizeRuns, readBlock } from './model.js';
import type { Block, KeyedBlock, Run } from './model.js';
import { commentRuns, commentsIn, markRuns, sliceRuns, styleAt, uncommentRuns } from './runs.js';
import { commentSelection, commentsAt, insertText, removeComment, replaceBlockText } from './edit.js';
import type { TextSelection } from './edit.js';

const block = (key: string, order: string, shape: Partial<Block>): KeyedBlock => ({ key, ...(readBlock({ type: 'paragraph', runs: [], ...shape, order }) as Block) });
const at = (key: string, offset: number, focus?: { block: string; offset: number }): TextSelection => ({ anchor: { block: key, offset }, focus: focus ?? { block: key, offset } });

describe('Comment anchors on runs', () => {
    it('should keep well-formed thread ids sorted and once each, and join runs only when their threads are the same', () => {
        // Arrange
        const stored = [
            { text: 'ab', comments: ['tB', 'tA', 'tA', '1bad', 'x'.repeat(40), 7] },
            { text: 'cd', comments: ['tA', 'tB'] },
            { text: 'ef' }
        ];

        // Act
        const runs = normalizeRuns(stored);

        // Assert
        expect(runs).toEqual([{ text: 'abcd', comments: ['tA', 'tB'] }, { text: 'ef' }]);
    });

    it('should keep at most eight threads on a run', () => {
        // Act
        const runs = normalizeRuns([{ text: 'a', comments: Array.from({ length: 12 }, (_, index) => `t${String(index).padStart(2, 'a')}`) }]);

        // Assert
        expect(runs[0]?.comments).toHaveLength(8);
    });

    it('should keep comments in a code block, which drops marks and links', () => {
        // Act
        const code = readBlock({ type: 'code', order: 'V', runs: [{ text: 'ab', marks: ['bold'], comments: ['tA'] }, { text: 'c' }] });

        // Assert
        expect(code?.runs).toEqual([{ text: 'ab', comments: ['tA'] }, { text: 'c' }]);
    });

    it('should put a thread on a range, keep it through marks and slices, and take it off again', () => {
        // Arrange
        const runs: Run[] = [{ text: 'abcdef' }];

        // Act
        const commented = commentRuns(runs, 1, 4, 'tA', true);
        const marked = markRuns(commented, 0, 6, 'bold', true);
        const sliced = sliceRuns(marked, 2, 5);
        const uncommented = uncommentRuns(marked, 'tA');

        // Assert
        expect(commented).toEqual([{ text: 'a' }, { text: 'bcd', comments: ['tA'] }, { text: 'ef' }]);
        expect(sliced).toEqual([{ text: 'cd', marks: ['bold'], comments: ['tA'] }, { text: 'e', marks: ['bold'] }]);
        expect(uncommented).toEqual([{ text: 'abcdef', marks: ['bold'] }]);
    });

    it('should let typing inside a commented stretch carry its threads, and typing at either end not', () => {
        // Arrange
        const runs: Run[] = [{ text: 'a' }, { text: 'bcd', comments: ['tA'] }, { text: 'e' }];

        // Act
        const inside = styleAt(runs, 2);
        const atStart = styleAt(runs, 1);
        const atEnd = styleAt(runs, 4);

        // Assert
        expect(inside.comments).toEqual(['tA']);
        expect(atStart.comments).toBeUndefined();
        expect(atEnd.comments).toBeUndefined();
    });

    it('should find the threads on a range, and on either side of a caret', () => {
        // Arrange
        const runs: Run[] = [{ text: 'ab', comments: ['tA'] }, { text: 'cd', comments: ['tB'] }];

        // Act
        const caretBetween = commentsIn(runs, 2, 2);
        const range = commentsIn(runs, 0, 1);

        // Assert
        expect(caretBetween).toEqual(['tA', 'tB']);
        expect(range).toEqual(['tA']);
    });
});

describe('Comment edits', () => {
    it('should put a thread on a selection across blocks and write only those blocks', () => {
        // Arrange
        const blocks = [block('a', 'V', { runs: [{ text: 'one' }] }), block('b', 'W', { runs: [{ text: 'two' }] }), block('c', 'X', { runs: [{ text: 'three' }] })];

        // Act
        const edit = commentSelection(blocks, at('a', 1, { block: 'b', offset: 2 }), 'tA');

        // Assert
        expect(edit?.blocks[0]?.runs).toEqual([{ text: 'o' }, { text: 'ne', comments: ['tA'] }]);
        expect(edit?.blocks[1]?.runs).toEqual([{ text: 'tw', comments: ['tA'] }, { text: 'o' }]);
        expect([...(edit?.written.keys() ?? [])]).toEqual(['a', 'b']);
    });

    it('should do nothing for a caret', () => {
        // Act
        const edit = commentSelection([block('a', 'V', { runs: [{ text: 'one' }] })], at('a', 1), 'tA');

        // Assert
        expect(edit).toBeNull();
    });

    it('should take a whole table when a selection reaches into it, and one cell when it is inside', () => {
        // Arrange
        const table = block('t', 'W', { type: 'table', rows: [{ cells: [{ runs: [{ text: 'h1' }] }, { runs: [{ text: 'h2' }] }] }] });
        const blocks = [block('a', 'V', { runs: [{ text: 'one' }] }), table];
        const inCell: TextSelection = { anchor: { block: 't', offset: 0, cell: { row: 0, column: 1 } }, focus: { block: 't', offset: 1, cell: { row: 0, column: 1 } } };

        // Act
        const across = commentSelection(blocks, { anchor: { block: 'a', offset: 0 }, focus: { block: 't', offset: 0, cell: { row: 0, column: 0 } } }, 'tA');
        const inside = commentSelection(blocks, inCell, 'tB');

        // Assert
        expect(across?.blocks[1]?.rows?.[0]?.cells.map((cell) => cell.runs)).toEqual([[{ text: 'h1', comments: ['tA'] }], [{ text: 'h2', comments: ['tA'] }]]);
        expect(inside?.blocks[1]?.rows?.[0]?.cells[1]?.runs).toEqual([{ text: 'h', comments: ['tB'] }, { text: '2' }]);
        expect(commentsAt(inside?.blocks ?? [], { ...inCell, focus: inCell.anchor })).toEqual(['tB']);
    });

    it('should take a deleted thread off every block and cell that carries it, and leave the others alone', () => {
        // Arrange
        const blocks = [
            block('a', 'V', { runs: [{ text: 'one', comments: ['tA', 'tB'] }] }),
            block('b', 'W', { runs: [{ text: 'two', comments: ['tB'] }] }),
            block('t', 'X', { type: 'table', rows: [{ cells: [{ runs: [{ text: 'h', comments: ['tA'] }] }] }] })
        ];

        // Act
        const edit = removeComment(blocks, 'tA', at('a', 0));

        // Assert
        expect(edit?.blocks[0]?.runs).toEqual([{ text: 'one', comments: ['tB'] }]);
        expect(edit?.blocks[2]?.rows?.[0]?.cells[0]?.runs).toEqual([{ text: 'h' }]);
        expect([...(edit?.written.keys() ?? [])]).toEqual(['a', 't']);
    });

    it('should carry the threads to text typed inside a commented stretch and read back from an input method', () => {
        // Arrange
        const blocks = [block('a', 'V', { runs: [{ text: 'a' }, { text: 'bc', comments: ['tA'] }, { text: 'd' }] })];

        // Act
        const typed = insertText(blocks, at('a', 2), 'X', { allowed: [], maxLength: 0 });
        const composed = replaceBlockText(blocks, 'a', 'abYcd');
        const after = insertText(blocks, at('a', 3), 'Z', { allowed: [], maxLength: 0 });

        // Assert
        expect(typed?.blocks[0]?.runs).toEqual([{ text: 'a' }, { text: 'bXc', comments: ['tA'] }, { text: 'd' }]);
        expect(composed?.edit.blocks[0]?.runs).toEqual([{ text: 'a' }, { text: 'bYc', comments: ['tA'] }, { text: 'd' }]);
        expect(after?.blocks[0]?.runs).toEqual([{ text: 'a' }, { text: 'bc', comments: ['tA'] }, { text: 'Zd' }]);
    });
});
