import type { ControllerContext } from '@punyts/stateui';
import { runtimePath } from '@punyts/stateui-app/core';
import { createSortOrder, readSortDirection } from '../shared/order/sortOrder.js';
import { readTotal } from '../shared/records/recordIndex.js';
import type { RecordViewElement } from '../shared/records/recordView.js';
import { createSelection, readSelectionMode } from '../shared/selection/selection.js';
import { checkDraft, draftOf, editableColumns, readEditor } from '../shared/records/cellEdit.js';
import type { CellEditor } from '../shared/records/cellEdit.js';
import { fieldMessage } from '../shared/field/field.js';
import { arrangeView, fillGroupText, GROUP_FIELD, optionLabels, readFilters, readViewColumns, recordLookup } from '../shared/records/tableView.js';
import type { GroupRow } from '../shared/records/tableView.js';
import { groupId, isGroupKey } from '../shared/records/placeholder.js';

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

const PX = /^(0|[1-9][0-9]*)(\.[0-9]+)?px$/;
const PINS = new Set(['start', 'end']);
/** The narrowest a column is resized to, in CSS pixels */
const MIN_WIDTH = 48;
/** How far an arrow key on a resize handle moves the column edge */
const RESIZE_STEP = 16;
const PIN_WIDTH = 'var(--ui-table-pin-width)';
const COLUMN_MIN = 'var(--ui-table-column-min)';

/** One grid track per column: `auto` and `fr` widths are `minmax(0, …)` so every row's grid takes the same tracks whatever its content */
function trackOf(width: unknown): string {
    const value = text(width);
    if (!WIDTH.test(value) || value === 'auto') return 'minmax(0, 1fr)';
    return value.endsWith('fr') ? `minmax(0, ${value})` : value;
}

const pinOf = (column: Entry): string => {
    const pin = text(column['pin']);
    return PINS.has(pin) ? pin : '';
};

/** The fixed width of a pinned column: its pixel width, or the `pin.width` token for any other width, since a sticky offset needs a fixed size */
const pinnedWidth = (width: string): string => (PX.test(width) ? width : PIN_WIDTH);

interface ColumnLayout {
    /** The grid track list, one track per column */
    tracks: string;
    /** The least width the rows take before the body scrolls sideways: pixel and pinned widths, and `column.min` for every other column */
    min: string;
    /** `--table-pin-<index>` for each pinned column: the sum of the pinned widths between it and its edge */
    pins: Record<string, string>;
}

/**
 * The tracks, the least row width and the sticky offsets of the columns, in key order. `widths` overrides a column's width
 * by key, so a drag draws the new width before it is written
 */
function layoutOf(columns: unknown, widths: Readonly<Record<string, string>> = {}): ColumnLayout {
    const list = Object.entries(isEntry(columns) ? columns : {}).filter((entry): entry is [string, Entry] => isEntry(entry[1]));
    if (list.length === 0) return { tracks: 'minmax(0, 1fr)', min: '0px', pins: {} };
    const widthOf = (key: string, column: Entry): string => widths[key] ?? text(column['width']);
    const tracks = list.map(([key, column]) => (pinOf(column) === '' ? trackOf(widthOf(key, column)) : pinnedWidth(widthOf(key, column))));
    const mins = list.map(([key, column]) => {
        const width = widthOf(key, column);
        if (pinOf(column) !== '') return pinnedWidth(width);
        return PX.test(width) ? width : COLUMN_MIN;
    });
    const pins: Record<string, string> = {};
    const offset = (parts: string[]): string => (parts.length === 0 ? '0px' : `calc(${parts.join(' + ')})`);
    let before: string[] = [];
    list.forEach(([key, column], index) => {
        if (pinOf(column) !== 'start') return;
        pins[`--table-pin-${index}`] = offset(before);
        before = [...before, pinnedWidth(widthOf(key, column))];
    });
    let after: string[] = [];
    for (let index = list.length - 1; index >= 0; index--) {
        const [key, column] = list[index] as [string, Entry];
        if (pinOf(column) !== 'end') continue;
        pins[`--table-pin-${index}`] = offset(after);
        after = [...after, pinnedWidth(widthOf(key, column))];
    }
    return { tracks: tracks.join(' '), min: `calc(${mins.join(' + ')})`, pins };
}

