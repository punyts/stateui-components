import type { ControllerContext } from '@punyts/stateui';
import { formatValue } from '../shared/format/format.js';

type Entry = Record<string, unknown>;

const isEntry = (value: unknown): value is Entry => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** What a cell shows for a value: the formatted number with a `format`, otherwise the value as text; nothing for no value or an object */
function shownText(value: unknown, cell: Entry, locale: string): string {
    if (value === undefined || value === null || typeof value === 'object') return '';
    const format = text(cell['format']);
    if (format === '') return String(value);
    const digits = cell['fractionDigits'];
    return formatValue(value, { format, currency: text(cell['currency']), locale, ...(typeof digits === 'number' ? { fractionDigits: digits } : {}) });
}

/**
 * Writes the `text` of each value cell of the row, formatted for `$.locale`. Each cell's `value` is an alias of a field
 * of the record the slot shows (`$row.<field>`, made by the slot pool), so a data change, a re-point of the slot and a
 * language switch rewrite the text of the cells concerned. Cells that hold a node (`content.node`) draw it and write nothing.
 * The view reads the formatted text from state, because a dynamic indexer on a repeat local renders empty
 */
export default function controller({ store, basePath }: ControllerContext) {
    const cellsPath = `${basePath}.cells`;
    const cells = store.get<unknown>(cellsPath);
    const keys = isEntry(cells) ? Object.keys(cells).filter((key) => isEntry(cells[key]) && !isEntry((cells[key] as Entry)['content'])) : [];
    const valuePath = (key: string): string => `${cellsPath}.${key}.value`;

    const refresh = (): void => {
        const locale = text(store.get<unknown>('$.locale'));
        for (const key of keys) {
            const cell = store.get<unknown>(`${cellsPath}.${key}`);
            if (!isEntry(cell)) continue;
            const shown = shownText(store.get<unknown>(valuePath(key)), cell, locale);
            if (cell['text'] !== shown) store.set(`${cellsPath}.${key}.text`, shown);
        }
    };

    const watched = [...keys.map(valuePath), '$.locale'];
    store.on(watched, refresh);
    refresh();
    return {
        dispose: () => store.off(watched, refresh)
    };
}
