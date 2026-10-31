import { createStore } from '@punyts/state';
import { describe, expect, it, vi } from 'vitest';
import { createRecordIndex } from './recordIndex.js';

interface Row {
    id: string;
}

const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }));

const setup = (records: unknown, order?: string[]) => {
    const store = createStore<Record<string, unknown>>({ data: { records, order }, runtime: { empty: {} } });
    const onChange = vi.fn();
    const index = createRecordIndex({ store, recordsPath: '$.data.records', orderPath: '$.data.order', key: 'id', onChange });
    const keys = (): (string | undefined)[] => Array.from({ length: index.size() }, (_v, i) => index.keyAt(i));
    return { store, index, onChange, keys };
};

describe('createRecordIndex', () => {
    it('should give the position of a key in an array, a keyed map and an order', () => {
        // Arrange
        const array = setup(rows('a', 'b', 'c'));
        const map = setup({ x: { id: 'x' }, y: { id: 'y' } });
        const ordered = setup(rows('a', 'b', 'c'), ['c', 'zzz', 'a']);

        // Act and Assert
        expect(array.index.positionOf('c')).toBe(2);
        expect(array.index.positionOf('zzz')).toBeUndefined();
        expect(map.index.positionOf('y')).toBe(1);
        expect(ordered.index.positionOf('c')).toBe(0);
        expect(ordered.index.positionOf('a')).toBe(1);
        expect(ordered.index.positionOf('b')).toBeUndefined();
    });

    it('should list the keys of an array and find a record by key', () => {
        // Arrange
        const { index, keys } = setup(rows('a', 'b', 'c'));

        // Assert
        expect(keys()).toEqual(['a', 'b', 'c']);
        expect(index.pathOf('b')).toBe('$.data.records.1');
        expect(index.pathOf('zzz')).toBeUndefined();
        expect(index.locate('zzz')).toBe('$.runtime.empty');
    });

    it('should follow push, shift, reverse and pop without reading the array again', () => {
        // Arrange
        const { store, index } = setup(rows('a', 'b', 'c'));
        const records = (): Row[] => store.get<Row[]>('$.data.records');

        // Act and Assert
        records().push({ id: 'd' });
        expect(index.pathOf('d')).toBe('$.data.records.3');
        records().shift();
        expect([index.pathOf('b'), index.pathOf('d'), index.pathOf('a')]).toEqual(['$.data.records.0', '$.data.records.2', undefined]);
        records().reverse();
        expect([index.pathOf('b'), index.pathOf('d')]).toEqual(['$.data.records.2', '$.data.records.0']);
        records().pop();
        expect(index.pathOf('b')).toBeUndefined();
        expect(index.size()).toBe(2);
    });

    it('should close the gap after store.delete of an array element and ask for a reload', () => {
        // Arrange
        const { store, index, onChange } = setup(rows('a', 'b', 'c', 'd'));

        // Act
        store.delete('$.data.records.1');

        // Assert
        expect([index.pathOf('c'), index.pathOf('d'), index.pathOf('b')]).toEqual(['$.data.records.1', '$.data.records.2', undefined]);
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it('should read the whole array again when it is replaced', () => {
        // Arrange
        const { store, index } = setup(rows('a', 'b'));

        // Act
        store.replace('$.data.records', rows('x', 'y', 'z'));

        // Assert
        expect([index.pathOf('x'), index.pathOf('z'), index.pathOf('a')]).toEqual(['$.data.records.0', '$.data.records.2', undefined]);
        expect(index.size()).toBe(3);
    });

    it('should follow a change of the key field of a record', () => {
        // Arrange
        const { store, index } = setup(rows('a', 'b'));

        // Act
        store.set('$.data.records.0.id', 'renamed');

        // Assert
        expect([index.pathOf('renamed'), index.pathOf('a')]).toEqual(['$.data.records.0', undefined]);
    });

    it('should use the map keys of a keyed map in order, with its own additions and removals', () => {
        // Arrange
        const { store, index, keys } = setup({ k1: { id: 'x' }, k2: { id: 'y' } });

        // Act
        store.set('$.data.records.k3', { id: 'z' });
        store.delete('$.data.records.k1');

        // Assert
        expect(keys()).toEqual(['k2', 'k3']);
        expect(index.pathOf('k3')).toBe('$.data.records.k3');
    });

    it('should filter and sort by order and skip entries that name no record', () => {
        // Arrange
        const { store, index, keys } = setup(rows('a', 'b', 'c'), ['c', 'ghost', 'a']);

        // Act and Assert
        expect(keys()).toEqual(['c', 'a']);
        store.set('$.data.order', ['b']);
        expect(keys()).toEqual(['b']);
        expect(index.size()).toBe(1);
    });

    it('should have no positions without records and remove its listeners on dispose', () => {
        // Arrange
        const store = createStore<Record<string, unknown>>({ data: {} });
        const on = vi.spyOn(store, 'on');
        const off = vi.spyOn(store, 'off');
        const index = createRecordIndex({ store, recordsPath: '$.data.records', orderPath: '$.data.order', key: 'id', onChange: vi.fn() });

        // Act
        const size = index.size();
        index.dispose();

        // Assert
        expect(size).toBe(0);
        expect(off.mock.calls.map(([paths]) => paths)).toEqual(on.mock.calls.map(([paths]) => paths));
    });
});
