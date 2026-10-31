import type { ControllerContext } from '@punyts/stateui';
import { runtimePath } from '@punyts/stateui-app/core';
import { createRecordIndex } from '../shared/records/recordIndex.js';
import { createSlotPool } from '../shared/records/slotPool.js';
import type { SlotPool } from '../shared/records/slotPool.js';
import { createViewportObserver } from '../shared/records/viewport.js';
import type { ViewportObserver } from '../shared/records/viewport.js';
import { readWindow, sameWindow } from '../shared/records/window.js';
import type { RecordWindow } from '../shared/records/window.js';

/**
 * Builds the slot pool of the record view (see `src/shared/records/`): the slots live at
 * `$.runtime.nodes.<path>.slots.<i>`, are aliased at `slots` for the view to repeat over, and show the records of the
 * window at `$.runtime.nodes.<path>.window` (`{ first, count }`). The viewport observer writes that window from the
 * scroll offset, the viewport height and the row height, and `range` is raised once for each change of it
 * (`{ first, count, total }`). For the role `table` the reflected `ariaRowcount` follows the count
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const keyPath = `${basePath}.key`;
    const overscanPath = `${basePath}.overscan`;
    const rolePath = `${basePath}.role`;
    const countPath = `${basePath}.count`;
    const rowcountPath = `${basePath}.ariaRowcount`;
    const windowPath = `${runtimePath(basePath)}.window`;
    const windowPaths = [windowPath, `${windowPath}.$all`];
    let pool: SlotPool | undefined;
    let observer: ViewportObserver | undefined;
    let disposed = false;
    let raised: RecordWindow = { first: 0, count: 0 };
    const text = (path: string, fallback: string): string => {
        const value = store.get<unknown>(path);
        return typeof value === 'string' && value !== '' ? value : fallback;
    };
    const index = createRecordIndex({
        store,
        recordsPath: `${basePath}.records`,
        orderPath: `${basePath}.order`,
        key: text(keyPath, 'id'),
        onChange: (reload) => pool?.invalidate(reload)
    });
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
        }
    });
    const onKey = (): void => index.setKey(text(keyPath, 'id'));
    const onOverscan = (): void => pool?.schedule();
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
    const watched = [rolePath, countPath];
    store.on([keyPath], onKey);
    store.on([overscanPath], onOverscan);
    store.on(windowPaths, onRange);
    store.on(watched, syncRowcount);
    //the view is drawn once the controller has returned, so the observer starts in the next microtask, after the pool
    const start = (attempts: number): void => {
        if (disposed) return;
        const root = element.shadowRoot;
        const scroller = root?.querySelector('.list');
        const probe = root?.querySelector('.probe');
        if (!scroller || !probe) {
            if (attempts > 0) queueMicrotask(() => start(attempts - 1));
            return;
        }
        observer = createViewportObserver({
            scroller,
            probe,
            onWindow: (next) => store.set(windowPath, { first: next.first, count: next.count })
        });
        syncRowcount();
    };
    queueMicrotask(() => start(8));
    return {
        dispose: () => {
            disposed = true;
            store.off([keyPath], onKey);
            store.off([overscanPath], onOverscan);
            store.off(windowPaths, onRange);
            store.off(watched, syncRowcount);
            observer?.dispose();
            observer = undefined;
            index.dispose();
            pool?.dispose();
            pool = undefined;
        }
    };
}
