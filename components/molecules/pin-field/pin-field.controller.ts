import type { ControllerContext } from '@punyts/stateui';
import { createField } from '../shared/field/field.js';
import { boxForKey, currentBox, deleteAt, pinChars, pinLength, typeAt } from '../shared/pin/pin.js';

interface CommandHost {
    commands?: Record<string, () => void>;
}

/** One box as the view draws it: its character, its accessible name and whether it is the tab stop */
interface Box {
    readonly char: string;
    readonly label: string;
    readonly tab: number;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * A one-time code or PIN on the field base. `value` is the code typed so far, one character per box, never with a gap;
 * `length` boxes (4 to 8, default 6) take digits, or letters too with `alphanumeric`, and `masked` hides them as a
 * password does. The boxes are one group named by `_label`, each named by `_digit` (`{index}`, `{count}`); the first has
 * `autocomplete="one-time-code"`, so a code the system offers fills them all. Only the box that takes the next character
 * is a tab stop. Typing writes the box and moves on, Backspace clears the box (or the one before an empty box) and moves
 * back, Delete clears the box, the arrows (swapped in right-to-left text), Home and End move, and a paste fills the
 * boxes from the first with the characters it holds. Focus never lands past the first empty box. `complete`
 * (`{ value }`) is raised whenever the value becomes full. A partly typed code fails the rule `incomplete`, an empty
 * one `required` when it is required, so a required code is a full one. The runtime `boxes` holds what the view draws
 */
export default function controller(context: ControllerContext) {
    const { element, store, basePath } = context;
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const valuePath = `${basePath}.value`;
    const count = (): number => pinLength(read('length'));
    const value = (): string => text(read('value')).slice(0, count());
    const field = createField(context, 'value', {
        entryRule: () => {
            const typed = value();
            return typed !== '' && typed.length < count() ? 'incomplete' : '';
        }
    });

    const inputs = (): HTMLInputElement[] => Array.from(element.shadowRoot?.querySelectorAll<HTMLInputElement>('input.cell') ?? []);
    const refresh = (): void => {
        const typed = value();
        const total = count();
        const current = currentBox(typed, total);
        const template = text(read('_digit'));
        const boxes: Record<string, Box> = {};
        for (let index = 0; index < total; index++) {
            const label = template.replaceAll('{index}', String(index + 1)).replaceAll('{count}', String(total));
            boxes[`b${index}`] = { char: typed[index] ?? '', label, tab: index === current ? 0 : -1 };
        }
        store.set(`${basePath}.boxes`, boxes);
        // A box may hold text the value refused (a letter in a digit box); it shows the value again
        inputs().forEach((input, index) => {
            const char = typed[index] ?? '';
            if (input.value !== char) input.value = char;
        });
    };
    let full = value().length === count();
    const onValue = (): void => {
        refresh();
        const now = value().length === count();
        if (now && !full) element.dispatchEvent(new CustomEvent('complete', { detail: { value: value() }, bubbles: true, composed: true }));
        full = now;
    };
    const watched = [`${basePath}.length`, `${basePath}._digit`];
    store.on(valuePath, onValue);
    store.on(watched, refresh);
    refresh();

    const blocked = (): boolean => read('disabled') === true || read('locked') === true || read('readonly') === true;
    const focusBox = (index: number): void => {
        const input = inputs()[index];
        if (!input) return;
        input.focus();
        input.select();
    };
    const indexOf = (event: Event): number => Number((event.currentTarget as HTMLElement | null)?.dataset['index'] ?? -1);
    const write = (next: string, focus: number): void => {
        if (next !== text(read('value'))) store.set(valuePath, next);
        refresh();
        focusBox(Math.min(focus, count() - 1));
    };
    const focus = (): void => focusBox(currentBox(value(), count()));
    const host = element as Element & CommandHost;
    if (host.commands) host.commands['focus'] = focus;

    return {
        ...field,
        focus,
        onInput: (event: Event) => {
            // The native input event is composed; the field raises its own `change`, so the native one stops here
            event.stopPropagation();
            const input = event.currentTarget as HTMLInputElement | null;
            const index = indexOf(event);
            if (!input || index < 0) return;
            const data = (event as InputEvent).data;
            const chars = blocked() ? '' : pinChars(data ?? input.value, read('alphanumeric') === true);
            if (chars === '') {
                refresh();
                return;
            }
            const start = Math.min(index, value().length);
            write(typeAt(value(), start, chars, count()), start + chars.length);
        },
        onPaste: (event: ClipboardEvent) => {
            event.preventDefault();
            if (blocked()) return;
            const chars = pinChars(event.clipboardData?.getData('text') ?? '', read('alphanumeric') === true).slice(0, count());
            if (chars === '') return;
            write(chars, chars.length);
        },
        onKeyDown: (event: KeyboardEvent) => {
            const index = indexOf(event);
            if (index < 0) return;
            const typed = value();
            if (event.key === 'Backspace' || event.key === 'Delete') {
                event.preventDefault();
                if (blocked()) return;
                if (index < typed.length) write(deleteAt(typed, index), index);
                else if (event.key === 'Backspace' && index > 0) write(deleteAt(typed, index - 1), index - 1);
                return;
            }
            const rtl = getComputedStyle(element).direction === 'rtl';
            const target = boxForKey(event.key, index, typed, count(), rtl);
            if (target === undefined) return;
            event.preventDefault();
            focusBox(target);
        },
        onFocusBox: (event: FocusEvent) => {
            const index = indexOf(event);
            const current = currentBox(value(), count());
            if (index > current) focusBox(current);
            else (event.currentTarget as HTMLInputElement | null)?.select();
        },
        dispose: () => {
            store.off(valuePath, onValue);
            store.off(watched, refresh);
            field.dispose();
        }
    };
}
