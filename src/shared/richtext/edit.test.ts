import { describe, expect, it } from 'vitest';
import { BLOCK_TYPES, plainText, readBlock } from './model.js';
import type { Block, KeyedBlock } from './model.js';
import {
    activeState,
    clampSelection,
    deleteBackward,
    deleteForward,
    indent,
    insertDivider,
    insertText,
    replaceBlockText,
    setBlockKind,
    splitBlock,
    toggleCheck,
    toggleMark,
    touchesList
} from './edit.js';
import type { Edit, EditSettings, TextSelection } from './edit.js';

const all: EditSettings = { allowed: [...BLOCK_TYPES], maxLength: 0 };

/** A block in its one form, as the editor reads it */
const block = (key: string, order: string, shape: Partial<Block> & { text?: string }): KeyedBlock => {
    const { text, ...rest } = shape;
    return { key, ...(readBlock({ type: 'paragraph', runs: text === undefined ? [] : [{ text }], ...rest, order }) as Block) };
};
const at = (key: string, offset: number, focus?: { block: string; offset: number }): TextSelection => ({ anchor: { block: key, offset }, focus: focus ?? { block: key, offset } });
/** Each block as its type and text, in order */
const shapes = (edit: Edit | null): string[] => (edit?.blocks ?? []).map((one) => `${one.type}${one.level ?? ''}${one.indent ? `+${one.indent}` : ''}:${plainText(one.runs)}`);

describe('insertText', () => {
    it('should type into a block with the marks before the caret and write only that block', () => {
        // Arrange
        const blocks = [block('a', 'V', { runs: [{ text: 'ab', marks: ['bold'] }] }), block('b', 'W', { text: 'x' })];

        // Act
        const edit = insertText(blocks, at('a', 2), 'c', all);

        // Assert
        expect(edit?.blocks[0]?.runs).toEqual([{ text: 'abc', marks: ['bold'] }]);
        expect([...(edit?.written.keys() ?? [])]).toEqual(['a']);
        expect(edit?.selection).toEqual(at('a', 3));
    });

    it('should replace a selection across blocks, joining the ends into the first block', () => {
        // Arrange
        const blocks = [block('a', 'V', { text: 'one' }), block('b', 'W', { text: 'two' }), block('c', 'X', { text: 'three' })];

        // Act
        const edit = insertText(blocks, at('a', 1, { block: 'c', offset: 2 }), '-', all);

        // Assert
        expect(shapes(edit)).toEqual(['paragraph:o-ree']);
        expect([...(edit?.removed ?? [])].sort()).toEqual(['b', 'c']);
    });

    it('should cut the text to the room maxLength leaves', () => {
        // Arrange
        const blocks = [block('a', 'V', { text: 'abc' })];

        // Act
        const edit = insertText(blocks, at('a', 3), 'defg', { ...all, maxLength: 5 });
        const full = insertText(edit?.blocks ?? [], at('a', 5), 'h', { ...all, maxLength: 5 });

        // Assert
        expect(shapes(edit)).toEqual(['paragraph:abcde']);
        expect(full).toBeNull();
    });

    it('should turn a paragraph into a heading, list item, check item or quote on a space after its shortcut', () => {
        // Arrange
        const cases: Array<[string, string]> = [['##', 'heading2:'], ['-', 'bullet:'], ['1.', 'numbered:'], ['[x]', 'check:'], ['>', 'quote:']];

        // Act
        const results = cases.map(([prefix]) => shapes(insertText([block('a', 'V', { text: prefix })], at('a', prefix.length), ' ', all, { shortcuts: true }))[0]);

        // Assert
        expect(results).toEqual(cases.map(([, shape]) => shape));
    });

    it('should leave a block shortcut as text when the type is not allowed', () => {
        // Act
        const edit = insertText([block('a', 'V', { text: '#' })], at('a', 1), ' ', { allowed: ['paragraph'], maxLength: 0 }, { shortcuts: true });

        // Assert
        expect(shapes(edit)).toEqual(['paragraph:# ']);
    });

    it('should mark the text between a closing delimiter and its opener, and type on without the mark', () => {
        // Arrange
        const blocks = [block('a', 'V', { text: 'a **bold*' })];

        // Act
        const edit = insertText(blocks, at('a', 9), '*', all, { shortcuts: true });

        // Assert
        expect(edit?.blocks[0]?.runs).toEqual([{ text: 'a ' }, { text: 'bold', marks: ['bold'] }]);
        expect(edit?.selection).toEqual(at('a', 6));
        expect(edit?.marks).toEqual([]);
    });

    it('should not read a delimiter inside a word or around spaces as a shortcut', () => {
        // Act
        const inWord = insertText([block('a', 'V', { text: 'snake_case_' })], at('a', 11), 'x', all, { shortcuts: true });
        const spaced = insertText([block('a', 'V', { text: 'a * b ' })], at('a', 6), '*', all, { shortcuts: true });

        // Assert
        expect(inWord?.blocks[0]?.runs).toEqual([{ text: 'snake_case_x' }]);
        expect(spaced?.blocks[0]?.runs).toEqual([{ text: 'a * b *' }]);
    });

    it('should type into a new paragraph after a divider the caret is on', () => {
        // Act
        const edit = insertText([block('a', 'V', { type: 'divider' })], at('a', 0), 'x', all);

        // Assert
        expect(shapes(edit)).toEqual(['divider:', 'paragraph:x']);
    });
});

