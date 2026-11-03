import type { ControllerContext } from '@punyts/stateui';
import { runtimePath } from '@punyts/stateui-app/core';
import { createSortOrder, readSortDirection } from '../shared/order/sortOrder.js';
import { readTotal } from '../shared/records/recordIndex.js';
import type { RecordViewElement } from '../shared/records/recordView.js';
import { createSelection, readSelectionMode } from '../shared/selection/selection.js';

type Entry = Record<string, unknown>;

interface CommandHost {
    commands?: Record<string, (value?: unknown, payload?: unknown, row?: string) => void>;
}

const ALIGNS = new Set(['start', 'center', 'end']);
const FORMATS = new Set(['number', 'percent', 'currency', 'duration']);
const WIDTH = /^(auto|(0|[1-9][0-9]*)(\.[0-9]+)?(fr|px|%))$/;
const FIELD = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/** The properties of the table that its `recordList` body reads through a link, by the body's property name */
const PASSED: Readonly<Record<string, string>> = {
    records: 'items',
    key: 'key',
    total: 'total',
    selected: 'selected',
    window: 'window'
};

/** Elements in a row that act on a press themselves, so a press on them does not select the row */
const INTERACTIVE = new Set(['a', 'button', 'input', 'label', 'select', 'summary', 'textarea']);

const isEntry = (value: unknown): value is Entry => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** One grid track per column: `auto` and `fr` widths are `minmax(0, …)` so every row's grid takes the same tracks whatever its content */
function trackOf(width: unknown): string {
    const value = text(width);
    if (!WIDTH.test(value) || value === 'auto') return 'minmax(0, 1fr)';
    return value.endsWith('fr') ? `minmax(0, ${value})` : value;
}

/**
 * The row template the body's slot pool copies per slot: a `tableRow` whose `cells` hold one entry per column in key
 * order. A `field` column links the cell's `value` to `$row.<field>` and carries its `format` and `currency`; a `cell`
 * column carries a copy of its node, whose `$row` links and `on` targets the pool resolves like any row template
 */
function rowTemplate(columns: unknown): Entry {
    const cells: Entry = {};
    for (const [key, column] of Object.entries(isEntry(columns) ? columns : {})) {
        if (!isEntry(column)) continue;
        const align = text(column['align']);
        const cell: Entry = { align: ALIGNS.has(align) ? align : 'start' };
        if (isEntry(column['cell'])) {
            cell['content'] = { node: copy(column['cell']) };
        } else {
            const format = text(column['format']);
            if (FORMATS.has(format)) cell['format'] = format;
            const currency = text(column['currency']);
            if (currency !== '') cell['currency'] = currency;
            cell['text'] = '';
            const field = text(column['field']);
            if (FIELD.test(field)) cell['<-value'] = `$row.${field}`;
        }
        cells[key] = cell;
    }
    return { component: 'tableRow', cells };
}

