import type { ControllerContext } from '@punyts/stateui';
import { RUNTIME_PATHS } from '@punyts/stateui-app/core';

/** The store a controller receives */
export type SelectionStore = ControllerContext['store'];

/** How many records a view lets the user select: none, one, or any number */
export const SELECTION_MODES = ['none', 'single', 'multi'] as const;

export type SelectionMode = (typeof SELECTION_MODES)[number];

/** The mode a stored `selectable` value names; anything else is `none` */
export function readSelectionMode(value: unknown): SelectionMode {
    return value === 'single' || value === 'multi' ? value : 'none';
}

const keyText = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value === '' ? undefined : value;
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
};

/** The keys a stored `selected` value holds (a key, a number or a list of them), without duplicates, in stored order */
export function selectionKeys(value: unknown): string[] {
    const keys = new Set<string>();
    const add = (item: unknown): void => {
        const key = keyText(item);
        if (key !== undefined) keys.add(key);
    };
    if (Array.isArray(value)) value.forEach(add);
    else add(value);
    return [...keys];
}

/** The value to store for a set of keys: a list in `multi` mode, otherwise the first key or `''` for none */
export function selectionValue(mode: SelectionMode, keys: readonly string[]): string | string[] {
    return mode === 'multi' ? [...keys] : (keys[0] ?? '');
}

/** The keys after the user picks `key`: `single` replaces the selection, `multi` toggles the key, `none` changes nothing */
export function pickKey(mode: SelectionMode, keys: readonly string[], key: string): string[] {
    if (mode === 'single') return [key];
    if (mode === 'multi') return keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key];
    return [...keys];
}

/** Whether two key lists hold the same keys in the same order */
export function sameKeys(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((key, i) => key === b[i]);
}

/** What a selection is made from */
export interface SelectionOptions {
    store: SelectionStore;
    /** The `selected` property: a key, or a list of keys in `multi` mode; a link such as `"<-selected": "$.data.picked"` works */
    selectedPath: string;
    /** The runtime path of the `current` link, whose parent must exist (`$.runtime.nodes.<path>.current`) */
    currentPath: string;
    /** The selection mode, read when it is needed */
    mode: () => SelectionMode;
    /** The store path of the record with a key, or `undefined` while the record view cannot tell yet */
    locate: (key: string) => string | undefined;
    /** Called with the keys after `pick`, `selectAll` or `clear` changed them (not after a write to `selected` from elsewhere) */
    onSelect?: (keys: string[]) => void;
}

/** The selection of a record view and the `current` link that follows it */
export interface Selection {
    /** The selected keys, read from `selected` */
    keys(): string[];
    /** The user picked the record with `key`: replaces or toggles by mode and writes `selected` */
    pick(key: string): void;
    /** Selects every key given, in `multi` mode only */
    selectAll(keys: readonly string[]): void;
    /** Empties the selection */
    clear(): void;
    /** Points `current` again, for when records moved, appeared or went */
    relocate(): void;
    /** The path `current` points at now */
    target(): string;
    /** Removes the listener and the `current` link */
    dispose(): void;
}

/**
 * Keeps the selection in `selected` and the store link `current`. In `single` mode `current` points at the record of the
 * selected key, found with `locate`; with no selection, an unknown key or another mode it points at the shared empty
 * record `$.runtime.empty`, which is protected, so a write into `current` is refused and the link is never removed.
 * A change of `selected` from anywhere re-points `current` in the same call; `relocate` is for changes of the records
 */
export function createSelection(options: SelectionOptions): Selection {
    const { store, selectedPath, currentPath, mode, locate, onSelect } = options;
    const selectedPaths = [selectedPath, `${selectedPath}.$all`];
    let pointed = '';

    const keys = (): string[] => selectionKeys(store.get<unknown>(selectedPath));

    const relocate = (): void => {
        const first = mode() === 'single' ? keys()[0] : undefined;
        const found = first === undefined ? undefined : locate(first);
        const target = found ?? RUNTIME_PATHS.empty;
        if (target === pointed) return;
        if (store.link(currentPath, target)) {
            pointed = target;
        } else if (pointed !== RUNTIME_PATHS.empty && store.link(currentPath, RUNTIME_PATHS.empty)) {
            pointed = RUNTIME_PATHS.empty;
        }
    };

    /** The listener on `selected` re-points `current`; `onSelect` is called only when the keys changed */
    const write = (next: readonly string[]): void => {
        const before = keys();
        store.set<unknown>(selectedPath, selectionValue(mode(), next));
        const after = keys();
        if (!sameKeys(before, after)) onSelect?.(after);
    };

    store.on(selectedPaths, relocate);
    relocate();

    return {
        keys,
        pick(key) {
            const current = mode();
            if (current === 'none') return;
            write(pickKey(current, keys(), key));
        },
        selectAll(all) {
            if (mode() !== 'multi') return;
            write(selectionKeys([...all]));
        },
        clear() {
            write([]);
        },
        relocate,
        target: () => pointed,
        dispose() {
            store.off(selectedPaths, relocate);
            store.unlink(currentPath);
        }
    };
}
