import { safeHref } from '../markdown/links.js';
import { orderKeys } from './order.js';

/**
 * The block value of rich text: a keyed map of blocks, each with a fractional `order` and its text as runs of marked
 * characters (docs/design/stateui-text-editor.md). Keys start with a letter, so none is integer-like, and order comes from
 * `order` (then the key), never from key order. `readRichText` reads any value leniently into blocks in order, with every
 * field checked; `normalizeRuns` gives equal content one form
 */

export const BLOCK_TYPES = ['paragraph', 'heading', 'bullet', 'numbered', 'check', 'quote', 'code', 'divider', 'table'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** The marks in the order they are stored and nested: code innermost, bold outermost */
export const MARKS = ['code', 'strike', 'italic', 'bold'] as const;
export type Mark = (typeof MARKS)[number];

export const LIST_TYPES: readonly BlockType[] = ['bullet', 'numbered', 'check'];
/** Blocks with no text of their own: the caret cannot sit in their runs (a table's text is in its cells) */
export const ATOMIC_TYPES: readonly BlockType[] = ['divider', 'table'];
export const ALIGNS = ['left', 'center', 'right'] as const;
export type Align = (typeof ALIGNS)[number];

export const MAX_HEADING_LEVEL = 3;
export const MAX_INDENT = 4;
/** At most this many blocks are read; the rest are dropped */
export const MAX_BLOCKS = 10_000;
/** A table has at most this many columns and rows (the first row is its header) */
export const MAX_COLUMNS = 20;
export const MAX_ROWS = 500;
/** The longest id a mention keeps */
export const MAX_MENTION_ID = 128;

export interface Run {
    text: string;
    marks?: Mark[];
    link?: string;
    /** The id of the person or record a mention names; the run's text is what it shows (`@Ada`). A mention is edited whole */
    mention?: string;
}

/** A table cell: one line of runs */
export interface Cell {
    runs: Run[];
}

/** A table row; every row has the table's number of cells */
export interface Row {
    cells: Cell[];
}

export interface Block {
    order: string;
    type: BlockType;
    runs: Run[];
    /** A heading's level, 1 to 3 */
    level?: number;
    /** A list item's indent, 0 to 4 */
    indent?: number;
    /** Whether a check item is ticked */
    checked?: boolean;
    /** A code block's language label */
    language?: string;
    /** A table's rows, the first its header */
    rows?: Row[];
    /** A table's column alignment, one per column (`''` for none); left out when no column has one */
    align?: Array<Align | ''>;
}

export interface RichTextValue {
    blocks: Record<string, Block>;
}

/** A block with its key, as `readRichText` returns it */
export interface KeyedBlock extends Block {
    key: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const KEY_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** A new block key: `b` and eight random base-62 characters */
export function newBlockKey(): string {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    let key = 'b';
    for (const byte of bytes) key += KEY_DIGITS[byte % 62];
    return key;
}

/** Whether a key may name a block: it starts with a letter and holds only letters, digits, `-` and `_` */
export function isBlockKey(key: string): boolean {
    if (key.length === 0 || key.length > 64) return false;
    const first = key.charCodeAt(0);
    if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122))) return false;
    for (let at = 1; at < key.length; at++) {
        const code = key.charCodeAt(at);
        const ok = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 45 || code === 95;
        if (!ok) return false;
    }
    return true;
}

