import { describe, expect, it } from 'vitest';
import { BLOCK_TYPES, MAX_IMAGES, plainText, readBlock } from './model.js';
import type { Block, KeyedBlock } from './model.js';
import {
    activeState,
    chainEdits,
    clampSelection,
    deleteBackward,
    deleteForward,
    indent,
    insertDivider,
    insertImage,
    removeBlock,
    setImage,
    insertBlocks,
    insertMention,
    insertTable,
    insertText,
    linkAt,
    opensPicker,
    pickerQuery,
    replaceBlockText,
    setBlockKind,
    setLink,
    linkTarget,
    splitBlock,
    tableCommand,
    toggleCheck,
    toggleMark,
    touchesList
} from './edit.js';
import type { Edit, EditSettings, Point, TextSelection } from './edit.js';

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

describe('insertBlocks', () => {
    it('should put one pasted paragraph in at the caret with its marks', () => {
        // Arrange
        const blocks = [block('a', 'V', { type: 'bullet', text: 'ad' })];

        // Act
        const edit = insertBlocks(blocks, at('a', 1), [{ type: 'paragraph', runs: [{ text: 'bc', marks: ['bold'] }] }], all);

        // Assert
        expect(shapes(edit)).toEqual(['bullet:abcd']);
        expect(edit?.blocks[0]?.runs).toEqual([{ text: 'a' }, { text: 'bc', marks: ['bold'] }, { text: 'd' }]);
        expect(edit?.selection).toEqual(at('a', 3));
    });

    it('should split the block, joining the first pasted block to its start and the last to its end', () => {
        // Arrange
        const blocks = [block('a', 'V', { text: 'start|end' }), block('z', 'W', { text: 'after' })];
        const pasted = [
            { type: 'paragraph' as const, runs: [{ text: 'one' }] },
            { type: 'heading' as const, level: 2, runs: [{ text: 'two' }] },
            { type: 'paragraph' as const, runs: [{ text: 'three' }] }
        ];

        // Act
        const edit = insertBlocks(blocks, at('a', 6), pasted, all);

        // Assert
        expect(shapes(edit)).toEqual(['paragraph:start|one', 'heading2:two', 'paragraph:threeend', 'paragraph:after']);
        expect(edit?.blocks[0]?.key).toBe('a');
        expect(edit?.selection.focus.offset).toBe(5);
        expect(edit?.selection.focus.block).toBe(edit?.blocks[2]?.key);
    });

    it('should make pasted paragraphs items of the list they land in, and give an empty block the first pasted kind', () => {
        // Arrange
        const list = [block('a', 'V', { type: 'bullet', indent: 1, text: '' })];
        const empty = [block('a', 'V', { text: '' })];

        // Act
        const lines = insertBlocks(list, at('a', 0), [{ type: 'paragraph', runs: [{ text: 'x' }] }, { type: 'paragraph', runs: [{ text: 'y' }] }], all);
        const heading = insertBlocks(empty, at('a', 0), [{ type: 'heading', level: 1, runs: [{ text: 'T' }] }, { type: 'paragraph', runs: [{ text: 'p' }] }], all);

        // Assert
        expect(shapes(lines)).toEqual(['bullet+1:x', 'bullet+1:y']);
        expect(shapes(heading)).toEqual(['heading1:T', 'paragraph:p']);
        expect(heading?.blocks[0]?.key).toBe('a');
    });

    it('should put pasted dividers between blocks, with the text after them in a block of its own', () => {
        // Arrange
        const blocks = [block('a', 'V', { text: 'ab' })];

        // Act
        const edit = insertBlocks(blocks, at('a', 1), [{ type: 'divider', runs: [] }], all);

        // Assert
        expect(shapes(edit)).toEqual(['paragraph:a', 'divider:', 'paragraph:b']);
        expect(edit?.selection.focus).toEqual({ block: edit?.blocks[2]?.key, offset: 0 });
    });

    it('should paste into a code block as plain lines and cut the paste to maxLength', () => {
        // Arrange
        const code = [block('a', 'V', { type: 'code', text: '' })];
        const short = [block('a', 'V', { text: 'ab' })];

        // Act
        const inCode = insertBlocks(code, at('a', 0), [{ type: 'heading', level: 1, runs: [{ text: 'x', marks: ['bold'] }] }, { type: 'bullet', runs: [{ text: 'y' }] }], all);
        const cut = insertBlocks(short, at('a', 2), [{ type: 'paragraph', runs: [{ text: 'cd' }] }, { type: 'paragraph', runs: [{ text: 'ef' }] }], { ...all, maxLength: 5 });

        // Assert
        expect(shapes(inCode)).toEqual(['code:x\ny']);
        expect(shapes(cut)).toEqual(['paragraph:abcd', 'paragraph:e']);
    });
});

