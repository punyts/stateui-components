import type { ControllerContext } from '@punyts/stateui';
import { formatValue } from '../shared/format/format.js';
import type { FormatOptions } from '../shared/format/format.js';
import { meterLevel, numberOr } from '../shared/meter/level.js';

/**
 * Keeps the runtime `share` (the value's place from `min` to `max`, 0 to 1), `level` (reflected, so the fill takes the
 * good, warning or danger token) and `valueText` (the value in `format` and the language of `$.locale`, also the
 * `aria-valuetext`) in step with the properties
 */
export default function controller({ store, basePath }: ControllerContext) {
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const optional = (name: string): number | undefined => {
        const value = read(name);
        return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    };
    const refresh = (): void => {
        const min = numberOr(read('min'), 0);
        const max = Math.max(min, numberOr(read('max'), 100));
        const value = numberOr(read('value'), min);
        const share = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
        const locale = store.get<unknown>('$.locale');
        const digits = read('fractionDigits');
        const currency = read('currency');
        const options: FormatOptions = { format: typeof read('format') === 'string' ? (read('format') as string) : 'number', locale: typeof locale === 'string' ? locale : '' };
        if (typeof currency === 'string') options.currency = currency;
        if (typeof digits === 'number') options.fractionDigits = digits;
        store.set(`${basePath}.share`, share);
        store.set(`${basePath}.level`, meterLevel(value, min, max, optional('low'), optional('high'), optional('optimum')));
        store.set(`${basePath}.valueText`, formatValue(value, options));
    };
    const watched = ['value', 'min', 'max', 'low', 'high', 'optimum', 'format', 'currency', 'fractionDigits'].map((name) => `${basePath}.${name}`).concat('$.locale');
    store.on(watched, refresh);
    refresh();
    return {
        dispose: () => {
            store.off(watched, refresh);
        }
    };
}
