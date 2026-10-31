import type { ControllerContext } from '@punyts/stateui';

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
    total: 'total'
};

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
 * `rowgroup` and the row index offset 1, so slots are rows with `aria-rowindex` counted after the header row) and drawn with `<sui-node>`, as `list` does. Its `records`, `key` and
 * `total` are store aliases of the table's `items`, `key` and `total`, made before the view draws the body, so the
 * record view's controller finds them. Its `row` is the template built from `columns`, written before the body draws
 * and replaced whenever a column changes: the pool rebuilds the slots for a new structure and only writes the content
 * for a language switch.
 *
 * Column widths become one `--table-columns` track list on the host, which the header row and every `tableRow` use as
 * `grid-template-columns`, so rows line up without measuring. The host is the `table` role and carries
 * `aria-rowcount` (the records plus the header row); the recordList element inside is the body's `rowgroup`. The
 * command `delete`, aimed at `$row` from a cell, deletes the record the row shows
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as HTMLElement & CommandHost;
    const bodyPath = `${basePath}.body`;
    const columnsPath = `${basePath}.columns`;
    const countPath = `${bodyPath}.count`;
    const read = (path: string): unknown => store.get<unknown>(path);
    const linked: string[] = [];
    let disposed = false;
    let templateJson = '';

    for (const [name, source] of Object.entries(PASSED)) {
        const alias = `${bodyPath}.${name}`;
        if (store.link(alias, `${basePath}.${source}`, { allowMissing: true })) linked.push(alias);
    }

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

    host.setAttribute('role', 'table');
    syncColumns();
    syncCount();
    const columnPaths = [columnsPath, `${columnsPath}.$all`];
    store.on(columnPaths, syncColumns);
    store.on([countPath], syncCount);

    host.commands = {
        delete: (_value, _payload, row) => {
            if (typeof row !== 'string' || !isEntry(read(row))) throw new Error('table: delete needs the $row of a cell');
            if (!store.delete(row)) throw new Error(`table: the store refused to delete ${row}`);
        }
    };

    return {
        dispose: () => {
            disposed = true;
            store.off(columnPaths, syncColumns);
            store.off([countPath], syncCount);
            for (const alias of linked) store.unlink(alias);
            host.removeAttribute('role');
            host.removeAttribute('aria-rowcount');
            host.style.removeProperty('--table-columns');
            delete host.commands;
        }
    };
}
