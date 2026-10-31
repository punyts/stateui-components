import { report } from '@punyts/core';
import { RUNTIME_PATHS, applyLinks, disposeLinks, resolveRowLinks, runtimePath } from '@punyts/stateui-app/core';
import type { Link, Node } from '@punyts/stateui-app/core';
import type { RecordIndex, RecordStore } from './recordIndex.js';
import { MAX_SLOTS, poolSize, poolStart, readWindow } from './window.js';

/** What a slot pool is made from */
export interface SlotPoolOptions {
    store: RecordStore;
    /** The state path of the record view node (`$.app.…`); the slots, the window and the aliases derive from it */
    nodePath: string;
    /** The state path of the row template, a node */
    rowPath: string;
    /** The property of the node the slots are aliased at, so the view can repeat over them (`<nodePath>.slots`) */
    viewPath: string;
    /** The property of the node that receives the number of positions (`<nodePath>.count`) */
    countPath: string;
    index: RecordIndex;
    /** The rows drawn above and below the viewport, read when the pool is sized */
    overscan: () => number;
}

/** The record view's slot nodes; E5.23 writes the window, `invalidate` is for anything that changes what a position shows */
export interface SlotPool {
    /** Shows the records of the current window now, rebuilding the pool when the template changed */
    refresh(): void;
    /** Asks for a `refresh` in a microtask; any number of calls before it runs make one refresh */
    schedule(): void;
    /**
     * Marks every position as possibly changed, so the next refresh asks the index again, and schedules it. `reload`
     * also points each slot again when its record path is unchanged, for records that moved without a store event
     */
    invalidate(reload?: boolean): void;
    /** The number of slots now */
    size(): number;
    /** The state path of slot `i` (`$.runtime.nodes.app.….slots.<i>`) */
    slotPath(i: number): string;
    /** Removes the listeners and every slot, link and alias the pool made */
    dispose(): void;
}

type Entry = Record<string, unknown>;

interface Slot {
    path: string;
    links: Link[];
    /** The position shown, or -1 for none */
    position: number;
    key: string | undefined;
    /** The record path `row` points at */
    target: string;
}

const isEntry = (value: unknown): value is Entry => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The template with the value of every `_` property blanked: equal structures differ only in content, such as a translation */
function structureOf(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(structureOf);
    if (!isEntry(value)) return value;
    const copy: Entry = {};
    for (const [key, item] of Object.entries(value)) copy[key] = key.startsWith('_') ? null : structureOf(item);
    return copy;
}

/** The `_` properties of a tree, in the tree's nesting, for `apply` over the slots that hold the same structure */
function contentOf(value: unknown): Entry {
    const out: Entry = {};
    if (!isEntry(value)) return out;
    for (const [key, item] of Object.entries(value)) {
        if (key.startsWith('_')) {
            out[key] = JSON.parse(JSON.stringify(item)) as unknown;
        } else if (isEntry(item)) {
            const inner = contentOf(item);
            if (Object.keys(inner).length > 0) out[key] = inner;
        }
    }
    return out;
}

/** The store refuses to alias a path that holds data, so a property a link takes the place of is removed from the tree */
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
 * The slot pool of a record view. It builds N slot nodes from the `row` template under the node's runtime branch
 * (`slots.<i>`), N being the visible rows of `window` plus the overscan on both sides (at most `MAX_SLOTS`), and shows
 * the record of position `p` in slot `p % N`, so a window move recycles only the slots whose position changed.
 *
 * Recycling is one store link: `slots.<i>.row` is re-pointed at the record, and one write of `slots.<i>.slotIndex` gives
 * the position. The template's `$row.x` links are rewritten once per slot to fixed `allowMissing` aliases under
 * `slots.<i>.row.x`, so they follow whatever `row` points at, a missing field reads as `undefined`, and a slot with no
 * record points at the shared empty record. Nothing is created or listened to when the window moves.
 *
 * A change to the template rebuilds the pool, except one that only changes `_` content (a language switch): that is
 * written into the existing slots. Writes to the window, the data and the template are coalesced into one refresh per
 * microtask
 */
