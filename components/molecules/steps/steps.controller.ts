import type { ControllerContext } from '@punyts/stateui';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const isEntry = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Keeps the runtime `progressText` (`_progress` with `{done}` and `{total}` filled), `busy` (a step is running) and
 * `failed` (a step ended in error) in step with `items`. The header button folds and unfolds the list, sets `open`
 * and raises `toggle` with the new value; the commands `open`, `close` and `toggle` do the same from logic. An agent
 * streams its work by adding steps and rewriting their `status`
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const itemsPath = `${basePath}.items`;
    const openPath = `${basePath}.open`;
    const watched = [itemsPath, `${itemsPath}.$all`, `${basePath}._progress`];

    const put = (name: string, value: unknown): void => {
        if (store.get<unknown>(`${basePath}.${name}`) !== value) store.set(`${basePath}.${name}`, value);
    };
    const sync = (): void => {
        const items = store.get<unknown>(itemsPath);
        const statuses = isEntry(items) ? Object.values(items).map((item) => (isEntry(item) ? text(item['status']) : '')) : [];
        const done = statuses.filter((status) => status === 'done').length;
        put('progressText', text(store.get<unknown>(`${basePath}._progress`)).replace('{done}', String(done)).replace('{total}', String(statuses.length)));
        put('busy', statuses.includes('running'));
        put('failed', statuses.includes('error'));
    };
    const setOpen = (open: boolean): void => {
        if (store.get<unknown>(openPath) === open) return;
        store.set(openPath, open);
        element.dispatchEvent(new CustomEvent('toggle', { detail: open, bubbles: true, composed: true }));
    };
    store.on(watched, sync);
    sync();
    (element as Element & { commands?: Record<string, () => void> }).commands = {
        open: () => setOpen(true),
        close: () => setOpen(false),
        toggle: () => setOpen(store.get<unknown>(openPath) !== true)
    };
    return {
        onToggle: () => setOpen(store.get<unknown>(openPath) !== true),
        dispose: () => {
            store.off(watched, sync);
            delete (element as Element & { commands?: Record<string, () => void> }).commands;
        }
    };
}
