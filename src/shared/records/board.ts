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
