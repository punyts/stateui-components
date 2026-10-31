import type { ControllerContext } from '@punyts/stateui';

/** Controls that keep their own click and keys: the card's `press` ignores events that start in them */
const OWN_ACTION = 'button, a[href], input, select, textarea, summary, [tabindex]';

/**
 * `press` fires only while `interactive`. A click counts unless it started in a control inside the card (a button in
 * `actions`; a `press` raised inside the card stays inside it), and Enter or Space counts only when the card itself has the focus.
 * The host carries `aria-busy` while `loading`
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const interactive = (): boolean => store.get(`${basePath}.interactive`) === true;
    const press = (): void => {
        element.dispatchEvent(new CustomEvent('press', { bubbles: true, composed: true }));
    };
    const syncBusy = (): void => {
        if (store.get(`${basePath}.loading`) === true) element.setAttribute('aria-busy', 'true');
        else element.removeAttribute('aria-busy');
    };
    store.on([`${basePath}.loading`], syncBusy);
    syncBusy();
    return {
        dispose: () => {
            store.off([`${basePath}.loading`], syncBusy);
        },
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
