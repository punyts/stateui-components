import type { ControllerContext } from '@punyts/stateui';
import { createField } from '../shared/field/field.js';
import { createOptions, watchRenderedOptions } from '../shared/field/options.js';

interface CommandHost {
    commands?: Record<string, () => void>;
}

export default function controller(context: ControllerContext) {
    const { element, store, basePath } = context;
    const field = createField(context);
    const options = createOptions(context);
    const control = (): HTMLSelectElement | null => element.shadowRoot?.querySelector('select') ?? null;

    const sync = (): void => {
        const current = control();
        if (!current) return;
        const keys = options.selectedKeys();
        for (const option of Array.from(current.options)) option.selected = keys.has(option.value);
        if (!current.multiple && !keys.has(current.value)) current.selectedIndex = -1;
    };
    const resync = (): void => queueMicrotask(sync);
    store.on(options.watched, resync);
    resync();
    const stopWatching = watchRenderedOptions(element, sync);

    const clear = (): void => {
        store.set(`${basePath}.value`, options.multiple() ? [] : '');
        store.set(`${basePath}.error`, '');
    };
    const host = element as Element & CommandHost;
    host.commands = { ...host.commands, clear };

    return {
        ...field,
        valueOf: options.valueOf,
        labelOf: options.labelOf,
        clear,
        onChange: () => {
            const current = control();
            if (!current) return;
            if (store.get<boolean>(`${basePath}.readonly`) === true) {
                sync();
                return;
            }
            const value = options.multiple()
                ? Array.from(current.selectedOptions).map((option) => options.resolveValue(option.value))
                : current.selectedIndex < 0 ? '' : options.resolveValue(current.value);
            store.set(`${basePath}.value`, value);
        },
        dispose: () => {
            store.off(options.watched, resync);
            stopWatching();
            field.dispose();
        }
    };
}
