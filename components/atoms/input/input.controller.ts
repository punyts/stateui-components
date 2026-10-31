import type { ControllerContext } from '@punyts/stateui';

interface CommandHost {
    commands?: Record<string, () => void>;
}

/** The input's current value as the events and `value` carry it: a number for a number input, null when it is empty */
function readValue(control: HTMLInputElement): string | number | null {
    if (control.type !== 'number') return control.value;
    return Number.isNaN(control.valueAsNumber) ? null : control.valueAsNumber;
}

export default function controller({ element, store, basePath }: ControllerContext) {
    const control = (): HTMLInputElement | null => element.shadowRoot?.querySelector('input') ?? null;
    const raise = (name: 'input' | 'change'): void => {
        const current = control();
        if (current) element.dispatchEvent(new CustomEvent(name, { detail: readValue(current), bubbles: true, composed: true }));
    };
    const host = element as Element & CommandHost;
    host.commands = {
        focus: () => control()?.focus(),
        clear: () => {
            const isNumber = control()?.type === 'number';
            store.set(`${basePath}.value`, isNumber ? null : '');
        }
    };
    return {
        // The native input event is composed; the component raises its own with the value, so the native one stops here
        onInput: (event: Event) => {
            event.stopPropagation();
            raise('input');
        },
        onChange: () => raise('change'),
        dispose: () => {
            delete host.commands;
        }
    };
}
