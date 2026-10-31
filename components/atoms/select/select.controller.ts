import type { ControllerContext } from '@punyts/stateui';
import { watchRenderedOptions } from '../shared/field/options.js';

interface CommandHost {
    commands?: Record<string, () => void>;
}

type Entry = Record<string, unknown>;

export default function controller({ element, store, basePath }: ControllerContext) {
    const control = (): HTMLSelectElement | null => element.shadowRoot?.querySelector('select') ?? null;
    const multiple = (): boolean => store.get<boolean>(`${basePath}.multiple`) === true;

    /** The option values as strings, which is how the native options hold them */
    const selectedKeys = (): Set<string> => {
        const value = store.get<unknown>(`${basePath}.value`);
        if (multiple()) return new Set(Array.isArray(value) ? value.map(String) : []);
        return new Set(value === null || value === undefined ? [] : [String(value)]);
    };

    /** The value an option stands for: the entry's own value for a data array (so a number stays a number), the key for a map */
    const resolveValue = (key: string): unknown => {
        const options = store.get<unknown>(`${basePath}.options`);
        if (!Array.isArray(options)) return key;
        const field = store.get<string>(`${basePath}.optionValue`);
        const entry = options.find((candidate: unknown) => candidate !== null && typeof candidate === 'object' && String((candidate as Entry)[field]) === key);
        return entry === undefined ? key : (entry as Entry)[field];
    };

    /** The native option value of a repeat entry: a map entry (it holds `_label`) is keyed, a data entry carries its own value */
    const optionKeyOf = (key: string, entry: Entry, field: string): string => String('_label' in entry ? key : entry[field]);
    const labelOf = (entry: Entry, field: string, content: unknown): string => String('_label' in entry ? content : entry[field] ?? '');

    const sync = (): void => {
        const current = control();
        if (!current) return;
        const keys = selectedKeys();
        for (const option of Array.from(current.options)) option.selected = keys.has(option.value);
        if (!current.multiple && !keys.has(current.value)) current.selectedIndex = -1;
    };
    const resync = (): void => queueMicrotask(sync);
    const watched = [`${basePath}.value`, `${basePath}.multiple`, `${basePath}.optionValue`, `${basePath}.options`, `${basePath}.options.$all`];
    store.on(watched, resync);
    resync();
    const stopWatching = watchRenderedOptions(element, sync);

    const host = element as Element & CommandHost;
    host.commands = {
        focus: () => control()?.focus(),
        clear: () => {
            store.set(`${basePath}.value`, multiple() ? [] : '');
        }
    };
    return {
        optionKeyOf,
        labelOf,
        onChange: () => {
            const current = control();
            if (!current) return;
            const value = multiple()
                ? Array.from(current.selectedOptions).map((option) => resolveValue(option.value))
                : current.selectedIndex < 0 ? '' : resolveValue(current.value);
            store.set(`${basePath}.value`, value);
            element.dispatchEvent(new CustomEvent('change', { detail: value, bubbles: true, composed: true }));
        },
        dispose: () => {
            store.off(watched, resync);
            stopWatching();
            delete host.commands;
        }
    };
}
