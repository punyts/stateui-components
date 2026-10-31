import type { ControllerContext } from '@punyts/stateui';
import { createPopover, isAlignedPlacement } from '../shared/popover/popover.js';
import type { AnyPlacement, PopoverHandle } from '../shared/popover/popover.js';
import { describedElement } from '../shared/popover/tipMixin.js';

interface CommandHost {
    commands?: Record<string, () => void>;
}

const ANCHOR = '--m';
const DEFAULT_ANCHOR: AnyPlacement = 'bottomStart';

/**
 * Owns `open`. The commands, a press on the trigger, Escape, an outside press and a choice all write it, and every
 * change of it, whoever wrote it, shows or hides the popup (the popover API, `src/shared/popover/`) and raises `close`
 * once when it goes from open to closed. A press from an item raises `select` with the item key and closes the menu.
 * Focus goes to the first enabled item on open and back to the trigger after Escape, a choice or a command; after an
 * outside press it stays where the user pressed
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as Element & CommandHost;
    const openPath = `${basePath}.open`;
    const anchorPath = `${basePath}.anchor`;
    const childrenPath = `${basePath}.children`;
    const isOpen = (): boolean => store.get<unknown>(openPath) === true;
    const placementOf = (): AnyPlacement => {
        const anchor = store.get<unknown>(anchorPath);
        return isAlignedPlacement(anchor) ? anchor : DEFAULT_ANCHOR;
    };
    const part = (selector: string): HTMLElement | null => element.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
    const triggerControl = (): HTMLElement | null => {
        const content = part('.trigger')?.firstElementChild;
        const control = content ? describedElement(content) : null;
        return control instanceof HTMLElement ? control : null;
    };
    const itemButtons = (): HTMLButtonElement[] =>
        Array.from(part('.popup')?.querySelectorAll('sui-node') ?? [])
            .map((node) => node.firstElementChild?.shadowRoot?.querySelector('button') ?? null)
            .filter((button): button is HTMLButtonElement => button !== null && !button.disabled);
    const focusItem = (index: number): void => itemButtons()[index]?.focus();
    const syncTrigger = (): void => {
        const control = triggerControl();
        if (!control) return;
        control.setAttribute('aria-haspopup', 'menu');
        control.setAttribute('aria-expanded', isOpen() ? 'true' : 'false');
    };

    let popover: PopoverHandle | undefined;
    let restoreFocus = true;
    const popoverOf = (): PopoverHandle | undefined => {
        if (popover) return popover;
        const popup = part('.popup');
        const trigger = part('.trigger');
        if (!popup || !trigger) return undefined;
        popover = createPopover({
            element: popup,
            placement: placementOf(),
            anchor: ANCHOR,
            inside: [trigger],
            onDismiss: (reason) => {
                restoreFocus = reason === 'escape';
                store.set(openPath, false);
            }
        });
        return popover;
    };

    let last = false;
    const sync = (): void => {
        const open = isOpen();
        syncTrigger();
        if (open === last) return;
        last = open;
        if (open) {
            const handle = popoverOf();
            if (!handle) {
                last = false;
                store.set(openPath, false);
                return;
            }
            handle.setPlacement(placementOf());
            handle.open();
            focusItem(0);
            return;
        }
        popover?.close();
        if (restoreFocus) triggerControl()?.focus();
        restoreFocus = true;
        element.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
    };
    const syncPlacement = (): void => popover?.setPlacement(placementOf());
    const watched = [openPath, childrenPath, `${childrenPath}.$all`];
    store.on(watched, sync);
    store.on([anchorPath], syncPlacement);
    queueMicrotask(sync);

    const setOpen = (open: boolean): void => store.set(openPath, open);
    host.commands = {
        open: () => setOpen(true),
        close: () => setOpen(false),
        toggle: () => setOpen(!isOpen())
    };

    const itemKeyOf = (event: Event): string | undefined => {
        const prefix = `${childrenPath}.`;
        for (const node of event.composedPath()) {
            if (!(node instanceof Element) || node.localName !== 'sui-node') continue;
            const state = node.getAttribute('state');
            if (state?.startsWith(prefix) && !state.slice(prefix.length).includes('.')) return state.slice(prefix.length);
        }
        return undefined;
    };
    const focused = (button: HTMLButtonElement): boolean => {
        const root = button.getRootNode();
        return root instanceof ShadowRoot && root.activeElement === button;
    };
    const target = (buttons: HTMLButtonElement[], key: string): number | undefined => {
        if (buttons.length === 0) return undefined;
        const current = buttons.findIndex(focused);
        if (key === 'Home') return 0;
        if (key === 'End') return buttons.length - 1;
        if (key === 'ArrowDown') return current < 0 ? 0 : (current + 1) % buttons.length;
        if (key === 'ArrowUp') return current < 0 ? buttons.length - 1 : (current - 1 + buttons.length) % buttons.length;
        return undefined;
    };
    return {
        onTriggerClick: () => setOpen(!isOpen()),
        onTriggerKeyDown: (event: KeyboardEvent) => {
            if (isOpen() || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
            event.preventDefault();
            setOpen(true);
        },
        onKeyDown: (event: KeyboardEvent) => {
            const next = target(itemButtons(), event.key);
            if (next === undefined) return;
            event.preventDefault();
            focusItem(next);
        },
        onPress: (event: Event) => {
            const key = itemKeyOf(event);
            if (key === undefined) return;
            element.dispatchEvent(new CustomEvent('select', { detail: key, bubbles: true, composed: true }));
            setOpen(false);
        },
        dispose: () => {
            store.off(watched, sync);
            store.off([anchorPath], syncPlacement);
            popover?.dispose();
            delete host.commands;
        }
    };
}
