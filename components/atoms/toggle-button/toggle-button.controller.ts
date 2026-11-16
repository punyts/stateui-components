import type { ControllerContext } from '@punyts/stateui';

interface CommandHost {
    commands?: Record<string, () => void>;
}

/**
 * A toggle button (`aria-pressed`): a press, or Enter or Space on the focused button, flips `pressed` and raises
 * `change` with the new value. A disabled button gets no click. `change` is raised for what the user does, not for a
 * write to `pressed`. An icon-only button (`iconPosition: "only"`) is named by `_text`
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as Element & CommandHost;
    host.commands = {
        focus: () => element.shadowRoot?.querySelector<HTMLButtonElement>('button')?.focus()
    };
    return {
        onClick: () => {
            if (store.get<unknown>(`${basePath}.disabled`) === true) return;
            const pressed = store.get<unknown>(`${basePath}.pressed`) !== true;
            store.set(`${basePath}.pressed`, pressed);
            element.dispatchEvent(new CustomEvent('change', { detail: pressed, bubbles: true, composed: true }));
        },
        dispose: () => {
            delete host.commands;
        }
    };
}
