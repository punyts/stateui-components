import type { ControllerContext } from '@punyts/stateui';

interface CommandHost {
    commands?: Record<string, () => void>;
}

export default function controller({ element, store, basePath }: ControllerContext) {
    const control = (): HTMLInputElement | null => element.shadowRoot?.querySelector('input') ?? null;
    const raise = (name: 'change' | 'search'): void => {
        element.dispatchEvent(new CustomEvent(name, { detail: control()?.value ?? '', bubbles: true, composed: true }));
    };
    const clear = (): void => {
        store.set(`${basePath}.value`, '');
        control()?.focus();
    };
    const host = element as Element & CommandHost;
    host.commands = {
        focus: () => control()?.focus(),
        clear
    };
    return {
        // The native input and search events are not the component's: it raises its own `change` and `search`
        onInput: (event: Event) => event.stopPropagation(),
        onSearch: (event: Event) => event.stopPropagation(),
        onChange: () => raise('change'),
        onKeydown: (event: KeyboardEvent) => {
            if (event.key === 'Enter' && !event.isComposing) raise('search');
        },
        onClear: clear,
        dispose: () => {
            delete host.commands;
        }
    };
}