describe('splitBlock', () => {
    it('should split a paragraph at the caret into a new block after it', () => {
        // Act
        const edit = splitBlock([block('a', 'V', { text: 'abcd' })], at('a', 2), all);

        // Assert
        expect(shapes(edit)).toEqual(['paragraph:ab', 'paragraph:cd']);
        expect(edit?.blocks[0]?.key).toBe('a');
        expect(edit?.selection.focus).toEqual({ block: edit?.blocks[1]?.key, offset: 0 });
    });

    it('should add an empty block above at the start, so the block with the text keeps its key', () => {
        // Act
        const edit = splitBlock([block('a', 'V', { type: 'bullet', text: 'item' })], at('a', 0), all);

        // Assert
        expect(shapes(edit)).toEqual(['bullet:', 'bullet:item']);
        expect(edit?.blocks[1]?.key).toBe('a');
        expect(edit?.selection).toEqual(at('a', 0));
    });

    it('should continue a list and a check item unticked, and end a heading with a paragraph', () => {
        // Act
        const list = splitBlock([block('a', 'V', { type: 'check', checked: true, indent: 1, text: 'x' })], at('a', 1), all);
        const heading = splitBlock([block('a', 'V', { type: 'heading', level: 2, text: 'Title' })], at('a', 5), all);

        // Assert
        expect(list?.blocks[1]).toMatchObject({ type: 'check', checked: false, indent: 1 });
        expect(shapes(heading)).toEqual(['heading2:Title', 'paragraph:']);
    });

    it('should outdent an empty list item, and turn it into a paragraph at indent 0', () => {
        // Act
        const nested = splitBlock([block('a', 'V', { type: 'bullet', indent: 1 })], at('a', 0), all);
        const top = splitBlock([block('a', 'V', { type: 'bullet' })], at('a', 0), all);

        // Assert
        expect(shapes(nested)).toEqual(['bullet:']);
        expect(nested?.blocks[0]?.indent).toBe(0);
        expect(shapes(top)).toEqual(['paragraph:']);
    });

    it('should add a line in a code block and leave it on a second Enter at the end', () => {
        // Arrange
        const blocks = [block('a', 'V', { type: 'code', text: 'x' })];

        // Act
        const first = splitBlock(blocks, at('a', 1), all);
        const second = splitBlock(first?.blocks ?? [], first?.selection ?? at('a', 0), all);

        // Assert
        expect(shapes(first)).toEqual(['code:x\n']);
        expect(shapes(second)).toEqual(['code:x', 'paragraph:']);
    });

    it('should turn a fence into a code block with its language, and three dashes into a divider', () => {
        // Act
        const fence = splitBlock([block('a', 'V', { text: '```ts' })], at('a', 5), all);
        const rule = splitBlock([block('a', 'V', { text: '---' })], at('a', 3), all);

        // Assert
        expect(fence?.blocks[0]).toMatchObject({ type: 'code', language: 'ts', runs: [] });
        expect(shapes(rule)).toEqual(['divider:', 'paragraph:']);
    });
});

