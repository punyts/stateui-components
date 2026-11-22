import { compareSortValues, fieldValue } from '../order/sortOrder.js';
import type { SortDirection } from '../order/sortOrder.js';
import { groupKey } from './placeholder.js';

type Entry = Record<string, unknown>;

/** The filters a table column can show in its filter row */
export const FILTER_KINDS = ['none', 'text', 'select'] as const;

export type FilterKind = (typeof FILTER_KINDS)[number];

/** The totals a table column can show on a group row */
export const TOTAL_KINDS = ['none', 'sum', 'average', 'min', 'max', 'count'] as const;

export type TotalKind = (typeof TOTAL_KINDS)[number];

/** The field of a group row that marks it and holds what the row shows; a hyphen keeps it apart from every column field */
export const GROUP_FIELD = 'group-row';

const FIELD = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

const isEntry = (value: unknown): value is Entry => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const pick = <T extends string>(value: unknown, kinds: readonly T[]): T => ((kinds as readonly unknown[]).includes(value) ? (value as T) : kinds[0]);

/** A column as filtering, grouping and totals see it */
export interface ViewColumn {
    key: string;
    field: string;
    filter: FilterKind;
    total: TotalKind;
    /** A select column's labels by key, which a filter searches and a group row shows */
    options: Record<string, string>;
}

/** A column's `options` as labels by key; an option without a `_label` is labelled by its key */
export function optionLabels(options: unknown): Record<string, string> {
    const labels: Record<string, string> = {};
    if (!isEntry(options)) return labels;
    for (const [option, entry] of Object.entries(options)) {
        const label = isEntry(entry) ? text(entry['_label']) : '';
        labels[option] = label === '' ? option : label;
    }
    return labels;
}

/** The columns that name a valid `field`, in key order */
export function readViewColumns(columns: unknown): ViewColumn[] {
    if (!isEntry(columns)) return [];
    const read: ViewColumn[] = [];
    for (const [key, column] of Object.entries(columns)) {
        if (!isEntry(column) || !FIELD.test(text(column['field']))) continue;
        read.push({ key, field: text(column['field']), filter: pick(column['filter'], FILTER_KINDS), total: pick(column['total'], TOTAL_KINDS), options: optionLabels(column['options']) });
    }
    return read;
}

/** The per-column filters that hold a value: column key to the text or option key typed or chosen */
export function readFilters(value: unknown): Record<string, string> {
    const filters: Record<string, string> = {};
    if (!isEntry(value)) return filters;
    for (const [key, wanted] of Object.entries(value)) if (typeof wanted === 'string' && wanted.trim() !== '') filters[key] = wanted;
    return filters;
}

/** Text folded for a search that ignores case and accents */
export const foldText = (value: string): string => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();

/** The text a value is searched as: a select column's label for its key, numbers and booleans as text, nothing for anything else */
const searchText = (value: unknown, column: ViewColumn): string => {
    if (typeof value === 'string') return column.options[value] ?? value;
    return typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
};

/**
 * Whether a record passes the filters. The quick filter (folded) passes a record when any column's text holds it; a
 * `text` filter when its column's text holds the filter text; a `select` filter when the field holds the option key.
 * A filter on a column that is not listed is ignored
 */
export function passesFilters(record: unknown, columns: readonly ViewColumn[], quick: string, filters: Readonly<Record<string, string>>): boolean {
    if (quick !== '' && !columns.some((column) => foldText(searchText(fieldValue(record, column.field), column)).includes(quick))) return false;
    for (const [key, wanted] of Object.entries(filters)) {
        const column = columns.find((candidate) => candidate.key === key);
        if (column === undefined || column.filter === 'none') continue;
        const value = fieldValue(record, column.field);
        if (column.filter === 'select' ? String(value ?? '') !== wanted : !foldText(searchText(value, column)).includes(foldText(wanted.trim()))) return false;
    }
    return true;
}

/** What a group row shows: the group's value and label, its count, whether it is collapsed and the column that shows the label */
export interface GroupInfo {
    value: string;
    label: string;
    count: number;
    collapsed: boolean;
    column: string;
    text: string;
}

/** A group row's record: its `group-row` field and the total of each totalled column at that column's field */
export type GroupRow = Entry & { [GROUP_FIELD]: GroupInfo };

