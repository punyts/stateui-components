import { report } from '@punyts/core';
import type { ControllerContext } from '@punyts/stateui';
import { runtimePath } from '@punyts/stateui-app/core';
import { buildBoard } from '../shared/records/board.js';

/** The properties of the board that a column body reads through a link, by the body's property name */
const PASSED: Readonly<Record<string, string>> = {
    records: 'records',
    row: 'card',
    key: 'key'
};

/** A column of the board: the value of `columnField` that puts a record in it, its title and its limit */
interface Column {
    readonly key: string;
    readonly title: string;
    readonly limit: number;
}

const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The `badge` node that shows the number of cards of a column: warning and solid past the limit */
const badgeNode = (text: string, over: boolean): Record<string, unknown> => ({ component: 'badge', size: 'sm', tone: over ? 'warning' : 'neutral', variant: over ? 'solid' : 'soft', _text: text });

/** The `recordList` node of one column body: the card list, with no selection and the role `list` */
const bodyNode = (): Record<string, unknown> => ({
    component: 'recordList',
    rowHeight: 'md',
    overscan: 5,
    role: 'list',
    multiselectable: false,
    selectable: false,
    loading: false,
    count: 0,
    slots: {},
    loadingRows: 0,
    loadingFirst: 0
});

/**
 * Draws a column per key of `columns`; the key is the value of `columnField` that puts a record in the column. Each column
 * body is a `recordList` node in the runtime property `cols` (`cols.<name>.body.main`), drawn with `<sui-node>` like the
 * body of a `list`: its `records`, `row` and `key` are store aliases of the board's `records`, `card` and `key`, so the slot
 * pool, the `$row` links and the recycling are the record view's, and a column of 2,000 cards holds only the slots that fit
 * the viewport. The board turns the records into one `order` per column (`buildBoard`, in `src/shared/records/board.ts`: the
 * records with that column value, sorted by `orderField`), written as a runtime array aliased as the body's `order`, so
 * writing a record's `columnField` in the data moves its card by changing two orders.
 *
 * A column keeps its body for as long as the board lives. A key that leaves `columns` hides its column (`gone`, laid out of the flow but at its size, with an empty
 * order) and a key that returns shows it again, because taking a record view out of the document while it is drawn would
 * delete its slot nodes before the view has let go of them. The columns are drawn in the order of `columns` (`position`,
 * a CSS `order`), so a column added later is placed by its key, not by when it appeared.
 *
 * A record whose value matches no column is not shown, and the board reports it once per distinct value as `SUI-RUN-BINDING`
 * (a warning), because the data is not known to the static validator. The header of a column shows its title (the content
 * `_title` of the column), the number of cards, and the limit when `limit` is above 0, in a `badge` (so the tone colours are the
 * shared articulation's, not this board's); past the limit the badge has `tone="warning"`, the header is `data-tone="warning"` and
 * carries the content `_limitExceeded` as hidden text
 */
