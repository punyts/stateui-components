import type { ControllerContext } from '@punyts/stateui';

/**
 * Owns which item is current. `active` is an item key; the controller writes `selected` on the `menuItem` child whose
 * key equals it and clears it on the others, so the item draws itself current (`aria-current`) with no code of its own.
 * A `press` that comes from an item sets `active` to the item's key and raises `select` with that key; presses from the
 * header and footer slots are not item presses and are left alone
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const activePath = `${basePath}.active`;
    const childrenPath = `${basePath}.children`;
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
    sync();
    return {
        onPress: (event: Event) => {
            const key = itemKeyOf(event);
            if (key === undefined) return;
            store.set(activePath, key);
            element.dispatchEvent(new CustomEvent('select', { detail: key, bubbles: true, composed: true }));
        },
        dispose: () => {
            store.off(watched, sync);
        }
    };
}