describe('links', () => {
    it('should find the whole link around a caret, and the one link a selection has', () => {
        // Arrange
        const blocks = [block('a', 'V', { runs: [{ text: 'see ' }, { text: 'the', link: 'https://x.example' }, { text: ' docs', marks: ['bold'], link: 'https://x.example' }, { text: '!' }] })];

        // Act
        const around = linkAt(blocks, at('a', 6));
        const atEnd = linkAt(blocks, at('a', 12));
        const outside = linkAt(blocks, at('a', 2));
        const mixed = linkAt(blocks, at('a', 2, { block: 'a', offset: 6 }));

        // Assert
        expect(around).toEqual({ href: 'https://x.example', selection: at('a', 4, { block: 'a', offset: 12 }) });
        expect(atEnd?.href).toBe('https://x.example');
        expect(outside).toBeNull();
        expect(mixed).toBeNull();
    });

    it('should link and unlink the selected text, keeping its marks', () => {
        // Arrange
        const blocks = [block('a', 'V', { runs: [{ text: 'ab' }, { text: 'cd', marks: ['italic'] }] })];

        // Act
        const linked = setLink(blocks, at('a', 1, { block: 'a', offset: 3 }), 'https://x.example', all);
        const unlinked = setLink(linked?.blocks ?? [], at('a', 2), null, all);

        // Assert
        expect(linked?.blocks[0]?.runs).toEqual([{ text: 'a' }, { text: 'b', link: 'https://x.example' }, { text: 'c', marks: ['italic'], link: 'https://x.example' }, { text: 'd', marks: ['italic'] }]);
        expect(unlinked?.blocks[0]?.runs).toEqual([{ text: 'ab' }, { text: 'cd', marks: ['italic'] }]);
    });

    it('should put the address in as linked text at a caret outside a link', () => {
        // Arrange
        const blocks = [block('a', 'V', { text: 'go ' })];

        // Act
        const edit = setLink(blocks, at('a', 3), 'https://x.example', all);

        // Assert
        expect(edit?.blocks[0]?.runs).toEqual([{ text: 'go ' }, { text: 'https://x.example', link: 'https://x.example' }]);
        expect(setLink(blocks, at('a', 3), null, all)).toBeNull();
    });
});

describe('linkTarget', () => {
    it('should read a bare domain as https and refuse what safeHref refuses', () => {
        // Act
        const read = ['example.com', 'www.example.com/a?b#c', 'https://x.example', '/docs', '#part', 'http://x.example', 'javascript:alert(1)', 'mailto:a@b.example', ''].map(linkTarget);

        // Assert
        expect(read).toEqual(['https://example.com', 'https://www.example.com/a?b#c', 'https://x.example', '/docs', '#part', undefined, undefined, undefined, undefined]);
    });
});

/** A table block from rows of cell texts */
const table = (key: string, order: string, rows: string[][]): KeyedBlock => block(key, order, { type: 'table', rows: rows.map((cells) => ({ cells: cells.map((text) => ({ runs: text === '' ? [] : [{ text }] })) })) });
const inCell = (key: string, row: number, column: number, offset: number, focusOffset = offset): TextSelection => ({
    anchor: { block: key, offset, cell: { row, column } },
    focus: { block: key, offset: focusOffset, cell: { row, column } }
});
/** A table's cell texts, row by row */
const cells = (edit: Edit | null, key: string): string[][] => (edit?.blocks.find((one) => one.key === key)?.rows ?? []).map((row) => row.cells.map((cell) => plainText(cell.runs)));

