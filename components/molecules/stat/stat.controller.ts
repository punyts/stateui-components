import type { ControllerContext } from '@punyts/stateui';
import { formatValue } from '../shared/format/format.js';

const TREND_ICONS: Readonly<Record<string, string>> = { up: 'chevron-up', down: 'chevron-down', flat: 'minus' };
const EMPTY_VALUE = '—';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Keeps the runtime properties the view shows (`shown`, `deltaShown`, `trendIcon`) in step with `value`, `delta`,
 * `format`, `currency`, `trend` and the application language, so a data write or a language switch reformats the number
 */
export default function controller({ store, basePath }: ControllerContext) {
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);

    const refresh = (): void => {
        const options = { format: text(read('format')), currency: text(read('currency')), locale: text(store.get<unknown>('$.locale')) };
        store.set(`${basePath}.shown`, formatValue(read('value'), options) || EMPTY_VALUE);
        store.set(`${basePath}.deltaShown`, formatValue(read('delta'), { ...options, signed: true }));
        store.set(`${basePath}.trendIcon`, TREND_ICONS[text(read('trend'))] ?? '');
    };

    const watched = ['value', 'delta', 'format', 'currency', 'trend'].map((name) => `${basePath}.${name}`).concat('$.locale');
    store.on(watched, refresh);
    refresh();
    return {
        dispose: () => {
            store.off(watched, refresh);
        }
    };
}
