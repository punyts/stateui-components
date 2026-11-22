import type { ControllerContext } from '@punyts/stateui';
import { createPopover } from '../shared/popover/popover.js';
import type { PopoverHandle } from '../shared/popover/popover.js';

interface CommandHost {
    commands?: Record<string, () => void>;
}

/**
 * A toggletip. `open` shows the note in the top layer next to the button, on the reflected `side`. A press on the button
 * toggles it; keyboard focus opens it, and the focus leaving the button, Escape or a press elsewhere closes it. A press
 * that also focuses the button only toggles, so it does not open and close at once. The note is a `role="status"` region
 * whose text is written only while it is open, so a screen reader reads it as it appears. Hover does nothing: the note
 * must be reachable on touch and by keyboard alike. `open` and `close` are raised once per change, not at load
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as Element & CommandHost;
    const openPath = `${basePath}.open`;
    const isOpen = (): boolean => store.get<unknown>(openPath) === true;
    const setOpen = (open: boolean): void => {
        if (isOpen() !== open) store.set(openPath, open);
    };
    const part = (selector: string): HTMLElement | null => element.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;

    let popover: PopoverHandle | undefined;
    const popoverOf = (): PopoverHandle | undefined => {
        if (popover) return popover;
        const note = part('.note');
        const toggle = part('.toggle');
        if (!note || !toggle) return undefined;
        popover = createPopover({ element: note, inside: [toggle], onDismiss: () => setOpen(false) });
        return popover;
    };

    let last = false;
    let announce = false;
    const sync = (): void => {
        const open = isOpen();
        if (open === last) return;
        last = open;
        if (open) popoverOf()?.open();
        else popover?.close();
        if (announce) element.dispatchEvent(new CustomEvent(open ? 'open' : 'close', { bubbles: true, composed: true }));
    };
    store.on([openPath], sync);
    queueMicrotask(() => {
        sync();
        announce = true;
    });

    let pressing = false;
    host.commands = {
        open: () => setOpen(true),
        close: () => setOpen(false),
        toggle: () => setOpen(!isOpen())
    };
    return {
        onPointerDown: (): void => {
            pressing = true;
        },
        onFocus: (): void => {
            if (!pressing) setOpen(true);
        },
        onBlur: (): void => {
            pressing = false;
            setOpen(false);
        },
        onToggle: (): void => {
            pressing = false;
            setOpen(!isOpen());
        },
        dispose: (): void => {
            store.off([openPath], sync);
            popover?.dispose();
            delete host.commands;
        }
    };
}
