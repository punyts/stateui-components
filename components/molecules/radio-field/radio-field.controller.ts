import type { ControllerContext } from '@punyts/stateui';
import { createField } from '../shared/field/field.js';
import { createOptions, watchRenderedOptions } from '../shared/field/options.js';

export default function controller(context: ControllerContext) {
    const { element, store, basePath } = context;
    const field = createField(context);
    const options = createOptions(context);
    const radios = (): HTMLInputElement[] => Array.from(element.shadowRoot?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? []);

    const sync = (): void => {
        const keys = options.selectedKeys();
        for (const radio of radios()) radio.checked = keys.has(radio.value);
    };
    const resync = (): void => queueMicrotask(sync);
    store.on(options.watched, resync);
    resync();
    const stopWatching = watchRenderedOptions(element, sync);

    return {
        ...field,
        optionKeyOf: options.optionKeyOf,
        labelOf: options.labelOf,
        onChange: () => {
            const chosen = radios().find((radio) => radio.checked);
            if (store.get<boolean>(`${basePath}.readonly`) === true || chosen === undefined) {
                sync();
                return;
            }
            store.set(`${basePath}.value`, options.resolveValue(chosen.value));
        },
        dispose: () => {
            store.off(options.watched, resync);
            stopWatching();
            field.dispose();
        }
    };
}
