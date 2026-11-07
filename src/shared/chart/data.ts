import { toNumber } from '../format/format.js';

/** One entry of a chart's `series` map: its key, the record field it reads and its label */
export interface SeriesSpec {
    readonly key: string;
    readonly field: string;
    readonly label: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The records in display order: an array as it is, a keyed map in key order; anything that is not an object is left out */
export function readRows(records: unknown): Record<string, unknown>[] {
    const values = Array.isArray(records) ? (records as unknown[]) : isRecord(records) ? Object.values(records) : [];
    return values.filter(isRecord);
}

/**
 * The key of each record `readRows` keeps, in the same order: an array's index as a string (the index in the array, so a
 * left-out entry does not shift the keys after it), a keyed map's key. A chart's `press` names a mark's record by it
 */
export function readKeys(records: unknown): string[] {
    const entries: [string, unknown][] = Array.isArray(records) ? (records as unknown[]).map((value, at) => [String(at), value]) : isRecord(records) ? Object.entries(records) : [];
    return entries.filter(([, value]) => isRecord(value)).map(([key]) => key);
}

/** The series in key order. An entry with no `field` reads the field named like its key; a label defaults to the key */
export function readSeries(series: unknown): SeriesSpec[] {
    if (!isRecord(series)) return [];
    return Object.entries(series)
        .filter(([, entry]) => isRecord(entry))
        .map(([key, entry]) => {
            const spec = entry as Record<string, unknown>;
            const field = typeof spec['field'] === 'string' && spec['field'] !== '' ? spec['field'] : key;
            const label = typeof spec['_label'] === 'string' && spec['_label'] !== '' ? spec['_label'] : key;
            return { key, field, label };
        });
}

/** The category of each record: the text of its `x` field, or its position from 1 when that field is empty */
export function readCategories(rows: readonly Record<string, unknown>[], x: string): string[] {
    return rows.map((row, at) => {
        const value = row[x];
        if (typeof value === 'string' && value !== '') return value;
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        return String(at + 1);
    });
}

/** The numbers a series reads from the records; a value that is not a number counts as 0 */
export function readValues(rows: readonly Record<string, unknown>[], field: string): number[] {
    return rows.map((row) => toNumber(row[field]) ?? 0);
}

/**
 * A number formatter that formats each value once and gives the same text again for it: a chart writes a value in its
 * mark's name, in every tooltip row of its category and in the data table, and `Intl` formatting is the slow part of a
 * big series. Make one per draw, so a change of locale or format is not mixed with the last one
 */
export function formatOnce(format: (value: number) => string): (value: number) => string {
    const done = new Map<number, string>();
    return (value) => {
        let text = done.get(value);
        if (text === undefined) {
            text = format(value);
            done.set(value, text);
        }
        return text;
    };
}
