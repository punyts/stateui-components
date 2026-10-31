import type { ControllerContext } from '@punyts/stateui';
import { createField } from '../shared/field/field.js';

export default function controller(context: ControllerContext) {
    const { element, store, basePath } = context;
    const field = createField(context);
    const control = (): HTMLTextAreaElement | null => element.shadowRoot?.querySelector('textarea') ?? null;
    const fit = (): void => {
        const current = control();
        if (!current) return;
        if (store.get<boolean>(`${basePath}.autoGrow`) !== true) {
            current.style.removeProperty('block-size');
            return;
        }
        current.style.blockSize = 'auto';
        current.style.blockSize = `${current.scrollHeight + current.offsetHeight - current.clientHeight}px`;
    };
    const refit = (): void => queueMicrotask(fit);
    const watched = [`${basePath}.value`, `${basePath}.autoGrow`, `${basePath}.rows`];
    store.on(watched, refit);
    refit();
    return {
        ...field,
        // The native input event is composed; the field raises its own `change`, so the native one stops here
        onInput: (event: Event) => {
            event.stopPropagation();
            fit();
        },
        dispose: () => {
            store.off(watched, refit);
            field.dispose();
        }
    };
}
