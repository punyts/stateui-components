import type { ControllerContext } from '@punyts/stateui';

/** Controls that keep their own click and keys: the card's `press` ignores events that start in them */
const OWN_ACTION = 'button, a[href], input, select, textarea, summary, [tabindex]';

/**
 * `press` fires only while `interactive`. A click counts unless it started in a control inside the card (a button in
 * `actions`; a `press` raised inside the card stays inside it), and Enter or Space counts only when the card itself has the focus
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const interactive = (): boolean => store.get(`${basePath}.interactive`) === true;
    const press = (): void => {
        element.dispatchEvent(new CustomEvent('press', { bubbles: true, composed: true }));
    };
    return {
        onInnerPress: (event: Event) => event.stopPropagation(),
        onClick: (event: Event) => {
            if (!interactive()) return;
            const surface = event.currentTarget as Element;
            for (const node of event.composedPath()) {
                if (node === surface) break;
                if (node instanceof Element && node.matches(OWN_ACTION)) return;
            }
            press();
        },
        onKeyDown: (event: KeyboardEvent) => {
            if (!interactive() || event.target !== event.currentTarget) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            press();
        }
    };
}
