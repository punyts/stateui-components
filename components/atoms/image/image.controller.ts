import type { ControllerContext } from '@punyts/stateui';

/**
 * `press` fires only while `interactive`: on a click, or Enter or Space while the image has the focus. An interactive
 * image is a button named by its `_alt` (its picture then has an empty `alt`, so the name is said once)
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const interactive = (): boolean => store.get(`${basePath}.interactive`) === true;
    const press = (): void => {
        element.dispatchEvent(new CustomEvent('press', { bubbles: true, composed: true }));
    };
    return {
        onClick: () => {
            if (interactive()) press();
        },
        onKeyDown: (event: KeyboardEvent) => {
            if (!interactive() || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault();
            press();
        }
    };
}
