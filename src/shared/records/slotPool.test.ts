import { createStore } from '@punyts/state';
import { describe, expect, it, vi } from 'vitest';
import { createRecordIndex } from './recordIndex.js';
import { createSlotPool } from './slotPool.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const RUNTIME = '$.runtime.nodes.app';

const setup = (count: number) => {
    const records = Array.from({ length: count }, (_v, i) => ({ id: `r${i}`, name: `Name ${i}` }));
    const store = createStore<Record<string, unknown>>({
        data: { records },
        app: { component: 'recordList', row: { component: 'text', '<-_text': '$row.name' }, records: {} },
        runtime: { nodes: {}, empty: {} }
    });
    store.delete('$.app.records');
    store.link('$.app.records', '$.data.records');
    store.protect('$.runtime.empty');
    const on = vi.spyOn(store, 'on');
    const off = vi.spyOn(store, 'off');
    let reload: ((again: boolean) => void) | undefined;
    const index = createRecordIndex({
        store,
        recordsPath: '$.app.records',
        orderPath: '$.app.order',
        key: 'id',
        onChange: (again) => reload?.(again)
    });
    const pool = createSlotPool({ store, nodePath: '$.app', rowPath: '$.app.row', viewPath: '$.app.slots', countPath: '$.app.count', index, overscan: () => 1 });
    reload = (again) => pool.invalidate(again);
    return { store, index, pool, on, off };
};

const rowName = (store: ReturnType<typeof setup>['store'], slot: number): unknown => store.get(`${RUNTIME}.slots.${slot}._text`);

describe('createSlotPool', () => {
    it('should build the pool from the window and show position p in slot p modulo the pool size', async () => {
        // Arrange
        const { store, pool } = setup(100);
        await flush();

        // Act
        store.set(`${RUNTIME}.window`, { first: 10, count: 4 });
        await flush();

        // Assert
        expect(pool.size()).toBe(6);
        expect(store.get(`${RUNTIME}.slots.${9 % 6}.slotIndex`)).toBe(9);
        expect(rowName(store, 9 % 6)).toBe('Name 9');
        expect(rowName(store, 14 % 6)).toBe('Name 14');
        expect(store.get('$.app.count')).toBe(100);
    });

    it('should re-point only the slots that change position when the window moves by one', async () => {
        // Arrange
        const { store } = setup(100);
        store.set(`${RUNTIME}.window`, { first: 10, count: 4 });
        await flush();
        const link = vi.spyOn(store, 'link');

        // Act
        store.set(`${RUNTIME}.window.first`, 11);
        await flush();

        // Assert
        expect(link).toHaveBeenCalledTimes(1);
        expect(rowName(store, 15 % 6)).toBe('Name 15');
    });

    it('should hide a slot that has no record', async () => {
        // Arrange
        const { store } = setup(2);
        store.set(`${RUNTIME}.window`, { first: 0, count: 4 });

        // Act
        await flush();

        // Assert
        expect(store.get(`${RUNTIME}.slots.3.slotIndex`)).toBe(-1);
        expect(rowName(store, 3)).toBeUndefined();
    });

    it('should remove the listeners and the slots on dispose', async () => {
        // Arrange
        const { store, pool, index, on, off } = setup(20);
        store.set(`${RUNTIME}.window`, { first: 0, count: 4 });
        await flush();

        // Act
        pool.dispose();
        index.dispose();

        // Assert
        expect(off.mock.calls.map(([paths]) => paths)).toEqual(expect.arrayContaining(on.mock.calls.map(([paths]) => paths)));
        expect(off).toHaveBeenCalledTimes(on.mock.calls.length);
        expect(store.get(`${RUNTIME}.slots`)).toBeUndefined();
    });
});
