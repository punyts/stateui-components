import { describe, expect, it } from 'vitest';
import { buildBoard, columnValue } from './board.js';

const options = { key: 'id', columnField: 'status', orderField: 'rank', columns: ['todo', 'doing', 'done'] };

const card = (id: string, status: unknown, rank?: unknown): Record<string, unknown> => ({ id, status, ...(rank === undefined ? {} : { rank }) });

describe('buildBoard', () => {
    it('should put each record in the column its field names, in the order of the records', () => {
        // Act
        const model = buildBoard([card('a', 'todo'), card('b', 'done'), card('c', 'todo')], { ...options, orderField: '' });

        // Assert
        expect(model.orders.get('todo')).toEqual(['a', 'c']);
        expect(model.orders.get('doing')).toEqual([]);
        expect(model.orders.get('done')).toEqual(['b']);
        expect([...model.orders.keys()]).toEqual(['todo', 'doing', 'done']);
    });

    it('should sort a column by the order field, numbers first and ties by position', () => {
        // Act
        const model = buildBoard([card('a', 'todo', 3), card('b', 'todo', 1), card('c', 'todo'), card('d', 'todo', 1), card('e', 'todo', '2')], options);

        // Assert
        expect(model.orders.get('todo')).toEqual(['b', 'd', 'e', 'a', 'c']);
    });

    it('should read a keyed map by its keys', () => {
        // Act
        const model = buildBoard({ x: card('ignored', 'doing', 2), y: card('ignored', 'doing', 1) }, options);

        // Assert
        expect(model.orders.get('doing')).toEqual(['y', 'x']);
    });

    it('should match a number to the column with the same text', () => {
        // Act
        const model = buildBoard([card('a', 1), card('b', 2)], { ...options, columns: ['1', '2'] });

        // Assert
        expect(model.orders.get('1')).toEqual(['a']);
        expect(model.orders.get('2')).toEqual(['b']);
    });

    it('should leave out a record in no column and list each such value once', () => {
        // Act
        const model = buildBoard([card('a', 'todo'), card('b', 'later'), card('c', 'later'), card('d', undefined), card('e', 'never')], options);

        // Assert
        expect(model.unmatched).toEqual(['later', 'undefined', 'never']);
        expect([...model.orders.values()].flat()).toEqual(['a']);
    });

    it('should skip records without a key and give empty columns for data that is not records', () => {
        // Assert
        expect(buildBoard([{ status: 'todo' }, 3, null], options).orders.get('todo')).toEqual([]);
        expect(buildBoard(undefined, options).orders.get('done')).toEqual([]);
        expect(buildBoard('x', options).unmatched).toEqual([]);
    });
});

describe('columnValue', () => {
    it('should give the text of a value', () => {
        // Assert
        expect(columnValue('a')).toBe('a');
        expect(columnValue(2)).toBe('2');
        expect(columnValue(undefined)).toBe('undefined');
    });
});
