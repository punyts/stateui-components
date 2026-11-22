import type { ControllerContext } from '@punyts/stateui';

interface CommandHost {
    commands?: Record<string, () => void>;
}

/**
 * Text that is edited in place. A press on the text (a button described by `_hint`), or the `edit` command, copies
 * `value` into the runtime `draft`, shows an input in its place with the text selected and sets the reflected `editing`.
 * Enter or the focus leaving the input writes the trimmed draft to `value` and raises `change` with `{ value, previous }`
 * when it differs; Escape or `cancel` drops it. An empty draft of a `required` text is dropped too. Enter and Escape
 * give the focus back to the text; a blur leaves it where it went
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as Element & CommandHost;
    const path = (name: string): string => `${basePath}.${name}`;
    const read = (name: string): unknown => store.get<unknown>(path(name));
    const part = (selector: string): HTMLElement | null => element.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
    const editing = (): boolean => read('editing') === true;

    const edit = (): void => {
        if (editing() || read('disabled') === true) return;
        const value = read('value');
        store.set(path('draft'), typeof value === 'string' ? value : '');
        store.set(path('editing'), true);
        const input = part('.input');
        if (input instanceof HTMLInputElement) {
            input.focus();
            input.select();
        }
    };
    const close = (refocus: boolean): void => {
        store.set(path('editing'), false);
        if (refocus) part('.display')?.focus();
    };
    const commit = (refocus: boolean): void => {
        if (!editing()) return;
        const draft = read('draft');
        const next = typeof draft === 'string' ? draft.trim() : '';
        const previous = typeof read('value') === 'string' ? (read('value') as string) : '';
        if (!(next === '' && read('required') === true) && next !== previous) {
            store.set(path('value'), next);
            element.dispatchEvent(new CustomEvent('change', { detail: { value: next, previous }, bubbles: true, composed: true }));
        }
        close(refocus);
    };
    const cancel = (refocus: boolean): void => {
        if (editing()) close(refocus);
    };

    host.commands = { edit, cancel: () => cancel(false) };
    return {
        onEdit: edit,
        onKeyDown: (event: KeyboardEvent): void => {
            if (event.key === 'Enter') {
                event.preventDefault();
                commit(true);
            } else if (event.key === 'Escape') {
                event.preventDefault();
                cancel(true);
            }
        },
        onBlur: (): void => commit(false),
        dispose: (): void => {
            delete host.commands;
        }
    };
}
