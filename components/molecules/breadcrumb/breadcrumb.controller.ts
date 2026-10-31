import type { ControllerContext } from '@punyts/stateui';
import { runtimePath } from '@punyts/stateui-app/core';
import { currentKey, planCrumbs } from '../shared/nav/crumbs.js';

type Entry = Record<string, unknown>;

interface Crumb {
    kind: 'item' | 'current' | 'more';
    key: string;
    label: string;
    /** For a `more` crumb: the menu holder is linked, so the view may render it */
    ready: boolean;
}

const isEntry = (value: unknown): value is Entry => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Lays the trail out in the runtime property `crumbs`: an `item` is a button that raises `select` with its key, the
 * `current` item is plain text with `aria-current="page"`, and a trail with more items than `maxVisible` has one `more`
 * crumb that holds the collapsed middle items as a `menu` (E5.11). The menu is a node written under the runtime branch
 * `$.runtime.nodes.<path>.overflow.menu` (the holder `overflow` is aliased at `overflow`, as `toastRegion` does for its items), never into `$.app`: the locale step would replace a node
 * written whole there. Its items are `menuItem`s keyed like the trail, so a choice in it raises the menu's `select` with the
 * item's key, which this component raises again as its own `select`. The current item is never collapsed
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const runtime = runtimePath(basePath);
    const holderPath = `${runtime}.overflow`;
    const menuPath = `${holderPath}.menu`;
    const aliasPath = `${basePath}.overflow`;
    const crumbsPath = `${basePath}.crumbs`;
    let disposed = false;
    let menuWritten = false;
    let aliased = false;
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);

    //the store creates no parents, so each missing object between `$.runtime.nodes` and the menu is written first
    const segments = holderPath.split('.');
    for (let length = 3; length <= segments.length; length++) {
        const prefix = segments.slice(0, length).join('.');
        if (store.get<unknown>(prefix) === undefined) store.set(prefix, {});
    }

    const writeNode = (path: string, node: Entry): void => {
        store.set(path, {});
        for (const [name, value] of Object.entries(node)) if (name !== 'component') store.set(`${path}.${name}`, value);
        store.set(`${path}.component`, node['component']);
    };
    /** Writes the menu once, then keeps its label, trigger name and items in step with the trail */
    const writeMenu = (items: ReadonlyArray<{ key: string; label: string }>): void => {
        const more = text(read('_more'));
        if (!menuWritten) {
            menuWritten = true;
            store.set(menuPath, {});
            store.set(`${menuPath}.open`, false);
            store.set(`${menuPath}.anchor`, 'bottomStart');
            writeNode(`${menuPath}.trigger`, { component: 'button', icon: 'dots', iconPosition: 'only', variant: 'ghost', tone: 'neutral', size: 'sm', _title: more });
            store.set(`${menuPath}.children`, {});
            store.set(`${menuPath}._label`, more);
            store.set(`${menuPath}.component`, 'menu');
        } else {
            store.set(`${menuPath}._label`, more);
            store.set(`${menuPath}.trigger._title`, more);
        }
        const childrenPath = `${menuPath}.children`;
        const known = store.get<unknown>(childrenPath);
        const present = isEntry(known) ? Object.keys(known) : [];
        for (const key of present) if (!items.some((item) => item.key === key)) store.delete(`${childrenPath}.${key}`);
        for (const item of items) {
            const path = `${childrenPath}.${item.key}`;
            if (store.get<unknown>(path) === undefined) writeNode(path, { component: 'menuItem', _label: item.label });
            else if (store.get<unknown>(`${path}._label`) !== item.label) store.set(`${path}._label`, item.label);
        }
    };

    const draw = (): void => {
        if (disposed) return;
        const source = read('items');
        const entries = isEntry(source) ? Object.entries(source) : [];
        const keys = entries.map(([key]) => key);
        const label = (key: string): string => {
            const entry = source !== undefined && isEntry(source) ? source[key] : undefined;
            const content = isEntry(entry) ? text(entry['_label']) : '';
            return content !== '' ? content : key;
        };
        const current = currentKey(keys, read('current'));
        const crumbs: Record<string, Crumb> = {};
        let hidden: Array<{ key: string; label: string }> = [];
        planCrumbs(keys, current, read('maxVisible')).forEach((slot, index) => {
            if (slot.kind === 'more') {
                hidden = slot.keys.map((key) => ({ key, label: label(key) }));
                crumbs[`c${index}`] = { kind: 'more', key: '', label: '', ready: aliased };
                return;
            }
            crumbs[`c${index}`] = { kind: slot.key === current ? 'current' : 'item', key: slot.key, label: label(slot.key), ready: true };
        });
        if (hidden.length > 0) writeMenu(hidden);
        store.set(crumbsPath, crumbs);
    };

    let scheduled = false;
    const schedule = (): void => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            draw();
        });
    };
    const watched = [`${basePath}.items`, `${basePath}.items.$all`, `${basePath}.current`, `${basePath}.maxVisible`, `${basePath}._more`, '$.locale'];
    store.on(watched, schedule);
    draw();
    //the controller runs while the node renders, and removing the default of `overflow` there would render the node again
    queueMicrotask(() => {
        if (disposed) return;
        if (store.get<unknown>(aliasPath) !== undefined) store.delete(aliasPath);
        store.link(aliasPath, holderPath, { allowMissing: true });
        //a binding on `overflow` is not told about the link, so the crumbs are drawn again, now ready to render the menu
        aliased = true;
        draw();
    });

    const raise = (key: string): void => {
        element.dispatchEvent(new CustomEvent('select', { detail: key, bubbles: true, composed: true }));
    };
    return {
        onPick: (event: Event) => {
            const key = (event.currentTarget as HTMLElement | null)?.dataset['key'];
            if (key !== undefined) raise(key);
        },
        onMenuSelect: (event: Event) => {
            event.stopPropagation();
            const key = (event as CustomEvent<unknown>).detail;
            if (typeof key === 'string') raise(key);
        },
        dispose: () => {
            disposed = true;
            store.off(watched, schedule);
            store.unlink(aliasPath);
            store.delete(holderPath);
        }
    };
}