describe('tables', () => {
    it('should put a three by three table in place of an empty paragraph with a paragraph after it and the caret in its first cell', () => {
        // Arrange
        const blocks = [block('a', 'V', {})];

        // Act
        const edit = insertTable(blocks, at('a', 0), all);

        // Assert
        expect(shapes(edit)).toEqual(['table:', 'paragraph:']);
        expect(cells(edit, 'a')).toEqual([['', '', ''], ['', '', ''], ['', '', '']]);
        expect(edit?.selection).toEqual(inCell('a', 0, 0, 0));
    });

    it('should refuse a table where the field does not allow one', () => {
        // Act
        const edit = insertTable([block('a', 'V', {})], at('a', 0), { allowed: ['bullet'], maxLength: 0 });

        // Assert
        expect(edit).toBeNull();
    });

    it('should type into a cell as one line, without block shortcuts, writing only the table', () => {
        // Arrange
        const blocks = [table('t', 'V', [['ab', 'c'], ['', '']]), block('p', 'W', { text: 'after' })];

        // Act
        const typed = insertText(blocks, inCell('t', 0, 0, 1), 'x', all, { shortcuts: true });
        const shortcut = insertText(blocks, inCell('t', 1, 0, 0), '# ', all, { shortcuts: true });
        const broken = insertText(blocks, inCell('t', 1, 1, 0), 'a\nb', all);

        // Assert
        expect(cells(typed, 't')).toEqual([['axb', 'c'], ['', '']]);
        expect([...(typed?.written.keys() ?? [])]).toEqual(['t']);
        expect(typed?.selection).toEqual(inCell('t', 0, 0, 2));
        expect(cells(shortcut, 't')[1]).toEqual(['# ', '']);
        expect(cells(broken, 't')[1]).toEqual(['', 'a b']);
    });

    it('should count every cell against maxLength', () => {
        // Arrange
        const blocks = [table('t', 'V', [['abc', 'de']]), block('p', 'W', { text: 'fg' })];

        // Act
        const edit = insertText(blocks, inCell('t', 0, 1, 2), 'xyz', { ...all, maxLength: 8 });

        // Assert
        expect(cells(edit, 't')).toEqual([['abc', 'dex']]);
    });

    it('should delete within a cell and stop at its start', () => {
        // Arrange
        const blocks = [table('t', 'V', [['ab', 'cd']])];

        // Act
        const deleted = deleteBackward(blocks, inCell('t', 0, 1, 1), 'character');
        const atStart = deleteBackward(blocks, inCell('t', 0, 1, 0), 'character');

        // Assert
        expect(cells(deleted, 't')).toEqual([['ab', 'd']]);
        expect(atStart?.written.size ?? 0).toBe(0);
    });

    it('should move Backspace after a table into its last cell and Delete before one into its first, removing nothing', () => {
        // Arrange
        const blocks = [block('a', 'V', { text: 'x' }), table('t', 'W', [['h1', 'h2'], ['c1', 'c2']]), block('b', 'X', { text: 'y' })];

        // Act
        const back = deleteBackward(blocks, at('b', 0), 'character');
        const forward = deleteForward(blocks, at('a', 1), 'character');

        // Assert
        expect(back?.selection).toEqual(inCell('t', 1, 1, 2));
        expect(back?.written.size).toBe(0);
        expect(forward?.selection).toEqual(inCell('t', 0, 0, 0));
        expect(forward?.removed.size).toBe(0);
    });

    it('should move with Tab and Shift+Tab, and add a row with Tab in the last cell or Enter in the last row', () => {
        // Arrange
        const blocks = [table('t', 'V', [['a', 'b'], ['c', 'd']])];

        // Act
        const next = tableCommand(blocks, inCell('t', 0, 1, 0), 'next');
        const previous = tableCommand(blocks, inCell('t', 1, 0, 0), 'previous');
        const added = tableCommand(blocks, inCell('t', 1, 1, 1), 'next');
        const enter = splitBlock(blocks, inCell('t', 1, 0, 1), all);
        const down = splitBlock(blocks, inCell('t', 0, 1, 0), all);

        // Assert
        expect(next?.selection).toEqual(inCell('t', 1, 0, 0));
        expect(previous?.selection).toEqual(inCell('t', 0, 1, 1));
        expect(cells(added, 't')).toEqual([['a', 'b'], ['c', 'd'], ['', '']]);
        expect(added?.selection).toEqual(inCell('t', 2, 0, 0));
        expect(cells(enter, 't')).toHaveLength(3);
        expect(enter?.selection).toEqual(inCell('t', 2, 0, 0));
        expect(down?.selection).toEqual(inCell('t', 1, 1, 0));
        expect(down?.written.size).toBe(0);
    });

    it('should add and remove rows and columns, keeping alignment with its columns, and remove the table with its last row', () => {
        // Arrange
        const blocks = [block('t', 'V', { type: 'table', align: ['left', 'right'], rows: [{ cells: [{ runs: [{ text: 'a' }] }, { runs: [{ text: 'b' }] }] }] })];

        // Act
        const column = tableCommand(blocks, inCell('t', 0, 0, 0), 'addColumn');
        const removed = tableCommand(column?.blocks ?? [], inCell('t', 0, 2, 0), 'removeColumn');
        const row = tableCommand(blocks, inCell('t', 0, 0, 0), 'addRow');
        const gone = tableCommand(blocks, inCell('t', 0, 0, 0), 'removeRow');

        // Assert
        expect(cells(column, 't')).toEqual([['a', '', 'b']]);
        expect(column?.blocks[0]?.align).toEqual(['left', '', 'right']);
        expect(removed?.blocks[0]?.align).toEqual(['left', '']);
        expect(cells(row, 't')).toEqual([['a', 'b'], ['', '']]);
        expect(shapes(gone)).toEqual(['paragraph:']);
        expect(gone?.removed.has('t')).toBe(true);
    });

    it('should bold a cell selection and find a link in a cell', () => {
        // Arrange
        const blocks = [block('t', 'V', { type: 'table', rows: [{ cells: [{ runs: [{ text: 'go ' }, { text: 'here', link: 'https://x.example' }] }] }] })];

        // Act
        const bold = toggleMark(blocks, inCell('t', 0, 0, 0, 2), 'bold');
        const found = linkAt(blocks, inCell('t', 0, 0, 4));

        // Assert
        expect(bold?.blocks[0]?.rows?.[0]?.cells[0]?.runs[0]).toEqual({ text: 'go', marks: ['bold'] });
        expect(found).toEqual({ href: 'https://x.example', selection: inCell('t', 0, 0, 3, 7) });
    });

    it('should clamp a point into a cell that exists and report the table as the active kind', () => {
        // Arrange
        const blocks = [table('t', 'V', [['ab']])];

        // Act
        const clamped = clampSelection(blocks, inCell('t', 4, 2, 9));
        const state = activeState(blocks, inCell('t', 0, 0, 1), null);

        // Assert
        expect(clamped).toEqual(inCell('t', 0, 0, 2));
        expect(state.kind).toEqual({ type: 'table' });
    });

    it('should read the text an input method wrote back into a cell', () => {
        // Arrange
        const blocks = [table('t', 'V', [['ab', 'c']])];

        // Act
        const result = replaceBlockText(blocks, 't', 'aXb', { row: 0, column: 0 });

        // Assert
        expect(cells(result?.edit ?? null, 't')).toEqual([['aXb', 'c']]);
        expect(result?.offset).toBe(2);
    });

    it('should paste blocks into a cell as one line', () => {
        // Arrange
        const blocks = [table('t', 'V', [['', '']])];

        // Act
        const edit = insertBlocks(blocks, inCell('t', 0, 1, 0), [{ type: 'heading', level: 1, runs: [{ text: 'one' }] }, { type: 'divider', runs: [] }, { type: 'paragraph', runs: [{ text: 'two' }] }], all);

        // Assert
        expect(cells(edit, 't')).toEqual([['', 'one two']]);
    });
});

