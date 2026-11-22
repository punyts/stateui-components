import { LIST_TYPES, MARKS, MAX_BLOCKS, MAX_HEADING_LEVEL, MAX_INDENT, newBlockKey, plainText, readBlock, textLength } from './model.js';
import type { Block, BlockType, KeyedBlock, Mark, Run } from './model.js';
import { safeHref } from '../markdown/links.js';
import { orderBetween } from './order.js';
import { deleteRuns, hasMark, insertRuns, joinRuns, linkExtent, linkRuns, markRuns, nextBoundary, previousBoundary, sliceRuns, styleAt } from './runs.js';
import type { DeleteUnit } from './runs.js';

/**
 * The edits of the rich-text editor as pure functions over the blocks in order. Each takes the blocks and the selection
 * and returns an `Edit`: the blocks after it, the blocks it wrote (whole, in their one form) and removed, and the
 * selection after it; or null when it changes nothing. The editor writes `written` and `removed` to the value, so an edit
 * writes only the blocks it changed (docs/design/stateui-text-editor.md)
 */

/** A place in the text: a block and a character offset in it (UTF-16 code units, as the DOM counts) */
export interface Point {
    block: string;
    offset: number;
}

/** The selection: where it started (`anchor`) and where it ends (`focus`); equal points are a caret */
export interface TextSelection {
    anchor: Point;
    focus: Point;
}

/** What an editor allows */
export interface EditSettings {
    /** The block types the field allows; a paragraph is always allowed */
    readonly allowed: readonly BlockType[];
    /** The most characters across all blocks; 0 for no limit */
    readonly maxLength: number;
}

export interface Edit {
    /** Every block after the edit, in order */
    blocks: KeyedBlock[];
    /** The blocks the edit changed or added, by key */
    written: Map<string, KeyedBlock>;
    /** The keys of the blocks the edit removed */
    removed: Set<string>;
    selection: TextSelection;
    /** The marks the next typed text takes, when the edit decides them (after an inline shortcut, without its mark) */
    marks?: Mark[];
}

/** The kind of a block that a toolbar button or shortcut sets */
export interface BlockKind {
    type: BlockType;
    /** A heading's level */
    level?: number;
}

/** Blocks without their key and order, as an edit makes them */
type Shape = Omit<Block, 'order'>;

const textOf = (block: Block): string => plainText(block.runs);
const lengthOf = (block: Block): number => textOf(block).length;
const isList = (block: Pick<Block, 'type'>): boolean => LIST_TYPES.includes(block.type);

/** A block in its one form, as `readRichText` would read it back */
function canonical(block: KeyedBlock): KeyedBlock {
    const read = readBlock(block) as Block;
    return { key: block.key, ...read };
}

/** Whether the settings allow a block type */
export function allows(settings: EditSettings, type: BlockType): boolean {
    return type === 'paragraph' || settings.allowed.includes(type);
}

class Draft {
    readonly blocks: KeyedBlock[];
    readonly written = new Map<string, KeyedBlock>();
    readonly removed = new Set<string>();

    constructor(blocks: readonly KeyedBlock[]) {
        this.blocks = [...blocks];
    }

    get changed(): boolean {
        return this.written.size > 0 || this.removed.size > 0;
    }

    index(key: string): number {
        return this.blocks.findIndex((block) => block.key === key);
    }

    get(key: string): KeyedBlock {
        return this.blocks[this.index(key)] as KeyedBlock;
    }

    /** Replaces a block with a changed copy of itself */
    put(block: KeyedBlock): KeyedBlock {
        const next = canonical(block);
        const index = this.index(block.key);
        if (index < 0) return next;
        if (JSON.stringify(this.blocks[index]) === JSON.stringify(next)) return next;
        this.blocks[index] = next;
        this.written.set(next.key, next);
        return next;
    }

    /** Puts a new block at `index`, with an order between its neighbours */
    insertAt(index: number, shape: Shape): KeyedBlock {
        const order = orderBetween(this.blocks[index - 1]?.order, this.blocks[index]?.order);
        const block = canonical({ ...shape, key: newBlockKey(), order });
        this.blocks.splice(index, 0, block);
        this.written.set(block.key, block);
        return block;
    }

    remove(key: string): void {
        const index = this.index(key);
        if (index < 0) return;
        this.blocks.splice(index, 1);
        if (this.written.has(key)) this.written.delete(key);
        this.removed.add(key);
    }

    done(selection: TextSelection, marks?: Mark[]): Edit {
        const edit: Edit = { blocks: this.blocks, written: this.written, removed: this.removed, selection };
        if (marks !== undefined) edit.marks = marks;
        return edit;
    }
}

