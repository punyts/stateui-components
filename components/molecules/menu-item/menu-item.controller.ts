import type { ControllerContext } from '@punyts/stateui';

/**
 * `press` fires once per activation: a click, or Enter or Space on the focused button, which the browser turns into a
 * click. A disabled button gets no click, and the handler checks `disabled` as well
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    return {
        onClick: () => {
            if (store.get(`${basePath}.disabled`) === true) return;
            element.dispatchEvent(new CustomEvent('press', { bubbles: true, composed: true }));
        }
    };
}
