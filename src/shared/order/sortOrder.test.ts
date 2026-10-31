import { createStore } from '@punyts/state';
import { describe, expect, it } from 'vitest';
import { compareSortValues, createSortOrder, fieldValue, readSortDirection, readSortEntries, sortedKeys } from './sortOrder.js';
import type { SortDirection } from './sortOrder.js';

interface Line {
    id: string;
    qty?: number;
    name?: string;
    meta?: { rank: number };
}

const lines = (): Line[] => [
    { id: 'a', qty: 3, name: 'Pear', meta: { rank: 2 } },
    { id: 'b', qty: 1, name: 'apple', meta: { rank: 3 } },
    { id: 'c', qty: 2, name: 'Fig', meta: { rank: 1 } }
];

const setup = (records: unknown, sortBy = 'qty', direction: SortDirection = 'asc') => {
    const store = createStore<Record<string, unknown>>({ data: { records }, runtime: { list: {} } });
    let field = sortBy;
    let dir = direction;
    const pending: (() => void)[] = [];
    let computed = 0;
    const order = createSortOrder({
        store,
        recordsPath: '$.data.records',
        orderPath: '$.runtime.list.order',
        key: () => 'id',
        sortBy: () => field,
        direction: () => dir,
        schedule: (run) => {
            const task = (): void => {
                computed++;
                run();
            };
            pending.push(task);
            return () => pending.splice(pending.indexOf(task), 1);
        }
    });
    const frame = (): void => {
        for (const task of pending.splice(0)) task();
    };
    const keys = (): unknown => {
        const value = store.get<unknown>('$.runtime.list.order');
        return Array.isArray(value) ? [...(value as string[])] : value;
    };
    const set = (next: { sortBy?: string; direction?: SortDirection }): void => {
        field = next.sortBy ?? field;
        dir = next.direction ?? dir;
        order.refresh();
    };
    return { store, order, frame, keys, set, pending, computed: () => computed };
};

describe('sort helpers', () => {
    it('should compare numbers by value, text with a numeric collation and put numbers before text', () => {
        // Arrange and Act and Assert
        expect(compareSortValues(2, 10)).toBeLessThan(0);
        expect(compareSortValues('a2', 'a10')).toBeLessThan(0);
        expect(compareSortValues('apple', 'Pear')).toBeLessThan(0);
        expect(compareSortValues(5, 'a')).toBeLessThan(0);
        expect(compareSortValues(false, true)).toBeLessThan(0);
        expect(readSortDirection('desc')).toBe('desc');
        expect(readSortDirection('up')).toBe('asc');
    });

    it('should keep records with no value last in both directions and keep ties in record order', () => {
        // Arrange
        const entries = [
            { key: 'a', value: 2 },
            { key: 'b', value: undefined },
            { key: 'c', value: 1 },
            { key: 'd', value: 2 },
            { key: 'e', value: '' }
        ];

        // Act and Assert
        expect(sortedKeys(entries, 'asc')).toEqual(['c', 'a', 'd', 'b', 'e']);
        expect(sortedKeys(entries, 'desc')).toEqual(['a', 'd', 'c', 'b', 'e']);
    });

    it('should read the entries of an array and a keyed map, by a dotted field', () => {
        // Arrange and Act and Assert
        expect(readSortEntries([{ id: 'a', meta: { rank: 2 } }, { meta: { rank: 1 } }], 'id', 'meta.rank')).toEqual([{ key: 'a', value: 2 }]);
        expect(readSortEntries({ x: { qty: 1 }, y: { qty: 2 } }, 'id', 'qty')).toEqual([
            { key: 'x', value: 1 },
            { key: 'y', value: 2 }
        ]);
        expect(readSortEntries(undefined, 'id', 'qty')).toEqual([]);
        expect(fieldValue({ a: 1 }, 'a.b')).toBeUndefined();
    });
});

describe('createSortOrder', () => {
    it('should write the sorted keys at once and the other direction after a refresh, leaving the data in place', () => {
        // Arrange
        const { store, keys, set, frame } = setup(lines());
        const first = keys();

        // Act
        set({ direction: 'desc' });
        frame();

        // Assert
        expect(first).toEqual(['b', 'c', 'a']);
        expect(keys()).toEqual(['a', 'c', 'b']);
        expect(store.get<Line[]>('$.data.records').map((line) => line.id)).toEqual(['a', 'b', 'c']);
    });

    it('should sort by text and by a dotted field', () => {
        // Arrange
        const { keys, set, frame } = setup(lines(), 'name');
        const byName = keys();

        // Act
        set({ sortBy: 'meta.rank' });
        frame();

        // Assert
        expect(byName).toEqual(['b', 'c', 'a']);
        expect(keys()).toEqual(['c', 'a', 'b']);
    });

    it('should re-sort once per frame after the sort field changes in records', () => {
        // Arrange
        const { store, keys, frame, computed } = setup(lines());
        const events: string[] = [];
        store.on(['$.runtime.list.order', '$.runtime.list.order.$all'], (path) => events.push(path));

        // Act
        store.set('$.data.records.0.qty', 0);
        store.set('$.data.records.1.qty', 9);
        frame();

        // Assert
        expect(computed()).toBe(1);
        expect(events).toEqual(['$.runtime.list.order']);
        expect(keys()).toEqual(['a', 'c', 'b']);
    });

    it('should not recompute when a field that is not the sort field changes', () => {
        // Arrange
        const { store, pending, computed } = setup(lines());

        // Act
        store.set('$.data.records.0.name', 'Plum');

        // Assert
        expect(pending).toHaveLength(0);
        expect(computed()).toBe(0);
    });

    it('should re-sort after a record is added, removed and the records are replaced', () => {
        // Arrange
        const { store, keys, frame } = setup(lines());

        // Act and Assert
        store.get<Line[]>('$.data.records').push({ id: 'd', qty: 0 });
        frame();
        expect(keys()).toEqual(['d', 'b', 'c', 'a']);

        store.get<Line[]>('$.data.records').splice(1, 1);
        frame();
        expect(keys()).toEqual(['d', 'c', 'a']);

        store.set('$.data.records', [{ id: 'x', qty: 2 }, { id: 'y', qty: 1 }]);
        frame();
        expect(keys()).toEqual(['y', 'x']);
    });

    it('should sort a keyed map and pick up an added key', () => {
        // Arrange
        const { store, keys, frame } = setup({ k1: { qty: 2 }, k2: { qty: 1 } });
        const first = keys();

        // Act
        store.set('$.data.records.k3', { qty: 0 });
        frame();

        // Assert
        expect(first).toEqual(['k2', 'k1']);
        expect(keys()).toEqual(['k3', 'k2', 'k1']);
    });

    it('should delete the order when the sort field is cleared and stop listening', () => {
        // Arrange
        const { store, keys, set, frame, pending } = setup(lines());

        // Act
        set({ sortBy: '' });
        frame();
        store.set('$.data.records.0.qty', 7);

        // Assert
        expect(keys()).toBeUndefined();
        expect(pending).toHaveLength(0);
    });

    it('should cancel a scheduled recompute and stop listening when disposed', () => {
        // Arrange
        const { store, order, pending } = setup(lines());
        store.set('$.data.records.0.qty', 0);

        // Act
        order.dispose();
        store.set('$.data.records.1.qty', 0);

        // Assert
        expect(pending).toHaveLength(0);
    });
});
