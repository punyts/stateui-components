import type { ControllerContext } from '@punyts/stateui';
import { createPopover, isAlignedPlacement } from '../shared/popover/popover.js';
import type { AnyPlacement, PopoverHandle } from '../shared/popover/popover.js';
import { describedElement } from '../shared/popover/tipMixin.js';

interface CommandHost {
    commands?: Record<string, () => void>;
}

const ANCHOR = '--m';
/** The anchor of a context menu: the point of no size the pointer put it at */
const POINT_ANCHOR = '--mp';
/** How long a touch must rest to open a context menu, and how far it may move meanwhile */
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 10;
const DEFAULT_ANCHOR: AnyPlacement = 'bottomStart';

/**
 * Owns `open`. The commands, a press on the trigger, Escape, an outside press and a choice all write it, and every
 * change of it, whoever wrote it, shows or hides the popup (the popover API, `src/shared/popover/`) and raises `close`
 * once when it goes from open to closed. A press from an item raises `select` with the item key and closes the menu.
 * Focus goes to the first enabled item on open and back to the trigger after Escape, a choice or a command; after an
 * outside press it stays where the user pressed.
 *
 * With `anchor: "pointer"` the menu is a context menu of its trigger, which is then a region (a card, a row, a canvas)
 * rather than a button: a press does not toggle it, and it opens at the pointer on a right-click (the browser's own
 * menu is suppressed), on a touch or pen held still for half a second, and at the trigger on Shift+F10 or the
 * ContextMenu key. The point is written as `--sui-x` and `--sui-y` on a fixed box of no size that the popup is
 * anchored to, so it flips to stay on screen; no layout is read
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
    const atPointer = (): boolean => store.get<unknown>(anchorPath) === 'pointer';
    /** Whether the menu opened at a point, so it is anchored there rather than to the trigger */
    let pointed = false;
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
        if (atPointer()) return;
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
            handle.setAnchor(pointed ? POINT_ANCHOR : ANCHOR);
            handle.setPlacement(placementOf());
            handle.open();
            focusItem(0);
            return;
        }
        popover?.close();
        pointed = false;
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
    /** Opens the menu at a point of the viewport; an open one moves there */
    const openAt = (x: number, y: number): void => {
        const point = part('.point');
        point?.style.setProperty('--sui-x', `${x}px`);
        point?.style.setProperty('--sui-y', `${y}px`);
        pointed = true;
        if (isOpen()) {
            popover?.setAnchor(POINT_ANCHOR);
            focusItem(0);
        } else setOpen(true);
    };
    let press: { id: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | undefined;
    /** Set when a long press opened the menu, so the click and context menu the browser sends after it do nothing */
    let pressed = false;
    const endPress = (): void => {
        if (press) clearTimeout(press.timer);
        press = undefined;
    };
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
        onTriggerClick: (event: MouseEvent) => {
            if (!atPointer()) {
                setOpen(!isOpen());
                return;
            }
            if (pressed) event.preventDefault();
            pressed = false;
        },
        onContextMenu: (event: MouseEvent) => {
            if (!atPointer()) return;
            event.preventDefault();
            if (pressed) return;
            openAt(event.clientX, event.clientY);
        },
        onPointerDown: (event: PointerEvent) => {
            endPress();
            pressed = false;
            if (!atPointer() || event.pointerType === 'mouse' || !event.isPrimary) return;
            const { clientX: x, clientY: y, pointerId: id } = event;
            press = {
                id,
                x,
                y,
                timer: setTimeout(() => {
                    press = undefined;
                    pressed = true;
                    openAt(x, y);
                }, LONG_PRESS_MS)
            };
        },
        onPointerMove: (event: PointerEvent) => {
            if (press && event.pointerId === press.id && Math.hypot(event.clientX - press.x, event.clientY - press.y) > LONG_PRESS_SLOP) endPress();
        },
        onPointerEnd: () => endPress(),
        onTriggerKeyDown: (event: KeyboardEvent) => {
            if (atPointer()) {
                if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
                event.preventDefault();
                pointed = false;
                if (!isOpen()) setOpen(true);
                return;
            }
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
            endPress();
            store.off(watched, sync);
            store.off([anchorPath], syncPlacement);
            popover?.dispose();
            delete host.commands;
        }
    };
}