describe('mentions', () => {
    const mentioned = (): KeyedBlock[] => [block('a', 'V', { runs: [{ text: 'hi ' }, { text: '@Ada', mention: 'u1' }, { text: ' there' }] })];

    it('should put a mention and a space in at the caret, with the caret after them', () => {
        // Arrange
        const blocks = [block('a', 'V', { text: 'hi ' })];

        // Act
        const edit = insertMention(blocks, at('a', 3), 'u1', 'Ada', all);

        // Assert
        expect(edit?.blocks[0]?.runs).toEqual([{ text: 'hi ' }, { text: '@Ada', mention: 'u1' }, { text: ' ' }]);
        expect(edit?.selection).toEqual(at('a', 8));
    });

    it('should not put a mention in a code block', () => {
        // Act
        const edit = insertMention([block('a', 'V', { type: 'code', text: 'x' })], at('a', 1), 'u1', 'Ada', all);

        // Assert
        expect(edit).toBeNull();
    });

    it('should delete a mention whole with one Backspace or Delete', () => {
        // Act
        const back = deleteBackward(mentioned(), at('a', 7), 'character');
        const forward = deleteForward(mentioned(), at('a', 3), 'character');

        // Assert
        expect(plainText(back?.blocks[0]?.runs ?? [])).toBe('hi  there');
        expect(back?.selection).toEqual(at('a', 3));
        expect(plainText(forward?.blocks[0]?.runs ?? [])).toBe('hi  there');
    });

    it('should type after a mention, not into it, when the caret is inside it', () => {
        // Act
        const edit = insertText(mentioned(), at('a', 5), 'x', all);

        // Assert
        expect(edit?.blocks[0]?.runs).toEqual([{ text: 'hi ' }, { text: '@Ada', mention: 'u1' }, { text: 'x there' }]);
    });

    it('should keep a mention when marking it and never link it', () => {
        // Act
        const bold = toggleMark(mentioned(), at('a', 0, { block: 'a', offset: 7 }), 'bold');
        const linked = setLink(mentioned(), at('a', 0, { block: 'a', offset: 7 }), 'https://x.example', all);

        // Assert
        expect(bold?.blocks[0]?.runs[1]).toEqual({ text: '@Ada', marks: ['bold'], mention: 'u1' });
        expect(linked?.blocks[0]?.runs[1]).toEqual({ text: '@Ada', mention: 'u1' });
    });
});

