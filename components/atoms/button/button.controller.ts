import type { ControllerContext } from '@punyts/stateui';
import { registerTipMixins } from '../shared/popover/tipMixin.js';

registerTipMixins();

interface CommandHost {
    commands?: Record<string, () => void>;
}

/**
 * `press` fires once per activation: a click, or Enter or Space on the focused button, which the browser turns into a
 * click. A disabled button gets no click; a busy one does, so it stays focusable, and the handler ignores it.
 * An icon-only button also shows its `_title` as a tip (the `tip` directive of the view, `src/shared/popover/`)
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as Element & CommandHost;
    host.commands = {
        focus: () => element.shadowRoot?.querySelector<HTMLButtonElement>('button')?.focus()
    };
    return {
        onClick: () => {
            if (store.get(`${basePath}.disabled`) === true || store.get(`${basePath}.busy`) === true) return;
            element.dispatchEvent(new CustomEvent('press', { bubbles: true, composed: true }));
        },
        dispose: () => {
            delete host.commands;
        }
    };
}
