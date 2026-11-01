import type { ControllerContext } from '@punyts/stateui';
import { runtimePath } from '@punyts/stateui-app/core';
import { createRecordIndex } from '../shared/records/recordIndex.js';
import { columnsFor, createGridViewport } from '../shared/records/gridViewport.js';
import type { GridViewport } from '../shared/records/gridViewport.js';
import { createRowLayout, layoutWindow } from '../shared/records/rowLayout.js';
import { createSlotMeasure } from '../shared/records/slotMeasure.js';
import type { SlotMeasure } from '../shared/records/slotMeasure.js';
import { createSlotPool } from '../shared/records/slotPool.js';
import type { SlotPool } from '../shared/records/slotPool.js';
import { readWindow, sameWindow } from '../shared/records/window.js';

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
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const keyPath = `${basePath}.key`;
    const overscanPath = `${basePath}.overscan`;
    const countPath = `${basePath}.count`;
    const colCountPath = `${basePath}.colCount`;
    const rowCountPath = `${basePath}.rowCount`;
    const contentPath = `${basePath}.contentHeight`;
    const windowPath = `${runtimePath(basePath)}.window`;
    let pool: SlotPool | undefined;
    let viewport: GridViewport | undefined;
    let measurer: SlotMeasure | undefined;
    let mutations: MutationObserver | undefined;
    let disposed = false;
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
        const win = layoutWindow(layout, measure.scrollTop, measure.height, columns);
        if (!sameWindow(win, readWindow(store.get<unknown>(windowPath)))) store.set(windowPath, win);
        shown = win;
        pool?.syncOffsets();
        if (anchor !== undefined && anchor !== measure.scrollTop) {
            const top = anchor;
            queueMicrotask(() => viewport?.scrollTo(top));
        }
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
        if (!changed) return;
        const delta = layout.offsetOfRow(anchorRow) - before;
        if (delta !== 0 && scrollTop > 0) {
            writeShape();
            viewport.scrollTo(scrollTop + delta);
        }
        recompute();
    };

    pool = createSlotPool({
        store,
        nodePath: basePath,
        rowPath: `${basePath}.row`,
        viewPath: `${basePath}.slots`,
        countPath,
        index,
        overscan: () => overscanRows() * columns,
        offset: (position) => layout.offsetOf(position),
        onSettled: () => queueMicrotask(syncMeasured)
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
    queueMicrotask(() => start(8));

    return {
        dispose: () => {
            disposed = true;
            store.off([keyPath], onKey);
            store.off([overscanPath], onOverscan);
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
        }
    };
}
