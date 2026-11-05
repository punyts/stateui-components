import type { ControllerContext } from '@punyts/stateui';

const ROUTE_PATH = '$.route';
const WATCHED = [ROUTE_PATH, `${ROUTE_PATH}.$all`];

/**
 * Shows nothing of its own: the app's mount appends each screen's container to this element, and the view's slot shows
 * them, the visible one without `hidden`. When `$.route.screen` names another screen, focus moves to the outlet
 * (without scrolling), so keyboard and screen reader users start at the new screen instead of the control that
 * navigated. The first screen does not take focus, and a change of params alone does not move it
 */
export default function controller({ element, store }: ControllerContext) {
    const screen = (): unknown => store.get<unknown>(`${ROUTE_PATH}.screen`);
    let shown = screen();
    const follow = (): void => {
        const next = screen();
        if (next === shown) return;
        shown = next;
        element.shadowRoot?.querySelector<HTMLElement>('.outlet')?.focus({ preventScroll: true });
    };
    store.on(WATCHED, follow);
    return {
        dispose: () => {
            store.off(WATCHED, follow);
        }
    };
}
