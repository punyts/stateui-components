import type { ControllerContext } from '@punyts/stateui';
import { createPopover } from '../shared/popover/popover.js';
import type { PopoverHandle } from '../shared/popover/popover.js';

const ANCHOR = '--g';

/**
 * Joined buttons from the keyed `actions`, in order; a press raises `action` with the key. With `split` only the first
 * action is a button, and a second half (the chevron) opens a menu of the others in the top layer, anchored under the
 * group: a press or the Down and Up arrows on it open the menu with the focus on the first or last item, the arrows,
 * Home and End move through the items, a choice raises `action` and closes it, and Escape closes it; both return the
 * focus to the chevron. An outside press closes it and leaves the focus where the user pressed. The runtime `open` is
 * the menu's state
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const openPath = `${basePath}.open`;
    const isOpen = (): boolean => store.get<unknown>(openPath) === true;
    const part = (selector: string): HTMLElement | null => element.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
    const items = (): HTMLButtonElement[] =>
        Array.from(element.shadowRoot?.querySelectorAll<HTMLButtonElement>('.item') ?? []).filter((item) => !item.hidden && !item.disabled);
    const focused = (): number => items().findIndex((item) => element.shadowRoot?.activeElement === item);

    let popover: PopoverHandle | undefined;
    let restoreFocus = true;
    let first: 'first' | 'last' = 'first';
    const popoverOf = (): PopoverHandle | undefined => {
        if (popover) return popover;
        const menu = part('.menu');
        const more = part('.more');
        if (!menu || !more) return undefined;
        popover = createPopover({
            element: menu,
            anchor: ANCHOR,
            placement: 'bottomEnd',
            inside: [more],
            onDismiss: (reason) => {
                restoreFocus = reason === 'escape';
                store.set(openPath, false);
            }
        });
        return popover;
    };

    let last = false;
    const sync = (): void => {
        const open = isOpen() && store.get<unknown>(`${basePath}.split`) === true;
        if (open === last) return;
        last = open;
        if (open) {
            popoverOf()?.open();
            const list = items();
            (first === 'last' ? list[list.length - 1] : list[0])?.focus();
            first = 'first';
            return;
        }
        popover?.close();
        if (restoreFocus) part('.more')?.focus();
        restoreFocus = true;
        if (isOpen()) store.set(openPath, false);
    };
    const watched = [openPath, `${basePath}.split`];
    store.on(watched, sync);
    queueMicrotask(sync);

    const setOpen = (open: boolean): void => {
        if (isOpen() !== open) store.set(openPath, open);
    };
    return {
        onAction: (event: Event): void => {
            const key = (event.currentTarget as HTMLElement | null)?.dataset['key'];
            if (key === undefined) return;
            element.dispatchEvent(new CustomEvent('action', { detail: key, bubbles: true, composed: true }));
            setOpen(false);
        },
        onToggle: (): void => setOpen(!isOpen()),
        onMoreKeyDown: (event: KeyboardEvent): void => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            first = event.key === 'ArrowUp' ? 'last' : 'first';
            setOpen(true);
        },
        onMenuKeyDown: (event: KeyboardEvent): void => {
            const list = items();
            if (list.length === 0) return;
            const current = focused();
            const next =
                event.key === 'ArrowDown' ? (current + 1) % list.length
                : event.key === 'ArrowUp' ? (current <= 0 ? list.length - 1 : current - 1)
                : event.key === 'Home' ? 0
                : event.key === 'End' ? list.length - 1
                : event.key === 'Tab' ? -2
                : -1;
            if (next === -1) return;
            if (next === -2) {
                // Tab leaves the menu, which closes it without taking the focus back
                restoreFocus = false;
                setOpen(false);
                return;
            }
            event.preventDefault();
            list[next]?.focus();
        },
        dispose: (): void => {
            store.off(watched, sync);
            popover?.dispose();
        }
    };
}
