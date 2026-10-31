import type { ControllerContext } from '@punyts/stateui';
import { createCombo, sameText } from '../shared/field/combo.js';
import type { ComboOption } from '../shared/field/combo.js';
import { createField } from '../shared/field/field.js';

const isEmptyValue = (value: unknown): boolean => value === '' || value === undefined || value === null;

/**
 * A searchable select on the field base. The input is the ARIA 1.2 combobox (`role="combobox"`, `aria-expanded`,
 * `aria-activedescendant`) and the options are a `listbox` in a popover (`src/shared/field/combo.ts`). Typing filters the
 * options by label, case- and accent-insensitive for `$.locale`; ArrowDown opens, the arrows move, Enter chooses,
 * Escape closes and restores the text. `value` is the chosen option's value; the runtime `text` is what the input shows,
 * the chosen label while nothing is being typed. Leaving the field with text that is the label of an option chooses it;
 * other text becomes the value with `allowCustom`, and otherwise the last value and its label come back. Empty text
 * clears the value. The label of the chosen value is kept when `options` no longer holds it
 */
export default function controller(context: ControllerContext) {
    const { element, store, basePath } = context;
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const valuePath = `${basePath}.value`;
    const textPath = `${basePath}.text`;
    const locale = (): string => {
        const value = store.get<unknown>('$.locale');
        return typeof value === 'string' ? value : '';
    };
    const control = (): HTMLInputElement | null => element.shadowRoot?.querySelector<HTMLInputElement>('#control') ?? null;
    const field = createField(context, 'value');

    let filtering = false;
    let remembered: { key: string; label: string } | undefined;

    const typed = (): string => {
        const value = read('text');
        return typeof value === 'string' ? value : '';
    };
    /** The label that stands for the current value */
    const labelOfValue = (): string => {
        const value = read('value');
        if (isEmptyValue(value)) return '';
        const key = String(value);
        const found = combo.options().find((option) => option.key === key);
        if (found) {
            remembered = { key, label: found.label };
            return found.label;
        }
        return remembered?.key === key ? remembered.label : key;
    };
    const setText = (value: string): void => {
        store.set(textPath, value);
        const input = control();
        if (input && input.value !== value) input.value = value;
    };
    const showValue = (): void => {
        filtering = false;
        setText(labelOfValue());
    };
    const setValue = (value: unknown): void => {
        if (read('readonly') === true || read('disabled') === true || read('locked') === true) return;
        store.set(valuePath, value as never);
    };
    const chooseOption = (option: ComboOption): void => {
        remembered = { key: option.key, label: option.label };
        filtering = false;
        setValue(option.value);
        setText(option.label);
    };
    const exactMatch = (text: string): ComboOption | undefined =>
        text === '' ? undefined : combo.options().find((option) => sameText(option.label, text, locale()));

    const combo = createCombo(context, {
        isSelected: (option) => {
            const value = read('value');
            return !isEmptyValue(value) && String(value) === option.key;
        },
        query: () => (filtering ? typed() : ''),
        autoActive: () => read('allowCustom') !== true,
        choose: chooseOption,
        closeOnChoose: true,
        onEscape: showValue
    });

    /** Applies the typed text when the user is done with it */
    const settle = (): void => {
        if (!filtering) return;
        const text = typed();
        const match = exactMatch(text);
        if (text.trim() === '') {
            filtering = false;
            setValue('');
            setText('');
        } else if (match) chooseOption(match);
        else if (read('allowCustom') === true) {
            const custom = text.trim();
            remembered = { key: custom, label: custom };
            filtering = false;
            setValue(custom);
            setText(custom);
        } else showValue();
    };

    const onExternal = (): void => {
        if (!filtering) setText(labelOfValue());
    };
    const watched = [valuePath, `${basePath}.options`, `${basePath}.options.$all`, `${basePath}.optionValue`, `${basePath}.optionLabel`, '$.locale'];
    store.on(watched, onExternal);
    showValue();

    return {
        ...field,
        // The native input event is composed; the field raises its own `change`, so the native one stops here
        onInput: (event: Event) => {
            event.stopPropagation();
            const input = control();
            if (!input || read('readonly') === true) return;
            filtering = true;
            store.set(textPath, input.value);
            combo.open();
            combo.refresh();
            combo.typed(input.value);
        },
        onKeyDown: (event: KeyboardEvent) => {
            if (combo.onKey(event)) return;
            if (event.key !== 'Enter' || !combo.isOpen()) return;
            event.preventDefault();
            settle();
            combo.close();
        },
        onBlur: () => {
            field.onBlur();
            combo.close();
            settle();
        },
        onPopupDown: combo.onPopupDown,
        onPick: combo.onPick,
        dispose: () => {
            store.off(watched, onExternal);
            combo.dispose();
            field.dispose();
        }
    };
}
