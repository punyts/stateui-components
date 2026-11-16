import type { ControllerContext } from '@punyts/stateui';

/** The role of the item's button inside each container that owns it: a menu's entries, and a nav's links */
const CONTAINER_ROLES: ReadonlyMap<string, string> = new Map([
    ['UI-MENU', 'menuitem'],
    ['UI-NAV', 'link']
]);

/** The DOM event the app's route step turns into navigation (`NAVIGATE_EVENT` of `@punyts/stateui-app`) */
const NAVIGATE_EVENT = 'sui-navigate';

/** The role the container whose shadow root holds this item gives it, or null for an item used on its own */
function roleOf(element: Element): string | null {
    const root = element.getRootNode();
    const host = root instanceof ShadowRoot ? root.host : undefined;
    return (host && CONTAINER_ROLES.get(host.tagName)) ?? null;
}

/**
 * `press` fires once per activation: a click, or Enter or Space on the focused button, which the browser turns into a
 * click. A disabled button gets no click, and the handler checks `disabled` as well. Inside a `menu` the button has
 * the role `menuitem` and inside a `nav` the role `link`, read once when the item attaches. An item with a `screen`
 * first raises `sui-navigate` with the screen and its `params`, which the app shows as the `navigate` command does
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    return {
        itemRole: roleOf(element),
        onClick: () => {
            if (store.get(`${basePath}.disabled`) === true) return;
            const screen = store.get<unknown>(`${basePath}.screen`);
            if (typeof screen === 'string' && screen !== '') {
                const params: unknown = JSON.parse(JSON.stringify(store.get<unknown>(`${basePath}.params`) ?? {}));
                element.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: { screen, params }, bubbles: true, composed: true }));
            }
            element.dispatchEvent(new CustomEvent('press', { bubbles: true, composed: true }));
        }
    };
}