describe('pickers', () => {
    it('should open a picker at the start of the text or after a space, never in code, and the slash menu not in a cell', () => {
        // Arrange
        const blocks = [block('a', 'V', { text: 'ab cd' }), block('c', 'W', { type: 'code', text: '' }), table('t', 'X', [['']])];
        const cell: Point = { block: 't', offset: 0, cell: { row: 0, column: 0 } };

        // Act
        const opened = [opensPicker(blocks, { block: 'a', offset: 0 }, 'slash'), opensPicker(blocks, { block: 'a', offset: 3 }, 'mention'), opensPicker(blocks, cell, 'mention')];
        const refused = [opensPicker(blocks, { block: 'a', offset: 2 }, 'slash'), opensPicker(blocks, { block: 'c', offset: 0 }, 'slash'), opensPicker(blocks, cell, 'slash')];

        // Assert
        expect(opened).toEqual([true, true, true]);
        expect(refused).toEqual([false, false, false]);
    });

    it('should follow the query after the trigger and close when the caret leaves it', () => {
        // Arrange
        const blocks = [block('a', 'V', { text: 'x /head' }), block('b', 'W', { text: 'y' })];
        const from: Point = { block: 'a', offset: 2 };

        // Act
        const query = pickerQuery(blocks, from, at('a', 7), 'slash');
        const before = pickerQuery(blocks, from, at('a', 2), 'slash');
        const elsewhere = pickerQuery(blocks, from, at('b', 1), 'slash');
        const spaced = pickerQuery([block('a', 'V', { text: 'x /he ad' })], from, at('a', 8), 'slash');
        const named = pickerQuery([block('a', 'V', { text: 'x @Ada Lo' })], from, at('a', 9), 'mention');

        // Assert
        expect(query).toBe('head');
        expect(before).toBeNull();
        expect(elsewhere).toBeNull();
        expect(spaced).toBeNull();
        expect(named).toBe('Ada Lo');
    });

    it('should chain two edits into one that writes both and removes what the second removed', () => {
        // Arrange
        const blocks = [block('a', 'V', { text: '/' })];
        const first = deleteBackward(blocks, at('a', 1), 'character') as Edit;

        // Act
        const chained = chainEdits(first, insertTable(first.blocks, first.selection, all));

        // Assert
        expect(shapes(chained)).toEqual(['table:', 'paragraph:']);
        expect(chained.written.size).toBe(2);
        expect(chained.removed.size).toBe(0);
    });
});