describe('deleteBackward', () => {
    it('should delete the character before the caret', () => {
        // Act
        const edit = deleteBackward([block('a', 'V', { text: 'abc' })], at('a', 2), 'character');

        // Assert
        expect(shapes(edit)).toEqual(['paragraph:ac']);
        expect(edit?.selection).toEqual(at('a', 1));
    });

    it('should outdent, then turn into a paragraph, then join, at the start of a block', () => {
        // Arrange
        const blocks = [block('a', 'V', { text: 'one' }), block('b', 'W', { type: 'bullet', indent: 1, text: 'two' })];

        // Act
        const outdented = deleteBackward(blocks, at('b', 0), 'character');
        const paragraph = deleteBackward(outdented?.blocks ?? [], at('b', 0), 'character');
        const joined = deleteBackward(paragraph?.blocks ?? [], at('b', 0), 'character');

        // Assert
        expect(shapes(outdented)).toEqual(['paragraph:one', 'bullet:two']);
        expect(shapes(paragraph)).toEqual(['paragraph:one', 'paragraph:two']);
        expect(shapes(joined)).toEqual(['paragraph:onetwo']);
        expect(joined?.selection).toEqual(at('a', 3));
        expect([...(joined?.removed ?? [])]).toEqual(['b']);
    });

    it('should remove a divider before the block', () => {
        // Act
        const edit = deleteBackward([block('a', 'V', { type: 'divider' }), block('b', 'W', { text: 'x' })], at('b', 0), 'character');

        // Assert
        expect(shapes(edit)).toEqual(['paragraph:x']);
    });

    it('should do nothing at the start of the first paragraph', () => {
        // Act
        const edit = deleteBackward([block('a', 'V', { text: 'x' })], at('a', 0), 'character');

        // Assert
        expect(edit).toBeNull();
    });
});

describe('deleteForward', () => {
    it('should delete the word after the caret, and join the next block at the end', () => {
        // Arrange
        const blocks = [block('a', 'V', { text: 'one two' }), block('b', 'W', { type: 'heading', text: 'next' })];

        // Act
        const word = deleteForward(blocks, at('a', 3), 'word');
        const joined = deleteForward(blocks, at('a', 7), 'character');

        // Assert
        expect(shapes(word)).toEqual(['paragraph:one', 'heading1:next']);
        expect(shapes(joined)).toEqual(['paragraph:one twonext']);
    });
});

describe('toggleMark', () => {
    it('should add a mark across blocks, and take it off when all of the text has it', () => {
        // Arrange
        const blocks = [block('a', 'V', { text: 'ab' }), block('b', 'W', { text: 'cd' })];
        const selection = at('a', 1, { block: 'b', offset: 1 });

        // Act
        const on = toggleMark(blocks, selection, 'italic');
        const off = toggleMark(on?.blocks ?? [], selection, 'italic');

        // Assert
        expect(on?.blocks.map((one) => one.runs)).toEqual([[{ text: 'a' }, { text: 'b', marks: ['italic'] }], [{ text: 'c', marks: ['italic'] }, { text: 'd' }]]);
        expect(off?.blocks.map((one) => one.runs)).toEqual([[{ text: 'ab' }], [{ text: 'cd' }]]);
    });

    it('should give nothing for a caret, and leave code blocks unmarked', () => {
        // Act
        const caret = toggleMark([block('a', 'V', { text: 'ab' })], at('a', 1), 'bold');
        const code = toggleMark([block('a', 'V', { type: 'code', text: 'ab' })], at('a', 0, { block: 'a', offset: 2 }), 'bold');

        // Assert
        expect(caret).toBeNull();
        expect(code).toBeNull();
    });
});

describe('setBlockKind', () => {
    it('should set the kind of every selected block, and turn them back into paragraphs when all have it', () => {
        // Arrange
        const blocks = [block('a', 'V', { text: 'one' }), block('b', 'W', { type: 'divider' }), block('c', 'X', { text: 'two' })];
        const selection = at('a', 0, { block: 'c', offset: 1 });

        // Act
        const listed = setBlockKind(blocks, selection, { type: 'numbered' }, all);
        const back = setBlockKind(listed?.blocks ?? [], selection, { type: 'numbered' }, all);

        // Assert
        expect(shapes(listed)).toEqual(['numbered:one', 'divider:', 'numbered:two']);
        expect(shapes(back)).toEqual(['paragraph:one', 'divider:', 'paragraph:two']);
    });

    it('should change a heading level, and refuse a type the settings do not allow', () => {
        // Arrange
        const blocks = [block('a', 'V', { type: 'heading', level: 1, text: 'x' })];

        // Act
        const level = setBlockKind(blocks, at('a', 0), { type: 'heading', level: 3 }, all);
        const refused = setBlockKind(blocks, at('a', 0), { type: 'quote' }, { allowed: ['heading'], maxLength: 0 });

        // Assert
        expect(shapes(level)).toEqual(['heading3:x']);
        expect(refused).toBeNull();
    });
});

