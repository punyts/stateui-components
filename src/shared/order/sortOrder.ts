import type { ControllerContext } from '@punyts/stateui';

/** The store a controller receives */
export type OrderStore = ControllerContext['store'];

/** The directions a view sorts in */
export const SORT_DIRECTIONS = ['asc', 'desc'] as const;

export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/** The direction a stored `sortDir` value names; anything else is `asc` */
export function readSortDirection(value: unknown): SortDirection {
    return value === 'desc' ? 'desc' : 'asc';
}

/** One record as the sort sees it: its key and the value of the sort field */
export interface SortEntry {
    key: string;
    value: unknown;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Numbers and booleans sort as numbers, before text; nothing (`undefined`, `null`, `''`, `NaN`) is ranked last */
const rank = (value: unknown): number => {
    if (typeof value === 'number') return Number.isNaN(value) ? 2 : 0;
    if (typeof value === 'boolean') return 0;
    if (typeof value === 'string') return value === '' ? 2 : 1;
    return value === undefined || value === null ? 2 : 1;
};

/**
 * Compares two field values for an ascending sort: numbers and booleans by value, then text with a numeric, case- and
 * accent-insensitive collation (`a2` before `a10`); anything else is compared as its text
 */
export function compareSortValues(a: unknown, b: unknown): number {
    const left = rank(a);
    const right = rank(b);
    if (left !== right) return left - right;
    if (left === 2) return 0;
    if (left === 0) return Number(a) - Number(b);
    return collator.compare(String(a), String(b));
}

/**
 * The keys of `entries` sorted by value. The sort is stable, so equal values keep their record order in both directions,
 * and values that are nothing stay last in both directions
 */
export function sortedKeys(entries: readonly SortEntry[], direction: SortDirection): string[] {
    const sign = direction === 'desc' ? -1 : 1;
    const indexed = entries.map((entry, index) => ({ entry, index, empty: rank(entry.value) === 2 }));
    indexed.sort((a, b) => {
        if (a.empty !== b.empty) return a.empty ? 1 : -1;
        const compared = a.empty ? 0 : compareSortValues(a.entry.value, b.entry.value) * sign;
        return compared !== 0 ? compared : a.index - b.index;
    });
    return indexed.map((item) => item.entry.key);
}

const keyText = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value === '' ? undefined : value;
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
};

/** The value at a dotted `field` of a record, `undefined` when a step is missing */
export function fieldValue(record: unknown, field: string): unknown {
    let value: unknown = record;
    for (const segment of field.split('.')) {
        if (value === null || typeof value !== 'object') return undefined;
        value = (value as Record<string, unknown>)[segment];
    }
    return value;
}

/**
 * The entries of an array (keyed by the `key` field; a record without a key is left out) or of a keyed map (keyed by its
 * own keys), each with the value of `field`
 */
export function readSortEntries(records: unknown, key: string, field: string): SortEntry[] {
    const entries: SortEntry[] = [];
    if (Array.isArray(records)) {
        for (let index = 0; index < records.length; index++) {
            const record: unknown = records[index];
            const recordKey = record !== null && typeof record === 'object' ? keyText((record as Record<string, unknown>)[key]) : undefined;
            if (recordKey !== undefined) entries.push({ key: recordKey, value: fieldValue(record, field) });
        }
    } else if (records !== null && typeof records === 'object') {
        for (const [recordKey, record] of Object.entries(records as Record<string, unknown>)) entries.push({ key: recordKey, value: fieldValue(record, field) });
    }
    return entries;
}

/** Runs `run` later, once, and returns a function that cancels it */
export type OrderScheduler = (run: () => void) => () => void;

/** What a sort order is made from */
export interface SortOrderOptions {
    store: OrderStore;
    /** The records: an array or a keyed map, possibly an alias of the data */
    recordsPath: string;
    /** Where the key array is written (a runtime path); it is deleted while there is no sort field */
    orderPath: string;
    /** The field of an array record that holds its key */
    key: () => string;
    /** The (possibly dotted) field to sort by; `''` for no sort */
    sortBy: () => string;
    direction: () => SortDirection;
    /** Coalesces the recomputes; a record view passes one animation frame */
    schedule: OrderScheduler;
}

/** The sorted key array of a record view, kept current from the store events */
export interface SortOrder {
    /** Reads the key field, the sort field and the direction again and schedules a recompute */
    refresh(): void;
    /** Recomputes now, cancelling a scheduled recompute */
    compute(): void;
    /** Removes the listeners and cancels a scheduled recompute; `order` is left as it is */
    dispose(): void;
}

/**
 * Writes the key array `order` that sorts the records by `sortBy` in `direction`, for a record view to show (the data
 * array is never reordered). It listens to the records path (an insert, a delete, a reorder or a replace of the records)
 * and to one wildcard path `<records>.$every.<sortBy>` (a change of the sort field in one record), so a change to any
 * other field costs nothing. Changes are coalesced into one recompute per `schedule` call; the first order is written at
 * once, so a view mounts sorted
 */
export function createSortOrder(options: SortOrderOptions): SortOrder {
    const { store, recordsPath, orderPath, key, sortBy, direction, schedule } = options;
    let watched: string[] = [];
    let cancel: (() => void) | undefined;

    const compute = (): void => {
        cancel?.();
        cancel = undefined;
        const field = sortBy();
        if (field === '') {
            if (store.get<unknown>(orderPath) !== undefined) store.delete(orderPath);
            return;
        }
        const keys = sortedKeys(readSortEntries(store.get<unknown>(recordsPath), key(), field), direction());
        //`set` over an existing array writes it element by element, one event each; `replace` is one event
        if (Array.isArray(store.get<unknown>(orderPath))) store.replace(orderPath, keys);
        else store.set(orderPath, keys);
    };

    const onRecords = (): void => {
        cancel ??= schedule(compute);
    };

    const listen = (): void => {
        if (watched.length > 0) store.off(watched, onRecords);
        const field = sortBy();
        watched = field === '' ? [] : [recordsPath, `${recordsPath}.$every.${field}`];
        if (watched.length > 0) store.on(watched, onRecords);
    };

    listen();
    compute();

    return {
        refresh() {
            listen();
            cancel ??= schedule(compute);
        },
        compute,
        dispose() {
            cancel?.();
            cancel = undefined;
            if (watched.length > 0) store.off(watched, onRecords);
            watched = [];
        }
    };
}
