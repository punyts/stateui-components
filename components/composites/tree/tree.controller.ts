import { report } from '@punyts/core';
import type { ControllerContext } from '@punyts/stateui';
import { runtimePath } from '@punyts/stateui-app/core';
import { placeholderOwner } from '../shared/records/placeholder.js';
import type { RecordViewElement } from '../shared/records/recordView.js';
import { buildTree, flattenModel } from '../shared/records/tree.js';
import type { TreeModel, TreeOptions, TreeRow } from '../shared/records/tree.js';
import { createSelection, readSelectionMode } from '../shared/selection/selection.js';

/** The properties of the tree that its `recordList` body reads through a link, by the body's property name */
const PASSED: Readonly<Record<string, string>> = {
    records: 'records',
    row: 'row',
    key: 'key',
    rowHeight: 'rowHeight',
    selected: 'selected'
};

/** Elements in a row that act on a press themselves, so a press on them does not select or open the row */
const INTERACTIVE = new Set(['a', 'button', 'input', 'label', 'select', 'summary', 'textarea']);
const TEXT_ENTRY = new Set(['input', 'textarea', 'select']);

interface CommandHost {
    commands?: Record<string, (value?: unknown) => void>;
}

/**
 * The body of the tree is a `recordList` node held in the runtime property `body` and drawn with `<sui-node>`, like the
 * list. Its `records`, `row`, `key`, `rowHeight` and `selected` are store aliases of the tree's own, so the slot pool, the `$row` links and
 * the recycling are the record view's. The tree turns the records into the rows to show (`flattenTree`, in
 * `src/shared/records/tree.ts`): `expanded` lists the keys whose children are shown, and the result is written as the
 * body's `order` (a runtime property aliased as `order`), so opening or closing a record changes the order and nothing else:
 * the slots are pointed at other records, not rebuilt. The depth of each record is the custom property `--sui-level` on
 * its slot, which the record list turns into the row's indent (with `--sui-indent`, the `indent` space) and its expand glyph. A cycle of parent keys hides its
 * records and is reported once as `SUI-RUN-BINDING`.
 *
 * The body has the role `tree`, and the pool gives each slot `aria-level`, `aria-expanded`, `aria-setsize`, `aria-posinset`
 * and an `aria-label` from `labelField`, through `slotMeta`. Keys: Down and Up move to the next and previous shown record,
 * Home and End to the first and last, Right opens a closed record or moves to its first child, Left closes an open record
 * or moves to its parent (Left and Right swap in right-to-left text), a character jumps to the next record whose
 * `labelField` starts with it, Space picks the record and Enter raises `activate`. A press on a record that can open
 * toggles it (a double press raises `activate`).
 *
 * Selection is the shared one: `selectable` (`none`, `single`, `multi`), data `selected`, the events `select` (the keys) and
 * `activate` (the key). `expand` is raised once, with the key, for a record that is open while it is marked as having
 * children (`hasChildrenField` is true) and none are loaded, whichever way it was opened (a key, a press, a command or a
 * write to `expanded`); a busy row stands under it until children arrive in `records`. The commands `expand` and `collapse`
 * take a key, `expandAll` opens every record that has children loaded and `collapseAll` closes everything
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as Element & CommandHost;
    const runtime = runtimePath(basePath);
    const bodyPath = `${basePath}.body`;
    const recordsPath = `${basePath}.records`;
    const expandedPath = `${basePath}.expanded`;
    const selectablePath = `${basePath}.selectable`;
    const orderPath = `${runtime}.order`;
    const currentPath = `${runtime}.current`;
    const fieldNames = ['key', 'parentField', 'childrenField', 'hasChildrenField', 'labelField'] as const;
    let disposed = false;
    let scheduled = false;
    let model: TreeModel | undefined;
    let rows: TreeRow[] = [];
    let shownRows: TreeRow[] = [];
    let rowByKey = new Map<string, TreeRow>();
    let reportedCycle = '';
    const requested = new Set<string>();

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
    const mode = () => readSelectionMode(store.get<unknown>(selectablePath));
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

    const syncSelectable = (): void => {
        const current = mode();
        if (store.get<unknown>(`${bodyPath}.selectable`) !== (current !== 'none')) store.set(`${bodyPath}.selectable`, current !== 'none');
        if (store.get<unknown>(`${bodyPath}.multiselectable`) !== (current === 'multi')) store.set(`${bodyPath}.multiselectable`, current === 'multi');
    };
    syncSelectable();

    const body = (): RecordViewElement | undefined => element.shadowRoot?.querySelector('.tree > sui-node')?.firstElementChild ?? undefined;

    const sameOrder = (next: readonly string[]): boolean => {
        const current = store.get<unknown>(orderPath);
        return Array.isArray(current) && current.length === next.length && next.every((key, at) => current[at] === key);
    };

    const ensureModel = (): TreeModel => {
        if (model !== undefined) return model;
        model = buildTree(store.get<unknown>(recordsPath), options());
        const signature = model.cyclic.join('\u0000');
        if (signature !== reportedCycle) {
            reportedCycle = signature;
            if (model.cyclic.length > 0) {
                report.error(`tree: the parent keys form a cycle, so ${model.cyclic.length} record(s) are not shown`, { code: 'SUI-RUN-BINDING', path: basePath });
            }
        }
        return model;
    };

    /** Raises `expand` once for each record that is open and waits for its children; a record that closed or loaded can raise it again */
    const raiseExpand = (): void => {
        const waiting = new Set(rows.filter((row) => row.expanded && row.unloaded).map((row) => row.key));
        for (const key of requested) if (!waiting.has(key)) requested.delete(key);
        for (const key of waiting) {
            if (requested.has(key)) continue;
            requested.add(key);
            element.dispatchEvent(new CustomEvent('expand', { detail: key, bubbles: true, composed: true }));
        }
    };

    const show = (): void => {
        rows = flattenModel(ensureModel(), expandedKeys());
        shownRows = rows.filter((row) => !row.placeholder);
        rowByKey = new Map(rows.map((row) => [row.key, row]));
        const keys = rows.map((row) => row.key);
        if (!sameOrder(keys)) {
            //a replace announces the new order once; a set would announce every position
            if (Array.isArray(store.get<unknown>(orderPath))) store.replace(orderPath, keys);
            else store.set(orderPath, keys);
        }
        body()?.invalidate?.();
        raiseExpand();
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

    const selection = createSelection({
        store,
        selectedPath: `${basePath}.selected`,
        currentPath,
        mode,
        locate: (key) => body()?.locate?.(key),
        onSelect: (keys) => element.dispatchEvent(new CustomEvent('select', { detail: keys, bubbles: true, composed: true }))
    });
    const onSelectable = (): void => {
        syncSelectable();
        selection.relocate();
    };
    store.on([selectablePath], onSelectable);

    const labelOf = (key: string): string => {
        const path = body()?.locate?.(key);
        const value = path === undefined ? undefined : store.get<unknown>(`${path}.${text('labelField', 'label')}`);
        if (typeof value === 'string') return value;
        return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
    };

    show();

    /** The body renders after the controller has returned: once its controller has run, the pool is told what each slot shows */
    const start = (attempts: number): void => {
        if (disposed) return;
        const view = body();
        if (view?.locate === undefined) {
            if (attempts > 0) queueMicrotask(() => start(attempts - 1));
            return;
        }
        view.slotMeta = (key) => {
            const row = rowByKey.get(key);
            if (row === undefined) return undefined;
            if (row.placeholder) return { level: row.level };
            return {
                level: row.level,
                ...(row.expandable ? { expanded: row.expanded } : {}),
                setsize: row.setsize,
                posinset: row.posinset,
                label: labelOf(key)
            };
        };
        view.invalidate?.();
        selection.relocate();
    };
    queueMicrotask(() => start(8));

    const writeExpanded = (keys: Iterable<string>): void => {
        store.set(expandedPath, [...keys]);
    };
    const expand = (key: string): void => {
        const node = ensureModel().nodes.get(key);
        if (node === undefined || (node.children.length === 0 && !node.marked)) return;
        const keys = expandedKeys();
        if (keys.has(key)) return;
        keys.add(key);
        writeExpanded(keys);
    };
    const collapse = (key: string): void => {
        const keys = expandedKeys();
        if (keys.delete(key)) writeExpanded(keys);
    };
    const keyOf = (value: unknown): string | undefined =>
        typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;

    host.commands = {
        expand: (value) => {
            const key = keyOf(value);
            if (key !== undefined) expand(key);
        },
        collapse: (value) => {
            const key = keyOf(value);
            if (key !== undefined) collapse(key);
        },
        expandAll: () => {
            const keys = expandedKeys();
            for (const node of ensureModel().nodes.values()) if (node.children.length > 0) keys.add(node.key);
            writeExpanded(keys);
        },
        collapseAll: () => writeExpanded([])
    };

    /** The slot an event passed through and the key of the record it shows; a busy row stands for the record it waits for */
    const rowOf = (event: Event): { slot: HTMLElement; key: string; pressable: boolean } | undefined => {
        const view = body();
        const root = view?.shadowRoot;
        if (!view || !root) return undefined;
        let pressable = true;
        for (const node of event.composedPath()) {
            if (!(node instanceof HTMLElement)) continue;
            if (node.getRootNode() === root && node.classList.contains('slot') && node.dataset['slot'] !== undefined) {
                const position = store.get<unknown>(`${bodyPath}.slots.${node.dataset['slot']}.slotIndex`);
                const shown = typeof position === 'number' && position >= 0 ? view.keyAt?.(position) : undefined;
                const key = shown === undefined ? undefined : (placeholderOwner(shown) ?? shown);
                return key === undefined || !rowByKey.has(key) ? undefined : { slot: node, key, pressable: pressable && placeholderOwner(shown ?? '') === undefined };
            }
            if (INTERACTIVE.has(node.localName) || node.isContentEditable) pressable = false;
        }
        return undefined;
    };
    const focusKey = (key: string | undefined): void => {
        if (key !== undefined) body()?.focusKey?.(key);
    };
    const activate = (key: string): void => {
        element.dispatchEvent(new CustomEvent('activate', { detail: key, bubbles: true, composed: true }));
    };
    const toggle = (row: TreeRow): void => {
        if (!row.expandable) return;
        if (row.expanded) collapse(row.key);
        else expand(row.key);
    };
    /** The key of the next shown record after `current` whose label starts with the character, wrapping round */
    const jumpTo = (current: number, character: string): string | undefined => {
        const total = shownRows.length;
        for (let step = 1; step <= total; step++) {
            const row = shownRows[(current + step) % total] as TreeRow;
            if (labelOf(row.key).toLowerCase().startsWith(character)) return row.key;
        }
        return undefined;
    };
    const rtl = (): boolean => getComputedStyle(element).direction === 'rtl';

    return {
        onClick: (event: MouseEvent) => {
            const row = rowOf(event);
            if (row?.pressable !== true) return;
            selection.pick(row.key);
            const target = rowByKey.get(row.key);
            if (target !== undefined && event.detail <= 1) toggle(target);
        },
        onDoubleClick: (event: MouseEvent) => {
            const row = rowOf(event);
            if (row?.pressable === true) activate(row.key);
        },
        onKeyDown: (event: KeyboardEvent) => {
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            const found = rowOf(event);
            if (found === undefined) return;
            const origin = event.composedPath()[0];
            const onSlot = origin === found.slot;
            if (!onSlot && origin instanceof HTMLElement && (TEXT_ENTRY.has(origin.localName) || origin.isContentEditable)) return;
            const current = rowByKey.get(found.key) as TreeRow;
            const at = shownRows.findIndex((row) => row.key === found.key);
            const grow = rtl() ? 'ArrowLeft' : 'ArrowRight';
            const shrink = rtl() ? 'ArrowRight' : 'ArrowLeft';
            if (event.key === 'Enter' || event.key === ' ') {
                if (!onSlot || (event.key === ' ' && mode() === 'none')) return;
                event.preventDefault();
                if (event.key === 'Enter') activate(found.key);
                else selection.pick(found.key);
                return;
            }
            if (!onSlot) return;
            let handled = true;
            if (event.key === 'ArrowDown') focusKey(shownRows[at + 1]?.key);
            else if (event.key === 'ArrowUp') focusKey(shownRows[at - 1]?.key);
            else if (event.key === 'Home') focusKey(shownRows[0]?.key);
            else if (event.key === 'End') focusKey(shownRows[shownRows.length - 1]?.key);
            else if (event.key === grow) {
                if (current.expandable && !current.expanded) expand(current.key);
                else if (current.expanded && shownRows[at + 1]?.parent === current.key) focusKey(shownRows[at + 1]?.key);
            } else if (event.key === shrink) {
                if (current.expanded) collapse(current.key);
                else focusKey(current.parent);
            } else if (event.key.length === 1) {
                focusKey(jumpTo(at, event.key.toLowerCase()));
            } else {
                handled = false;
            }
            if (handled) event.preventDefault();
        },
        dispose: () => {
            disposed = true;
            store.off(watchedRecords, onRecords);
            store.off(fieldPaths, onFields);
            store.off(expandedPaths, schedule);
            store.off([selectablePath], onSelectable);
            selection.dispose();
            for (const alias of linked) store.unlink(alias);
            delete host.commands;
        }
    };
}
