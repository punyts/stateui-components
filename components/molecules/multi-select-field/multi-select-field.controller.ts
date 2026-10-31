import type { ControllerContext } from '@punyts/stateui';
import { createCombo, sameText } from '../shared/field/combo.js';
import type { ComboOption } from '../shared/field/combo.js';
import { createField } from '../shared/field/field.js';

/** What the view draws for one chosen value */
interface Chip {
    label: string;
    removeLabel: string;
}

/**
 * A multi-select field on the field base: `value` is a list, shown as chips inside the control, each with a remove
 * button named by the content `_remove` (`Remove {label}`). The input and the list are the `comboboxField`'s
 * (`src/shared/field/combo.ts`); the list stays open while options are picked, a chosen option is marked and pressing it
 * again removes it. Backspace in an empty input removes the last chip. With `allowCustom` (tag mode) Enter or a comma adds
 * the typed text, trimmed; a value already in the list is never added twice. `maxSelected` also stops adding;
 * `minSelected` and `maxSelected` are rules of the field (`minSelected` and `maxSelected` in `_errors`). The label of a
 * chosen value is kept when `options` is replaced by results that do not hold it. Leaving the field drops text that was
 * not added
 */
export default function controller(context: ControllerContext) {
    const { element, store, basePath } = context;
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const valuePath = `${basePath}.value`;
    const textPath = `${basePath}.text`;
    const control = (): HTMLInputElement | null => element.shadowRoot?.querySelector<HTMLInputElement>('#control') ?? null;
    const field = createField(context, 'value');

    const known = new Map<string, string>();
    const values = (): unknown[] => {
        const value = read('value');
        return Array.isArray(value) ? [...(value as unknown[])] : [];
    };
    const typed = (): string => {
        const value = read('text');
        return typeof value === 'string' ? value : '';
    };
    const blocked = (): boolean => read('readonly') === true || read('disabled') === true || read('locked') === true;
    const full = (): boolean => {
        const max = read('maxSelected');
        return typeof max === 'number' && max > 0 && values().length >= max;
    };
    const has = (key: string): boolean => values().some((value) => String(value) === key);
    const setText = (value: string): void => {
        store.set(textPath, value);
        const input = control();
        if (input && input.value !== value) input.value = value;
    };

    /** The chips, from the value and the options; labels the options no longer hold come from the ones seen before */
    const drawChips = (): void => {
        const options = combo.options();
        const template = typeof read('_remove') === 'string' ? (read('_remove') as string) : '{label}';
        const chips: Record<string, Chip> = {};
        values().forEach((value, index) => {
            const key = String(value);
            const found = options.find((option) => option.key === key);
            if (found) known.set(key, found.label);
            const label = found?.label ?? known.get(key) ?? key;
            chips[`c${index}`] = { label, removeLabel: template.replace('{label}', label) };
        });
        store.set(`${basePath}.chips`, chips);
    };
    let scheduled = false;
    const scheduleChips = (): void => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            drawChips();
        });
    };

    const add = (value: unknown, label: string): boolean => {
        if (blocked() || full() || has(String(value))) return false;
        known.set(String(value), label);
        store.set(valuePath, [...values(), value] as never);
        return true;
    };
    const removeAt = (index: number): void => {
        if (blocked()) return;
        const next = values();
        if (index < 0 || index >= next.length) return;
        next.splice(index, 1);
        store.set(valuePath, next as never);
    };
    const exactMatch = (text: string): ComboOption | undefined =>
        text === '' ? undefined : combo.options().find((option) => sameText(option.label, text, locale()));
    const locale = (): string => {
        const value = store.get<unknown>('$.locale');
        return typeof value === 'string' ? value : '';
    };
    /**
     * Takes the typed text as a value: the option whose label it is, else (with `allowCustom`) the text as it is, trimmed.
     * Returns false when the text is not a value (no such option and no `allowCustom`), so it stays in the input; text that
     * is already chosen, or that `maxSelected` refuses, is consumed without being added
     */
    const addTyped = (text: string): boolean => {
        const match = exactMatch(text.trim());
        if (match) {
            add(match.value, match.label);
            return true;
        }
        const custom = text.trim();
        if (read('allowCustom') !== true || custom === '') return false;
        add(custom, custom);
        return true;
    };

    const combo = createCombo(context, {
        isSelected: (option) => has(option.key),
        query: () => typed(),
        autoActive: () => read('allowCustom') !== true,
        choose: (option) => {
            if (has(option.key)) {
                removeAt(values().findIndex((value) => String(value) === option.key));
                return;
            }
            if (add(option.value, option.label)) setText('');
        },
        closeOnChoose: false
    });

    const watched = [valuePath, `${valuePath}.$all`, `${basePath}.options`, `${basePath}.options.$all`, `${basePath}.optionValue`, `${basePath}.optionLabel`, `${basePath}._remove`, '$.locale'];
    store.on(watched, scheduleChips);
    drawChips();

    return {
        ...field,
        // The native input event is composed; the field raises its own `change`, so the native one stops here
        onInput: (event: Event) => {
            event.stopPropagation();
            const input = control();
            if (!input || read('readonly') === true) return;
            let text = input.value;
            if (read('allowCustom') === true && text.includes(',')) {
                const parts = text.split(',');
                text = parts[parts.length - 1] ?? '';
                for (const part of parts.slice(0, -1)) addTyped(part);
                input.value = text;
            }
            store.set(textPath, text);
            combo.open();
            combo.refresh();
            combo.typed(text);
        },
        onKeyDown: (event: KeyboardEvent) => {
            if (combo.onKey(event)) return;
            const text = typed();
            if (event.key === 'Enter' && text.trim() !== '') {
                event.preventDefault();
                if (addTyped(text)) setText('');
                return;
            }
            if (event.key === ',' && read('allowCustom') === true) {
                event.preventDefault();
                if (addTyped(text)) setText('');
                return;
            }
            if (event.key === 'Backspace' && text === '' && !event.isComposing) {
                const count = values().length;
                if (count === 0) return;
                event.preventDefault();
                removeAt(count - 1);
            }
        },
        onBlur: () => {
            field.onBlur();
            combo.close();
            setText('');
        },
        onBoxClick: (event: Event) => {
            if (event.target === event.currentTarget) control()?.focus();
        },
        onRemove: (event: Event) => {
            const key = (event.currentTarget as HTMLElement | null)?.dataset.index;
            if (key === undefined) return;
            removeAt(Number(key.slice(1)));
            control()?.focus();
        },
        onPopupDown: combo.onPopupDown,
        onPick: combo.onPick,
        dispose: () => {
            store.off(watched, scheduleChips);
            combo.dispose();
            field.dispose();
        }
    };
}
