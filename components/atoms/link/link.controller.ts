interface LinkContext {
    element: Element;
    state: { href?: string; screen?: string; params?: unknown };
}

/** The DOM event the app's route step turns into navigation (`NAVIGATE_EVENT` of `@punyts/stateui-app`) */
const NAVIGATE_EVENT = 'sui-navigate';

/**
 * The browser never follows the link: the click is cancelled and `press` carries the `href`, so the application decides
 * what to do with `on`. A link with a `screen` first raises `sui-navigate` with the screen and its `params`, which the
 * app shows as the `navigate` command does. A click (and Enter on the focused anchor, which the browser turns into a
 * click) raises one `press`
 */
export default function link({ element, state }: LinkContext): { activate(event: Event): void } {
    return {
        activate(event: Event): void {
            event.preventDefault();
            const screen = state.screen ?? '';
            if (screen !== '') {
                const params: unknown = JSON.parse(JSON.stringify(state.params ?? {}));
                element.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: { screen, params }, bubbles: true, composed: true }));
            }
            element.dispatchEvent(new CustomEvent('press', { detail: { href: state.href ?? '' }, bubbles: true, composed: true }));
        }
    };
}
