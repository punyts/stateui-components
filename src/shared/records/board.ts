import { toNumber } from '../format/format.js';

export interface BoardOptions {
    /** The field of an array record that holds its key (a keyed map is keyed by its own keys) */
    readonly key: string;
    /** The field whose value names the column a record is in */
    readonly columnField: string;
    /** The optional field that orders the records inside a column; empty keeps the order of the records */
    readonly orderField: string;
    /** The keys of the columns, in the order they are shown */
    readonly columns: readonly string[];
}

export interface BoardModel {
    /** The record keys of each column in display order; every column in `columns` has an entry, empty when no record is in it */
    readonly orders: ReadonlyMap<string, readonly string[]>;
    /** The distinct column values of the records that are in no column, as text, in the order they were found */
    readonly unmatched: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const keyText = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value === '' ? undefined : value;
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
};

interface Entry {
    readonly key: string;
    readonly position: number;
    readonly order: number | undefined;
}

/** The text of a column value: the key it is looked up by (`1` and `"1"` are the same column) */
export const columnValue = (value: unknown): string => (typeof value === 'string' ? value : String(value));

/**
 * Sorts the records into the columns of a board. A record goes to the column whose key is the text of its `columnField`
 * value; inside a column the records are in `orderField` order (numbers ascending, a record with no number after them, ties
 * and a missing `orderField` in the order of the records). A record that no column has is left out and its value is listed in
 * `unmatched` once. Records are an array keyed by the `key` field, or a keyed map; anything else gives empty columns
 */
export function buildBoard(records: unknown, options: BoardOptions): BoardModel {
    const rows: [string, Record<string, unknown>][] = [];
    if (Array.isArray(records)) {
        for (const record of records as unknown[]) {
            const key = isRecord(record) ? keyText(record[options.key]) : undefined;
            if (key !== undefined && isRecord(record)) rows.push([key, record]);
        }
    } else if (isRecord(records)) {
        for (const [key, record] of Object.entries(records)) if (isRecord(record)) rows.push([key, record]);
    }
    const known = new Set(options.columns);
    const entries = new Map<string, Entry[]>(options.columns.map((column) => [column, []]));
    const unmatched: string[] = [];
    rows.forEach(([key, record], position) => {
        const column = columnValue(record[options.columnField]);
        if (!known.has(column)) {
            if (!unmatched.includes(column)) unmatched.push(column);
            return;
        }
        const order = options.orderField === '' ? undefined : toNumber(record[options.orderField]);
        (entries.get(column) as Entry[]).push({ key, position, order });
    });
    const orders = new Map<string, readonly string[]>();
    for (const [column, list] of entries) {
        list.sort((a, b) => {
            if (a.order !== undefined && b.order !== undefined && a.order !== b.order) return a.order - b.order;
            if ((a.order === undefined) !== (b.order === undefined)) return a.order === undefined ? 1 : -1;
            return a.position - b.position;
        });
        orders.set(column, list.map((entry) => entry.key));
    }
    return { orders, unmatched };
}

/** One write of a move: the record (by key), which of its two fields and the value */
export interface MoveWrite {
    readonly key: string;
    readonly field: 'column' | 'order';
    readonly value: string | number;
}

export interface MovePlan {
    /** The writes that make the move, in the order to apply them; empty when nothing has to change */
    readonly writes: readonly MoveWrite[];
    /** The index the card has in the target column after the writes */
    readonly index: number;
}

export interface MoveInput {
    /** The key of the record that moves */
    readonly key: string;
    /** The column key it is dragged from and to */
    readonly from: string;
    readonly to: string;
    /** The index it should have in the target column, from 0 */
    readonly index: number;
    /** The record keys of the target column in display order now (the moved record included when `from` is `to`) */
    readonly targetKeys: readonly string[];
    /** The value of `orderField` of a record, or `undefined` when it has no number; always `undefined` without an `orderField` */
    readonly orderOf: (key: string) => number | undefined;
    /** Whether the board has an `orderField`: without one a card cannot be put at a place inside a column */
    readonly ordered: boolean;
    /** The place of a record among all the records, for the index a move into a column without an `orderField` ends at */
    readonly positionOf: (key: string) => number;
}

const PRECISION = 1e6;

/**
 * The writes that move a card, and the index it ends at. The column field is written when the column changes; the order
 * field, when the board has one, gets a number between its new neighbours (their average, or one past the end of the list).
 * When the neighbours do not allow that (a record with no number, equal numbers, no room left), the whole column is
 * numbered from 1 in the new order instead. Without an `orderField` a move inside a column writes nothing, and a move into
 * another column ends where the record order puts the card
 */
export function planMove(input: MoveInput): MovePlan {
    const { key, from, to, targetKeys, orderOf } = input;
    const others = targetKeys.filter((candidate) => candidate !== key);
    const writes: MoveWrite[] = [];
    if (from !== to) writes.push({ key, field: 'column', value: to });
    if (!input.ordered) {
        const own = from === to;
        const index = own ? Math.max(0, targetKeys.indexOf(key)) : others.filter((candidate) => input.positionOf(candidate) < input.positionOf(key)).length;
        return { writes, index };
    }
    const index = Math.min(Math.max(0, Math.floor(input.index)), others.length);
    if (from === to && targetKeys.indexOf(key) === index) return { writes: [], index };
    const numbers = others.map((candidate) => orderOf(candidate));
    const before = index > 0 ? numbers[index - 1] : undefined;
    const after = index < others.length ? numbers[index] : undefined;
    const known = numbers.every((value) => value !== undefined);
    let value: number | undefined;
    if (known) {
        if (before !== undefined && after !== undefined) value = before < after ? Math.round(((before + after) / 2) * PRECISION) / PRECISION : undefined;
        else if (before !== undefined) value = before + 1;
        else if (after !== undefined) value = after - 1;
        else value = 1;
        if (value !== undefined && ((before !== undefined && value <= before) || (after !== undefined && value >= after))) value = undefined;
    }
    if (value !== undefined) {
        writes.push({ key, field: 'order', value });
        return { writes, index };
    }
    const next = [...others.slice(0, index), key, ...others.slice(index)];
    next.forEach((candidate, at) => {
        if (orderOf(candidate) !== at + 1) writes.push({ key: candidate, field: 'order', value: at + 1 });
    });
    return { writes, index };
}
