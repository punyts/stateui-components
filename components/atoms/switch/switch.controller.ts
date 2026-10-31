import type { ControllerContext } from '@punyts/stateui';

interface CommandHost {
    commands?: Record<string, () => void>;
}

export default function controller({ element, store, basePath }: ControllerContext) {
    const control = (): HTMLInputElement | null => element.shadowRoot?.querySelector('input') ?? null;
    const host = element as Element & CommandHost;
    host.commands = {
        focus: () => control()?.focus(),
        clear: () => {
            store.set(`${basePath}.checked`, false);
        }
    };
    return {
        // A read-only control keeps its state: the click is cancelled, so no change follows
        onClick: (event: Event) => {
            if (store.get<boolean>(`${basePath}.readonly`) === true) event.preventDefault();
        },
        onChange: () => {
            const current = control();
            if (current) element.dispatchEvent(new CustomEvent('change', { detail: current.checked, bubbles: true, composed: true }));
        },
        dispose: () => {
            delete host.commands;
        }
    };
}