export function createSlotPool(options: SlotPoolOptions): SlotPool {
    const { store, nodePath, rowPath, viewPath, countPath, index, overscan } = options;
    const runtime = runtimePath(nodePath);
    const slotsPath = `${runtime}.slots`;
    const windowPath = `${runtime}.window`;
    let slots: Slot[] = [];
    let templateJson = '';
    let templateDirty = true;
    let dirty = true;
    let reload = false;
    let pending = false;
    let disposed = false;
    let shownCount = -1;

    const slotPath = (i: number): string => `${slotsPath}.${i}`;
    const rowLink = (path: string): string => `${path}.row`;

    /** The store creates no parents, so each missing object between `$.runtime.nodes` and the slots is written first */
    const ensure = (path: string): void => {
        const segments = path.split('.');
        for (let length = 3; length <= segments.length; length++) {
            const prefix = segments.slice(0, length).join('.');
            if (store.get<unknown>(prefix) === undefined) store.set(prefix, {});
        }
    };

    const rewrite = (json: string, path: string): { tree: Entry; links: Link[] } => {
        const rewritten = resolveRowLinks(JSON.parse(json) as Node, rowLink(path), { path });
        const tree = rewritten.tree as unknown as Entry;
        removeLinked(tree, path, rewritten.links);
        return { tree, links: rewritten.links };
    };

    const createSlot = (i: number): Slot => {
        const path = slotPath(i);
        const { tree, links } = rewrite(templateJson, path);
        tree['slotIndex'] = -1;
        store.set(path, tree);
        store.link(rowLink(path), RUNTIME_PATHS.empty);
        for (const error of applyLinks(store, links)) {
            report.error(error.message, { code: error.code, path });
        }
        return { path, links, position: -1, key: undefined, target: RUNTIME_PATHS.empty };
    };

    const destroySlot = (slot: Slot): void => {
        store.unlink(rowLink(slot.path));
        disposeLinks(store, slot.links);
        store.delete(slot.path);
    };

    const destroyAll = (): void => {
        for (const slot of slots) destroySlot(slot);
        slots = [];
    };

    const point = (slot: Slot, target: string): void => {
        if (slot.target === target) return;
        if (!store.link(rowLink(slot.path), target)) {
            store.link(rowLink(slot.path), RUNTIME_PATHS.empty);
            slot.target = RUNTIME_PATHS.empty;
            return;
        }
        slot.target = target;
    };

    const place = (slot: Slot, position: number): void => {
        if (slot.position === position) return;
        slot.position = position;
        store.set(`${slot.path}.slotIndex`, position);
    };

    const syncTemplate = (): void => {
        templateDirty = false;
        const template = store.get<unknown>(rowPath);
        const json = isEntry(template) ? JSON.stringify(template) : '';
        if (json === templateJson) return;
        const previous = templateJson;
        templateJson = json;
        if (json === '') {
            destroyAll();
            return;
        }
        const sameStructure =
            previous !== '' && slots.length > 0 && JSON.stringify(structureOf(JSON.parse(previous))) === JSON.stringify(structureOf(JSON.parse(json)));
        if (sameStructure) {
            const content = contentOf(rewrite(json, slotPath(0)).tree);
            for (const slot of slots) store.apply(slot.path, JSON.parse(JSON.stringify(content)) as Entry);
            return;
        }
        destroyAll();
        dirty = true;
    };

    const refresh = (): void => {
        if (disposed) return;
        if (templateDirty) syncTemplate();
        const win = readWindow(store.get<unknown>(windowPath));
        const wanted = templateJson === '' ? 0 : poolSize(win.count, overscan(), MAX_SLOTS);
        if (wanted !== slots.length) {
            ensure(slotsPath);
            while (slots.length > wanted) destroySlot(slots.pop() as Slot);
            while (slots.length < wanted) slots.push(createSlot(slots.length));
        }
        const total = index.size();
        if (total !== shownCount) {
            shownCount = total;
            store.set(countPath, total);
        }
        const size = slots.length;
        if (size > 0) {
            const start = poolStart(win.first, total, size, overscan());
            for (let position = start; position < start + size; position++) {
                const slot = slots[position % size] as Slot;
                if (position >= total) {
                    point(slot, RUNTIME_PATHS.empty);
                    slot.key = undefined;
                    place(slot, -1);
                    continue;
                }
                if (!dirty && slot.position === position) continue;
                const key = index.keyAt(position);
                const target = key === undefined ? undefined : index.pathOf(key);
                slot.key = key;
                if (reload && target !== undefined && slot.target === target) {
                    store.link(rowLink(slot.path), RUNTIME_PATHS.empty);
                    slot.target = RUNTIME_PATHS.empty;
                }
                point(slot, target ?? RUNTIME_PATHS.empty);
                place(slot, target === undefined ? -1 : position);
            }
        }
        dirty = false;
        reload = false;
    };

    const schedule = (): void => {
        if (pending || disposed) return;
        pending = true;
        queueMicrotask(() => {
            pending = false;
            refresh();
        });
    };

    const onWindow = (): void => schedule();
    const onTemplate = (): void => {
        templateDirty = true;
        schedule();
    };
    const windowPaths = [windowPath, `${windowPath}.$all`];
    const templatePaths = [rowPath, `${rowPath}.$all`];

    ensure(slotsPath);
    store.on(windowPaths, onWindow);
    store.on(templatePaths, onTemplate);
    //the controller runs while the node is being rendered, and removing the default of `slots` there would re-render the node, so the pool starts in the next microtask
    queueMicrotask(() => {
        if (disposed) return;
        if (store.get<unknown>(viewPath) !== undefined) store.delete(viewPath);
        store.link(viewPath, slotsPath);
        refresh();
    });

    return {
        refresh,
        schedule,
        invalidate(again = false) {
            dirty = true;
            reload = reload || again;
            schedule();
        },
        size: () => slots.length,
        slotPath,
        dispose() {
            if (disposed) return;
            disposed = true;
            store.off(windowPaths, onWindow);
            store.off(templatePaths, onTemplate);
            destroyAll();
            store.unlink(viewPath);
            store.delete(slotsPath);
        }
    };
}
