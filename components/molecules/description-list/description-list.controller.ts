import type { ControllerContext } from '@punyts/stateui';
import { applyLinks, disposeLinks, resolveRowLinks, runtimePath } from '@punyts/stateui-app/core';
import type { Link, Node } from '@punyts/stateui-app/core';
import { formatValue } from '../shared/format/format.js';

type Entry = Record<string, unknown>;

interface Instance {
    signature: string;
    links: Link[];
}

const isEntry = (value: unknown): value is Entry => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Removes the property a link takes the place of, as the store refuses to alias a path that holds data */
function removeLinked(tree: Entry, nodePath: string, links: readonly Link[]): void {
    for (const link of links) {
        let holder: unknown = tree;
        for (const segment of link.statePath.slice(nodePath.length).split('.').filter(Boolean)) {
            holder = isEntry(holder) ? holder[segment] : undefined;
        }
        if (isEntry(holder)) delete holder[link.key];
    }
}


/**
 * Writes the rows the view draws: `rows.<key>` holds the term and the formatted text of a `field` item (formatted for
 * `$.locale`). A `node` item gets a runtime node under `$.runtime.nodes.<path>.items.<key>` whose `$row` links point
 * at `record`, so the node follows the record, also when `record` is re-linked. `rows.<key>.node` is an alias of the
 * runtime `items.<key>` object that holds the node, which gives `<sui-node>` a store path below the component to draw from
 */
export default function controller({ store, basePath }: ControllerContext) {
    const itemsPath = `${runtimePath(basePath)}.items`;
    const recordPath = `${basePath}.record`;
    const rowsPath = `${basePath}.rows`;
    const instances = new Map<string, Instance>();
    const read = (path: string): unknown => store.get<unknown>(path);
    let order = '';

    const holderPath = (key: string): string => `${itemsPath}.${key}`;
    const nodePath = (key: string): string => `${holderPath(key)}.node`;
    const aliased = new Set<string>();
    const unalias = (key: string): void => {
        if (aliased.delete(key)) store.unlink(`${rowsPath}.${key}.node`);
    };

    const release = (key: string): void => {
        unalias(key);
        const instance = instances.get(key);
        if (!instance) return;
        disposeLinks(store, instance.links);
        store.delete(holderPath(key));
        instances.delete(key);
    };

    /** The store creates no parents, so each missing object between `$.runtime.nodes` and the node is written first */
    const ensure = (path: string): void => {
        const segments = path.split('.');
        for (let length = 3; length <= segments.length; length++) {
            const prefix = segments.slice(0, length).join('.');
            if (read(prefix) === undefined) store.set(prefix, {});
        }
    };

    const instantiate = (key: string, node: Entry): void => {
        const signature = JSON.stringify(node);
        if (instances.get(key)?.signature === signature) return;
        const path = nodePath(key);
        const rewritten = resolveRowLinks(JSON.parse(signature) as Node, recordPath, { path });
        const tree = rewritten.tree as unknown as Entry;
        removeLinked(tree, path, rewritten.links);
        const previous = instances.get(key);
        if (previous) disposeLinks(store, previous.links);
        ensure(holderPath(key));
        store.set(path, tree);
        applyLinks(store, rewritten.links);
        instances.set(key, { signature, links: rewritten.links });
    };

    const entries = (): [string, Entry][] => {
        const items = read(`${basePath}.items`);
        return isEntry(items) ? Object.entries(items).filter((pair): pair is [string, Entry] => isEntry(pair[1])) : [];
    };

    const shownText = (item: Entry, record: unknown, empty: string): string => {
        const field = text(item['field']);
        const value = isEntry(record) && field !== '' ? record[field] : undefined;
        if (value === undefined || value === null || value === '' || typeof value === 'object') return empty;
        const format = text(item['format']);
        if (format === '') return String(value);
        return formatValue(value, { format, currency: text(item['currency']), locale: text(read('$.locale')) }) || empty;
    };

    const refresh = (): void => {
        const empty = text(read(`${basePath}._empty`));
        const record = read(recordPath);
        const list = entries();
        const signature = list.map(([key]) => key).join(',');
        const rebuild = signature !== order;
        if (rebuild) {
            for (const key of Array.from(aliased)) unalias(key);
            store.set(rowsPath, {});
            order = signature;
        }
        const live = new Set<string>();
        for (const [key, item] of list) {
            const node = item['node'];
            if (rebuild) store.set(`${rowsPath}.${key}`, { term: '', text: '' });
            store.set(`${rowsPath}.${key}.term`, text(item['_term']));
            if (isEntry(node)) {
                live.add(key);
                instantiate(key, node);
                if (!aliased.has(key)) {
                    store.link(`${rowsPath}.${key}.node`, holderPath(key));
                    aliased.add(key);
                }
                store.set(`${rowsPath}.${key}.text`, '');
            } else {
                store.set(`${rowsPath}.${key}.text`, shownText(item, record, empty));
            }
        }
        for (const key of Array.from(instances.keys())) if (!live.has(key)) release(key);
    };

    const watched = [`${basePath}.items`, `${basePath}.items.$all`, recordPath, `${recordPath}.$all`, `${basePath}._empty`, '$.locale'];
    store.on(watched, refresh);
    refresh();
    return {
        dispose: () => {
            store.off(watched, refresh);
            for (const key of Array.from(instances.keys())) release(key);
        }
    };
}
