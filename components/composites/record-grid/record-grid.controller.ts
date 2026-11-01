import type { ControllerContext } from '@punyts/stateui';
import { runtimePath } from '@punyts/stateui-app/core';
import { createRecordIndex } from '../shared/records/recordIndex.js';
import { bandOffset, columnsFor, createGridViewport } from '../shared/records/gridViewport.js';
import type { GridViewport } from '../shared/records/gridViewport.js';
import { createRowLayout, layoutWindow } from '../shared/records/rowLayout.js';
import { createSlotMeasure } from '../shared/records/slotMeasure.js';
import type { SlotMeasure } from '../shared/records/slotMeasure.js';
import { createSlotPool } from '../shared/records/slotPool.js';
import type { SlotPool } from '../shared/records/slotPool.js';
import type { RecordViewElement } from '../shared/records/recordView.js';
import { readWindow, sameWindow } from '../shared/records/window.js';

const TEXT_ENTRY = new Set(['input', 'textarea', 'select']);

/** How far from the end the view may be and still count as at the end, in pixels (sub-pixel scroll offsets and rounding) */
const END_TOLERANCE = 2;

/** How many animation frames the grid tries again to reach the end while the content is not yet as tall as the layout says */
const END_RETRIES = 4;

/**
 * Builds the slot pool of the record grid (see `src/shared/records/`), the same pool, link recycling, key index and window state
 * as `recordList`, but across and down. The viewport observer measures the scroller, the token `recordgrid.itemmin` and the token
 * `recordgrid.itemheight` from `ResizeObserver` entries and the scroll offset once per frame. The columns are
 * `floor(width / itemmin)`, the window is the whole rows that reach into the viewport (`first` is the first item of the topmost
 * one, `count` is rows times columns) and the pool is the columns times the visible rows plus the overscan rows on both sides,
 * at most 200 slots. Item `p` is in row `floor(p / columns)` and column `p % columns` (row-major); the slot shows them as the custom
 * properties `--sui-col` and `--sui-row`, so a change of the column count re-points slots and rewrites those properties without
 * rebuilding the slots that stay. A change of the column count keeps the first visible item at the top.
 *
 * Items differ in height. Each slot is observed with a `ResizeObserver`; a measured height goes into a height map keyed by record
 * (`createRowLayout`) and a record that is not measured counts as `itemheight`, which is also the least height of a slot. The row is
 * as tall as its tallest item, the offsets are the sums of the rows above and each slot shows its own as `--sui-offset`; the sum of
 * every row is the height of the scroll content (`contentHeight`). When a measured height above the first visible row changes,
 * `scrollTop` is written by the difference, so the visible records do not move.
 *
 * The host is `role="grid"` with `aria-rowcount` and `aria-colcount`, and each slot is a `gridcell` with `aria-rowindex` and
 * `aria-colindex`. One slot is the tab stop (the record that last had focus, otherwise the first one shown). The arrow keys move
 * by position, one item across (swapped in right-to-left text) or one row down; Home and End go to the ends of the row, Ctrl+Home
 * and Ctrl+End to the first and the last item. The target is scrolled into the window and its slot is then focused. The slot that
 * holds focus is pinned while its record is out of the window, so focus is not lost when it scrolls out, and the pin follows the
 * record when the column count changes. When a record is deleted focus moves to the record that took its place.
 *
 * Scrolling by command: `scrollTo` takes a record key and puts its row at the top (a key no record has is an error, as in
 * `recordList`), and `scrollToEnd` puts the end of the content at the bottom of the viewport. The end is worked out from the
 * layout, whose heights are estimates until the rows are measured, so after `scrollToEnd` the grid keeps the end in view while
 * the heights settle and the content grows, until the user scrolls away. With `follow` the grid does so from the start: it
 * stays at the end while records are added, a measured height changes or the viewport is resized, unless the user has scrolled
 * up. The runtime property `atEnd` says whether the view is at the end. It follows the scroll position and changes only when
 * the position does, so content that grows while the user is away neither moves the view nor changes `atEnd`.
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as Element & RecordViewElement;
    const keyPath = `${basePath}.key`;
    const overscanPath = `${basePath}.overscan`;
    const countPath = `${basePath}.count`;
    const colCountPath = `${basePath}.colCount`;
    const rowCountPath = `${basePath}.rowCount`;
    const contentPath = `${basePath}.contentHeight`;
    const followPath = `${basePath}.follow`;
    const atEndPath = `${basePath}.atEnd`;
    const windowPath = `${runtimePath(basePath)}.window`;
    let revealKey: string | undefined;
    let shownRows = -1;
    let shownColumns = -1;
    let pool: SlotPool | undefined;
    let viewport: GridViewport | undefined;
    let measurer: SlotMeasure | undefined;
    let mutations: MutationObserver | undefined;
    let disposed = false;
    /** Whether the view is at the end, as of the last change of the scroll position */
    let following = true;
    /** Whether `scrollToEnd` asked to stay at the end, until the user scrolls away */
    let commanded = false;
    /** Set while the grid scrolls itself, so that its own scroll is not read as the user leaving the end */
    let scrolling = false;
    let seenTop = 0;
    let endFrame = 0;
    let endPending = false;
    let columns = 1;
    let shown = { first: 0, count: 0 };
    /** The slot elements being measured, with the record each showed when it was last asked to report */
    const watched = new Map<HTMLElement, string | undefined>();

    const text = (path: string, fallback: string): string => {
        const value = store.get<unknown>(path);
        return typeof value === 'string' && value !== '' ? value : fallback;
    };
    const overscanRows = (): number => {
        const value = store.get<unknown>(overscanPath);
        return typeof value === 'number' && value >= 0 ? Math.floor(value) : 2;
    };

    const layout = createRowLayout({
        total: () => index.size(),
        keyAt: (position) => index.keyAt(position),
        positionOf: (key) => index.positionOf(key)
    });
    const index = createRecordIndex({
        store,
        recordsPath: `${basePath}.records`,
        orderPath: `${basePath}.order`,
        key: text(keyPath, 'id'),
        onChange: (reload) => {
            layout.invalidate();
            pool?.invalidate(reload);
            recompute();
        }
    });

    /** Writes the rows and the height of the scroll content from the layout */
    const writeShape = (): void => {
        const rows = layout.rows();
        if (store.get<unknown>(rowCountPath) !== rows) store.set(rowCountPath, rows);
        const height = layout.height();
        if (store.get<unknown>(contentPath) !== height) store.set(contentPath, height);
    };

    /** Puts the size of the grid on the host as `aria-rowcount` and `aria-colcount` */
    function syncGrid(): void {
        const rows = layout.rows();
        if (rows !== shownRows) {
            shownRows = rows;
            element.setAttribute('aria-rowcount', String(rows));
        }
        if (columns !== shownColumns) {
            shownColumns = columns;
            element.setAttribute('aria-colcount', String(columns));
        }
    }

    /** Writes the columns, the rows, the height and the window from the last measurement; the pool follows the window */
    function recompute(): void {
        if (disposed || viewport === undefined) return;
        const measure = viewport.current();
        const next = columnsFor(measure.width, measure.itemMin);
        layout.configure(next, measure.itemHeight);
        let anchor: number | undefined;
        if (next !== columns) {
            if (shown.count > 0) anchor = layout.offsetOf(shown.first);
            columns = next;
            pool?.invalidate();
        }
        if (store.get<unknown>(colCountPath) !== columns) store.set(colCountPath, columns);
        writeShape();
        syncGrid();
        const win = layoutWindow(layout, measure.scrollTop, measure.height, columns);
        if (!sameWindow(win, readWindow(store.get<unknown>(windowPath)))) store.set(windowPath, win);
        shown = win;
        pool?.syncOffsets();
        if (anchor !== undefined && anchor !== measure.scrollTop) {
            const top = anchor;
            queueMicrotask(() => correct(top));
        }
        trackEnd(measure);
    }

    /** Moves the scroll position because the layout changed, not because the user did: whether the view is at the end is left as it was */
    function correct(offset: number): void {
        if (viewport === undefined) return;
        scrolling = true;
        try {
            viewport.scrollTo(offset);
        } finally {
            scrolling = false;
        }
    }

    /** Whether a viewport at an offset shows the end of the content */
    const nearEnd = (measure: { scrollTop: number; height: number }): boolean => measure.scrollTop + measure.height >= layout.height() - END_TOLERANCE;

    const sticks = (): boolean => following && (commanded || store.get<unknown>(followPath) === true);

    /**
     * Follows the end. A change of the scroll position (not one the grid made itself) says whether the user is at the end or
     * has left it, and leaving ends a `scrollToEnd`; a change of the content alone changes nothing about that. While the grid
     * sticks to the end and the end is out of view, it scrolls there once this pass is over
     */
    function trackEnd(measure: { scrollTop: number; height: number }): void {
        if (!scrolling && measure.scrollTop !== seenTop) {
            following = nearEnd(measure);
            if (!following) commanded = false;
        }
        seenTop = measure.scrollTop;
        if (store.get<unknown>(atEndPath) !== following) store.set(atEndPath, following);
        if (!scrolling && sticks() && measure.height > 0 && !nearEnd(measure)) aimAtEnd(END_RETRIES);
    }

    /** The offset that puts the end of the content at the bottom of the viewport */
    const endOffset = (): number => Math.max(0, layout.height() - (viewport?.current().height ?? 0));

    /**
     * Scrolls to the end of the layout. The content element may not be as tall as the layout yet (it follows the store a
     * moment later), in which case the browser stops short; the grid tries again in the next frames while it still sticks
     */
    function aimAtEnd(attempts: number): void {
        if (endFrame !== 0 || endPending || disposed) return;
        endPending = true;
        queueMicrotask(() => {
            endPending = false;
            if (disposed || viewport === undefined || !sticks()) return;
            scrolling = true;
            try {
                viewport.scrollTo(endOffset());
            } finally {
                scrolling = false;
            }
            const measure = viewport.current();
            seenTop = measure.scrollTop;
            if (nearEnd(measure) || attempts <= 0 || measure.height <= 0) return;
            endFrame = requestAnimationFrame(() => {
                endFrame = 0;
                if (!disposed && sticks() && viewport !== undefined && !nearEnd(viewport.current())) aimAtEnd(attempts - 1);
            });
        });
    }

    /** Takes the heights the slots reported; a change above the first visible row moves `scrollTop` so the visible records stay */
    const onMeasure = (measures: { slot: number; height: number }[]): void => {
        if (disposed || viewport === undefined || pool === undefined) return;
        viewport.measure();
        const scrollTop = viewport.current().scrollTop;
        const anchorRow = layout.rowAt(scrollTop);
        const before = layout.offsetOfRow(anchorRow);
        let changed = false;
        for (const { slot, height } of measures) {
            const key = pool.keyOfSlot(slot);
            if (key === undefined || pool.positionOfSlot(slot) === undefined) continue;
            if (layout.measure(key, height)) changed = true;
        }
        if (!changed) {
            revealKey = undefined;
            return;
        }
        const delta = layout.offsetOfRow(anchorRow) - before;
        if (delta !== 0 && scrollTop > 0) {
            writeShape();
            correct(scrollTop + delta);
        }
        recompute();
        const target = revealKey === undefined ? undefined : index.positionOf(revealKey);
        if (target !== undefined) reveal(target);
    };

    const part = (selector: string): HTMLElement | null => element.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
    const slotOf = (event: Event): HTMLElement | undefined => {
        for (const node of event.composedPath()) {
            if (node instanceof HTMLElement && node.classList.contains('slot') && node.dataset['slot'] !== undefined) return node;
        }
        return undefined;
    };
    const activeSlot = (): HTMLElement | undefined => element.shadowRoot?.activeElement?.closest<HTMLElement>('.slot') ?? undefined;
    const focusSlot = (i: number, attempts = 2): void => {
        const slot = part(`.slot[data-slot="${i}"]`);
        if (!slot || disposed) return;
        slot.focus({ preventScroll: true });
        if (activeSlot() !== slot && attempts > 0) queueMicrotask(() => focusSlot(i, attempts - 1));
    };
    const focusPosition = (position: number): void => {
        const i = pool?.slotAt(position);
        if (i !== undefined) focusSlot(i);
    };

    /** Scrolls the row of a position into the viewport, as little as possible; the scroll reports the window at once */
    function reveal(position: number): void {
        if (viewport === undefined) return;
        const measure = viewport.current();
        if (!(measure.height > 0)) return;
        const row = layout.rowOf(position);
        const next = bandOffset(layout.offsetOfRow(row), layout.heightOfRow(row), measure.scrollTop, measure.height, layout.height(), 'nearest');
        if (next !== measure.scrollTop) viewport.scrollTo(next);
    }

    function moveTo(position: number): void {
        const total = index.size();
        if (total === 0 || pool === undefined) return;
        const target = Math.min(Math.max(0, position), total - 1);
        const key = index.keyAt(target);
        pool.pin(key);
        revealKey = key;
        reveal(target);
        pool.refresh();
        focusPosition(target);
    }

    pool = createSlotPool({
        store,
        nodePath: basePath,
        rowPath: `${basePath}.row`,
        viewPath: `${basePath}.slots`,
        countPath,
        index,
        overscan: () => overscanRows() * columns,
        offset: (position) => layout.offsetOf(position),
        onPinLost: (position) => moveTo(Math.min(position, index.size() - 1)),
        onSettled: () => {
            queueMicrotask(syncMeasured);
            const key = pool?.pinned();
            if (key === undefined) return;
            const i = pool?.slotOfKey(key);
            const active = activeSlot();
            if (i !== undefined && active !== undefined && active.dataset['slot'] !== String(i)) focusSlot(i);
        }
    });

    /** Observes each slot element once, and again when it shows another record, so a record whose height equals the last one's is measured too */
    function syncMeasured(): void {
        if (disposed || measurer === undefined || pool === undefined) return;
        const root = element.shadowRoot;
        if (!root) return;
        const present = new Set<HTMLElement>();
        for (const slot of root.querySelectorAll<HTMLElement>('.slot')) {
            present.add(slot);
            const key = pool.keyOfSlot(Number(slot.dataset['slot']));
            if (!watched.has(slot)) {
                watched.set(slot, key);
                measurer.observe(slot);
            } else if (watched.get(slot) !== key) {
                watched.set(slot, key);
                measurer.refresh(slot);
            }
        }
        for (const slot of [...watched.keys()]) {
            if (present.has(slot)) continue;
            watched.delete(slot);
            measurer.unobserve(slot);
        }
    }

    const onKey = (): void => index.setKey(text(keyPath, 'id'));
    const onOverscan = (): void => pool?.schedule();
    store.on([keyPath], onKey);
    store.on([overscanPath], onOverscan);

    //the view is drawn once the controller has returned, so the observers start in the next microtask, after the pool
    const start = (attempts: number): void => {
        if (disposed) return;
        const root = element.shadowRoot;
        const scroller = root?.querySelector('.grid');
        const probe = root?.querySelector('.probe');
        const rows = root?.querySelector('.rows');
        if (!scroller || !probe || !rows) {
            if (attempts > 0) queueMicrotask(() => start(attempts - 1));
            return;
        }
        measurer = createSlotMeasure({ onMeasure });
        mutations = new MutationObserver(syncMeasured);
        mutations.observe(rows, { childList: true });
        viewport = createGridViewport({ scroller, probe, onChange: recompute });
        syncMeasured();
    };
    element.setAttribute('role', 'grid');
    queueMicrotask(() => start(8));

    host.commands = {
        scrollTo: (value) => {
            const key = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
            const position = key === '' ? undefined : index.positionOf(key);
            if (position === undefined || viewport === undefined) throw new Error(`recordGrid: no record has the key "${key}"`);
            const measure = viewport.current();
            const row = layout.rowOf(position);
            commanded = false;
            viewport.scrollTo(bandOffset(layout.offsetOfRow(row), layout.heightOfRow(row), measure.scrollTop, measure.height, layout.height(), 'start'));
        },
        scrollToEnd: () => {
            following = true;
            commanded = true;
            aimAtEnd(END_RETRIES);
        }
    };
    const onFollow = (): void => recompute();
    store.on([followPath], onFollow);

    /** The position a key moves the focus to from a position, or `undefined` for a key that does nothing here */
    const targetOf = (event: KeyboardEvent, current: number): number | undefined => {
        const total = index.size();
        const last = total - 1;
        const rowStart = current - (current % columns);
        const rtl = element.matches(':dir(rtl)');
        const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
        const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
        if (event.key === 'Home') return event.ctrlKey ? 0 : rowStart;
        if (event.key === 'End') return event.ctrlKey ? last : Math.min(rowStart + columns - 1, last);
        if (event.ctrlKey) return undefined;
        if (event.key === forward) return current % columns < columns - 1 ? Math.min(current + 1, last) : current;
        if (event.key === backward) return current % columns > 0 ? current - 1 : current;
        if (event.key === 'ArrowUp') return current < columns ? current : current - columns;
        if (event.key === 'ArrowDown') {
            if (current + columns <= last) return current + columns;
            return Math.floor(last / columns) > Math.floor(current / columns) ? last : current;
        }
        return undefined;
    };

    return {
        onKeyDown: (event: KeyboardEvent) => {
            if (event.altKey || event.metaKey || pool === undefined) return;
            const origin = event.composedPath()[0];
            if (origin instanceof HTMLElement && (TEXT_ENTRY.has(origin.localName) || origin.isContentEditable)) return;
            const slot = slotOf(event);
            const current = slot === undefined ? undefined : pool.positionOfSlot(Number(slot.dataset['slot']));
            if (current === undefined) return;
            const target = targetOf(event, current);
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
            const grid = part('.grid');
            if (next instanceof Node && grid?.contains(next)) return;
            pool?.pin(undefined);
        },
        dispose: () => {
            disposed = true;
            store.off([keyPath], onKey);
            store.off([overscanPath], onOverscan);
            store.off([followPath], onFollow);
            if (endFrame !== 0) cancelAnimationFrame(endFrame);
            endFrame = 0;
            delete host.commands;
            mutations?.disconnect();
            mutations = undefined;
            measurer?.dispose();
            measurer = undefined;
            watched.clear();
            viewport?.dispose();
            viewport = undefined;
            index.dispose();
            pool?.dispose();
            pool = undefined;
            element.removeAttribute('role');
            element.removeAttribute('aria-rowcount');
            element.removeAttribute('aria-colcount');
        }
    };
}