const caret = (point: Point): TextSelection => ({ anchor: point, focus: point });

interface Bound extends Point {
    index: number;
}

/** The selection's start and end in document order, with their block indexes; null when a point is not in the blocks */
function rangeOf(blocks: readonly KeyedBlock[], selection: TextSelection): { start: Bound; end: Bound } | null {
    const bound = (point: Point): Bound | null => {
        const index = blocks.findIndex((block) => block.key === point.block);
        if (index < 0) return null;
        const offset = Math.max(0, Math.min(point.offset, lengthOf(blocks[index] as KeyedBlock)));
        return { block: point.block, offset, index };
    };
    const anchor = bound(selection.anchor);
    const focus = bound(selection.focus);
    if (anchor === null || focus === null) return null;
    const forward = anchor.index < focus.index || (anchor.index === focus.index && anchor.offset <= focus.offset);
    return forward ? { start: anchor, end: focus } : { start: focus, end: anchor };
}

const collapsed = (range: { start: Bound; end: Bound }): boolean => range.start.index === range.end.index && range.start.offset === range.end.offset;

/** Takes the selected text out and returns where the caret lands */
function removeRange(draft: Draft, range: { start: Bound; end: Bound }): Point {
    const { start, end } = range;
    const first = draft.blocks[start.index] as KeyedBlock;
    if (start.index === end.index) {
        if (start.offset !== end.offset) draft.put({ ...first, runs: deleteRuns(first.runs, start.offset, end.offset) });
        return { block: first.key, offset: start.offset };
    }
    const last = draft.blocks[end.index] as KeyedBlock;
    for (const block of draft.blocks.slice(start.index + 1, end.index)) draft.remove(block.key);
    const tail = last.type === 'divider' ? [] : sliceRuns(last.runs, end.offset, lengthOf(last));
    if (first.type !== 'divider') {
        draft.remove(last.key);
        draft.put({ ...first, runs: joinRuns(sliceRuns(first.runs, 0, start.offset), tail) });
        return { block: first.key, offset: start.offset };
    }
    draft.remove(first.key);
    if (last.type !== 'divider') {
        draft.put({ ...last, runs: tail });
        return { block: last.key, offset: 0 };
    }
    const index = draft.index(last.key);
    draft.remove(last.key);
    const paragraph = draft.insertAt(index, { type: 'paragraph', runs: [] });
    return { block: paragraph.key, offset: 0 };
}

/** The first `room` characters of `text`, not cutting a surrogate pair */
function fit(text: string, room: number): string {
    if (text.length <= room) return text;
    if (room <= 0) return '';
    const code = text.charCodeAt(room - 1);
    return text.slice(0, code >= 0xd800 && code <= 0xdbff ? room - 1 : room);
}

/** What typing a space after one of these at the start of a paragraph turns it into */
function blockShortcut(prefix: string): BlockKind & { checked?: boolean } | null {
    if (prefix === '#' || prefix === '##' || prefix === '###') return { type: 'heading', level: prefix.length };
    if (prefix === '-' || prefix === '*' || prefix === '+') return { type: 'bullet' };
    if (/^\d{1,9}[.)]$/u.test(prefix)) return { type: 'numbered' };
    if (prefix === '[]' || prefix === '[ ]') return { type: 'check', checked: false };
    if (prefix === '[x]' || prefix === '[X]') return { type: 'check', checked: true };
    if (prefix === '>') return { type: 'quote' };
    return null;
}

/** Inline shortcuts, longest delimiter first so `**` is not read as two `*` */
const INLINE_SHORTCUTS: ReadonlyArray<readonly [string, Mark]> = [
    ['**', 'bold'],
    ['__', 'bold'],
    ['~~', 'strike'],
    ['`', 'code'],
    ['*', 'italic'],
    ['_', 'italic']
];

const isSpace = (character: string): boolean => /\s/u.test(character);
const opensAfter = (character: string): boolean => character === '' || /[\s\p{P}]/u.test(character);

/** A closing delimiter just typed: the mark it closes and where its text starts and ends, or null */
function inlineShortcut(text: string): { mark: Mark; delimiter: number; open: number; close: number } | null {
    for (const [delimiter, mark] of INLINE_SHORTCUTS) {
        if (!text.endsWith(delimiter)) continue;
        const close = text.length - delimiter.length;
        const single = delimiter.length === 1;
        if (single && text.charAt(close - 1) === delimiter) continue;
        const open = text.lastIndexOf(delimiter, close - delimiter.length - 1);
        if (open < 0) continue;
        if (single && text.charAt(open - 1) === delimiter) continue;
        const content = text.slice(open + delimiter.length, close);
        if (content === '' || isSpace(content.charAt(0)) || isSpace(content.charAt(content.length - 1))) continue;
        if (!opensAfter(text.charAt(open - 1))) continue;
        return { mark, delimiter: delimiter.length, open, close };
    }
    return null;
}

