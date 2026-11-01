import type { ControllerContext } from '@punyts/stateui';
import { createField } from '../shared/field/field.js';

interface CommandHost {
    commands?: Record<string, () => void>;
}

/**
 * The multi-line field on the field contract (`createField`), with `autoGrow` and a way to send its text. The `send` command
 * raises the event `send` with the text (trimmed) unless the field is disabled, read-only or locked, or the text is empty.
 * With `sendOnEnter`, Enter does the same and Shift+Enter still adds a line; Enter with another modifier is left alone, and Enter while an
 * input method is composing text is left to the method. The field does not clear itself: the application decides what sending
 * does, usually the `clear` command
 */
export default function controller(context: ControllerContext) {
    const { element, store, basePath } = context;
    const host = element as Element & CommandHost;
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

    const send = (): boolean => {
        if (store.get<boolean>(`${basePath}.disabled`) === true || store.get<boolean>(`${basePath}.readonly`) === true || store.get<boolean>(`${basePath}.locked`) === true) return false;
        const value = store.get<unknown>(`${basePath}.value`);
        const text = typeof value === 'string' ? value.trim() : '';
        if (text === '') return false;
        element.dispatchEvent(new CustomEvent('send', { detail: text, bubbles: true, composed: true }));
        return true;
    };
    host.commands = { ...host.commands, send: () => void send() };

    return {
        ...field,
        // The native input event is composed; the field raises its own `change`, so the native one stops here
        onInput: (event: Event) => {
            event.stopPropagation();
            fit();
        },
        onKeyDown: (event: KeyboardEvent) => {
            if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
            if (store.get<boolean>(`${basePath}.sendOnEnter`) !== true) return;
            event.preventDefault();
            send();
        },
        dispose: () => {
            store.off(watched, refit);
            field.dispose();
        }
    };
}
