import { describe, expect, it } from 'vitest';
import { BLOCK_TYPES, plainText } from './model.js';
import type { KeyedBlock } from './model.js';
import { insertText, splitBlock } from './edit.js';
import type { Edit, EditSettings, TextSelection } from './edit.js';
import { GROUP_PAUSE_MS, createHistory } from './history.js';
import type { HistoryStep } from './history.js';

const all: EditSettings = { allowed: [...BLOCK_TYPES], maxLength: 0 };
const caret = (key: string, offset: number): TextSelection => ({ anchor: { block: key, offset }, focus: { block: key, offset } });
const start: KeyedBlock[] = [{ key: 'a', order: 'V', type: 'paragraph', runs: [] }];

/** The blocks after a history step is written */
const applyStep = (blocks: readonly KeyedBlock[], step: HistoryStep | null): KeyedBlock[] => {
    if (step === null) return [...blocks];
    const kept = blocks.filter((one) => !step.removed.has(one.key) && !step.written.has(one.key));
    return [...kept, ...step.written.values()].sort((x, y) => (x.order < y.order ? -1 : 1));
};
const texts = (blocks: readonly KeyedBlock[]): string[] => blocks.map((one) => plainText(one.runs));

/** Types each character as its own edit, recording it, and returns the blocks after */
const type = (history: ReturnType<typeof createHistory>, blocks: KeyedBlock[], text: string, now: number): KeyedBlock[] => {
    let current = blocks;
    for (const character of text) {
        const offset = plainText(current[0]?.runs ?? []).length;
        const edit = insertText(current, caret('a', offset), character, all) as Edit;
        history.record(current, edit, caret('a', offset), 'typing', now);
        current = edit.blocks;
    }
    return current;
};

describe('createHistory', () => {
    it('should group typing into one entry and undo and redo it', () => {
        // Arrange
        const history = createHistory();
        const typed = type(history, start, 'abc', 0);

        // Act
        const undone = applyStep(typed, history.undo(typed));
        const redone = applyStep(undone, history.redo(undone));

        // Assert
        expect(texts(undone)).toEqual(['']);
        expect(texts(redone)).toEqual(['abc']);
        expect(history.canUndo()).toBe(true);
        expect(history.canRedo()).toBe(false);
    });

    it('should start a new entry after a pause, a seal or another kind of edit', () => {
        // Arrange
        const history = createHistory();
        let blocks = type(history, start, 'ab', 0);
        blocks = type(history, blocks, 'c', GROUP_PAUSE_MS + 1);
        history.seal();
        blocks = type(history, blocks, 'd', GROUP_PAUSE_MS + 2);
        const split = splitBlock(blocks, caret('a', 4), all) as Edit;
        history.record(blocks, split, caret('a', 4), 'other', GROUP_PAUSE_MS + 3);
        blocks = split.blocks;

        // Act
        const steps: string[][] = [];
        for (let index = 0; index < 4; index++) {
            blocks = applyStep(blocks, history.undo(blocks));
            steps.push(texts(blocks));
        }

        // Assert
        expect(steps).toEqual([['abcd'], ['abc'], ['ab'], ['']]);
        expect(history.canUndo()).toBe(false);
    });

    it('should undo a split by removing the block it added', () => {
        // Arrange
        const history = createHistory();
        const blocks: KeyedBlock[] = [{ key: 'a', order: 'V', type: 'paragraph', runs: [{ text: 'abcd' }] }];
        const split = splitBlock(blocks, caret('a', 2), all) as Edit;
        history.record(blocks, split, caret('a', 2), 'other', 0);

        // Act
        const step = history.undo(split.blocks);

        // Assert
        expect(step?.removed.size).toBe(1);
        expect(texts(applyStep(split.blocks, step))).toEqual(['abcd']);
        expect(step?.selection).toEqual(caret('a', 2));
    });

    it('should skip a block someone else changed since the edit', () => {
        // Arrange
        const history = createHistory();
        const typed = type(history, start, 'mine', 0);
        const theirs: KeyedBlock[] = [{ ...(typed[0] as KeyedBlock), runs: [{ text: 'theirs' }] }];

        // Act
        const step = history.undo(theirs);

        // Assert
        expect(step).toBeNull();
        expect(history.canUndo()).toBe(false);
    });

    it('should drop the redo entries on a new edit', () => {
        // Arrange
        const history = createHistory();
        const typed = type(history, start, 'a', 0);
        const undone = applyStep(typed, history.undo(typed));

        // Act
        type(history, undone, 'b', 10);

        // Assert
        expect(history.canRedo()).toBe(false);
    });
});
