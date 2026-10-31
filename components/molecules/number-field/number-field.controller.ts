import type { ControllerContext } from '@punyts/stateui';
import { createField } from '../shared/field/field.js';
import { NUMBER_RULE } from '../shared/field/rules.js';
import { formatNumberInput, parseNumberInput } from '../shared/format/numberInput.js';

const FALLBACK_STEP = 1;
/** Decimals kept when a step is added to a value, so `0.1 + 0.2` stays `0.3` */
const STEP_DECIMALS = 10;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * A number field on the field base. `value` is always a number (or an empty string for none): the text the user types is
 * read with `$.locale` on every input and written to `value` when it parses; text that does not parse is kept as typed,
 * writes nothing and sets `error` to `number` (the field's `entryRule`). The runtime `text` is what the input shows: it
 * follows `value`, `format`, `currency` and the language, but is never rewritten while the user types, and on blur an
 * entry that parsed is shown in the locale's own form. The buttons and the arrow keys step by `step` (1 when it is 0),
 * clamped to `min` and `max`. `min`, `max`, `step` and `required` are the base's rules
 */
export default function controller(context: ControllerContext) {
    const { element, store, basePath } = context;
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const valuePath = `${basePath}.value`;
    const textPath = `${basePath}.text`;
    const errorPath = `${basePath}.error`;
    const control = (): HTMLInputElement | null => element.shadowRoot?.querySelector<HTMLInputElement>('#control') ?? null;
    const options = (): { format: string; currency: string; locale: string } => ({
        format: text(read('format')),
        currency: text(read('currency')),
        locale: text(store.get<unknown>('$.locale'))
    });

    let entryInvalid = false;
    let writing = false;
    const field = createField(context, 'value', {
        entryRule: () => {
            if (entryInvalid) return NUMBER_RULE;
            const value = read('value');
            return value === '' || value === undefined || value === null || isNumber(value) ? '' : NUMBER_RULE;
        }
    });

    /** Shows the value in the input. The view's `value` binding sets the attribute, which a typed-in input ignores, so the property is written too */
    const showValue = (): void => {
        const shown = formatNumberInput(read('value'), options());
        store.set(textPath, shown);
        const input = control();
        if (input && input.value !== shown) input.value = shown;
    };
    const clearNumberError = (): void => {
        if (read('error') === NUMBER_RULE) store.set(errorPath, '');
    };
    const writeValue = (value: number | ''): void => {
        writing = true;
        try {
            store.set(valuePath, value);
        } finally {
            writing = false;
        }
    };
    const onExternal = (): void => {
        if (writing) return;
        entryInvalid = false;
        clearNumberError();
        showValue();
    };
    const watched = [valuePath, `${basePath}.format`, `${basePath}.currency`, '$.locale'];
    store.on(watched, onExternal);
    showValue();

    const bound = (name: string): number | undefined => {
        const value = read(name);
        return isNumber(value) ? value : undefined;
    };
    const stepBy = (direction: 1 | -1): void => {
        if (read('disabled') === true || read('locked') === true || read('readonly') === true) return;
        const step = bound('step');
        const amount = step !== undefined && step > 0 ? step : FALLBACK_STEP;
        const value = read('value');
        const current = isNumber(value) ? value : 0;
        const min = bound('min');
        const max = bound('max');
        let next = Number((current + direction * amount).toFixed(STEP_DECIMALS));
        if (min !== undefined && next < min) next = min;
        if (max !== undefined && next > max) next = max;
        entryInvalid = false;
        clearNumberError();
        store.set(valuePath, next);
        showValue();
    };

    return {
        ...field,
        // The native input event is composed; the field raises its own `change`, so the native one stops here
        onInput: (event: Event) => {
            event.stopPropagation();
            const input = control();
            if (!input) return;
            const typed = input.value;
            store.set(textPath, typed);
            if (typed.trim() === '') {
                entryInvalid = false;
                writeValue('');
                clearNumberError();
                return;
            }
            const parsed = parseNumberInput(typed, options());
            if (parsed === undefined) {
                entryInvalid = true;
                field.validate();
                return;
            }
            entryInvalid = false;
            writeValue(parsed);
            clearNumberError();
        },
        onKeyDown: (event: KeyboardEvent) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            stepBy(event.key === 'ArrowUp' ? 1 : -1);
        },
        onBlur: () => {
            field.onBlur();
            if (!entryInvalid) showValue();
        },
        onDecrement: () => {
            stepBy(-1);
            control()?.focus();
        },
        onIncrement: () => {
            stepBy(1);
            control()?.focus();
        },
        dispose: () => {
            store.off(watched, onExternal);
            field.dispose();
        }
    };
}