/** The shape of a block turned into another kind, keeping its text */
function converted(block: Block, kind: BlockKind & { checked?: boolean }): Shape {
    const shape: Shape = { type: kind.type, runs: block.runs };
    if (kind.type === 'heading') shape.level = Math.min(MAX_HEADING_LEVEL, Math.max(1, kind.level ?? 1));
    if (LIST_TYPES.includes(kind.type)) shape.indent = isList(block) ? (block.indent ?? 0) : 0;
    if (kind.type === 'check') shape.checked = kind.checked ?? (block.type === 'check' && block.checked === true);
    if (kind.type === 'code' && block.type === 'code' && block.language !== undefined) shape.language = block.language;
    return shape;
}

/** Replaces a block's kind, keeping its key and order */
function reshape(block: KeyedBlock, shape: Shape): KeyedBlock {
    return { ...shape, key: block.key, order: block.order };
}

/** A caret in a divider moves into a new paragraph after it, which the edit then types into */
function textPoint(draft: Draft, point: Point): Point {
    const block = draft.get(point.block);
    if (block.type !== 'divider') return point;
    const paragraph = draft.insertAt(draft.index(block.key) + 1, { type: 'paragraph', runs: [] });
    return { block: paragraph.key, offset: 0 };
}

interface InsertOptions {
    /** The marks the text takes instead of those at the caret (marks toggled with nothing selected) */
    readonly marks?: readonly Mark[] | undefined;
    /** Whether a space or a closing delimiter may run a Markdown shortcut (typing does; a line break and a paste do not) */
    readonly shortcuts?: boolean;
}

/**
 * Types `text` over the selection. The text takes the marks of the character before the caret, or `options.marks`, and
 * is cut to the room `maxLength` leaves. With `shortcuts`, a space after `#`, `-`, `1.`, `[]` or `>` at the start of a
 * paragraph turns it into a heading, list item or quote, and a closing `**`, `_`, `~~` or backtick marks the text since
 * its opener
 */
export function insertText(blocks: readonly KeyedBlock[], selection: TextSelection, text: string, settings: EditSettings, options: InsertOptions = {}): Edit | null {
    const range = rangeOf(blocks, selection);
    if (range === null) return null;
    const draft = new Draft(blocks);
    const at = textPoint(draft, removeRange(draft, range));
    const block = draft.get(at.block);
    const room = settings.maxLength > 0 ? settings.maxLength - textLength(draft.blocks) : Number.POSITIVE_INFINITY;
    const typed = fit(text, room);
    if (typed === '') return draft.changed ? draft.done(caret(at)) : null;
    const style = styleAt(block.runs, at.offset);
    const marks = block.type === 'code' ? [] : MARKS.filter((mark) => (options.marks ?? style.marks).includes(mark));
    const run: Run = { text: typed };
    if (marks.length > 0) run.marks = marks;
    if (style.link !== undefined && block.type !== 'code') run.link = style.link;
    let written = draft.put({ ...block, runs: insertRuns(block.runs, at.offset, [run]) });
    const end: Point = { block: block.key, offset: at.offset + typed.length };
    if (options.shortcuts !== true || block.type === 'code') return draft.done(caret(end));

    const before = textOf(written).slice(0, end.offset);
    if (typed === ' ' && written.type === 'paragraph') {
        const kind = blockShortcut(before.slice(0, -1));
        if (kind !== null && allows(settings, kind.type)) {
            written = draft.put(reshape(written, converted({ ...written, runs: deleteRuns(written.runs, 0, end.offset) }, kind)));
            return draft.done(caret({ block: written.key, offset: 0 }));
        }
    }
    const inline = typed.length === 1 ? inlineShortcut(before) : null;
    if (inline === null) return draft.done(caret(end));
    const { mark, delimiter, open, close } = inline;
    let runs = deleteRuns(written.runs, close, close + delimiter);
    runs = markRuns(runs, open + delimiter, close, mark, true);
    runs = deleteRuns(runs, open, open + delimiter);
    written = draft.put({ ...written, runs });
    const offset = close - delimiter;
    const following = styleAt(written.runs, offset).marks.filter((known) => known !== mark);
    return draft.done(caret({ block: written.key, offset }), following);
}

