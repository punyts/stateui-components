import type { ControllerContext } from '@punyts/stateui';

/**
 * Owns which item is current. `active` is an item key; the controller writes `selected` on the `menuItem` child whose
 * key equals it and clears it on the others, so the item draws itself current (`aria-current`) with no code of its own.
 * A `press` that comes from an item sets `active` to the item's key and raises `select` with that key; presses from the
 * header and footer slots are not item presses and are left alone.
 *
 * In an app with screens the active item follows the route: when `$.route.screen` changes, `active` becomes the key of
 * the item whose `screen` names it (an item with a `screen` raises `sui-navigate` itself). A press of such an item
 * leaves `active` to the route, so a refused navigation does not mark the item current
 */
const ROUTE_PATH = '$.route';
const ROUTE_WATCHED = [ROUTE_PATH, `${ROUTE_PATH}.$all`];

export default function controller({ element, store, basePath }: ControllerContext) {
    const activePath = `${basePath}.active`;
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
    followRoute();
    sync();
    return {
        onPress: (event: Event) => {
            const key = itemKeyOf(event);
            if (key === undefined) return;
            if (screenOf(key) === '' || store.get<unknown>(ROUTE_PATH) === undefined) store.set(activePath, key);
            element.dispatchEvent(new CustomEvent('select', { detail: key, bubbles: true, composed: true }));
        },
        dispose: () => {
            store.off(watched, sync);
            store.off(ROUTE_WATCHED, followRoute);
        }
    };
}
