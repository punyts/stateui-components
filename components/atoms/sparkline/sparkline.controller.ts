import type { ControllerContext } from '@punyts/stateui';
import { formatValue } from '../shared/format/format.js';
import type { FormatOptions } from '../shared/format/format.js';
import { fillSummary, sparkShape, sparkValues } from '../shared/spark/spark.js';

/**
 * Draws `values` (numbers; anything else is left out) as the runtime `line`, `area` and `bars` the view binds, and
 * writes `summaryText` from `_summary` (placeholders `{count}`, `{first}`, `{last}`, `{min}`, `{max}`, the values in
 * `format` and the language of `$.locale`), which follows `_label` in the accessible name. The svg stretches to the
 * element and the line keeps its width (`vector-effect`); no layout is read
 */
export default function controller({ store, basePath }: ControllerContext) {
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const refresh = (): void => {
        const values = sparkValues(read('values'));
        const shape = sparkShape(values);
        const locale = store.get<unknown>('$.locale');
        const digits = read('fractionDigits');
        const currency = read('currency');
        const format = read('format');
        const options: FormatOptions = { format: typeof format === 'string' ? format : 'number', locale: typeof locale === 'string' ? locale : '' };
        if (typeof currency === 'string') options.currency = currency;
        if (typeof digits === 'number') options.fractionDigits = digits;
        const text = (value: number): string => formatValue(value, options);
        const template = read('_summary');
        const summary =
            values.length === 0
                ? ''
                : fillSummary(typeof template === 'string' ? template : '', {
                      count: String(values.length),
                      first: text(values[0] as number),
                      last: text(values[values.length - 1] as number),
                      min: text(Math.min(...values)),
                      max: text(Math.max(...values))
                  });
        store.set(`${basePath}.line`, shape.line);
        store.set(`${basePath}.area`, shape.area);
        store.set(`${basePath}.bars`, shape.bars);
        store.set(`${basePath}.summaryText`, summary);
    };
    const watched = ['values', 'values.$all', 'format', 'currency', 'fractionDigits', '_summary'].map((name) => `${basePath}.${name}`).concat('$.locale');
    store.on(watched, refresh);
    refresh();
    return {
        dispose: () => {
            store.off(watched, refresh);
        }
    };
}