/**
 * The row template the body's slot pool copies per slot: a `tableRow` whose `cells` hold one entry per column in key
 * order. A `field` column links the cell's `value` to `$row.<field>` and carries its `format`, `currency` and `fractionDigits`; a `cell`
 * column carries a copy of its node, whose `$row` links and `on` targets the pool resolves like any row template
 */
function rowTemplate(columns: unknown): Entry {
    const cells: Entry = {};
    for (const [key, column] of Object.entries(isEntry(columns) ? columns : {})) {
        if (!isEntry(column)) continue;
        const align = text(column['align']);
        const cell: Entry = { align: ALIGNS.has(align) ? align : 'start' };
        const pin = pinOf(column);
        if (pin !== '') cell['pin'] = pin;
        const editor = readEditor(column);
        if (editor?.kind === 'check') {
            cell['content'] = { node: { component: 'checkbox', _label: text(column['_title']), '<-checked': `$row.${editor.field}` } };
        } else if (isEntry(column['cell'])) {
            cell['content'] = { node: copy(column['cell']) };
        } else {
            if (editor !== undefined) cell['editable'] = true;
            const labels = optionLabels(column['options']);
            if (Object.keys(labels).length > 0) cell['options'] = labels;
            const format = text(column['format']);
            if (FORMATS.has(format)) cell['format'] = format;
            const currency = text(column['currency']);
            if (currency !== '') cell['currency'] = currency;
            const digits = column['fractionDigits'];
            if (typeof digits === 'number') cell['fractionDigits'] = digits;
            cell['text'] = '';
            const field = text(column['field']);
            if (FIELD.test(field)) cell['<-value'] = `$row.${field}`;
        }
        cells[key] = cell;
    }
    return { component: 'tableRow', cells, '<-group': `$row.${GROUP_FIELD}` };
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
 *
 * Columns wider than the table scroll sideways in the body: `--table-min` (pixel and pinned widths, and the `column.min`
 * token for every other column) is the least width of the header row and of the body's rows, and the header follows the
 * body's `scrollLeft`. A column with `pin` `start` or `end` is a sticky cell in the header and in every row, at the offset
 * `--table-pin-<index>` (the widths of the pinned columns between it and its edge); a pinned column without a pixel width
 * takes the `pin.width` token. With `resizable` each header has a handle (`role=separator`): a drag draws the new width
 * as it moves and writes `<width>px` to the column on release, the arrow keys move the edge 16 pixels, no column goes
 * below 48 pixels, and each write raises `columnResize` with `{ column, width }`
 *
 * A column with `edit` and a `field` is edited in place. `check` draws a checkbox in each cell, linked to the field. The
 * others (`text`, `number`, `date`, `select`) open an editor over the cell on a double press or F2 (the first editable
 * column of the focused row), held in the runtime property `editing`: Enter or Tab writes the value when it passes the
 * column's rules (`required`, `minLength`, `maxLength`, `min`, `max`, `step`, `pattern`, the rules of a form field), and
 * Tab or Shift+Tab then opens the next or previous editable cell of the row; Escape closes it unwritten. A value that fails
 * shows the `_errors` message for the rule and stays open; leaving the editor or scrolling the body writes a passing value
 * and drops a failing one. A write goes to the record's own path and raises `edit` with
 * `{ key, column, field, value, previous }`
 *
 * Filters and groups are state, so a paged source can serve them: `filter` is the quick filter (a record passes when the
 * text of any column with a `field` holds it, ignoring case and accents), and `filters` holds a value per column. A
 * column's `filter` (`text` or `select`, a select listing the column's `options`) puts a control in a filter row under
 * the headers that writes `filters.<column>`; each change of `filter` or `filters` raises `filter` with
 * `{ filter, filters }`, and `clearFilters` empties both. `groupBy` names a field: each group's records follow a group
 * row (groups in the order of their value, empty last, and the sort direction when the table sorts by that field), whose
 * label cell (the grouped column, or the first) holds a toggle with `_group` and the count, and whose other cells show
 * each column's `total` (`sum`, `average`, `min`, `max`, `count`) over the group's records that pass the filters. A
 * press, Enter or Space on a group row collapses or expands it, writes `collapsedGroups` (the group values) and raises
 * `groupToggle` with `{ group, collapsed }`. Group rows are keys of the body's `order` that name records in the runtime
 * `groups` map (`src/shared/records/tableView.ts`); they are never selected or edited. With `total` set nothing is
 * filtered or grouped in the browser
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
    const groupsPath = `${runtime}.groups`;
    const filterPath = `${basePath}.filter`;
    const filtersPath = `${basePath}.filters`;
    const groupByPath = `${basePath}.groupBy`;
    const collapsedPath = `${basePath}.collapsedGroups`;
    const filterRowPath = `${basePath}.filterRow`;
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
    if (read(groupsPath) === undefined) store.set(groupsPath, {});
    if (store.link(`${bodyPath}.groups`, groupsPath, { allowMissing: true })) linked.push(`${bodyPath}.groups`);

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

    let pinNames: string[] = [];
    /** Writes the tracks, the least row width and the sticky offsets on the host, for the columns as stored or with a drag's width */
    const drawLayout = (widths?: Readonly<Record<string, string>>): void => {
        const layout = layoutOf(read(columnsPath), widths);
        host.style.setProperty('--table-columns', layout.tracks);
        host.style.setProperty('--table-min', layout.min);
        for (const name of pinNames) if (!(name in layout.pins)) host.style.removeProperty(name);
        for (const [name, value] of Object.entries(layout.pins)) host.style.setProperty(name, value);
        pinNames = Object.keys(layout.pins);
        const pinsEnd = Object.values(isEntry(read(columnsPath)) ? (read(columnsPath) as Entry) : {}).some((column) => isEntry(column) && pinOf(column) === 'end');
        host.toggleAttribute('data-pin-end', pinsEnd);
    };

    const syncColumns = (): void => {
        if (disposed) return;
        const columns = read(columnsPath);
        drawLayout();
        const template = rowTemplate(columns);
        const json = JSON.stringify(template);
        if (json === templateJson) return;
        templateJson = json;
        if (read(`${bodyPath}.row`) === undefined) store.set(`${bodyPath}.row`, template);
        else store.replace(`${bodyPath}.row`, template);
    };

    const filterRowShown = (): boolean => isEntry(read(filterRowPath)) && (read(filterRowPath) as Entry)['show'] === true;
    const syncCount = (): void => {
        if (disposed) return;
        const count = read(countPath);
        host.setAttribute('aria-rowcount', String((typeof count === 'number' ? count : 0) + (filterRowShown() ? 2 : 1)));
    };

    let filterRowJson = '';
    /** Writes the filter row: one cell per column, with the control of a column that has a `filter` and its value in `filters` */
    const syncFilterRow = (): void => {
        if (disposed) return;
        const columns = read(columnsPath);
        const view = readViewColumns(columns);
        const filters = readFilters(read(filtersPath));
        const template = text(read(`${basePath}._filterLabel`));
        const cells: Entry = {};
        let show = false;
        for (const [key, column] of Object.entries(isEntry(columns) ? columns : {})) {
            if (!isEntry(column)) continue;
            const viewColumn = view.find((candidate) => candidate.key === key);
            const kind = viewColumn?.filter ?? 'none';
            if (kind !== 'none') show = true;
            const pin = pinOf(column);
            cells[key] = {
                kind,
                value: filters[key] ?? '',
                label: (template === '' ? 'Filter {column}' : template).split('{column}').join(text(column['_title'])),
                options: kind === 'select' ? (viewColumn?.options ?? {}) : {},
                ...(pin === '' ? {} : { pin })
            };
        }
        const next = { show, cells };
        const json = JSON.stringify(next);
        if (json !== filterRowJson) {
            filterRowJson = json;
            if (read(filterRowPath) === undefined) store.set(filterRowPath, next);
            else store.replace(filterRowPath, next);
        }
        const offset = show ? 2 : 1;
        if (read(`${bodyPath}.rowIndexOffset`) !== offset) store.set(`${bodyPath}.rowIndexOffset`, offset);
        syncCount();
    };

    let groupsJson = '{}';
    const writeGroups = (groups: Record<string, GroupRow>): void => {
        const json = JSON.stringify(groups);
        if (json === groupsJson) return;
        groupsJson = json;
        store.replace(groupsPath, groups);
    };
    const collapsedValues = (): string[] => {
        const value = read(collapsedPath);
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    };
    /** The filter and group step of the order, or `undefined` (and no group rows) when nothing filters or groups or the source is paged */
    const arrangement = () => {
        const quick = text(read(filterPath));
        const filters = readFilters(read(filtersPath));
        const groupField = text(read(groupByPath));
        const groupBy = FIELD.test(groupField) ? groupField : '';
        if (paged() || (quick.trim() === '' && Object.keys(filters).length === 0 && groupBy === '')) {
            writeGroups({});
            return undefined;
        }
        const columns = readViewColumns(read(columnsPath));
        const fields = [...new Set([...columns.map((column) => column.field), ...(groupBy === '' ? [] : [groupBy])])];
        return {
            fields,
            arrange: (keys: string[]): string[] => {
                const lookup = recordLookup(read(itemsPath), keyText());
                const template = text(read(`${basePath}._group`));
                const noValue = text(read(`${basePath}._noValue`));
                const { order, groups } = arrangeView(keys, (key) => lookup.get(key), {
                    columns,
                    quick,
                    filters,
                    groupBy,
                    groupDirection: text(read(sortByPath)) === groupBy ? readSortDirection(read(sortDirPath)) : 'asc',
                    collapsed: new Set(collapsedValues()),
                    emptyLabel: noValue === '' ? 'No value' : noValue,
                    groupText: (label, count) => fillGroupText(template === '' ? '{label} ({count})' : template, label, count)
                });
                writeGroups(groups);
                return order;
            }
        };
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
        },
        arrange: arrangement
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
    const onFilters = (): void => {
        sort.refresh();
        syncFilterRow();
        host.dispatchEvent(new CustomEvent('filter', { detail: { filter: text(read(filterPath)), filters: readFilters(read(filtersPath)) }, bubbles: true, composed: true }));
    };
    const onColumns = (): void => {
        syncColumns();
        syncFilterRow();
        sort.refresh();
    };
    const onTotal = (): void => sort.refresh();

    host.setAttribute('role', 'table');
    syncColumns();
    syncFilterRow();
    const columnPaths = [columnsPath, `${columnsPath}.$all`];
    const sortPaths = [sortByPath, sortDirPath, groupByPath, collapsedPath, `${collapsedPath}.$all`];
    const filterPaths = [filterPath, filtersPath, `${filtersPath}.$all`];
    store.on(columnPaths, onColumns);
    store.on(filterPaths, onFilters);
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
    let scroller: HTMLElement | undefined;
    /** The header scrolls sideways with the body, which owns the sideways scroll so that pinned cells stick to it */
    const onBodyScroll = (): void => {
        const header = element.shadowRoot?.querySelector<HTMLElement>('.header');
        if (header && scroller && header.scrollLeft !== scroller.scrollLeft) header.scrollLeft = scroller.scrollLeft;
        if (editing && !commitEdit()) closeEdit(false);
    };
    const start = (attempts: number): void => {
        if (disposed) return;
        if (body()?.locate === undefined) {
            if (attempts > 0) queueMicrotask(() => start(attempts - 1));
            return;
        }
        selection.relocate();
        scroller = body()?.shadowRoot?.querySelector<HTMLElement>('.list') ?? undefined;
        scroller?.addEventListener('scroll', onBodyScroll, { passive: true });
    };

    /** The column a resize handle sits in, by the handle's `data-key` */
    const resizeTarget = (event: Event): { key: string; head: HTMLElement } | undefined => {
        const handle = event.currentTarget as HTMLElement | null;
        const key = handle?.dataset['key'];
        const head = handle?.closest<HTMLElement>('.head');
        if (key === undefined || !head || read(`${basePath}.resizable`) !== true || !isEntry(read(`${columnsPath}.${key}`))) return undefined;
        return { key, head };
    };
    const rtl = (): boolean => getComputedStyle(host).direction === 'rtl';
    const clampWidth = (width: number): number => Math.max(MIN_WIDTH, Math.round(width));
    /** Writes a column's new width in pixels and raises `columnResize` */
    const writeWidth = (key: string, width: number): void => {
        const value = `${clampWidth(width)}px`;
        store.set(`${columnsPath}.${key}.width`, value);
        host.dispatchEvent(new CustomEvent('columnResize', { detail: { column: key, width: value }, bubbles: true, composed: true }));
    };
    let drag: { key: string; pointer: number; startX: number; startWidth: number; width: number; sign: number } | undefined;

    const editingPath = `${basePath}.editing`;
    let editing: { key: string; column: string; editor: CellEditor; path: string; previous: unknown } | undefined;
    /** The slot of the body that shows the record with a key, if it is drawn */
    const slotOfKey = (key: string): HTMLElement | undefined => {
        const view = body();
        for (const slot of Array.from(view?.shadowRoot?.querySelectorAll<HTMLElement>('.slot[data-slot]') ?? [])) {
            if (slot.hidden) continue;
            const position = read(`${bodyPath}.slots.${slot.dataset['slot'] ?? ''}.slotIndex`);
            if (typeof position === 'number' && position >= 0 && view?.keyAt?.(position) === key) return slot;
        }
        return undefined;
    };
    const cellOf = (slot: HTMLElement | undefined, column: string): HTMLElement | undefined =>
        Array.from(slot?.querySelector('sui-node')?.firstElementChild?.shadowRoot?.querySelectorAll<HTMLElement>('.cell') ?? []).find((cell) => cell.dataset['key'] === column);
    const closeEdit = (focusRow: boolean): void => {
        const key = editing?.key;
        editing = undefined;
        store.replace(editingPath, { column: '' });
        if (focusRow && key !== undefined) slotOfKey(key)?.focus();
    };
    /** Opens the editor of a column over the cell of the record with a key; false when the column has none or the cell is not drawn */
    const openEdit = (key: string, column: string): boolean => {
        const definition = read(`${columnsPath}.${column}`);
        const editor = readEditor(definition);
        const cell = cellOf(slotOfKey(key), column);
        const frame = element.shadowRoot?.querySelector<HTMLElement>('.table');
        const record = isGroupKey(key) ? undefined : body()?.locate?.(key);
        if (editor === undefined || editor.kind === 'check' || !cell || !frame || record === undefined || !isEntry(read(record))) return false;
        const path = `${record}.${editor.field}`;
        const previous = read(path);
        const box = cell.getBoundingClientRect();
        const outer = frame.getBoundingClientRect();
        editing = { key, column, editor, path, previous };
        store.replace(editingPath, {
            column,
            kind: editor.kind,
            draft: draftOf(previous),
            message: '',
            label: isEntry(definition) ? text(definition['_title']) : '',
            required: editor.settings.required,
            options: editor.options,
            top: box.top - outer.top,
            start: rtl() ? outer.right - box.right : box.left - outer.left,
            width: box.width,
            height: box.height
        });
        queueMicrotask(() => element.shadowRoot?.querySelector<HTMLElement>('.edit-control')?.focus());
        return true;
    };
    /** Writes the editor's value when it passes the column's rules, then opens the next (1) or previous (-1) editable cell of the row; false when it fails */
    const commitEdit = (move?: 1 | -1): boolean => {
        if (!editing) return true;
        const checked = checkDraft(editing.editor, text(read(`${editingPath}.draft`)));
        if (checked.rule !== undefined) {
            const message = fieldMessage(read(`${basePath}._errors`), checked.rule);
            store.set(`${editingPath}.message`, message === '' ? checked.rule : message);
            return false;
        }
        const { key, column, editor, path, previous } = editing;
        const unchanged = checked.value === previous || ((previous === undefined || previous === null) && (checked.value === '' || checked.value === null));
        if (!unchanged) {
            store.set(path, checked.value as never);
            host.dispatchEvent(new CustomEvent('edit', { detail: { key, column, field: editor.field, value: checked.value, previous }, bubbles: true, composed: true }));
        }
        closeEdit(move === undefined);
        if (move !== undefined) {
            const columns = editableColumns(read(columnsPath));
            const next = columns[columns.indexOf(column) + move];
            if (next === undefined || !openEdit(key, next)) slotOfKey(key)?.focus();
        }
        return true;
    };
    /** The column of the cell an event passed through, inside a row of the body */
    const columnOf = (event: Event): string | undefined => {
        for (const node of event.composedPath()) {
            if (node instanceof HTMLElement && node.classList.contains('cell') && node.dataset['key'] !== undefined && node.getRootNode() instanceof ShadowRoot) return node.dataset['key'];
        }
        return undefined;
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
    /** Collapses or expands the group of a group row, writes `collapsedGroups` and raises `groupToggle` */
    const toggleGroup = (key: string): void => {
        const info = read(`${groupsPath}.${groupId(key) ?? ''}.${GROUP_FIELD}`);
        if (!isEntry(info) || typeof info['value'] !== 'string') return;
        const group = info['value'];
        const values = collapsedValues();
        const collapsed = !values.includes(group);
        const next = collapsed ? [...values, group] : values.filter((value) => value !== group);
        if (Array.isArray(read(collapsedPath))) store.replace(collapsedPath, next);
        else store.set(collapsedPath, next);
        host.dispatchEvent(new CustomEvent('groupToggle', { detail: { group, collapsed }, bubbles: true, composed: true }));
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
        clearFilters: () => {
            if (read(filterPath) !== '') store.set(filterPath, '');
            if (Object.keys(readFilters(read(filtersPath))).length > 0) store.replace(filtersPath, {});
        },
        selectAll: () => selection.selectAll(body()?.recordKeys?.() ?? [])
    };

    return {
        onClick: (event: MouseEvent) => {
            const row = rowOf(event);
            if (row !== undefined && isGroupKey(row.key)) toggleGroup(row.key);
            else if (row?.pressable === true) selection.pick(row.key);
        },
        onDoubleClick: (event: MouseEvent) => {
            const row = rowOf(event);
            if (row === undefined || isGroupKey(row.key)) return;
            const column = columnOf(event);
            if (column !== undefined && openEdit(row.key, column)) return;
            if (row?.pressable === true) activate(row.key);
        },
        onKeyDown: (event: KeyboardEvent) => {
            if (event.altKey || event.ctrlKey || event.metaKey || (event.key !== ' ' && event.key !== 'Enter' && event.key !== 'F2')) return;
            const row = rowOf(event);
            if (row !== undefined && isGroupKey(row.key)) {
                if (event.key !== 'F2' && event.composedPath()[0] === row.slot) {
                    event.preventDefault();
                    toggleGroup(row.key);
                }
                return;
            }
            if (event.key === 'F2') {
                const first = editableColumns(read(columnsPath))[0];
                if (row !== undefined && event.composedPath()[0] === row.slot && first !== undefined && openEdit(row.key, first)) event.preventDefault();
                return;
            }
            if (row === undefined || event.composedPath()[0] !== row.slot || (event.key === ' ' && mode() === 'none')) return;
            event.preventDefault();
            if (event.key === 'Enter') activate(row.key);
            else selection.pick(row.key);
        },
        onFilterInput: (event: Event) => {
            const control = event.currentTarget as HTMLInputElement | HTMLSelectElement | null;
            const key = control?.dataset['key'];
            if (!control || key === undefined) return;
            const next: Record<string, string> = { ...readFilters(read(filtersPath)) };
            if (control.value.trim() === '') delete next[key];
            else next[key] = control.value;
            if (isEntry(read(filtersPath))) store.replace(filtersPath, next);
            else store.set(filtersPath, next);
        },
        onEditInput: (event: Event) => {
            const control = event.currentTarget as HTMLInputElement | HTMLSelectElement | null;
            if (!editing || !control) return;
            store.set(`${editingPath}.draft`, control.value);
            if (read(`${editingPath}.message`) !== '') store.set(`${editingPath}.message`, '');
        },
        onEditKey: (event: KeyboardEvent) => {
            if (!editing) return;
            event.stopPropagation();
            if (event.key === 'Escape') {
                event.preventDefault();
                closeEdit(true);
            } else if (event.key === 'Enter') {
                event.preventDefault();
                commitEdit();
            } else if (event.key === 'Tab') {
                event.preventDefault();
                commitEdit(event.shiftKey ? -1 : 1);
            }
        },
        onEditBlur: (event: FocusEvent) => {
            const control = event.currentTarget as HTMLElement | null;
            if (!editing || !control?.isConnected) return;
            if (!commitEdit()) closeEdit(false);
        },
        onResizeDown: (event: PointerEvent) => {
            const target = resizeTarget(event);
            if (!target || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            const startWidth = target.head.getBoundingClientRect().width;
            drag = { key: target.key, pointer: event.pointerId, startX: event.clientX, startWidth, width: startWidth, sign: rtl() ? -1 : 1 };
            try {
                (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
            } catch {
                //a pointer the browser does not know (a synthetic event) cannot be captured; the moves still reach the handle
            }
        },
        onResizeMove: (event: PointerEvent) => {
            if (!drag || event.pointerId !== drag.pointer) return;
            drag.width = clampWidth(drag.startWidth + drag.sign * (event.clientX - drag.startX));
            drawLayout({ [drag.key]: `${drag.width}px` });
        },
        onResizeUp: (event: PointerEvent) => {
            if (!drag || event.pointerId !== drag.pointer) return;
            const done = drag;
            drag = undefined;
            if (done.width !== done.startWidth) writeWidth(done.key, done.width);
            else drawLayout();
        },
        onResizeKey: (event: KeyboardEvent) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            const target = resizeTarget(event);
            if (!target) return;
            event.preventDefault();
            event.stopPropagation();
            const grow = (event.key === 'ArrowRight') !== rtl();
            const width = target.head.getBoundingClientRect().width + (grow ? RESIZE_STEP : -RESIZE_STEP);
            writeWidth(target.key, width);
            (event.currentTarget as HTMLElement).setAttribute('aria-valuenow', String(clampWidth(width)));
        },
        onResizeFocus: (event: FocusEvent) => {
            const target = resizeTarget(event);
            if (target) (event.currentTarget as HTMLElement).setAttribute('aria-valuenow', String(clampWidth(target.head.getBoundingClientRect().width)));
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
            store.off(columnPaths, onColumns);
            store.off(filterPaths, onFilters);
            store.off([countPath], syncCount);
            store.off(watchedRecords, relocateSoon);
            store.off([keyPath], onKey);
            store.off([selectablePath], onSelectable);
            store.off(sortPaths, onSort);
            store.off([totalPath], onTotal);
            sort.dispose();
            scroller?.removeEventListener('scroll', onBodyScroll);
            if (aliased) store.unlink(currentAlias);
            selection.dispose();
            for (const alias of linked) store.unlink(alias);
            host.removeAttribute('role');
            host.removeAttribute('aria-rowcount');
            host.style.removeProperty('--table-columns');
            host.style.removeProperty('--table-min');
            host.removeAttribute('data-pin-end');
            for (const name of pinNames) host.style.removeProperty(name);
            delete host.commands;
        }
    };
}