/**
 * The table's body is a `recordList` node held in the runtime property `body` (its default is the node, with the role
 * `rowgroup` and the row index offset 1, so slots are rows with `aria-rowindex` counted after the header row) and drawn with `<sui-node>`, as `list` does. Its `records`, `key`,
 * `total`, `selected` and `window` are store aliases of the same table properties (`records` of `items`), made before the view draws the body, so the
 * record view's controller finds them. Its `row` is the template built from `columns`, written before the body draws
 * and replaced whenever a column changes: the pool rebuilds the slots for a new structure and only writes the content
 * for a language switch.
 *
 * Column widths become one `--table-columns` track list on the host, which the header row and every `tableRow` use as
 * `grid-template-columns`, so rows line up without measuring. The host is the `table` role and carries
 * `aria-rowcount` (the records plus the header row); the recordList element inside is the body's `rowgroup`. The
 * command `delete`, aimed at `$row` from a cell, deletes the record the row shows.
 *
 * Selection is the list's, through the same `createSelection`: `selectable` (`none`, `single`, `multi`) marks the body's
 * rows `aria-selected`, a press or Space on a row picks its record and writes `selected`, then raises `select`; Enter or a
 * double press raises `activate`; the exposed runtime link `current` follows the selected record. Sort is the list's
 * too, through `createSortOrder`: `sortBy` and `sortDir` give the key array `order` in the table's runtime branch, aliased
 * as the body's `order`, so the data is not reordered and a selection survives a sort (it is held by key). A press on a
 * `sortable` column header with a `field` sorts by that field ascending, or flips the direction when it already sorts
 * the table, and raises `sort` with `{ sortBy, sortDir }`. With `total` set the data is paged and the source sorts: no `order`
 * is computed, and the header press still writes `sortBy` and `sortDir` (so the header shows them) and raises `sort`
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as HTMLElement & CommandHost;
    const bodyPath = `${basePath}.body`;
    const columnsPath = `${basePath}.columns`;
    const countPath = `${bodyPath}.count`;
    const keyPath = `${basePath}.key`;
    const itemsPath = `${basePath}.items`;
    const selectablePath = `${basePath}.selectable`;
    const sortByPath = `${basePath}.sortBy`;
    const sortDirPath = `${basePath}.sortDir`;
    const totalPath = `${basePath}.total`;
    const runtime = runtimePath(basePath);
    const currentPath = `${runtime}.current`;
    const currentAlias = `${basePath}.current`;
    const orderPath = `${runtime}.order`;
    const read = (path: string): unknown => store.get<unknown>(path);
    const linked: string[] = [];
    let disposed = false;
    let templateJson = '';
    let relocating = false;
    let aliased = false;
    const keyText = (): string => {
        const value = read(keyPath);
        return typeof value === 'string' && value !== '' ? value : 'id';
    };
    const paged = (): boolean => readTotal(read(totalPath)) !== undefined;
    const mode = () => readSelectionMode(read(selectablePath));

    //the store creates no parents, so each missing object between `$.runtime.nodes` and the table's branch is written first
    const segments = runtime.split('.');
    for (let length = 3; length <= segments.length; length++) {
        const prefix = segments.slice(0, length).join('.');
        if (read(prefix) === undefined) store.set(prefix, {});
    }

    for (const [name, source] of Object.entries(PASSED)) {
        const alias = `${bodyPath}.${name}`;
        if (store.link(alias, `${basePath}.${source}`, { allowMissing: true })) linked.push(alias);
    }
    if (store.link(`${bodyPath}.order`, orderPath, { allowMissing: true })) linked.push(`${bodyPath}.order`);

    const syncSelectable = (): void => {
        if (disposed) return;
        const selectable = mode() !== 'none';
        if (read(`${bodyPath}.selectable`) !== selectable) store.set(`${bodyPath}.selectable`, selectable);
    };
    syncSelectable();

    const body = (): RecordViewElement | undefined => {
        const view = element.shadowRoot?.querySelector('.body > sui-node')?.firstElementChild;
        return view ?? undefined;
    };

    const syncColumns = (): void => {
        if (disposed) return;
        const columns = read(columnsPath);
        const list = isEntry(columns) ? Object.values(columns).filter(isEntry) : [];
        host.style.setProperty('--table-columns', list.length === 0 ? 'minmax(0, 1fr)' : list.map((column) => trackOf(column['width'])).join(' '));
        const template = rowTemplate(columns);
        const json = JSON.stringify(template);
        if (json === templateJson) return;
        templateJson = json;
        if (read(`${bodyPath}.row`) === undefined) store.set(`${bodyPath}.row`, template);
        else store.replace(`${bodyPath}.row`, template);
    };

    const syncCount = (): void => {
        if (disposed) return;
        const count = read(countPath);
        host.setAttribute('aria-rowcount', String((typeof count === 'number' ? count : 0) + 1));
    };

    const selection = createSelection({
        store,
        selectedPath: `${basePath}.selected`,
        currentPath,
        mode,
        locate: (key) => body()?.locate?.(key),
        onSelect: (keys) => host.dispatchEvent(new CustomEvent('select', { detail: keys, bubbles: true, composed: true }))
    });

    /** The record index of the body updates in its own listeners, so `current` is pointed again once they have run */
    const relocateSoon = (): void => {
        if (relocating) return;
        relocating = true;
        queueMicrotask(() => {
            relocating = false;
            if (!disposed) selection.relocate();
        });
    };
    const recordPaths = (): string[] => [itemsPath, `${itemsPath}.$every`, `${itemsPath}.$every.${keyText()}`];
    let watchedRecords = recordPaths();
    store.on(watchedRecords, relocateSoon);

    const sort = createSortOrder({
        store,
        recordsPath: itemsPath,
        orderPath,
        key: keyText,
        sortBy: () => (paged() ? '' : text(read(sortByPath))),
        direction: () => readSortDirection(read(sortDirPath)),
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
        syncSelectable();
        selection.relocate();
    };
    const onSort = (): void => sort.refresh();
    const onTotal = (): void => sort.refresh();

    host.setAttribute('role', 'table');
    syncColumns();
    syncCount();
    const columnPaths = [columnsPath, `${columnsPath}.$all`];
    const sortPaths = [sortByPath, sortDirPath];
    store.on(columnPaths, syncColumns);
    store.on([countPath], syncCount);
    store.on([keyPath], onKey);
    store.on([selectablePath], onSelectable);
    store.on(sortPaths, onSort);
    store.on([totalPath], onTotal);

    /**
     * The body renders after the controller has returned, so `current` finds the selected record once it is there. The
     * default of `current` in `$.app` becomes an alias of the runtime link in the first microtask: replacing it while
     * the node renders would render the node again
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
        if (read(currentAlias) !== undefined) store.delete(currentAlias);
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
                const position = read(`${bodyPath}.slots.${node.dataset['slot']}.slotIndex`);
                const key = typeof position === 'number' && position >= 0 ? view.keyAt?.(position) : undefined;
                return key === undefined ? undefined : { slot: node, key, pressable };
            }
            if (INTERACTIVE.has(node.localName) || node.isContentEditable) pressable = false;
        }
        return undefined;
    };
    const activate = (key: string): void => {
        host.dispatchEvent(new CustomEvent('activate', { detail: key, bubbles: true, composed: true }));
    };

    host.commands = {
        delete: (_value, _payload, row) => {
            if (typeof row !== 'string' || !isEntry(read(row))) throw new Error('table: delete needs the $row of a cell');
            if (!store.delete(row)) throw new Error(`table: the store refused to delete ${row}`);
        },
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
        onSortHeader: (event: Event) => {
            const columnKey = (event.currentTarget as HTMLElement | null)?.dataset['key'];
            const columns = read(columnsPath);
            const column = columnKey !== undefined && isEntry(columns) ? columns[columnKey] : undefined;
            const field = isEntry(column) ? text(column['field']) : '';
            if (!isEntry(column) || column['sortable'] !== true || !FIELD.test(field)) return;
            const direction = text(read(sortByPath)) === field && readSortDirection(read(sortDirPath)) === 'asc' ? 'desc' : 'asc';
            store.set(sortDirPath, direction);
            store.set(sortByPath, field);
            host.dispatchEvent(new CustomEvent('sort', { detail: { sortBy: field, sortDir: direction }, bubbles: true, composed: true }));
        },
        dispose: () => {
            disposed = true;
            store.off(columnPaths, syncColumns);
            store.off([countPath], syncCount);
            store.off(watchedRecords, relocateSoon);
            store.off([keyPath], onKey);
            store.off([selectablePath], onSelectable);
            store.off(sortPaths, onSort);
            store.off([totalPath], onTotal);
            sort.dispose();
            if (aliased) store.unlink(currentAlias);
            selection.dispose();
            for (const alias of linked) store.unlink(alias);
            host.removeAttribute('role');
            host.removeAttribute('aria-rowcount');
            host.style.removeProperty('--table-columns');
            delete host.commands;
        }
    };
}