export default function controller({ store, basePath }: ControllerContext) {
    const runtime = runtimePath(basePath);
    const colsPath = `${basePath}.cols`;
    const ordersPath = `${runtime}.orders`;
    const recordsPath = `${basePath}.records`;
    const columnsPath = `${basePath}.columns`;
    const fieldNames = ['key', 'columnField', 'orderField'] as const;
    let disposed = false;
    let scheduled = false;
    let started = false;
    const reported = new Set<string>();
    const names = new Map<string, string>();
    const aliases: string[] = [];

    const text = (name: string, fallback: string): string => {
        const value = store.get<unknown>(`${basePath}.${name}`);
        return typeof value === 'string' && value !== '' ? value : fallback;
    };
    const readColumns = (): Column[] => {
        const map = store.get<unknown>(columnsPath);
        const entries = isRecord(map) ? Object.entries(map) : [];
        return entries.map(([key, entry]) => {
            const spec = isRecord(entry) ? entry : {};
            const limit = typeof spec['limit'] === 'number' && Number.isFinite(spec['limit']) ? Math.max(0, Math.floor(spec['limit'])) : 0;
            const title = typeof spec['_title'] === 'string' && spec['_title'] !== '' ? spec['_title'] : key;
            return { key, title, limit };
        });
    };
    /** The name a column is stored under: its key when a path can hold it, otherwise a number; it never changes for a key */
    const nameOf = (key: string): string => {
        const known = names.get(key);
        if (known !== undefined) return known;
        const name = SAFE_KEY.test(key) ? `k_${key}` : `u${names.size}`;
        names.set(key, name);
        return name;
    };

    //the store creates no parents, so each missing object between `$.runtime.nodes` and the board's branch is written first
    const segments = runtime.split('.');
    for (let length = 3; length <= segments.length; length++) {
        const prefix = segments.slice(0, length).join('.');
        if (store.get<unknown>(prefix) === undefined) store.set(prefix, {});
    }

    /**
     * The column is stored with `ready: false` and its body node, which the view does not draw yet; the aliases of the body
     * are linked, and only then `ready` is written, so the record view finds its data when it starts, also for a column
     * added after the board is drawn
     */
    const addColumn = (column: Column, name: string): void => {
        store.set(`${colsPath}.${name}`, { key: column.key, title: column.title, count: 0, limit: column.limit, over: false, gone: false, position: 0, ready: false, badge: { main: badgeNode('0', false) }, body: { main: bodyNode() } });
        const bodyPath = `${colsPath}.${name}.body.main`;
        for (const [property, source] of Object.entries(PASSED)) {
            const alias = `${bodyPath}.${property}`;
            if (store.link(alias, `${basePath}.${source}`, { allowMissing: true })) aliases.push(alias);
        }
        store.set(`${ordersPath}.${name}`, []);
        const orderAlias = `${bodyPath}.order`;
        if (store.link(orderAlias, `${ordersPath}.${name}`, { allowMissing: true })) aliases.push(orderAlias);
        store.set(`${colsPath}.${name}.ready`, true);
    };

    const setIfChanged = (path: string, value: unknown): void => {
        if (store.get<unknown>(path) !== value) store.set(path, value);
    };
    const showBadge = (base: string, label: string, over: boolean): void => {
        const badge = badgeNode(label, over);
        for (const property of ['_text', 'tone', 'variant']) setIfChanged(`${base}.badge.main.${property}`, badge[property]);
    };
    const writeOrder = (name: string, keys: readonly string[]): void => {
        const path = `${ordersPath}.${name}`;
        const current = store.get<unknown>(path);
        if (Array.isArray(current) && current.length === keys.length && keys.every((key, at) => current[at] === key)) return;
        //a replace announces the new order once; a set would announce every position
        store.replace(path, [...keys]);
    };

    const show = (): void => {
        if (!started) {
            started = true;
            store.set(colsPath, {});
            store.set(ordersPath, {});
        }
        const columns = readColumns();
        const current = new Set(columns.map((column) => column.key));
        const model = buildBoard(store.get<unknown>(recordsPath), {
            key: text('key', 'id'),
            columnField: text('columnField', 'column'),
            orderField: text('orderField', ''),
            columns: columns.map((column) => column.key)
        });
        columns.forEach((column, position) => {
            const name = nameOf(column.key);
            if (store.get<unknown>(`${colsPath}.${name}`) === undefined) addColumn(column, name);
            const keys = model.orders.get(column.key) ?? [];
            writeOrder(name, keys);
            const base = `${colsPath}.${name}`;
            setIfChanged(`${base}.title`, column.title);
            setIfChanged(`${base}.limit`, column.limit);
            setIfChanged(`${base}.count`, keys.length);
            const over = column.limit > 0 && keys.length > column.limit;
            setIfChanged(`${base}.over`, over);
            showBadge(base, column.limit > 0 ? `${keys.length} / ${column.limit}` : String(keys.length), over);
            setIfChanged(`${base}.position`, position);
            setIfChanged(`${base}.gone`, false);
        });
        for (const [key, name] of names) {
            if (current.has(key) || store.get<unknown>(`${colsPath}.${name}`) === undefined) continue;
            writeOrder(name, []);
            setIfChanged(`${colsPath}.${name}.count`, 0);
            setIfChanged(`${colsPath}.${name}.over`, false);
            showBadge(`${colsPath}.${name}`, '0', false);
            setIfChanged(`${colsPath}.${name}.gone`, true);
        }
        for (const value of [...reported]) if (!model.unmatched.includes(value)) reported.delete(value);
        for (const value of model.unmatched) {
            if (reported.has(value)) continue;
            reported.add(value);
            report.warning(`board: the records with ${text('columnField', 'column')} "${value}" are in no column, so they are not shown`, { code: 'SUI-RUN-BINDING', path: basePath });
        }
    };

    const refresh = (): void => {
        scheduled = false;
        if (!disposed) show();
    };
    const schedule = (): void => {
        if (scheduled || disposed) return;
        scheduled = true;
        queueMicrotask(refresh);
    };

    const recordPaths = (): string[] => [
        recordsPath,
        `${recordsPath}.$every`,
        ...fieldNames.map((name) => `${recordsPath}.$every.${text(name, '')}`).filter((path) => !path.endsWith('.'))
    ];
    let watchedRecords = recordPaths();
    const onFields = (): void => {
        store.off(watchedRecords, schedule);
        watchedRecords = recordPaths();
        store.on(watchedRecords, schedule);
        schedule();
    };
    const fieldPaths = fieldNames.map((name) => `${basePath}.${name}`);
    const columnPaths = [columnsPath, `${columnsPath}.$all`];
    store.on(watchedRecords, schedule);
    store.on(fieldPaths, onFields);
    store.on(columnPaths, schedule);
    show();

    return {
        dispose: () => {
            disposed = true;
            store.off(watchedRecords, schedule);
            store.off(fieldPaths, onFields);
            store.off(columnPaths, schedule);
            for (const alias of aliases) store.unlink(alias);
            aliases.length = 0;
        }
    };
}
