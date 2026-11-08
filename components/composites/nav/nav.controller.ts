import type { ControllerContext } from '@punyts/stateui';
import { BREAKPOINTS } from '@punyts/stateui-app/core';

/**
 * Owns which item is current. `active` is an item key; the controller writes `selected` on the `menuItem` child whose
 * key equals it and clears it on the others, so the item draws itself current (`aria-current`) with no code of its own.
 * A `press` that comes from an item sets `active` to the item's key and raises `select` with that key; presses from the
 * header and footer slots are not item presses and are left alone.
 *
 * In an app with screens the active item follows the route: when `$.route.screen` changes, `active` becomes the key of
 * the item whose `screen` names it (an item with a `screen` raises `sui-navigate` itself). A press of such an item
 * leaves `active` to the route, so a refused navigation does not mark the item current.
 *
 * Collapses on a narrow layout: the runtime property `compact` is true while the layout the nav is placed in (the
 * nearest `[layout-host]` above it, across shadow roots; the page without one) is narrower than the `collapseBelow`
 * breakpoint (`BREAKPOINTS`, the same widths at which layouts stack; `none` never collapses). That width does not depend
 * on the nav, so collapsing cannot flip it back. A compact nav is a menu button (`aria-expanded`, `aria-controls`) and
 * shows its items as a panel only while `open`. The button toggles `open`; a press on the scrim, Escape (focus goes back
 * to the button) and a press of an item close it, and a nav that stops being compact closes. `open` is plain state, so
 * an agent can write it
 */
const ROUTE_PATH = '$.route';
const ROUTE_WATCHED = [ROUTE_PATH, `${ROUTE_PATH}.$all`];

/** The nearest element above `element` that hosts a layout, crossing shadow roots; the root element without one */
function layoutContainer(element: Element): Element {
    let current: Node | null = element.parentNode;
    while (current !== null) {
        if (current instanceof Element && current.hasAttribute('layout-host')) return current;
        current = current instanceof ShadowRoot ? current.host : current.parentNode;
    }
    return element.ownerDocument.documentElement;
}

export default function controller({ element, store, basePath }: ControllerContext) {
    const activePath = `${basePath}.active`;
    const compactPath = `${basePath}.compact`;
    const openPath = `${basePath}.open`;
    const belowPath = `${basePath}.collapseBelow`;
    const isCompact = (): boolean => store.get<unknown>(compactPath) === true;
    const isOpen = (): boolean => store.get<unknown>(openPath) === true;
    const close = (): void => {
        if (isOpen()) store.set(openPath, false);
    };
    let width = 0;
    const evaluate = (): void => {
        const below = store.get<unknown>(belowPath);
        const limit = typeof below === 'string' && below in BREAKPOINTS ? BREAKPOINTS[below as keyof typeof BREAKPOINTS] : 0;
        const compact = width > 0 && width < limit;
        if (isCompact() === compact) return;
        store.set(compactPath, compact);
        if (!compact) close();
    };
    const childrenPath = `${basePath}.children`;
    const screenOf = (key: string): string => {
        const screen = store.get<unknown>(`${childrenPath}.${key}.screen`);
        return typeof screen === 'string' ? screen : '';
    };
    const followRoute = (): void => {
        const screen = store.get<unknown>(`${ROUTE_PATH}.screen`);
        const children = store.get<unknown>(childrenPath);
        if (typeof screen !== 'string' || screen === '' || children === null || typeof children !== 'object') return;
        const key = Object.keys(children).find((candidate) => screenOf(candidate) === screen);
        if (key !== undefined && store.get<unknown>(activePath) !== key) store.set(activePath, key);
    };
    const sync = (): void => {
        const children = store.get<unknown>(childrenPath);
        if (children === null || typeof children !== 'object') return;
        const active = store.get<unknown>(activePath);
        for (const [key, child] of Object.entries(children)) {
            if (child === null || typeof child !== 'object' || (child as { component?: unknown }).component !== 'menuItem') continue;
            const selected = active !== '' && active === key;
            if ((child as { selected?: unknown }).selected !== selected) store.set(`${childrenPath}.${key}.selected`, selected);
        }
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
    const watched = [activePath, childrenPath, `${childrenPath}.$all`];
    store.on(watched, sync);
    store.on(ROUTE_WATCHED, followRoute);
    store.on(belowPath, evaluate);
    followRoute();
    sync();
    let frame = 0;
    const container = layoutContainer(element);
    const observer = new ResizeObserver((entries) => {
        const box = entries[entries.length - 1]?.contentRect;
        // a container with no box (a hidden screen) leaves compact as it was
        if (box === undefined || box.width <= 0) return;
        width = box.width;
        if (frame !== 0) return;
        // the layout change of compact must not land inside the observer callback (a resize loop)
        frame = requestAnimationFrame(() => {
            frame = 0;
            evaluate();
        });
    });
    observer.observe(container);
    return {
        onToggle: () => store.set(openPath, !isOpen()),
        onClose: close,
        onKeyDown: (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || !isCompact() || !isOpen()) return;
            event.preventDefault();
            close();
            element.shadowRoot?.querySelector<HTMLElement>('.toggle')?.focus();
        },
        onPress: (event: Event) => {
            const key = itemKeyOf(event);
            if (key === undefined) return;
            if (isCompact()) close();
            if (screenOf(key) === '' || store.get<unknown>(ROUTE_PATH) === undefined) store.set(activePath, key);
            element.dispatchEvent(new CustomEvent('select', { detail: key, bubbles: true, composed: true }));
        },
        dispose: () => {
            observer.disconnect();
            if (frame !== 0) cancelAnimationFrame(frame);
            store.off(belowPath, evaluate);
            store.off(watched, sync);
            store.off(ROUTE_WATCHED, followRoute);
        }
    };
}
