import type { ControllerContext } from '@punyts/stateui';

interface CommandHost {
    commands?: Record<string, () => void>;
}

/**
 * `press` fires once per activation: a click, or Enter or Space on the focused button, which the browser turns into a
 * click. A disabled button gets no click; a busy one does, so it stays focusable, and the handler ignores it
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
