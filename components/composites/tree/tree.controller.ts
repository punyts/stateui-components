import { report } from '@punyts/core';
import type { ControllerContext } from '@punyts/stateui';
import { runtimePath } from '@punyts/stateui-app/core';
import type { RecordViewElement } from '../shared/records/recordView.js';
import { buildTree, flattenModel } from '../shared/records/tree.js';
import type { TreeModel, TreeOptions, TreeRow } from '../shared/records/tree.js';

/** The properties of the tree that its `recordList` body reads through a link, by the body's property name */
const PASSED: Readonly<Record<string, string>> = {
    records: 'records',
    row: 'row',
    key: 'key'
};

/**
 * The body of the tree is a `recordList` node held in the runtime property `body` and drawn with `<sui-node>`, like the
 * list. Its `records`, `row` and `key` are store aliases of the tree's own, so the slot pool, the `$row` links and the
 * recycling are the record view's. The tree turns the records into the rows to show (`flattenTree`, in
 * `src/shared/records/tree.ts`): `expanded` lists the keys whose children are shown, and the result is written as the
 * body's `order` (a runtime property aliased as `order`), so opening or closing a record changes the order and nothing else:
 * the slots are pointed at other records, not rebuilt. The depth of each record is the custom property `--sui-level` on
 * its slot, from the pool's `slotLevel`, which a row template uses in CSS with `--sui-indent` (the `indent` space). A cycle
 * of parent keys hides its records and is reported once as `SUI-RUN-BINDING`
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const runtime = runtimePath(basePath);
    const bodyPath = `${basePath}.body`;
    const recordsPath = `${basePath}.records`;
    const expandedPath = `${basePath}.expanded`;
    const orderPath = `${runtime}.order`;
    const fieldNames = ['key', 'parentField', 'childrenField', 'hasChildrenField'] as const;
    let disposed = false;
    let scheduled = false;
    let model: TreeModel | undefined;
    let rows: TreeRow[] = [];
    let rowByKey = new Map<string, TreeRow>();
    let reportedCycle = '';

    const text = (name: string, fallback: string): string => {
        const value = store.get<unknown>(`${basePath}.${name}`);
        return typeof value === 'string' && value !== '' ? value : fallback;
    };
    const options = (): TreeOptions => ({
        key: text('key', 'id'),
        parentField: text('parentField', 'parentId'),
        childrenField: text('childrenField', ''),
        hasChildrenField: text('hasChildrenField', 'hasChildren')
    });
    const expandedKeys = (): Set<string> => {
        const value = store.get<unknown>(expandedPath);
        const keys = new Set<string>();
        for (const item of Array.isArray(value) ? (value as unknown[]) : []) {
            if (typeof item === 'string' && item !== '') keys.add(item);
            else if (typeof item === 'number' && Number.isFinite(item)) keys.add(String(item));
        }
        return keys;
    };

    //the store creates no parents, so each missing object between `$.runtime.nodes` and the tree's branch is written first
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

    const body = (): RecordViewElement | undefined => element.shadowRoot?.querySelector('.tree > sui-node')?.firstElementChild ?? undefined;

    const sameOrder = (next: readonly string[]): boolean => {
        const current = store.get<unknown>(orderPath);
        return Array.isArray(current) && current.length === next.length && next.every((key, at) => current[at] === key);
    };

    /** Reads the records again: the model changes only when the records or the field names did */
    const rebuild = (): void => {
        model = buildTree(store.get<unknown>(recordsPath), options());
        const signature = model.cyclic.join('\u0000');
        if (signature === reportedCycle) return;
        reportedCycle = signature;
        if (model.cyclic.length > 0) {
            report.error(`tree: the parent keys form a cycle, so ${model.cyclic.length} record(s) are not shown`, { code: 'SUI-RUN-BINDING', path: basePath });
        }
    };

    const show = (): void => {
        if (model === undefined) rebuild();
        rows = flattenModel(model as TreeModel, expandedKeys());
        rowByKey = new Map(rows.map((row) => [row.key, row]));
        const keys = rows.map((row) => row.key);
        if (!sameOrder(keys)) {
            //a replace announces the new order once; a set would announce every position
            if (Array.isArray(store.get<unknown>(orderPath))) store.replace(orderPath, keys);
            else store.set(orderPath, keys);
        }
        body()?.invalidate?.();
    };

    const refresh = (): void => {
        if (disposed) return;
        scheduled = false;
        show();
    };
    const schedule = (): void => {
        if (scheduled || disposed) return;
        scheduled = true;
        queueMicrotask(refresh);
    };
    const onRecords = (): void => {
        model = undefined;
        schedule();
    };

    const recordPaths = (): string[] => [
        recordsPath,
        `${recordsPath}.$every`,
        ...fieldNames.map((name) => `${recordsPath}.$every.${text(name, '')}`).filter((path) => !path.endsWith('.'))
    ];
    let watchedRecords = recordPaths();
    const onFields = (): void => {
        store.off(watchedRecords, onRecords);
        watchedRecords = recordPaths();
        store.on(watchedRecords, onRecords);
        onRecords();
    };
    const fieldPaths = fieldNames.map((name) => `${basePath}.${name}`);
    const expandedPaths = [expandedPath, `${expandedPath}.$all`];
    store.on(watchedRecords, onRecords);
    store.on(fieldPaths, onFields);
    store.on(expandedPaths, schedule);
    show();

    /** The body renders after the controller has returned: once its controller has run, the pool is told what each slot's level is */
    const start = (attempts: number): void => {
        if (disposed) return;
        const view = body();
        if (view?.locate === undefined) {
            if (attempts > 0) queueMicrotask(() => start(attempts - 1));
            return;
        }
        view.slotMeta = (key) => {
            const row = rowByKey.get(key);
            return row === undefined ? undefined : { level: row.level };
        };
        view.invalidate?.();
    };
    queueMicrotask(() => start(8));

    return {
        dispose: () => {
            disposed = true;
            store.off(watchedRecords, onRecords);
            store.off(fieldPaths, onFields);
            store.off(expandedPaths, schedule);
            for (const alias of linked) store.unlink(alias);
        }
    };
}
