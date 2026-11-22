import type { ControllerContext } from '@punyts/stateui';
import { compareSortValues, fieldValue, isSortNothing } from '@punyts/stateui-app/core';
import type { SortDirection } from '@punyts/stateui-app/core';

export { SORT_DIRECTIONS, compareSortValues, fieldValue } from '@punyts/stateui-app/core';
export type { SortDirection } from '@punyts/stateui-app/core';

/** The store a controller receives */
export type OrderStore = ControllerContext['store'];

/** The direction a stored `sortDir` value names; anything else is `asc` */
export function readSortDirection(value: unknown): SortDirection {
    return value === 'desc' ? 'desc' : 'asc';
}

/** One record as the sort sees it: its key and the value of the sort field */
export interface SortEntry {
    key: string;
    value: unknown;
}

/**
 * The keys of `entries` sorted by value. The sort is stable, so equal values keep their record order in both directions,
 * and values that are nothing stay last in both directions
 */
export function sortedKeys(entries: readonly SortEntry[], direction: SortDirection): string[] {
    const sign = direction === 'desc' ? -1 : 1;
    const indexed = entries.map((entry, index) => ({ entry, index, empty: isSortNothing(entry.value) }));
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

/** A step after the sort that filters or regroups the keys, with the record fields it reads */
export interface OrderArrangement {
    /** The (possibly dotted) fields the step reads, watched in every record */
    fields: readonly string[];
    /** The keys to show, from the record keys in sort order (or record order without a sort field) */
    arrange(keys: string[]): string[];
}

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
    /** The optional step after the sort, read again at each recompute and refresh; `undefined` for none */
    arrange?: () => OrderArrangement | undefined;
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
 * once, so a view mounts sorted. With an `arrange` step the order is written even without a sort field: the step gets the
 * keys in sort (or record) order and returns the keys to show, and the fields it names are watched too
 */
export function createSortOrder(options: SortOrderOptions): SortOrder {
    const { store, recordsPath, orderPath, key, sortBy, direction, schedule, arrange } = options;
    let watched: string[] = [];
    let cancel: (() => void) | undefined;

    const compute = (): void => {
        cancel?.();
        cancel = undefined;
        const field = sortBy();
        const arrangement = arrange?.();
        if (field === '' && arrangement === undefined) {
            if (store.get<unknown>(orderPath) !== undefined) store.delete(orderPath);
            return;
        }
        const entries = readSortEntries(store.get<unknown>(recordsPath), key(), field === '' ? key() : field);
        const sorted = field === '' ? entries.map((entry) => entry.key) : sortedKeys(entries, direction());
        const keys = arrangement === undefined ? sorted : arrangement.arrange(sorted);
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
        const fields = new Set(arrange?.()?.fields ?? []);
        if (field !== '') fields.add(field);
        watched = fields.size === 0 ? [] : [recordsPath, ...[...fields].map((name) => `${recordsPath}.$every.${name}`)];
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
