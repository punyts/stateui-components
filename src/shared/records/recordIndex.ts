import type { ControllerContext } from '@punyts/stateui';
import { RUNTIME_PATHS } from '@punyts/stateui-app/core';

/** The store a controller receives */
export type RecordStore = ControllerContext['store'];

/** What a record index is made from */
export interface RecordIndexOptions {
    store: RecordStore;
    /** The records: an array or a keyed map, possibly an alias of the data */
    recordsPath: string;
    /** The optional array of record keys that sets which records show and in what order */
    orderPath: string;
    /** The field of an array record that holds its key (`id`); a keyed map is keyed by its own keys */
    key: string;
    /**
     * Called after the positions or the keys changed, so a pool can show the new ones. `reload` is true when records moved
     * to other array indexes without the store announcing it, so the slots that show them must be pointed again even at the same path
     */
    onChange: (reload: boolean) => void;
}

/** The key-to-position bookkeeping of a record view; the pool asks it which record belongs at a position */
export interface RecordIndex {
    /** The number of positions: the records, or the entries of `order` that name a record */
    size(): number;
    /** The key at a position, or `undefined` when there is none (past the end, or a record with no key) */
    keyAt(position: number): string | undefined;
    /** The store path of the record with that key, or `undefined` when no record has it */
    pathOf(key: string): string | undefined;
    /** The store path of the record with that key, or the shared empty record `$.runtime.empty` */
    locate(key: string): string;
    /** Takes another key field and reads the records again */
    setKey(key: string): void;
    /** Removes every listener */
    dispose(): void;
}

type Kind = 'none' | 'array' | 'map';

const ARRAY_INDEX = /^(?:0|[1-9][0-9]*)$/;

const keyText = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value === '' ? undefined : value;
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
};

const keyOf = (record: unknown, field: string): string | undefined =>
    record !== null && typeof record === 'object' ? keyText((record as Record<string, unknown>)[field]) : undefined;

/**
 * Keeps the key of every record and where it is. For an array it holds a key-to-index map that the store's change
 * events keep current (insert, delete, reorder, replace), so a window move never reads the array to find a record. For a
 * keyed map the key is the map key and the position is the order of the keys. `order` filters and sorts: the positions
 * are its entries that name a record
 */
