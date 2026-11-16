import type { ControllerContext } from '@punyts/stateui';

/**
 * A row of chips, one per entry of `items` (`{ text, icon? }`), in the map's order. With `removable` each chip has a `×`
 * button named by `_remove` (`{text}` is the chip's text): a press, or Delete or Backspace on it, raises `remove` with the
 * entry's key as `detail`, and moves the focus to the next chip's button (or the previous one at the end) so a keyboard
 * user can go on. The list does not remove the entry itself; the app drops it from its data on `remove`. Nothing is
 * raised while `disabled`
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const blocked = (): boolean => store.get<unknown>(`${basePath}.disabled`) === true || store.get<unknown>(`${basePath}.removable`) !== true;
    const remove = (button: HTMLElement | null): void => {
        const key = button?.dataset['key'];
        if (blocked() || key === undefined) return;
        // The focus goes to a neighbour before the app takes this chip away with its button
        const buttons = Array.from(element.shadowRoot?.querySelectorAll<HTMLButtonElement>('.remove') ?? []);
        const index = buttons.indexOf(button as HTMLButtonElement);
        const next = buttons[index + 1] ?? buttons[index - 1];
        if (button === element.shadowRoot?.activeElement) next?.focus();
        element.dispatchEvent(new CustomEvent('remove', { detail: key, bubbles: true, composed: true }));
    };
    return {
        removeLabel: (template: unknown, text: unknown): string => (typeof template === 'string' ? template : '').replaceAll('{text}', typeof text === 'string' ? text : ''),
        onRemove: (event: Event) => remove(event.currentTarget as HTMLElement | null),
        onKeyDown: (event: KeyboardEvent) => {
            if (event.key !== 'Delete' && event.key !== 'Backspace') return;
            event.preventDefault();
            remove(event.currentTarget as HTMLElement | null);
        }
    };
}
