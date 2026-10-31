import type { ControllerContext } from '@punyts/stateui';
import { createPopover, isAlignedPlacement } from '../shared/popover/popover.js';
import type { AnyPlacement, PopoverHandle } from '../shared/popover/popover.js';
import { describedElement } from '../shared/popover/tipMixin.js';

interface CommandHost {
    commands?: Record<string, () => void>;
}

const ANCHOR = '--p';
const DEFAULT_ANCHOR: AnyPlacement = 'bottomStart';
const FOCUSABLE = 'button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

/** The first enabled focusable element under the root in document order, looking through open shadow roots */
function firstFocusable(root: ParentNode): HTMLElement | undefined {
    for (const child of Array.from(root.children)) {
        if (child.matches(FOCUSABLE) && child instanceof HTMLElement && !child.matches(':disabled')) return child;
        const inner = (child.shadowRoot ? firstFocusable(child.shadowRoot) : undefined) ?? firstFocusable(child);
        if (inner) return inner;
    }
    return undefined;
}

/**
 * Owns `open`. The commands, a press on the trigger, Escape and an outside press all write it, and every change of it,
 * whoever wrote it, shows or hides the panel (the popover API, `src/shared/popover/`) and raises `open` or `close` once
 * per change (an open popover at load raises nothing). While `dismissible` is false Escape and outside presses do
 * nothing; the commands and a write to `open` still close it. Focus moves to the first focusable element of the body on
 * open (the panel itself when there is none) and returns to the trigger after Escape, a command or a write; after an
 * outside press it stays where the user pressed. The trigger's first focusable element gets `aria-haspopup="dialog"`
 * and `aria-expanded`
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as Element & CommandHost;
    const openPath = `${basePath}.open`;
    const anchorPath = `${basePath}.anchor`;
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
    const syncTrigger = (): void => {
        const control = triggerControl();
        if (!control) return;
        control.setAttribute('aria-haspopup', 'dialog');
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
            dismissible: () => store.get<unknown>(`${basePath}.dismissible`) !== false,
            onDismiss: (reason) => {
                restoreFocus = reason === 'escape';
                store.set(openPath, false);
            }
        });
        return popover;
    };
    const raise = (name: string): void => {
        element.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
    };

    let last = false;
    let announce = false;
    const sync = (): void => {
        const open = isOpen();
        syncTrigger();
        if (open === last) return;
        if (open) {
            const handle = popoverOf();
            if (!handle) {
                store.set(openPath, false);
                return;
            }
            last = true;
            handle.setPlacement(placementOf());
            handle.open();
            const popup = part('.popup');
            const body = popup ? firstFocusable(popup) : undefined;
            (body ?? popup)?.focus();
            if (announce) raise('open');
            return;
        }
        last = false;
        popover?.close();
        if (restoreFocus) triggerControl()?.focus();
        restoreFocus = true;
        raise('close');
    };
    const syncPlacement = (): void => popover?.setPlacement(placementOf());
    const watched = [openPath, `${basePath}.trigger`, `${basePath}.trigger.$all`];
    store.on(watched, sync);
    store.on([anchorPath], syncPlacement);
    queueMicrotask(() => {
        sync();
        announce = true;
    });

    const setOpen = (open: boolean): void => store.set(openPath, open);
    host.commands = {
        open: () => setOpen(true),
        close: () => setOpen(false),
        toggle: () => setOpen(!isOpen())
    };
    return {
        onTriggerClick: () => setOpen(!isOpen()),
        dispose: () => {
            store.off(watched, sync);
            store.off([anchorPath], syncPlacement);
            popover?.dispose();
            delete host.commands;
        }
    };
}
