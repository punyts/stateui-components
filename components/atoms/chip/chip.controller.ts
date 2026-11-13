import type { ControllerContext } from '@punyts/stateui';

interface CommandHost {
    commands?: Record<string, () => void>;
}

/**
 * A selectable chip is a toggle button (`aria-pressed`): a press flips `selected` and raises `change` (`detail`: the new
 * `selected`). A removable chip has a `×` button named by `_remove` (`{text}` is the chip's `_text`): a press raises
 * `remove`, and so do Delete and Backspace on either button. The chip does not remove itself; the app drops it from its
 * data on `remove`. A disabled chip does neither. Both events are raised for what the user does, not for a write to
 * `selected`
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const blocked = (): boolean => store.get<unknown>(`${basePath}.disabled`) === true;
    const raise = (name: string, detail?: unknown): void => {
        element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
    };
    const removable = (): boolean => store.get<unknown>(`${basePath}.removable`) === true;
    const remove = (): void => {
        if (blocked() || !removable()) return;
        raise('remove');
    };
    const host = element as Element & CommandHost;
    host.commands = {
        focus: () => element.shadowRoot?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    };
    return {
        removeLabel: (template: unknown, text: unknown): string => (typeof template === 'string' ? template : '').replaceAll('{text}', typeof text === 'string' ? text : ''),
        onToggle: () => {
            if (blocked()) return;
            const selected = store.get<unknown>(`${basePath}.selected`) !== true;
            store.set(`${basePath}.selected`, selected);
            raise('change', selected);
        },
        onRemove: remove,
        onKeyDown: (event: KeyboardEvent) => {
            if ((event.key !== 'Delete' && event.key !== 'Backspace') || !removable()) return;
            event.preventDefault();
            remove();
        },
        dispose: () => {
            delete host.commands;
        }
    };
}