/** How the keys of a table are filtered and grouped */
export interface ViewSettings {
    columns: readonly ViewColumn[];
    /** The quick filter as typed; it is folded and trimmed here */
    quick: string;
    filters: Readonly<Record<string, string>>;
    /** The field to group by, `''` for no groups */
    groupBy: string;
    /** The order of the groups by their value */
    groupDirection: SortDirection;
    /** The values of the collapsed groups, as text */
    collapsed: ReadonlySet<string>;
    /** The label of the group of records with no value in the group field */
    emptyLabel: string;
    /** The text of a group row's label cell from the label and the count */
    groupText: (label: string, count: number) => string;
}

const setField = (target: Entry, field: string, value: unknown): void => {
    const segments = field.split('.');
    let at = target;
    for (const segment of segments.slice(0, -1)) {
        if (!isEntry(at[segment])) at[segment] = {};
        at = at[segment] as Entry;
    }
    at[segments[segments.length - 1] as string] = value;
};

const totalOf = (kind: TotalKind, values: readonly unknown[]): number | undefined => {
    if (kind === 'count') return values.length;
    const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (numbers.length === 0) return undefined;
    if (kind === 'min') return Math.min(...numbers);
    if (kind === 'max') return Math.max(...numbers);
    const sum = numbers.reduce((total, value) => total + value, 0);
    return kind === 'average' ? sum / numbers.length : sum;
};

/**
 * Filters the keys of a table (already in sort order) and, with `groupBy`, puts each group's records after a group row.
 * Groups are ordered by their value (empty values last) and keep the sort order inside; a group row's key is
 * `groupKey('g<n>')` and its record, at `groups.g<n>`, holds the totals of the totalled columns at their fields. The
 * records of a collapsed group are left out of `order`; its group row stays
 */
export function arrangeView(keys: readonly string[], recordOf: (key: string) => unknown, settings: ViewSettings): { order: string[]; groups: Record<string, GroupRow> } {
    const quick = foldText(settings.quick.trim());
    const kept = quick === '' && Object.keys(settings.filters).length === 0 ? [...keys] : keys.filter((key) => passesFilters(recordOf(key), settings.columns, quick, settings.filters));
    if (settings.groupBy === '') return { order: kept, groups: {} };
    const byValue = new Map<string, { raw: unknown; keys: string[] }>();
    for (const key of kept) {
        const raw = fieldValue(recordOf(key), settings.groupBy);
        const value = raw === undefined || raw === null ? '' : String(raw);
        let group = byValue.get(value);
        if (!group) byValue.set(value, (group = { raw: value === '' ? undefined : raw, keys: [] }));
        group.keys.push(key);
    }
    const sign = settings.groupDirection === 'desc' ? -1 : 1;
    const ordered = [...byValue.entries()].sort(([a, left], [b, right]) => {
        if ((a === '') !== (b === '')) return a === '' ? 1 : -1;
        return compareSortValues(left.raw, right.raw) * sign;
    });
    const grouped = settings.columns.find((column) => column.field === settings.groupBy);
    const labelColumn = grouped?.key ?? settings.columns[0]?.key ?? '';
    const order: string[] = [];
    const groups: Record<string, GroupRow> = {};
    ordered.forEach(([value, group], index) => {
        const id = `g${index}`;
        const label = value === '' ? settings.emptyLabel : (grouped?.options[value] ?? value);
        const collapsed = settings.collapsed.has(value);
        const row: GroupRow = { [GROUP_FIELD]: { value, label, count: group.keys.length, collapsed, column: labelColumn, text: settings.groupText(label, group.keys.length) } };
        for (const column of settings.columns) {
            if (column.total === 'none' || column.key === labelColumn) continue;
            const total = totalOf(column.total, group.keys.map((key) => fieldValue(recordOf(key), column.field)));
            if (total !== undefined) setField(row, column.field, total);
        }
        groups[id] = row;
        order.push(groupKey(id));
        if (!collapsed) order.push(...group.keys);
    });
    return { order, groups };
}

/** The records of a view by key: an array's by its key field (a record without a key is left out), a keyed map's by its own keys */
export function recordLookup(records: unknown, key: string): Map<string, unknown> {
    const lookup = new Map<string, unknown>();
    if (Array.isArray(records)) {
        for (const record of records) {
            const value = isEntry(record) ? record[key] : undefined;
            if (typeof value === 'string' && value !== '') lookup.set(value, record);
            else if (typeof value === 'number' && Number.isFinite(value)) lookup.set(String(value), record);
        }
    } else if (isEntry(records)) {
        for (const [recordKey, record] of Object.entries(records)) lookup.set(recordKey, record);
    }
    return lookup;
}

/** A text with `{label}` and `{count}` filled */
export const fillGroupText = (template: string, label: string, count: number): string => template.split('{label}').join(label).split('{count}').join(String(count));