describe('insertDivider', () => {
    it('should put a divider after the block and the caret in a paragraph after it', () => {
        // Act
        const edit = insertDivider([block('a', 'V', { text: 'x' })], at('a', 1), all);

        // Assert
        expect(shapes(edit)).toEqual(['paragraph:x', 'divider:', 'paragraph:']);
        expect(edit?.selection.focus.block).toBe(edit?.blocks[2]?.key);
    });

    it('should turn an empty block into the divider and keep the order keys between their neighbours', () => {
        // Act
        const edit = insertDivider([block('a', 'V', {}), block('b', 'W', { text: 'next' })], at('a', 0), all);

        // Assert
        expect(shapes(edit)).toEqual(['divider:', 'paragraph:next']);
        expect(edit?.selection).toEqual(at('b', 0));
    });
});

describe('indent and touchesList', () => {
    it('should indent the selected list items within the limit and leave other blocks', () => {
        // Arrange
        const blocks = [block('a', 'V', { type: 'bullet', indent: 4, text: 'x' }), block('b', 'W', { text: 'p' }), block('c', 'X', { type: 'check', text: 'y' })];
        const selection = at('a', 0, { block: 'c', offset: 0 });

        // Act
        const edit = indent(blocks, selection, 1);

        // Assert
        expect(touchesList(blocks, selection)).toBe(true);
        expect(touchesList(blocks, at('b', 0))).toBe(false);
        expect(edit?.blocks.map((one) => one.indent)).toEqual([4, undefined, 1]);
        expect([...(edit?.written.keys() ?? [])]).toEqual(['c']);
    });
});

describe('toggleCheck', () => {
    it('should tick and untick a check item only', () => {
        // Arrange
        const blocks = [block('a', 'V', { type: 'check', text: 'x' }), block('b', 'W', { text: 'y' })];

        // Act
        const ticked = toggleCheck(blocks, 'a', at('a', 0));
        const paragraph = toggleCheck(blocks, 'b', at('a', 0));

        // Assert
        expect(ticked?.blocks[0]?.checked).toBe(true);
        expect(paragraph).toBeNull();
    });
});

describe('clampSelection and activeState', () => {
    it('should move a point whose block is gone to the first block, and clamp offsets', () => {
        // Act
        const clamped = clampSelection([block('a', 'V', { text: 'ab' })], at('gone', 4, { block: 'a', offset: 9 }));

        // Assert
        expect(clamped).toEqual(at('a', 0, { block: 'a', offset: 2 }));
    });

    it('should give the marks all the selected text has, the pending marks for a caret, and the block kind', () => {
        // Arrange
        const blocks = [block('a', 'V', { type: 'heading', level: 2, runs: [{ text: 'ab', marks: ['bold', 'italic'] }, { text: 'c', marks: ['bold'] }] })];

        // Act
        const range = activeState(blocks, at('a', 0, { block: 'a', offset: 3 }), null);
        const pending = activeState(blocks, at('a', 1), ['code']);

        // Assert
        expect(range).toEqual({ marks: ['bold'], kind: { type: 'heading', level: 2 } });
        expect(pending.marks).toEqual(['code']);
    });
});

describe('replaceBlockText', () => {
    it('should put text an input method wrote in with the marks around it, keeping the rest of the runs', () => {
        // Arrange
        const blocks = [block('a', 'V', { runs: [{ text: 'ab', marks: ['bold'] }, { text: 'cd' }] })];

        // Act
        const result = replaceBlockText(blocks, 'a', 'ab日本cd');

        // Assert
        expect(result?.edit.blocks[0]?.runs).toEqual([{ text: 'ab日本', marks: ['bold'] }, { text: 'cd' }]);
        expect(result?.offset).toBe(4);
    });

    it('should give nothing when the text is the same', () => {
        // Act
        const result = replaceBlockText([block('a', 'V', { text: 'ab' })], 'a', 'ab');

        // Assert
        expect(result).toBeNull();
    });
});
