import type { ControllerContext } from '@punyts/stateui';

interface CommandHost {
    commands?: Record<string, () => void>;
}

export default function controller({ element, store, basePath }: ControllerContext) {
    const control = (): HTMLTextAreaElement | null => element.shadowRoot?.querySelector('textarea') ?? null;
    const grows = (): boolean => store.get<boolean>(`${basePath}.autoGrow`) === true;
    const fit = (): void => {
        const current = control();
        if (!current) return;
        if (!grows()) {
            current.style.removeProperty('block-size');
            return;
        }
        current.style.blockSize = 'auto';
        current.style.blockSize = `${current.scrollHeight + current.offsetHeight - current.clientHeight}px`;
    };
    const refit = (): void => queueMicrotask(fit);
    const raise = (name: 'input' | 'change'): void => {
        const current = control();
        if (current) element.dispatchEvent(new CustomEvent(name, { detail: current.value, bubbles: true, composed: true }));
    };
    const watched = [`${basePath}.value`, `${basePath}.autoGrow`, `${basePath}.rows`];
    store.on(watched, refit);
    refit();

    const host = element as Element & CommandHost;
    host.commands = {
        focus: () => control()?.focus(),
        clear: () => {
            store.set(`${basePath}.value`, '');
        }
    };
    return {
        // The native input event is composed; the component raises its own with the value, so the native one stops here
        onInput: (event: Event) => {
            event.stopPropagation();
            fit();
            raise('input');
        },
        onChange: () => raise('change'),
        dispose: () => {
            store.off(watched, refit);
            delete host.commands;
        }
    };
}
