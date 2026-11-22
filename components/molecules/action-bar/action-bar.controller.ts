import type { ControllerContext } from '@punyts/stateui';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** How many records a `selected` value holds: the length of an array, one for a key, none for an empty key or no value */
function countOf(selected: unknown): number {
    if (Array.isArray(selected)) return selected.length;
    if (typeof selected === 'number') return Number.isFinite(selected) ? 1 : 0;
    return typeof selected === 'string' && selected !== '' ? 1 : 0;
}

/**
 * Keeps the runtime properties `count` (the records `selected` holds, usually a link to a table's or list's `selected`)
 * and `countText` (`_count` with `{count}` filled) in step; the view shows the bar only while `count` is above zero. A
 * press on an action raises `action` with the action's key; the clear button raises `clear`, which an app points at the
 * table's `clearSelection` command
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const selectedPath = `${basePath}.selected`;
    const countTextPath = `${basePath}._count`;
    const watched = [selectedPath, `${selectedPath}.$all`, countTextPath];

    const sync = (): void => {
        const count = countOf(store.get<unknown>(selectedPath));
        if (store.get<unknown>(`${basePath}.count`) !== count) store.set(`${basePath}.count`, count);
        const shown = text(store.get<unknown>(countTextPath)).replace('{count}', String(count));
        if (store.get<unknown>(`${basePath}.countText`) !== shown) store.set(`${basePath}.countText`, shown);
    };
    const raise = (name: string, detail?: unknown): void => {
        element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
    };
    store.on(watched, sync);
    sync();
    return {
        onAction: (event: Event) => {
            const key = (event.currentTarget as HTMLElement | null)?.dataset['key'];
            if (key !== undefined) raise('action', key);
        },
        onClear: () => raise('clear'),
        dispose: () => store.off(watched, sync)
    };
}
