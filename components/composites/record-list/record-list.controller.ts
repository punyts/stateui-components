import type { ControllerContext } from '@punyts/stateui';
import { runtimePath } from '@punyts/stateui-app/core';
import { createRecordIndex } from '../shared/records/recordIndex.js';
import type { RecordViewElement } from '../shared/records/recordView.js';
import { createSlotPool } from '../shared/records/slotPool.js';
import type { SlotPool } from '../shared/records/slotPool.js';
import { createViewportObserver } from '../shared/records/viewport.js';
import type { ViewportObserver } from '../shared/records/viewport.js';
import { readWindow, sameWindow } from '../shared/records/window.js';
import type { RecordWindow } from '../shared/records/window.js';

const TEXT_ENTRY = new Set(['input', 'textarea', 'select']);

/**
 * Builds the slot pool of the record view (see `src/shared/records/`): the slots live at
 * `$.runtime.nodes.<path>.slots.<i>`, are aliased at `slots` for the view to repeat over, and show the records of the
 * window at `$.runtime.nodes.<path>.window` (`{ first, count }`). The viewport observer writes that window from the
 * scroll offset, the viewport height and the row height, and `range` is raised once for each change of it
 * (`{ first, count, total }`). For the role `table` the reflected `ariaRowcount` follows the count.
 *
 * Identity belongs to the record: `selected` (a key or a list of keys) is shown on the slot of each selected record
 * (`slotSelected`; `aria-multiselectable` on a `listbox` host follows `multiselectable`), one slot is the tab stop
 * (`slotTab`), and the arrow keys, Home, End, PageUp and PageDown move the focus by position: the target is scrolled into
 * the window and then its slot is focused. The slot that holds focus is pinned while its record is out of the window;
 * when its record is deleted focus moves to the neighbouring row. `locate(key)`, `keyAt(position)` and `recordKeys()` are
 * on the element, `scrollTo` is a command, and `loading` shows skeleton rows over the visible rows.
 *
 * Paged data: with `total` set (a non-negative integer) the count, `aria-rowcount` / `aria-setsize` and the `range` event's
 * `total` come from it, the records are read by position (an array, or a map keyed by position) and `order` is ignored. A
 * position with no record yet is a pending slot: a `skeleton` is shown in it and its `row` links to `$.runtime.empty` until the
 * source writes the record. `recordKeys()` lists only the loaded records. The view never fetches; `range` tells the source
 * which positions to load.
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as RecordViewElement;
    const keyPath = `${basePath}.key`;
    const overscanPath = `${basePath}.overscan`;
    const rolePath = `${basePath}.role`;
    const countPath = `${basePath}.count`;
    const rowcountPath = `${basePath}.ariaRowcount`;
    const selectedPath = `${basePath}.selected`;
    const multiPath = `${basePath}.multiselectable`;
    const loadingPath = `${basePath}.loading`;
    const loadingRowsPath = `${basePath}.loadingRows`;
    const loadingFirstPath = `${basePath}.loadingFirst`;
    const windowPath = `${runtimePath(basePath)}.window`;
    const windowPaths = [windowPath, `${windowPath}.$all`];
    const selectedPaths = [selectedPath, `${selectedPath}.$all`];
    let pool: SlotPool | undefined;
    let observer: ViewportObserver | undefined;
    let disposed = false;
    let raised: RecordWindow = { first: 0, count: 0 };
    let selection = new Set<string>();
    const text = (path: string, fallback: string): string => {
        const value = store.get<unknown>(path);
        return typeof value === 'string' && value !== '' ? value : fallback;
    };
    const readSelection = (): Set<string> => {
        const value = store.get<unknown>(selectedPath);
        const keys = new Set<string>();
        const add = (item: unknown): void => {
            if (typeof item === 'string' && item !== '') keys.add(item);
            else if (typeof item === 'number' && Number.isFinite(item)) keys.add(String(item));
        };
        if (Array.isArray(value)) value.forEach(add);
        else add(value);
        return keys;
    };
    selection = readSelection();

    const part = (selector: string): HTMLElement | null => element.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
    const slotElement = (i: number): HTMLElement | null => part(`.slot[data-slot="${i}"]`);
    const slotOf = (event: Event): HTMLElement | undefined => {
        for (const node of event.composedPath()) {
            if (node instanceof HTMLElement && node.classList.contains('slot') && node.dataset['slot'] !== undefined) return node;
        }
        return undefined;
    };
    const activeSlot = (): HTMLElement | undefined => {
        const active = element.shadowRoot?.activeElement;
        const slot = active?.closest<HTMLElement>('.slot');
        return slot ?? undefined;
    };
    const focusSlot = (i: number, attempts = 2): void => {
        const slot = slotElement(i);
        if (!slot || disposed) return;
        slot.focus({ preventScroll: true });
        if (activeSlot() !== slot && attempts > 0) queueMicrotask(() => focusSlot(i, attempts - 1));
    };
    const focusPosition = (position: number): void => {
        const i = pool?.slotAt(position);
        if (i !== undefined) focusSlot(i);
    };

    const index = createRecordIndex({
        store,
        recordsPath: `${basePath}.records`,
        orderPath: `${basePath}.order`,
        totalPath: `${basePath}.total`,
        key: text(keyPath, 'id'),
        onChange: (reload) => pool?.invalidate(reload)
    });

    /** Scrolls a position into view and writes the window at once; without a measured viewport the window is written directly */
    const reveal = (position: number, align: 'start' | 'nearest'): void => {
        if (observer?.reveal(position, index.size(), align) === true) return;
        const win = readWindow(store.get<unknown>(windowPath));
        const count = Math.max(1, win.count);
        let first = win.first;
        if (align === 'start' || position < win.first) first = position;
        else if (position >= win.first + count) first = position - count + 1;
        store.set(windowPath, { first, count: win.count });
    };

    const moveTo = (position: number): void => {
        const total = index.size();
        if (total === 0 || pool === undefined) return;
        const target = Math.min(Math.max(0, position), total - 1);
        pool.pin(index.keyAt(target));
        reveal(target, 'nearest');
        pool.refresh();
        focusPosition(target);
    };

    pool = createSlotPool({
        store,
        nodePath: basePath,
        rowPath: `${basePath}.row`,
        viewPath: `${basePath}.slots`,
        countPath,
        index,
        overscan: () => {
            const value = store.get<unknown>(overscanPath);
            return typeof value === 'number' ? value : 5;
        },
        isSelected: (key) => selection.has(key),
        paged: () => index.paged(),
        meta: (key, position) => host.slotMeta?.(key, position),
        onPinLost: (position) => moveTo(Math.min(position, index.size() - 1)),
        onSettled: () => {
            const key = pool?.pinned();
            if (key === undefined) return;
            const i = pool?.slotOfKey(key);
            const active = activeSlot();
            if (i !== undefined && active !== undefined && active.dataset['slot'] !== String(i)) focusSlot(i);
        }
    });

    const onKey = (): void => index.setKey(text(keyPath, 'id'));
    const onOverscan = (): void => pool?.schedule();
    const onSelected = (): void => {
        selection = readSelection();
        pool?.syncSelection();
    };
    const onRange = (): void => {
        const next = readWindow(store.get<unknown>(windowPath));
        if (sameWindow(next, raised)) return;
        raised = next;
        element.dispatchEvent(new CustomEvent('range', { detail: { ...next, total: index.size() }, bubbles: true, composed: true }));
    };
    const syncRowcount = (): void => {
        if (disposed) return;
        const count = store.get<unknown>(countPath);
        if (text(rolePath, 'list') === 'table' && typeof count === 'number') {
            if (store.get<unknown>(rowcountPath) !== count) store.set(rowcountPath, count);
        } else if (store.get<unknown>(rowcountPath) !== undefined) {
            store.delete(rowcountPath);
        }
    };
    const syncMultiselectable = (): void => {
        if (disposed) return;
        if (text(rolePath, 'list') === 'listbox') element.setAttribute('aria-multiselectable', store.get<unknown>(multiPath) === true ? 'true' : 'false');
        else element.removeAttribute('aria-multiselectable');
    };
    const syncLoading = (): void => {
        if (disposed) return;
        const loading = store.get<unknown>(loadingPath) === true;
        if (loading) element.setAttribute('aria-busy', 'true');
        else element.removeAttribute('aria-busy');
        const win = readWindow(store.get<unknown>(windowPath));
        const rows = loading ? win.count : 0;
        const first = loading ? win.first : 0;
        if (store.get<unknown>(loadingRowsPath) !== rows) store.set(loadingRowsPath, rows);
        if (store.get<unknown>(loadingFirstPath) !== first) store.set(loadingFirstPath, first);
    };
    const watched = [rolePath, countPath];
    const multiWatched = [rolePath, multiPath];
    const loadingWatched = [loadingPath, ...windowPaths];
    store.on([keyPath], onKey);
    store.on([overscanPath], onOverscan);
    store.on(windowPaths, onRange);
    store.on(watched, syncRowcount);
    store.on(multiWatched, syncMultiselectable);
    store.on(selectedPaths, onSelected);
    store.on(loadingWatched, syncLoading);

    //the view is drawn once the controller has returned, so the observers start in the next microtask, after the pool
    const start = (attempts: number): void => {
        if (disposed) return;
        const root = element.shadowRoot;
        const scroller = root?.querySelector('.list');
        const probe = root?.querySelector('.probe');
        const rows = root?.querySelector('.rows');
        if (!scroller || !probe || !rows) {
            if (attempts > 0) queueMicrotask(() => start(attempts - 1));
            return;
        }
        observer = createViewportObserver({
            scroller,
            probe,
            onWindow: (next) => store.set(windowPath, { first: next.first, count: next.count })
        });
        syncRowcount();
        syncMultiselectable();
        syncLoading();
    };
    queueMicrotask(() => start(8));

    host.locate = (key) => index.locate(key);
    host.keyAt = (position) => index.keyAt(position);
    host.recordKeys = () => index.loadedKeys();
    host.invalidate = () => pool?.invalidate();
    host.commands = {
        scrollTo: (value) => {
            const key = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
            const position = key === '' ? undefined : index.positionOf(key);
            if (position === undefined) throw new Error(`recordList: no record has the key "${key}"`);
            reveal(position, 'start');
        }
    };

    return {
        onKeyDown: (event: KeyboardEvent) => {
            if (event.altKey || event.ctrlKey || event.metaKey || pool === undefined || text(rolePath, 'list') === 'tree') return;
            const origin = event.composedPath()[0];
            if (origin instanceof HTMLElement && (TEXT_ENTRY.has(origin.localName) || origin.isContentEditable)) return;
            const slot = slotOf(event);
            const current = slot === undefined ? undefined : pool.positionOfSlot(Number(slot.dataset['slot']));
            if (current === undefined) return;
            const page = Math.max(1, readWindow(store.get<unknown>(windowPath)).count - 1);
            const steps: Record<string, number> = {
                ArrowDown: current + 1,
                ArrowUp: current - 1,
                Home: 0,
                End: index.size() - 1,
                PageDown: current + page,
                PageUp: current - page
            };
            const target = Object.hasOwn(steps, event.key) ? steps[event.key] : undefined;
            if (target === undefined) return;
            event.preventDefault();
            moveTo(target);
        },
        onFocusIn: (event: FocusEvent) => {
            const slot = slotOf(event);
            if (slot === undefined) return;
            pool?.pin(pool.keyOfSlot(Number(slot.dataset['slot'])));
        },
        onFocusOut: (event: FocusEvent) => {
            const next = event.relatedTarget;
            const list = part('.list');
            if (next instanceof Node && list?.contains(next)) return;
            pool?.pin(undefined);
        },
        dispose: () => {
            disposed = true;
            store.off([keyPath], onKey);
            store.off([overscanPath], onOverscan);
            store.off(windowPaths, onRange);
            store.off(watched, syncRowcount);
            store.off(multiWatched, syncMultiselectable);
            store.off(selectedPaths, onSelected);
            store.off(loadingWatched, syncLoading);
            observer?.dispose();
            observer = undefined;
            index.dispose();
            pool?.dispose();
            pool = undefined;
            element.removeAttribute('aria-busy');
            element.removeAttribute('aria-multiselectable');
            delete host.locate;
            delete host.keyAt;
            delete host.recordKeys;
            delete host.invalidate;
            delete host.slotMeta;
            delete host.commands;
        }
    };
}
