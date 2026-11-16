import type { ControllerContext } from '@punyts/stateui';
import { formatValue } from '../shared/format/format.js';

/**
 * Keeps the runtime property `valueText` in step with `value`, `max` and the language: the share done as a percent
 * (from 0 to 100, in the language of `$.locale`). A ring shows it in its centre with `showValue` and gives it to
 * assistive technology as `aria-valuetext`; a bar draws the same `value` and `max` and does not use it
 */
export default function controller({ store, basePath }: ControllerContext) {
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const refresh = (): void => {
        const value = read('value');
        const max = read('max');
        const share = typeof value === 'number' && typeof max === 'number' && max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
        const locale = store.get<unknown>('$.locale');
        store.set(`${basePath}.valueText`, formatValue(share, { format: 'percent', locale: typeof locale === 'string' ? locale : '', fractionDigits: 0 }));
    };
    const watched = [`${basePath}.value`, `${basePath}.max`, '$.locale'];
    store.on(watched, refresh);
    refresh();
    return {
        dispose: () => {
            store.off(watched, refresh);
        }
    };
}
