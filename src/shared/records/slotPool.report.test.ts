import { addListener, removeListener, setCategories } from '@punyts/core';
import { createStore } from '@punyts/state';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRecordIndex } from './recordIndex.js';
import { createSlotPool } from './slotPool.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const RUNTIME = '$.runtime.nodes.app';
const CATEGORY = 'stateui-components.records';

interface Seen {
    message: string;
    details: unknown;
}

const setup = (count: number) => {
    const records = Array.from({ length: count }, (_v, i) => ({ id: `r${i}`, name: `Secret name ${i}` }));
    const store = createStore<Record<string, unknown>>({
        data: { records },
        app: { component: 'recordList', row: { component: 'text', '<-_text': '$row.name' }, records: {} },
        runtime: { nodes: {}, empty: {} }
    });
    store.delete('$.app.records');
    store.link('$.app.records', '$.data.records');
    store.protect('$.runtime.empty');
    const index = createRecordIndex({ store, recordsPath: '$.app.records', orderPath: '$.app.order', key: 'id', onChange: () => undefined });
    const pool = createSlotPool({ store, nodePath: '$.app', rowPath: '$.app.row', viewPath: '$.app.slots', countPath: '$.app.count', index, overscan: () => 1 });
    return { store, pool };
};

describe('createSlotPool reports', () => {
    let seen: Seen[] = [];
    const listener = (_timestamp: number, _category: string, message: string, details: unknown): void => {
        seen.push({ message, details });
    };

    beforeEach(() => {
        seen = [];
        setCategories(['info', 'error', 'stack', 'stateui-components.*']);
        addListener(listener, CATEGORY);
    });
    afterEach(() => {
        removeListener(listener, CATEGORY);
        setCategories(['info', 'error', 'stack']);
    });

    it('should report the pool resized, the window moved with the slots recycled, and the dispose, with no record value', async () => {
        // Arrange
        const { store, pool } = setup(100);
        await flush();
        seen = [];

        // Act
        store.set(`${RUNTIME}.window`, { first: 10, count: 4 });
        await flush();
        store.set(`${RUNTIME}.window.first`, 11);
        await flush();
        pool.dispose();

        // Assert
        expect(seen.map((entry) => entry.message)).toEqual([
            'Resized the slot pool of $.app from 2 to 6',
            'Showed $.app: window 10+4 of 100, 6 slots, 6 recycled',
            'Showed $.app: window 11+4 of 100, 6 slots, 1 recycled',
            'Disposed the slot pool of $.app: 6 slots'
        ]);
        expect(seen[2]?.details).toEqual(['$.app', 11, 4, 100, 6, 1]);
        expect(JSON.stringify(seen)).not.toContain('Secret');
    });

    it('should report nothing while its category is off', async () => {
        // Arrange
        setCategories(['info', 'error', 'stack']);
        const { store } = setup(10);

        // Act
        store.set(`${RUNTIME}.window`, { first: 0, count: 4 });
        await flush();

        // Assert
        expect(seen).toEqual([]);
    });
});