/** A line break inside the block: a `\n` in its text */
export function insertLineBreak(blocks: readonly KeyedBlock[], selection: TextSelection, settings: EditSettings): Edit | null {
    return insertText(blocks, selection, '\n', settings);
}

/** The block that Enter at the end of `block` starts */
function continuation(block: Block, atEnd: boolean): Shape {
    if (block.type === 'heading') return atEnd ? { type: 'paragraph', runs: [] } : { type: 'heading', level: block.level ?? 1, runs: [] };
    if (block.type === 'check') return { type: 'check', indent: block.indent ?? 0, checked: false, runs: [] };
    if (isList(block)) return { type: block.type, indent: block.indent ?? 0, runs: [] };
    if (block.type === 'quote') return { type: 'quote', runs: [] };
    return { type: 'paragraph', runs: [] };
}

/**
 * Enter: splits the block at the caret. In a code block it adds a line, and a second Enter at the end leaves it; in an
 * empty list item it outdents, and at indent 0 (or in an empty heading or quote) turns the block into a paragraph. A
 * paragraph that is only ```` ``` ```` (with a language) becomes a code block and one that is only `---` a divider
 */
export function splitBlock(blocks: readonly KeyedBlock[], selection: TextSelection, settings: EditSettings): Edit | null {
    const range = rangeOf(blocks, selection);
    if (range === null) return null;
    const draft = new Draft(blocks);
    const at = removeRange(draft, range);
    const block = draft.get(at.block);
    const index = draft.index(block.key);
    const text = textOf(block);
    if (block.type === 'divider') {
        const paragraph = draft.insertAt(index + 1, { type: 'paragraph', runs: [] });
        return draft.done(caret({ block: paragraph.key, offset: 0 }));
    }
    if (block.type === 'code') {
        if (at.offset === text.length && text.endsWith('\n')) {
            draft.put({ ...block, runs: deleteRuns(block.runs, text.length - 1, text.length) });
            const paragraph = draft.insertAt(index + 1, { type: 'paragraph', runs: [] });
            return draft.done(caret({ block: paragraph.key, offset: 0 }));
        }
        if (settings.maxLength > 0 && textLength(draft.blocks) >= settings.maxLength) return draft.changed ? draft.done(caret(at)) : null;
        draft.put({ ...block, runs: insertRuns(block.runs, at.offset, [{ text: '\n' }]) });
        return draft.done(caret({ block: block.key, offset: at.offset + 1 }));
    }
    if (text === '' && block.type !== 'paragraph') {
        const shape: Shape = isList(block) && (block.indent ?? 0) > 0 ? { ...converted(block, { type: block.type }), indent: (block.indent ?? 0) - 1 } : { type: 'paragraph', runs: [] };
        if (block.type === 'check' && shape.type === 'check') shape.checked = block.checked === true;
        draft.put(reshape(block, shape));
        return draft.done(caret({ block: block.key, offset: 0 }));
    }
    if (block.type === 'paragraph' && at.offset === text.length) {
        const fence = /^```([\w+#.-]{0,32})$/u.exec(text);
        if (fence !== null && allows(settings, 'code')) {
            const shape: Shape = { type: 'code', runs: [] };
            if (fence[1] !== undefined && fence[1] !== '') shape.language = fence[1];
            draft.put(reshape(block, shape));
            return draft.done(caret({ block: block.key, offset: 0 }));
        }
        if ((text === '---' || text === '***' || text === '___') && allows(settings, 'divider')) {
            draft.put(reshape(block, { type: 'divider', runs: [] }));
            const paragraph = draft.insertAt(index + 1, { type: 'paragraph', runs: [] });
            return draft.done(caret({ block: paragraph.key, offset: 0 }));
        }
    }
    if (at.offset === 0 && text !== '') {
        //Enter at the start adds an empty block above, so the block with the text keeps its key
        const above = block.type === 'heading' ? { type: 'paragraph' as const, runs: [] } : continuation(block, false);
        draft.insertAt(index, above);
        return draft.done(caret({ block: block.key, offset: 0 }));
    }
    draft.put({ ...block, runs: sliceRuns(block.runs, 0, at.offset) });
    const next = draft.insertAt(index + 1, { ...continuation(block, at.offset === text.length), runs: sliceRuns(block.runs, at.offset, text.length) });
    return draft.done(caret({ block: next.key, offset: 0 }));
}

/** The caret after a divider at `index` is removed: the end of the block before it, else the start of the one after */
function afterRemoval(draft: Draft, index: number): Point {
    const before = draft.blocks[index - 1];
    if (before !== undefined) return { block: before.key, offset: before.type === 'divider' ? 0 : lengthOf(before) };
    const after = draft.blocks[index];
    if (after !== undefined) return { block: after.key, offset: 0 };
    const paragraph = draft.insertAt(0, { type: 'paragraph', runs: [] });
    return { block: paragraph.key, offset: 0 };
}

/** Joins `second` onto the end of `first`; `first` keeps its kind */
function join(draft: Draft, first: KeyedBlock, second: KeyedBlock): Point {
    const offset = lengthOf(first);
    draft.put({ ...first, runs: joinRuns(first.runs, second.runs) });
    draft.remove(second.key);
    return { block: first.key, offset };
}

/**
 * Backspace (and its word and line forms): deletes the selection, or the `unit` before the caret. At the start of a
 * block it outdents a list item, turns any other kind into a paragraph, removes a divider before it, or joins the
 * paragraph onto the block before
 */
export function deleteBackward(blocks: readonly KeyedBlock[], selection: TextSelection, unit: DeleteUnit): Edit | null {
    const range = rangeOf(blocks, selection);
    if (range === null) return null;
    const draft = new Draft(blocks);
    if (!collapsed(range)) return draft.done(caret(removeRange(draft, range)));
    const { start } = range;
    const block = draft.get(start.block);
    if (block.type === 'divider') {
        draft.remove(block.key);
        return draft.done(caret(afterRemoval(draft, start.index)));
    }
    if (start.offset > 0) {
        const from = previousBoundary(textOf(block), start.offset, unit);
        draft.put({ ...block, runs: deleteRuns(block.runs, from, start.offset) });
        return draft.done(caret({ block: block.key, offset: from }));
    }
    if (isList(block) && (block.indent ?? 0) > 0) {
        draft.put({ ...block, indent: (block.indent ?? 0) - 1 });
        return draft.done(caret(start));
    }
    if (block.type !== 'paragraph') {
        draft.put(reshape(block, { type: 'paragraph', runs: block.runs }));
        return draft.done(caret(start));
    }
    const previous = draft.blocks[start.index - 1];
    if (previous === undefined) return null;
    if (previous.type === 'divider') {
        draft.remove(previous.key);
        return draft.done(caret(start));
    }
    return draft.done(caret(join(draft, previous, block)));
}

/** Delete (and its word and line forms): deletes the selection or the `unit` after the caret, joining the next block at the end */
export function deleteForward(blocks: readonly KeyedBlock[], selection: TextSelection, unit: DeleteUnit): Edit | null {
    const range = rangeOf(blocks, selection);
    if (range === null) return null;
    const draft = new Draft(blocks);
    if (!collapsed(range)) return draft.done(caret(removeRange(draft, range)));
    const { start } = range;
    const block = draft.get(start.block);
    if (block.type === 'divider') {
        draft.remove(block.key);
        const after = draft.blocks[start.index];
        return draft.done(caret(after !== undefined ? { block: after.key, offset: 0 } : afterRemoval(draft, start.index)));
    }
    const text = textOf(block);
    if (start.offset < text.length) {
        const to = nextBoundary(text, start.offset, unit);
        draft.put({ ...block, runs: deleteRuns(block.runs, start.offset, to) });
        return draft.done(caret(start));
    }
    const next = draft.blocks[start.index + 1];
    if (next === undefined) return null;
    if (next.type === 'divider') {
        draft.remove(next.key);
        return draft.done(caret(start));
    }
    return draft.done(caret(join(draft, block, next)));
}

/** The selected stretch of each text block in a range (code blocks have no marks, so they are left out) */
function stretches(blocks: readonly KeyedBlock[], range: { start: Bound; end: Bound }): Array<{ block: KeyedBlock; from: number; to: number }> {
    const found: Array<{ block: KeyedBlock; from: number; to: number }> = [];
    for (let index = range.start.index; index <= range.end.index; index++) {
        const block = blocks[index] as KeyedBlock;
        if (block.type === 'divider' || block.type === 'code') continue;
        const from = index === range.start.index ? range.start.offset : 0;
        const to = index === range.end.index ? range.end.offset : lengthOf(block);
        if (from < to) found.push({ block, from, to });
    }
    return found;
}

/** Adds `mark` to the selected text, or takes it off when all of it has it already. Null for a caret (the editor keeps the mark for the next typing) */
export function toggleMark(blocks: readonly KeyedBlock[], selection: TextSelection, mark: Mark): Edit | null {
    const range = rangeOf(blocks, selection);
    if (range === null || collapsed(range)) return null;
    const parts = stretches(blocks, range);
    if (parts.length === 0) return null;
    const on = !parts.every((part) => hasMark(part.block.runs, part.from, part.to, mark));
    const draft = new Draft(blocks);
    for (const part of parts) draft.put({ ...part.block, runs: markRuns(part.block.runs, part.from, part.to, mark, on) });
    return draft.done(selection);
}

/** The blocks a range touches */
function touched(blocks: readonly KeyedBlock[], range: { start: Bound; end: Bound }): KeyedBlock[] {
    return blocks.slice(range.start.index, range.end.index + 1);
}

/** Sets the kind of every selected block, or turns them back into paragraphs when all are of that kind already */
export function setBlockKind(blocks: readonly KeyedBlock[], selection: TextSelection, kind: BlockKind, settings: EditSettings): Edit | null {
    if (!allows(settings, kind.type) || kind.type === 'divider') return null;
    const range = rangeOf(blocks, selection);
    if (range === null) return null;
    const targets = touched(blocks, range).filter((block) => block.type !== 'divider');
    if (targets.length === 0) return null;
    const level = kind.type === 'heading' ? Math.min(MAX_HEADING_LEVEL, Math.max(1, kind.level ?? 1)) : undefined;
    const already = targets.every((block) => block.type === kind.type && (level === undefined || block.level === level));
    const draft = new Draft(blocks);
    for (const block of targets) draft.put(reshape(block, already ? { type: 'paragraph', runs: block.runs } : converted(block, { type: kind.type, ...(level === undefined ? {} : { level }) })));
    return draft.changed ? draft.done(selection) : null;
}

/** Puts a divider after the caret's block (or turns an empty block into one) and moves the caret to the text after it */
export function insertDivider(blocks: readonly KeyedBlock[], selection: TextSelection, settings: EditSettings): Edit | null {
    if (!allows(settings, 'divider')) return null;
    const range = rangeOf(blocks, selection);
    if (range === null) return null;
    const draft = new Draft(blocks);
    const at = removeRange(draft, range);
    const block = draft.get(at.block);
    let index = draft.index(block.key);
    if (block.type !== 'divider' && textOf(block) === '') draft.put(reshape(block, { type: 'divider', runs: [] }));
    else {
        draft.insertAt(index + 1, { type: 'divider', runs: [] });
        index++;
    }
    const after = draft.blocks[index + 1];
    const target = after !== undefined && after.type !== 'divider' ? after : draft.insertAt(index + 1, { type: 'paragraph', runs: [] });
    return draft.done(caret({ block: target.key, offset: 0 }));
}

/** Whether the selection touches a list item, where Tab indents */
export function touchesList(blocks: readonly KeyedBlock[], selection: TextSelection): boolean {
    const range = rangeOf(blocks, selection);
    return range !== null && touched(blocks, range).some(isList);
}

/** Indents (`delta` 1) or outdents (-1) every selected list item, within 0 to `MAX_INDENT` */
export function indent(blocks: readonly KeyedBlock[], selection: TextSelection, delta: number): Edit | null {
    const range = rangeOf(blocks, selection);
    if (range === null) return null;
    const draft = new Draft(blocks);
    for (const block of touched(blocks, range)) {
        if (!isList(block)) continue;
        const next = Math.min(MAX_INDENT, Math.max(0, (block.indent ?? 0) + delta));
        if (next !== (block.indent ?? 0)) draft.put({ ...block, indent: next });
    }
    return draft.changed ? draft.done(selection) : null;
}

/** Ticks or unticks a check item */
export function toggleCheck(blocks: readonly KeyedBlock[], key: string, selection: TextSelection): Edit | null {
    const draft = new Draft(blocks);
    const index = draft.index(key);
    const block = draft.blocks[index];
    if (block === undefined || block.type !== 'check') return null;
    draft.put({ ...block, checked: block.checked !== true });
    return draft.done(selection);
}

/** Shapes cut to `room` characters in all: the shape that reaches it is cut, those after it are left out */
function fitShapes(shapes: readonly Shape[], room: number): Shape[] {
    const fitted: Shape[] = [];
    let left = room;
    for (const shape of shapes) {
        const length = plainText(shape.runs).length;
        if (length <= left) {
            fitted.push(shape);
            left -= length;
            continue;
        }
        const cut = fit(plainText(shape.runs), left).length;
        if (cut > 0) fitted.push({ ...shape, runs: sliceRuns(shape.runs, 0, cut) });
        break;
    }
    return fitted;
}

/** A pasted shape as it lands next to `block`: a paragraph takes the kind Enter would continue with, a list item adds the list's indent */
function landed(shape: Shape, block: Block): Shape {
    if (shape.type === 'paragraph') return { ...continuation(block, true), runs: shape.runs };
    if (isList(shape) && isList(block)) return { ...shape, indent: Math.min(MAX_INDENT, (shape.indent ?? 0) + (block.indent ?? 0)) };
    return shape;
}

/**
 * Pasted or dropped blocks put in over the selection. One pasted block goes in at the caret; with more, the block at the
 * caret is split, the first pasted block joins its start, the last takes its end and those between are added after it.
 * A pasted paragraph takes the kind of the block it lands in (pasted lines in a list become items of it), and a block at
 * the caret with no text before it takes the first pasted block's kind. In a code block the text goes in plain, one
 * block per line. The text is cut to the room `maxLength` leaves, and no more blocks are added than `MAX_BLOCKS` allows
 */
export function insertBlocks(blocks: readonly KeyedBlock[], selection: TextSelection, shapes: readonly Shape[], settings: EditSettings): Edit | null {
    const range = rangeOf(blocks, selection);
    if (range === null) return null;
    if ((blocks[range.start.index] as KeyedBlock).type === 'code') {
        const text = shapes.filter((shape) => shape.type !== 'divider').map((shape) => plainText(shape.runs)).join('\n');
        return insertText(blocks, selection, text, settings);
    }
    const draft = new Draft(blocks);
    const at = textPoint(draft, removeRange(draft, range));
    const block = draft.get(at.block);
    const room = settings.maxLength > 0 ? settings.maxLength - textLength(draft.blocks) : Number.POSITIVE_INFINITY;
    const fitted = fitShapes(shapes, room).slice(0, Math.max(1, MAX_BLOCKS - draft.blocks.length + 1));
    const nothing = fitted.length === 0 || (fitted.length === 1 && fitted[0]?.type !== 'divider' && fitted[0]?.runs.length === 0);
    if (nothing) return draft.changed ? draft.done(caret(at)) : null;
    const length = lengthOf(block);
    const head = sliceRuns(block.runs, 0, at.offset);
    const tail = sliceRuns(block.runs, at.offset, length);
    const [first, ...rest] = fitted as [Shape, ...Shape[]];
    let index = draft.index(block.key);
    let pieces = rest;

    if (first.type === 'divider') {
        if (length === 0) draft.put(reshape(block, { type: 'divider', runs: [] }));
        else {
            draft.put({ ...block, runs: head });
            pieces = fitted;
        }
    } else {
        const runs = joinRuns(head, first.runs, rest.length === 0 ? tail : []);
        const takesKind = at.offset === 0 && first.type !== 'paragraph';
        draft.put(takesKind ? reshape(block, { ...landed(first, block), runs }) : { ...block, runs });
        if (rest.length === 0) return draft.done(caret({ block: block.key, offset: at.offset + plainText(first.runs).length }));
    }

    let end: Point = { block: block.key, offset: 0 };
    pieces.forEach((shape, position) => {
        const lastPiece = position === pieces.length - 1;
        const placed = landed(shape, block);
        if (placed.type === 'divider') {
            draft.insertAt(++index, placed);
            if (lastPiece) {
                const after = draft.insertAt(++index, { ...continuation(block, true), runs: tail });
                end = { block: after.key, offset: 0 };
            }
            return;
        }
        const added = draft.insertAt(++index, { ...placed, runs: lastPiece ? joinRuns(placed.runs, tail) : placed.runs });
        if (lastPiece) end = { block: added.key, offset: plainText(placed.runs).length };
    });
    return draft.done(caret(end));
}

/** The link under the caret with its whole stretch selected, or the one link all of a selection has; null when there is none */
export function linkAt(blocks: readonly KeyedBlock[], selection: TextSelection): { href: string; selection: TextSelection } | null {
    const range = rangeOf(blocks, selection);
    if (range === null) return null;
    if (collapsed(range)) {
        const block = blocks[range.start.index] as KeyedBlock;
        const extent = linkExtent(block.runs, range.start.offset);
        if (extent === null) return null;
        return { href: extent.href, selection: { anchor: { block: block.key, offset: extent.from }, focus: { block: block.key, offset: extent.to } } };
    }
    const parts = stretches(blocks, range);
    const links = new Set(parts.flatMap((part) => sliceRuns(part.block.runs, part.from, part.to).map((run) => run.link)));
    const [only] = links;
    return links.size === 1 && only !== undefined ? { href: only, selection } : null;
}

/**
 * Links the selected text to `href`, or unlinks it when `href` is null. A caret in a link applies to the whole link; a
 * caret elsewhere puts `href` in as linked text (unlinking there does nothing). `href` must already be checked with
 * `safeHref`; the run's own check drops it otherwise
 */
export function setLink(blocks: readonly KeyedBlock[], selection: TextSelection, href: string | null, settings: EditSettings): Edit | null {
    const range = rangeOf(blocks, selection);
    if (range === null) return null;
    if (collapsed(range)) {
        const found = linkAt(blocks, selection);
        if (found !== null) return setLink(blocks, found.selection, href, settings);
        if (href === null) return null;
        const block = blocks[range.start.index] as KeyedBlock;
        if (block.type === 'code') return null;
        return insertBlocks(blocks, selection, [{ type: 'paragraph', runs: [{ text: href, link: href }] }], settings);
    }
    const parts = stretches(blocks, range);
    if (parts.length === 0) return null;
    const draft = new Draft(blocks);
    for (const part of parts) draft.put({ ...part.block, runs: linkRuns(part.block.runs, part.from, part.to, href) });
    return draft.changed ? draft.done(selection) : null;
}

/** A typed address that starts like a domain (`example.com/a`) and so is read as https, not as a relative path */
const DOMAIN = /^(?:[\p{L}\p{N}-]+\.)+\p{L}{2,}(?::\d{1,5})?(?:[/?#]|$)/u;

/** A typed link address as a safe target: a bare domain gets `https://`; undefined when `safeHref` refuses it */
export function linkTarget(typed: string): string | undefined {
    const text = typed.trim();
    if (text === '') return undefined;
    return safeHref(DOMAIN.test(text) ? `https://${text}` : text);
}

/** A selection whose points are in the blocks: a point whose block is gone goes to the start of the first block, and offsets are clamped */
export function clampSelection(blocks: readonly KeyedBlock[], selection: TextSelection): TextSelection {
    const clamp = (point: Point): Point => {
        const block = blocks.find((candidate) => candidate.key === point.block);
        if (block === undefined) return blocks[0] === undefined ? point : { block: blocks[0].key, offset: 0 };
        return { block: block.key, offset: Math.max(0, Math.min(point.offset, lengthOf(block))) };
    };
    return { anchor: clamp(selection.anchor), focus: clamp(selection.focus) };
}

/** What the toolbar shows as active: the marks all the selected text has (or the marks typing would take) and the focus block's kind */
export function activeState(blocks: readonly KeyedBlock[], selection: TextSelection, pending: readonly Mark[] | null): { marks: Mark[]; kind: BlockKind | null } {
    const range = rangeOf(blocks, selection);
    if (range === null) return { marks: [], kind: null };
    const focus = blocks[range.end.index] as KeyedBlock;
    const kind: BlockKind = focus.type === 'heading' ? { type: 'heading', level: focus.level ?? 1 } : { type: focus.type };
    if (collapsed(range)) {
        const marks = focus.type === 'code' ? [] : (pending ?? styleAt(focus.runs, range.start.offset).marks);
        return { marks: [...marks], kind };
    }
    const parts = stretches(blocks, range);
    const marks = parts.length === 0 ? [] : MARKS.filter((mark) => parts.every((part) => hasMark(part.block.runs, part.from, part.to, mark)));
    return { marks, kind };
}

/** A whole block's text replaced by `text` read back from the page (after an input method wrote it), keeping the marks around the change */
export function replaceBlockText(blocks: readonly KeyedBlock[], key: string, text: string): { edit: Edit; offset: number } | null {
    const draft = new Draft(blocks);
    const block = draft.blocks[draft.index(key)];
    if (block === undefined || block.type === 'divider') return null;
    const old = textOf(block);
    if (old === text) return null;
    let prefix = 0;
    while (prefix < old.length && prefix < text.length && old.charCodeAt(prefix) === text.charCodeAt(prefix)) prefix++;
    let suffix = 0;
    while (suffix < old.length - prefix && suffix < text.length - prefix && old.charCodeAt(old.length - 1 - suffix) === text.charCodeAt(text.length - 1 - suffix)) suffix++;
    const inserted = text.slice(prefix, text.length - suffix);
    const style = styleAt(block.runs, prefix);
    const run: Run = { text: inserted };
    if (style.marks.length > 0 && block.type !== 'code') run.marks = style.marks;
    if (style.link !== undefined && block.type !== 'code') run.link = style.link;
    const runs = insertRuns(deleteRuns(block.runs, prefix, old.length - suffix), prefix, inserted === '' ? [] : [run]);
    draft.put({ ...block, runs });
    const offset = prefix + inserted.length;
    return { edit: draft.done(caret({ block: key, offset })), offset };
}
