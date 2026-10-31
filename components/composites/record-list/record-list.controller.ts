import type { ControllerContext } from '@punyts/stateui';
import { createRecordIndex } from '../shared/records/recordIndex.js';
import { createSlotPool } from '../shared/records/slotPool.js';
import type { SlotPool } from '../shared/records/slotPool.js';

/**
 * Builds the slot pool of the record view (see `src/shared/records/`): the slots live at
 * `$.runtime.nodes.<path>.slots.<i>`, are aliased at `slots` for the view to repeat over, and show the records of the
 * window at `$.runtime.nodes.<path>.window` (`{ first, count }`, written by the observer). `count` is the number of
 * positions
 */
export default function controller({ store, basePath }: ControllerContext) {
    const keyPath = `${basePath}.key`;
    const overscanPath = `${basePath}.overscan`;
    let pool: SlotPool | undefined;
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
        countPath: `${basePath}.count`,
        index,
        overscan: () => {
            const value = store.get<unknown>(overscanPath);
            return typeof value === 'number' ? value : 5;
        }
    });
    const onKey = (): void => index.setKey(text(keyPath, 'id'));
    const onOverscan = (): void => pool?.schedule();
    store.on([keyPath], onKey);
    store.on([overscanPath], onOverscan);
    return {
        dispose: () => {
            store.off([keyPath], onKey);
            store.off([overscanPath], onOverscan);
            index.dispose();
            pool?.dispose();
            pool = undefined;
        }
    };
}
