import type { ControllerContext } from '@punyts/stateui';
import { runtimePath } from '@punyts/stateui-app/core';
import { createSortOrder, readSortDirection } from '../shared/order/sortOrder.js';
import { readTotal } from '../shared/records/recordIndex.js';
import type { RecordViewElement } from '../shared/records/recordView.js';
import { createSelection, readSelectionMode } from '../shared/selection/selection.js';

/** The properties of the list that its `recordList` body reads through a link, by the body's property name */
const PASSED: Readonly<Record<string, string>> = {
    records: 'items',
    row: 'row',
    key: 'key',
    rowHeight: 'rowHeight',
    total: 'total',
    selected: 'selected',
    window: 'window'
};

/** Elements in a row that act on a press themselves, so a press on them does not select the row */
const INTERACTIVE = new Set(['a', 'button', 'input', 'label', 'select', 'summary', 'textarea']);

interface CommandHost {
    commands?: Record<string, (value?: unknown) => void>;
}

/**
 * The body of the list is a `recordList` node held in the runtime property `body` and drawn with `<sui-node>`. Its
 * `records`, `row`, `key`, `rowHeight`, `total`, `selected` and `window` are store aliases of the list's `items`, `row`, `key`, `rowHeight`, `total` and
 * `selected` (and `window`, which the record view writes, so logic sees it on the list), so the record view reads the list's data and template directly: the slot pool, the `$row` links (rewritten
 * per slot by `resolveRowLinks`), recycling, the key index, the shown selection and the focus movement are the record
 * view's own. The body's runtime branch is `$.runtime.nodes.<path>.body`, beside the list's own runtime state. The links
 * are made before the view draws the body, so the record view's controller finds them; `allowMissing` lets a list with
 * no `items` or `total` mount.
 *
 * Selection: `selectable` sets the body's role (`list`, or `listbox` with `aria-multiselectable`). A press or Space on a
 * row picks its record (`single` replaces, `multi` toggles) and writes `selected`, then raises `select` with the keys;
 * Enter or a double press raises `activate` with the key. The exposed runtime `current` is a store link at
 * `$.runtime.nodes.<path>.current` (aliased at `$.app.<path>.current`) that the selection re-points at the selected
 * record, found with the body's `locate`, or at the protected empty record `$.runtime.empty`.
 *
 * Sort: `sortBy` and `sortDir` give the key array `order`, written into the list's runtime branch and aliased as the
 * body's `order`; the data is not reordered. It is recomputed at most once per animation frame. With `total` set the data is
 * paged and sorting is the source's job: no `order` is computed, and a change of `sortBy` or `sortDir` raises `sort`
 * (`{ sortBy, sortDir }`) once per microtask
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as Element & CommandHost;
    const runtime = runtimePath(basePath);
    const bodyPath = `${basePath}.body`;
    const keyPath = `${basePath}.key`;
    const itemsPath = `${basePath}.items`;
    const selectablePath = `${basePath}.selectable`;
    const sortByPath = `${basePath}.sortBy`;
    const sortDirPath = `${basePath}.sortDir`;
    const totalPath = `${basePath}.total`;
    const currentPath = `${runtime}.current`;
    const currentAlias = `${basePath}.current`;
    const orderPath = `${runtime}.order`;
    let disposed = false;
    let relocating = false;

    const text = (path: string, fallback: string): string => {
        const value = store.get<unknown>(path);
        return typeof value === 'string' && value !== '' ? value : fallback;
    };
    const paged = (): boolean => readTotal(store.get<unknown>(totalPath)) !== undefined;
    const mode = () => readSelectionMode(store.get<unknown>(selectablePath));

    //the store creates no parents, so each missing object between `$.runtime.nodes` and the list's branch is written first
    const segments = runtime.split('.');
    for (let length = 3; length <= segments.length; length++) {
        const prefix = segments.slice(0, length).join('.');
        if (store.get<unknown>(prefix) === undefined) store.set(prefix, {});
    }

    const linked: string[] = [];
    for (const [name, source] of Object.entries(PASSED)) {
        const alias = `${bodyPath}.${name}`;
        if (store.link(alias, `${basePath}.${source}`, { allowMissing: true })) linked.push(alias);
    }
    if (store.link(`${bodyPath}.order`, orderPath, { allowMissing: true })) linked.push(`${bodyPath}.order`);

    const syncRole = (): void => {
        const current = mode();
        const role = current === 'none' ? 'list' : 'listbox';
        if (store.get<unknown>(`${bodyPath}.role`) !== role) store.set(`${bodyPath}.role`, role);
        const multi = current === 'multi';
        if (store.get<unknown>(`${bodyPath}.multiselectable`) !== multi) store.set(`${bodyPath}.multiselectable`, multi);
    };
    syncRole();

    const body = (): RecordViewElement | undefined => {
        const view = element.shadowRoot?.querySelector('.list > sui-node')?.firstElementChild;
        return view ?? undefined;
    };

    const selection = createSelection({
        store,
        selectedPath: `${basePath}.selected`,
        currentPath,
        mode,
        locate: (key) => body()?.locate?.(key),
        onSelect: (keys) => element.dispatchEvent(new CustomEvent('select', { detail: keys, bubbles: true, composed: true }))
    });
    let aliased = false;

    /** The record index of the body updates in its own listeners, so `current` is pointed again once they have run */
    const relocateSoon = (): void => {
        if (relocating) return;
        relocating = true;
        queueMicrotask(() => {
            relocating = false;
            if (!disposed) selection.relocate();
        });
    };
    const recordPaths = (): string[] => [itemsPath, `${itemsPath}.$every`, `${itemsPath}.$every.${text(keyPath, 'id')}`];
    let watchedRecords = recordPaths();
    store.on(watchedRecords, relocateSoon);

    const sort = createSortOrder({
        store,
        recordsPath: itemsPath,
        orderPath,
        key: () => text(keyPath, 'id'),
        sortBy: () => (paged() ? '' : text(sortByPath, '')),
        direction: () => readSortDirection(store.get<unknown>(sortDirPath)),
        schedule: (run) => {
            const id = requestAnimationFrame(run);
            return () => cancelAnimationFrame(id);
        }
    });

    const onKey = (): void => {
        store.off(watchedRecords, relocateSoon);
        watchedRecords = recordPaths();
        store.on(watchedRecords, relocateSoon);
        relocateSoon();
        sort.refresh();
    };
    const onSelectable = (): void => {
        syncRole();
        selection.relocate();
    };
    let raising = false;
    const onSort = (): void => {
        sort.refresh();
        if (!paged() || raising) return;
        raising = true;
        queueMicrotask(() => {
            raising = false;
            if (disposed || !paged()) return;
            const detail = { sortBy: text(sortByPath, ''), sortDir: readSortDirection(store.get<unknown>(sortDirPath)) };
            element.dispatchEvent(new CustomEvent('sort', { detail, bubbles: true, composed: true }));
        });
    };
    const onTotal = (): void => sort.refresh();
    const sortPaths = [sortByPath, sortDirPath];
    store.on([keyPath], onKey);
    store.on([selectablePath], onSelectable);
    store.on(sortPaths, onSort);
    store.on([totalPath], onTotal);

    /**
     * The body renders after the controller has returned, so `current` finds the selected record once it is there. The
     * default of `current` in `$.app` becomes an alias of the runtime link here too: replacing it while the node renders
     * would render the node again
     */
    const start = (attempts: number): void => {
        if (disposed) return;
        if (body()?.locate === undefined) {
            if (attempts > 0) queueMicrotask(() => start(attempts - 1));
            return;
        }
        selection.relocate();
    };
    queueMicrotask(() => {
        if (disposed) return;
        if (store.get<unknown>(currentAlias) !== undefined) store.delete(currentAlias);
        aliased = store.link(currentAlias, currentPath);
        start(8);
    });

    /** The slot element in the body that an event passed through, and the key of the record it shows */
    const rowOf = (event: Event): { slot: HTMLElement; key: string; pressable: boolean } | undefined => {
        const view = body();
        const root = view?.shadowRoot;
        if (!view || !root) return undefined;
        let pressable = true;
        for (const node of event.composedPath()) {
            if (!(node instanceof HTMLElement)) continue;
            if (node.getRootNode() === root && node.classList.contains('slot') && node.dataset['slot'] !== undefined) {
                const position = store.get<unknown>(`${bodyPath}.slots.${node.dataset['slot']}.slotIndex`);
                const key = typeof position === 'number' && position >= 0 ? view.keyAt?.(position) : undefined;
                return key === undefined ? undefined : { slot: node, key, pressable };
            }
            if (INTERACTIVE.has(node.localName) || node.isContentEditable) pressable = false;
        }
        return undefined;
    };
    const activate = (key: string): void => {
        element.dispatchEvent(new CustomEvent('activate', { detail: key, bubbles: true, composed: true }));
    };

    host.commands = {
        clearSelection: () => selection.clear(),
        selectAll: () => selection.selectAll(body()?.recordKeys?.() ?? [])
    };

    return {
        onClick: (event: MouseEvent) => {
            const row = rowOf(event);
            if (row?.pressable === true) selection.pick(row.key);
        },
        onDoubleClick: (event: MouseEvent) => {
            const row = rowOf(event);
            if (row?.pressable === true) activate(row.key);
        },
        onKeyDown: (event: KeyboardEvent) => {
            if (event.altKey || event.ctrlKey || event.metaKey || (event.key !== ' ' && event.key !== 'Enter')) return;
            const row = rowOf(event);
            if (row === undefined || event.composedPath()[0] !== row.slot || (event.key === ' ' && mode() === 'none')) return;
            event.preventDefault();
            if (event.key === 'Enter') activate(row.key);
            else selection.pick(row.key);
        },
        dispose: () => {
            disposed = true;
            store.off(watchedRecords, relocateSoon);
            store.off([keyPath], onKey);
            store.off([selectablePath], onSelectable);
            store.off(sortPaths, onSort);
            store.off([totalPath], onTotal);
            sort.dispose();
            if (aliased) store.unlink(currentAlias);
            selection.dispose();
            for (const alias of linked) store.unlink(alias);
            delete host.commands;
        }
    };
}
