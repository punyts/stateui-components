import { createStore } from '@punyts/state';
import { describe, expect, it, vi } from 'vitest';
import { createSelection, pickKey, readSelectionMode, sameKeys, selectionKeys, selectionValue } from './selection.js';
import type { SelectionMode } from './selection.js';

const EMPTY = '$.runtime.empty';

const setup = (selected: unknown, initialMode: SelectionMode = 'single') => {
    const records = [
        { id: 'a', name: 'Ada' },
        { id: 'b', name: 'Bea' },
        { id: 'c', name: 'Cy' }
    ];
    const store = createStore<Record<string, unknown>>({
        data: { records, picked: selected },
        runtime: { empty: {}, nodes: { list: {} } }
    });
    store.protect(EMPTY);
    let mode: SelectionMode = initialMode;
    const onSelect = vi.fn();
    const locate = (key: string): string | undefined => {
        const index = store.get<{ id: string }[]>('$.data.records').findIndex((record) => record.id === key);
        return index < 0 ? EMPTY : `$.data.records.${index}`;
    };
    const selection = createSelection({
        store,
        selectedPath: '$.data.picked',
        currentPath: '$.runtime.nodes.list.current',
        mode: () => mode,
        locate,
        onSelect
    });
    const setMode = (next: SelectionMode): void => {
        mode = next;
    };
    return { store, selection, onSelect, setMode };
};

describe('selection helpers', () => {
    it('should read a selection mode and fall back to none', () => {
        // Arrange and Act and Assert
        expect(readSelectionMode('single')).toBe('single');
        expect(readSelectionMode('multi')).toBe('multi');
        expect(readSelectionMode('all')).toBe('none');
        expect(readSelectionMode(undefined)).toBe('none');
    });

    it('should read keys from a key, a number and a list, without empties or duplicates', () => {
        // Arrange and Act and Assert
        expect(selectionKeys('a')).toEqual(['a']);
        expect(selectionKeys(7)).toEqual(['7']);
        expect(selectionKeys(['a', '', 'b', 'a', 2, null])).toEqual(['a', 'b', '2']);
        expect(selectionKeys('')).toEqual([]);
        expect(selectionKeys(undefined)).toEqual([]);
    });

    it('should store a list in multi mode and one key otherwise', () => {
        // Arrange and Act and Assert
        expect(selectionValue('multi', ['a', 'b'])).toEqual(['a', 'b']);
        expect(selectionValue('single', ['a', 'b'])).toBe('a');
        expect(selectionValue('single', [])).toBe('');
    });

    it('should replace in single mode, toggle in multi mode and keep the keys in none mode', () => {
        // Arrange and Act and Assert
        expect(pickKey('single', ['a'], 'b')).toEqual(['b']);
        expect(pickKey('multi', ['a'], 'b')).toEqual(['a', 'b']);
        expect(pickKey('multi', ['a', 'b'], 'a')).toEqual(['b']);
        expect(pickKey('none', ['a'], 'b')).toEqual(['a']);
        expect(sameKeys(['a', 'b'], ['a', 'b'])).toBe(true);
        expect(sameKeys(['a', 'b'], ['b', 'a'])).toBe(false);
    });
});

describe('createSelection', () => {
    it('should point current at the empty record when nothing is selected and refuse a write into it', () => {
        // Arrange
        const { store, selection } = setup('');

        // Act
        const written = store.set('$.runtime.nodes.list.current.name', 'Nobody');

        // Assert
        expect(selection.target()).toBe(EMPTY);
        expect(written).toBe(false);
        expect(store.get<Record<string, unknown>>(EMPTY)).toEqual({});
    });

    it('should point current at the selected record and re-point it when another is picked', () => {
        // Arrange
        const { store, selection, onSelect } = setup('b');
        const before = store.get<string>('$.runtime.nodes.list.current.name');

        // Act
        selection.pick('c');

        // Assert
        expect(before).toBe('Bea');
        expect(store.get<string>('$.data.picked')).toBe('c');
        expect(store.get<string>('$.runtime.nodes.list.current.name')).toBe('Cy');
        expect(onSelect).toHaveBeenCalledWith(['c']);
    });

    it('should write through current into the selected record', () => {
        // Arrange
        const { store } = setup('a');

        // Act
        const written = store.set('$.runtime.nodes.list.current.name', 'Ida');

        // Assert
        expect(written).toBe(true);
        expect(store.get<string>('$.data.records.0.name')).toBe('Ida');
    });

    it('should follow a write to selected from elsewhere without raising select', () => {
        // Arrange
        const { store, selection, onSelect } = setup('a');

        // Act
        store.set('$.data.picked', 'b');

        // Assert
        expect(selection.target()).toBe('$.data.records.1');
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('should fall back to the empty record when the selection is cleared', () => {
        // Arrange
        const { store, selection, onSelect } = setup('a');

        // Act
        selection.clear();

        // Assert
        expect(store.get<string>('$.data.picked')).toBe('');
        expect(selection.target()).toBe(EMPTY);
        expect(store.set('$.runtime.nodes.list.current.name', 'x')).toBe(false);
        expect(onSelect).toHaveBeenCalledWith([]);
    });

    it('should toggle keys and select all in multi mode, with current on the empty record', () => {
        // Arrange
        const { store, selection, onSelect } = setup([], 'multi');

        // Act
        selection.pick('a');
        selection.pick('c');
        selection.pick('a');
        const toggled = [...store.get<string[]>('$.data.picked')];
        selection.selectAll(['a', 'b', 'c']);

        // Assert
        expect(toggled).toEqual(['c']);
        expect([...store.get<string[]>('$.data.picked')]).toEqual(['a', 'b', 'c']);
        expect(selection.target()).toBe(EMPTY);
        expect(onSelect).toHaveBeenCalledTimes(4);
    });

    it('should ignore selectAll unless in multi mode and pick unless selectable', () => {
        // Arrange
        const { store, selection, onSelect, setMode } = setup('a');

        // Act
        selection.selectAll(['a', 'b']);
        setMode('none');
        selection.pick('b');

        // Assert
        expect(store.get<string>('$.data.picked')).toBe('a');
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('should re-point current when relocate finds the record at another path', () => {
        // Arrange
        const { store, selection } = setup('b');

        // Act
        store.get<unknown[]>('$.data.records').unshift({ id: 'z', name: 'Zed' });
        selection.relocate();

        // Assert
        expect(selection.target()).toBe('$.data.records.2');
        expect(store.get<string>('$.runtime.nodes.list.current.name')).toBe('Bea');
    });

    it('should remove the current link when disposed', () => {
        // Arrange
        const { store, selection } = setup('a');

        // Act
        selection.dispose();
        store.set('$.data.picked', 'b');

        // Assert
        expect(store.get<unknown>('$.runtime.nodes.list.current')).toBeUndefined();
    });
});
