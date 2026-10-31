interface LinkContext {
    element: Element;
    state: { href?: string };
}

/**
 * The link never navigates: the click is cancelled and `press` carries the `href`, so the application decides what to do
 * with `on`. A click (and Enter on the focused anchor, which the browser turns into a click) raises one `press`
 */
export default function link({ element, state }: LinkContext): { activate(event: Event): void } {
    return {
        activate(event: Event): void {
            event.preventDefault();
            element.dispatchEvent(new CustomEvent('press', { detail: { href: state.href ?? '' }, bubbles: true, composed: true }));
        }
    };
}
