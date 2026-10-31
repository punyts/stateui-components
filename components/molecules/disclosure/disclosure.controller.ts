import type { ControllerContext } from '@punyts/stateui';

interface CommandHost {
    commands?: Record<string, () => void>;
}

/**
 * Owns `open`. The commands `open`, `close` and `toggle` and the header button write it, and every change of it,
 * whoever wrote it, raises `toggle` with `{ open }` (none for the state it had at load). A closed body is hidden by the
 * view, not removed, so the children keep their state. A disabled disclosure ignores the header button; the commands
 * and a write to `open` still work
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as Element & CommandHost;
    const openPath = `${basePath}.open`;
    const isOpen = (): boolean => store.get<unknown>(openPath) === true;
    let last = isOpen();
    const raise = (): void => {
        const open = isOpen();
        if (open === last) return;
        last = open;
        element.dispatchEvent(new CustomEvent('toggle', { detail: { open }, bubbles: true, composed: true }));
    };
    const toggle = (): void => store.set(openPath, !isOpen());
    host.commands = {
        open: () => store.set(openPath, true),
        close: () => store.set(openPath, false),
        toggle
    };
    store.on([openPath], raise);
    return {
        onToggle: () => {
            if (store.get<unknown>(`${basePath}.disabled`) !== true) toggle();
        },
        dispose: () => {
            store.off([openPath], raise);
            delete host.commands;
        }
    };
}