export function createRecordIndex(options: RecordIndexOptions): RecordIndex {
    const { store, recordsPath, orderPath, onChange } = options;
    let field = options.key;
    let kind: Kind = 'none';
    const indexOfKey = new Map<string, number>();
    const mapKeys: string[] = [];
    const mapKeySet = new Set<string>();
    let knownLength = 0;
    let ordered: string[] | undefined;

    const has = (key: string): boolean => (kind === 'array' ? indexOfKey.has(key) : kind === 'map' && mapKeySet.has(key));

    const arrayLength = (): number => {
        const records = store.get<unknown>(recordsPath);
        return Array.isArray(records) ? records.length : 0;
    };

    const readRecords = (): void => {
        indexOfKey.clear();
        mapKeys.length = 0;
        mapKeySet.clear();
        const records = store.get<unknown>(recordsPath);
        if (Array.isArray(records)) {
            kind = 'array';
            for (let index = 0; index < records.length; index++) {
                const key = keyOf(records[index], field);
                if (key !== undefined) indexOfKey.set(key, index);
            }
            knownLength = records.length;
        } else if (records !== null && typeof records === 'object') {
            kind = 'map';
            for (const key of store.keys(recordsPath)) {
                if (typeof key !== 'string') continue;
                mapKeys.push(key);
                mapKeySet.add(key);
            }
        } else {
            kind = 'none';
        }
    };

    const readOrder = (): void => {
        const order = store.get<unknown>(orderPath);
        if (!Array.isArray(order)) {
            ordered = undefined;
            return;
        }
        const keys: string[] = [];
        for (let index = 0; index < order.length; index++) {
            const key = keyText(order[index]);
            if (key !== undefined && has(key)) keys.push(key);
        }
        ordered = keys;
    };

    const moveKey = (index: number, oldKey: string | undefined, newKey: string | undefined): void => {
        if (oldKey !== undefined && indexOfKey.get(oldKey) === index) indexOfKey.delete(oldKey);
        if (newKey !== undefined) indexOfKey.set(newKey, index);
    };

    /** `store.delete` splices an array element out and reports only its own index, so the followers shift down unannounced */
    const closeGap = (removed: number): void => {
        for (const [key, index] of indexOfKey) if (index > removed) indexOfKey.set(key, index - 1);
    };

    const changed = (reload = false): void => {
        if (ordered !== undefined) readOrder();
        onChange(reload);
    };

    const onElement = (segment: string, value: unknown, oldValue: unknown, action: string): void => {
        if (kind === 'array') {
            if (segment === 'length') {
                knownLength = arrayLength();
                changed();
                return;
            }
            if (!ARRAY_INDEX.test(segment)) return;
            const index = Number(segment);
            if (action === 'delete') {
                moveKey(index, keyOf(oldValue, field), undefined);
                const length = arrayLength();
                const shifted = length === knownLength - 1;
                if (shifted) closeGap(index);
                knownLength = length;
                changed(shifted);
                return;
            } else {
                moveKey(index, keyOf(oldValue, field), keyOf(value, field));
                knownLength = Math.max(knownLength, index + 1);
            }
            changed();
            return;
        }
        if (kind !== 'map') return;
        if (action === 'insert' && !mapKeySet.has(segment)) {
            mapKeySet.add(segment);
            mapKeys.push(segment);
        } else if (action === 'delete' && mapKeySet.delete(segment)) {
            mapKeys.splice(mapKeys.indexOf(segment), 1);
        } else {
            return;
        }
        changed();
    };

    const onRecords = (path: string, value: unknown, oldValue: unknown, action: string): void => {
        if (path === recordsPath) {
            if (action.endsWith('-child')) return;
            readRecords();
            readOrder();
            onChange(false);
            return;
        }
        const segments = path.slice(recordsPath.length + 1).split('.');
        const [segment, rest] = segments;
        if (segment === undefined) return;
        if (segments.length === 1) {
            onElement(segment, value, oldValue, action);
        } else if (segments.length === 2 && rest === field && kind === 'array' && ARRAY_INDEX.test(segment)) {
            moveKey(Number(segment), keyText(oldValue), keyText(value));
            changed();
        }
    };

    const onOrder = (): void => {
        readOrder();
        onChange(false);
    };

    const recordPaths = (): string[] => [recordsPath, `${recordsPath}.$every`, `${recordsPath}.$every.${field}`];
    const orderPaths = [orderPath, `${orderPath}.$all`];
    store.on(recordPaths(), onRecords);
    store.on(orderPaths, onOrder);
    readRecords();
    readOrder();

    const pathOf = (key: string): string | undefined => {
        if (kind === 'array') {
            const index = indexOfKey.get(key);
            return index === undefined ? undefined : `${recordsPath}.${index}`;
        }
        return kind === 'map' && mapKeySet.has(key) ? `${recordsPath}.${key}` : undefined;
    };

    return {
        size() {
            if (ordered !== undefined) return ordered.length;
            return kind === 'array' ? arrayLength() : mapKeys.length;
        },
        keyAt(position) {
            if (ordered !== undefined) return ordered[position];
            if (kind === 'array') return keyText(store.get<unknown>(`${recordsPath}.${position}.${field}`));
            return mapKeys[position];
        },
        pathOf,
        locate: (key) => pathOf(key) ?? RUNTIME_PATHS.empty,
        setKey(key) {
            if (key === field) return;
            store.off(recordPaths(), onRecords);
            field = key;
            store.on(recordPaths(), onRecords);
            readRecords();
            readOrder();
            onChange(false);
        },
        dispose() {
            store.off(recordPaths(), onRecords);
            store.off(orderPaths, onOrder);
        }
    };
}