describe('images', () => {
    const photo = { id: 'f1', name: 'photo.png', size: 2048, type: 'image/png' };
    const image = (key: string, order: string, extra: Partial<Block> = {}): KeyedBlock => block(key, order, { type: 'image', file: photo, ...extra });

    it('should put an image after the block and the caret in a paragraph after it', () => {
        // Act
        const edit = insertImage([block('a', 'V', { text: 'x' })], 'a', photo, all);

        // Assert
        expect(shapes(edit)).toEqual(['paragraph:x', 'image:', 'paragraph:']);
        expect(edit?.blocks[1]?.file).toEqual(photo);
        expect(edit?.selection.focus.block).toBe(edit?.blocks[2]?.key);
    });

    it('should turn an empty block into the image and move the caret into the text after it', () => {
        // Act
        const edit = insertImage([block('a', 'V', {}), block('b', 'W', { text: 'next' })], 'a', photo, all);

        // Assert
        expect(shapes(edit)).toEqual(['image:', 'paragraph:next']);
        expect(edit?.blocks[0]?.key).toBe('a');
        expect(edit?.selection).toEqual(at('b', 0));
    });

    it('should put the image at the end when its block is gone', () => {
        // Act
        const edit = insertImage([block('a', 'V', { text: 'x' })], 'gone', photo, all);

        // Assert
        expect(shapes(edit)).toEqual(['paragraph:x', 'image:', 'paragraph:']);
    });

    it('should refuse a file that is not a picture, a field without images and one already full', () => {
        // Arrange
        const full = Array.from({ length: MAX_IMAGES }, (_, index) => image(`i${String.fromCharCode(97 + index)}`, `V${String.fromCharCode(97 + index)}`));

        // Act
        const notPicture = insertImage([block('a', 'V', {})], 'a', { ...photo, type: 'application/pdf' }, all);
        const notAllowed = insertImage([block('a', 'V', {})], 'a', photo, { allowed: ['paragraph'], maxLength: 0 });
        const tooMany = insertImage(full, null, photo, all);

        // Assert
        expect(notPicture).toBeNull();
        expect(notAllowed).toBeNull();
        expect(tooMany).toBeNull();
    });

    it('should set alt text and caption as one trimmed line, set the width and leave out what is empty or full', () => {
        // Arrange
        const blocks = [image('a', 'V', { alt: 'old', width: 'small' })];

        // Act
        const edit = setImage(blocks, 'a', { alt: '  a\nchart ', caption: 'Sales', width: 'medium' });
        const cleared = setImage(edit?.blocks ?? [], 'a', { alt: ' ', width: 'full' });

        // Assert
        expect(edit?.blocks[0]).toMatchObject({ alt: 'a chart', caption: 'Sales', width: 'medium' });
        expect(edit?.selection).toEqual(at('a', 0));
        expect(cleared?.blocks[0]?.alt).toBeUndefined();
        expect(cleared?.blocks[0]?.width).toBeUndefined();
        expect(cleared?.blocks[0]?.caption).toBe('Sales');
    });

    it('should change nothing when the image is missing or the change keeps it as it is', () => {
        // Arrange
        const blocks = [image('a', 'V', { alt: 'same' })];

        // Act
        const missing = setImage(blocks, 'b', { alt: 'x' });
        const same = setImage(blocks, 'a', { alt: 'same', width: 'full' });

        // Assert
        expect(missing).toBeNull();
        expect(same).toBeNull();
    });

    it('should remove an image and put the caret where it was', () => {
        // Act
        const edit = removeBlock([block('a', 'V', { text: 'x' }), image('b', 'W'), block('c', 'X', { text: 'y' })], 'b');

        // Assert
        expect(shapes(edit)).toEqual(['paragraph:x', 'paragraph:y']);
        expect(edit?.removed.has('b')).toBe(true);
    });

    it('should select the image before or after the caret on Backspace or Delete, and remove it on the next press', () => {
        // Arrange
        const blocks = [block('a', 'V', { text: 'x' }), image('b', 'W'), block('c', 'X', { text: 'y' })];

        // Act
        const backward = deleteBackward(blocks, at('c', 0), 'character');
        const forward = deleteForward(blocks, at('a', 1), 'character');
        const removed = deleteBackward(blocks, at('b', 0), 'character');

        // Assert
        expect(backward?.selection).toEqual(at('b', 0));
        expect(backward?.written.size).toBe(0);
        expect(forward?.selection).toEqual(at('b', 0));
        expect(shapes(removed)).toEqual(['paragraph:x', 'paragraph:y']);
    });
});