const clampInteger = (value: unknown, min: number, max: number, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;

const sameMarks = (a: readonly Mark[] | undefined, b: readonly Mark[] | undefined): boolean => {
    const left = a ?? [];
    const right = b ?? [];
    return left.length === right.length && left.every((mark, index) => mark === right[index]);
};

/** The marks of a stored run that are known, once each, in `MARKS` order */
export function readMarks(value: unknown): Mark[] {
    if (!Array.isArray(value)) return [];
    return MARKS.filter((mark) => value.includes(mark));
}

/**
 * Runs in their one form: unknown marks and unsafe links dropped, empty runs dropped, and neighbours with the same marks
 * and link joined (a mention is never joined). A run keeps `marks`, `link` and `mention` only when it has them
 */
export function normalizeRuns(value: unknown): Run[] {
    if (!Array.isArray(value)) return [];
    const runs: Run[] = [];
    for (const item of value) {
        if (!isRecord(item) || typeof item['text'] !== 'string' || item['text'] === '') continue;
        const marks = readMarks(item['marks']);
        const mentioned = item['mention'];
        const mention = typeof mentioned === 'string' && mentioned !== '' && mentioned.length <= MAX_MENTION_ID ? mentioned : undefined;
        //a mention is its own target, so it carries no link
        const link = mention === undefined && typeof item['link'] === 'string' ? safeHref(item['link']) : undefined;
        const last = runs[runs.length - 1];
        if (last !== undefined && mention === undefined && last.mention === undefined && sameMarks(last.marks, marks) && last.link === link) {
            last.text += item['text'];
            continue;
        }
        const run: Run = { text: item['text'] };
        if (marks.length > 0) run.marks = marks;
        if (link !== undefined) run.link = link;
        if (mention !== undefined) run.mention = mention;
        runs.push(run);
    }
    return runs;
}

/** A block's characters, without marks */
export function plainText(runs: readonly Run[]): string {
    return runs.map((run) => run.text).join('');
}

/** Lists of runs joined into one, with `between` as plain text between each two; empty lists are left out */
export function joinRunsOf(lists: ReadonlyArray<readonly Run[]>, between: string): Run[] {
    const runs: Run[] = [];
    for (const list of lists) {
        if (list.length === 0) continue;
        if (runs.length > 0) runs.push({ text: between });
        runs.push(...list);
    }
    return normalizeRuns(runs);
}

/** A cell's runs: one line, so a line break reads as a space */
const cellRuns = (value: unknown): Run[] => normalizeRuns(normalizeRuns(value).map((run) => ({ ...run, text: run.text.replace(/\n/g, ' ') })));

/** A table's rows and alignment, checked: as many columns as its header has (1 to `MAX_COLUMNS`), every row padded or cut to them, 1 to `MAX_ROWS` rows */
function readTable(value: Record<string, unknown>, block: Block): void {
    const stored = Array.isArray(value['rows']) ? value['rows'].slice(0, MAX_ROWS) : [];
    const cellsOf = (row: unknown): unknown[] => (isRecord(row) && Array.isArray(row['cells']) ? row['cells'] : []);
    const columns = Math.min(MAX_COLUMNS, Math.max(1, cellsOf(stored[0]).length));
    const rows: Row[] = (stored.length > 0 ? stored : [{}]).map((row) => {
        const cells = cellsOf(row);
        return { cells: Array.from({ length: columns }, (_, index) => ({ runs: cellRuns(isRecord(cells[index]) ? cells[index]['runs'] : []) })) };
    });
    block.rows = rows;
    const align = Array.isArray(value['align']) ? value['align'] : [];
    const aligned = Array.from({ length: columns }, (_, index): Align | '' => ((ALIGNS as readonly unknown[]).includes(align[index]) ? (align[index] as Align) : ''));
    if (aligned.some((one) => one !== '')) block.align = aligned;
}

/** The text of every cell of a table, or of a block's runs */
export function blockLength(block: Pick<Block, 'runs' | 'rows'>): number {
    if (block.rows === undefined) return plainText(block.runs).length;
    return block.rows.reduce((total, row) => total + row.cells.reduce((sum, cell) => sum + plainText(cell.runs).length, 0), 0);
}

/** One stored block read into its checked form, or undefined when it is not a block */
export function readBlock(value: unknown): Block | undefined {
    if (!isRecord(value)) return undefined;
    const type = value['type'];
    if (typeof type !== 'string' || !(BLOCK_TYPES as readonly string[]).includes(type)) return undefined;
    const order = typeof value['order'] === 'string' ? value['order'] : '';
    const block: Block = { order, type: type as BlockType, runs: type === 'divider' || type === 'table' ? [] : normalizeRuns(value['runs']) };
    if (type === 'heading') block.level = clampInteger(value['level'], 1, MAX_HEADING_LEVEL, 1);
    if (LIST_TYPES.includes(block.type)) block.indent = clampInteger(value['indent'], 0, MAX_INDENT, 0);
    if (type === 'check') block.checked = value['checked'] === true;
    if (type === 'code') {
        //code keeps its characters only; marks and links have no meaning in it
        block.runs = block.runs.length === 0 ? [] : [{ text: plainText(block.runs) }];
        if (typeof value['language'] === 'string' && value['language'] !== '') block.language = value['language'].slice(0, 32);
    }
    if (type === 'table') readTable(value, block);
    return block;
}

/** Sorts by `order`, then by key, so two blocks given the same order by two writers still have one order */
export const compareBlocks = (a: KeyedBlock, b: KeyedBlock): number => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * The blocks of a value in order. Anything that is not a block, or whose key is not a block key, is dropped, as is every
 * block past `MAX_BLOCKS`
 */
export function readRichText(value: unknown): KeyedBlock[] {
    const blocks = isRecord(value) ? value['blocks'] : undefined;
    if (!isRecord(blocks)) return [];
    const read: KeyedBlock[] = [];
    for (const [key, stored] of Object.entries(blocks)) {
        if (!isBlockKey(key)) continue;
        const block = readBlock(stored);
        if (block !== undefined) read.push({ key, ...block });
    }
    return read.sort(compareBlocks).slice(0, MAX_BLOCKS);
}

/** Blocks in the order given, as a value: each gets a new key and an order key that keeps that order */
export function valueOf(blocks: readonly Omit<Block, 'order'>[]): RichTextValue {
    const orders = orderKeys(blocks.length);
    const value: RichTextValue = { blocks: {} };
    blocks.forEach((block, index) => {
        value.blocks[newBlockKey()] = { ...block, order: orders[index] ?? '' };
    });
    return value;
}

/** The number of characters across every block, a table's cells among them */
export function textLength(blocks: readonly Pick<Block, 'runs' | 'rows'>[]): number {
    return blocks.reduce((total, block) => total + blockLength(block), 0);
}
