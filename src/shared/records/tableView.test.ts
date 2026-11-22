import { createStore } from '@punyts/state';
import { describe, expect, it, vi } from 'vitest';
import { groupKey } from './placeholder.js';
import { createRecordIndex } from './recordIndex.js';
import { arrangeView, fillGroupText, foldText, passesFilters, readFilters, readViewColumns, recordLookup } from './tableView.js';
import type { ViewSettings } from './tableView.js';

const records = [
    { id: 'a', name: 'Café Ada', state: 'open', units: 4, price: 2 },
    { id: 'b', name: 'Grace', state: 'done', units: 6, price: 3 },
    { id: 'c', name: 'Hopper', state: 'open', units: 10, price: 5 },
    { id: 'd', name: 'Lovelace', units: 1, price: 7 }
];
const lookup = recordLookup(records, 'id');
const columns = readViewColumns({
    name: { _title: 'Name', field: 'name', filter: 'text' },
    state: { _title: 'State', field: 'state', filter: 'select', options: { open: { _label: 'Open' }, done: { _label: 'Done' } } },
    units: { _title: 'Units', field: 'units', total: 'sum' },
    price: { _title: 'Price', field: 'price', total: 'average' },
    actions: { _title: 'Actions' }
});
const settings = (overrides: Partial<ViewSettings> = {}): ViewSettings => ({
    columns,
    quick: '',
    filters: {},
    groupBy: '',
    groupDirection: 'asc',
    collapsed: new Set(),
    emptyLabel: 'No value',
    groupText: (label, count) => fillGroupText('{label} ({count})', label, count),
    ...overrides
});
const keys = ['a', 'b', 'c', 'd'];

describe('readViewColumns and readFilters', () => {
    it('should read the columns with a field, their filter, total and option labels', () => {
        // Assert
        expect(columns.map((column) => column.key)).toEqual(['name', 'state', 'units', 'price']);
        expect(columns[1]).toEqual({ key: 'state', field: 'state', filter: 'select', total: 'none', options: { open: 'Open', done: 'Done' } });
        expect(columns[2]?.filter).toBe('none');
    });

    it('should keep only filters that hold text', () => {
        // Assert
        expect(readFilters({ name: 'ad', state: '', units: 3, price: '  ' })).toEqual({ name: 'ad' });
        expect(readFilters('x')).toEqual({});
    });
});

describe('passesFilters', () => {
    it('should match the quick filter in any column, ignoring case and accents, and a select option by its label', () => {
        // Assert
        expect(passesFilters(records[0], columns, foldText('cafe'), {})).toBe(true);
        expect(passesFilters(records[1], columns, foldText('DONE'), {})).toBe(true);
        expect(passesFilters(records[1], columns, foldText('zzz'), {})).toBe(false);
    });

    it('should match a text filter as contained text and a select filter as the option key', () => {
        // Assert
        expect(passesFilters(records[2], columns, '', { name: 'opp' })).toBe(true);
        expect(passesFilters(records[2], columns, '', { name: 'ada' })).toBe(false);
        expect(passesFilters(records[2], columns, '', { state: 'open' })).toBe(true);
        expect(passesFilters(records[1], columns, '', { state: 'open' })).toBe(false);
        expect(passesFilters(records[1], columns, '', { units: 'x', missing: 'y' })).toBe(true);
    });
});

describe('arrangeView', () => {
    it('should keep the sorted keys that pass the filters, with no groups', () => {
        // Act
        const view = arrangeView(['d', 'c', 'b', 'a'], (key) => lookup.get(key), settings({ quick: ' R ' }));

        // Assert
        expect(view).toEqual({ order: ['c', 'b'], groups: {} });
    });

    it('should put each group after a group row with its label, count and totals, empty values last', () => {
        // Act
        const view = arrangeView(keys, (key) => lookup.get(key), settings({ groupBy: 'state' }));

        // Assert
        expect(view.order).toEqual([groupKey('g0'), 'b', groupKey('g1'), 'a', 'c', groupKey('g2'), 'd']);
        expect(view.groups['g0']).toEqual({ 'group-row': { value: 'done', label: 'Done', count: 1, collapsed: false, column: 'state', text: 'Done (1)' }, units: 6, price: 3 });
        expect(view.groups['g1']).toEqual({ 'group-row': { value: 'open', label: 'Open', count: 2, collapsed: false, column: 'state', text: 'Open (2)' }, units: 14, price: 3.5 });
        expect(view.groups['g2']?.['group-row'].label).toBe('No value');
    });

    it('should order groups descending, leave out the records of a collapsed group and total only the filtered records', () => {
        // Act
        const view = arrangeView(keys, (key) => lookup.get(key), settings({ groupBy: 'state', groupDirection: 'desc', collapsed: new Set(['done']), filters: { name: 'r' } }));

        // Assert
        expect(view.order).toEqual([groupKey('g0'), 'c', groupKey('g1')]);
        expect(view.groups['g0']?.['units']).toBe(10);
        expect(view.groups['g1']?.['group-row']).toMatchObject({ value: 'done', collapsed: true, count: 1 });
    });

    it('should show the label in the first column when the grouped field has no column', () => {
        // Act
        const view = arrangeView(keys, (key) => lookup.get(key), settings({ groupBy: 'id' }));

        // Assert
        expect(view.groups['g0']?.['group-row']).toMatchObject({ value: 'a', label: 'a', column: 'name' });
    });
});

describe('createRecordIndex with group rows', () => {
    it('should place group keys of the order at the records of groups and leave them out of the loaded keys', () => {
        // Arrange
        const store = createStore<Record<string, unknown>>({
            data: { records: records.slice(0, 2), order: [groupKey('g0'), 'a', groupKey('gx'), 'b'], groups: { g0: { 'group-row': { value: 'v' } } } },
            runtime: { empty: {} }
        });
        const index = createRecordIndex({ store, recordsPath: '$.data.records', orderPath: '$.data.order', groupsPath: '$.data.groups', key: 'id', onChange: vi.fn() });

        // Act
        const shown = Array.from({ length: index.size() }, (_v, i) => index.keyAt(i));

        // Assert
        expect(shown).toEqual([groupKey('g0'), 'a', groupKey('gx'), 'b']);
        expect(index.pathOf(groupKey('g0'))).toBe('$.data.groups.g0');
        expect(index.pathOf(groupKey('gx'))).toBeUndefined();
        expect(index.loadedKeys()).toEqual(['a', 'b']);
    });
});
