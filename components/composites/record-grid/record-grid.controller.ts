import type { ControllerContext } from '@punyts/stateui';
import { runtimePath } from '@punyts/stateui-app/core';
import { createRecordIndex } from '../shared/records/recordIndex.js';
import { columnsFor, createGridViewport, gridWindow, rowsFor } from '../shared/records/gridViewport.js';
import type { GridViewport } from '../shared/records/gridViewport.js';
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
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const keyPath = `${basePath}.key`;
    const overscanPath = `${basePath}.overscan`;
    const countPath = `${basePath}.count`;
    const colCountPath = `${basePath}.colCount`;
    const rowCountPath = `${basePath}.rowCount`;
    const windowPath = `${runtimePath(basePath)}.window`;
    let pool: SlotPool | undefined;
    let viewport: GridViewport | undefined;
    let disposed = false;
    let columns = 1;
    let shown = { first: 0, count: 0 };

    const text = (path: string, fallback: string): string => {
        const value = store.get<unknown>(path);
        return typeof value === 'string' && value !== '' ? value : fallback;
    };
    const overscanRows = (): number => {
        const value = store.get<unknown>(overscanPath);
        return typeof value === 'number' && value >= 0 ? Math.floor(value) : 2;
    };

    const index = createRecordIndex({
        store,
        recordsPath: `${basePath}.records`,
        orderPath: `${basePath}.order`,
        key: text(keyPath, 'id'),
        onChange: (reload) => {
            pool?.invalidate(reload);
            recompute();
        }
    });

    /** Writes the columns, the rows and the window from the last measurement; the pool follows the window */
    function recompute(): void {
        if (disposed || viewport === undefined) return;
        const measure = viewport.current();
        const next = columnsFor(measure.width, measure.itemMin);
        let anchor: number | undefined;
        if (next !== columns) {
            if (measure.itemHeight > 0 && shown.count > 0) anchor = Math.floor(shown.first / next) * measure.itemHeight;
            columns = next;
            pool?.invalidate();
        }
        if (store.get<unknown>(colCountPath) !== columns) store.set(colCountPath, columns);
        const rows = rowsFor(index.size(), columns);
        if (store.get<unknown>(rowCountPath) !== rows) store.set(rowCountPath, rows);
        const win = gridWindow(measure.scrollTop, measure.height, measure.itemHeight, columns);
        if (!sameWindow(win, readWindow(store.get<unknown>(windowPath)))) store.set(windowPath, win);
        shown = win;
        if (anchor !== undefined && anchor !== measure.scrollTop) {
            const top = anchor;
            queueMicrotask(() => viewport?.scrollTo(top));
        }
    }

    pool = createSlotPool({
        store,
        nodePath: basePath,
        rowPath: `${basePath}.row`,
        viewPath: `${basePath}.slots`,
        countPath,
        index,
        overscan: () => overscanRows() * columns
    });

    const onKey = (): void => index.setKey(text(keyPath, 'id'));
    const onOverscan = (): void => pool?.schedule();
    store.on([keyPath], onKey);
    store.on([overscanPath], onOverscan);

    //the view is drawn once the controller has returned, so the observer starts in the next microtask, after the pool
    const start = (attempts: number): void => {
        if (disposed) return;
        const root = element.shadowRoot;
        const scroller = root?.querySelector('.grid');
        const probe = root?.querySelector('.probe');
        if (!scroller || !probe) {
            if (attempts > 0) queueMicrotask(() => start(attempts - 1));
            return;
        }
        viewport = createGridViewport({ scroller, probe, onChange: recompute });
    };
    queueMicrotask(() => start(8));

    return {
        dispose: () => {
            disposed = true;
            store.off([keyPath], onKey);
            store.off([overscanPath], onOverscan);
            viewport?.dispose();
            viewport = undefined;
            index.dispose();
            pool?.dispose();
            pool = undefined;
        }
    };
}
