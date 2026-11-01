import { describe, expect, it } from 'vitest';
import { planMove } from './board.js';
import type { MoveInput } from './board.js';

const orders: Record<string, number | undefined> = { a: 1, b: 2, c: 3, x: 10, y: 20, n: undefined };
const base: MoveInput = {
    key: 'a',
    from: 'todo',
    to: 'todo',
    index: 0,
    targetKeys: ['a', 'b', 'c'],
    orderOf: (key) => orders[key],
    ordered: true,
    positionOf: (key) => ['a', 'b', 'c', 'x', 'y', 'n'].indexOf(key)
};

describe('planMove', () => {
    it('should write nothing for a drop where the card already is', () => {
        // Assert
        expect(planMove(base)).toEqual({ writes: [], index: 0 });
        expect(planMove({ ...base, key: 'b', index: 1 })).toEqual({ writes: [], index: 1 });
    });

    it('should give a card moved down inside its column the average of its new neighbours', () => {
        // Act
        const plan = planMove({ ...base, index: 1 });

        // Assert
        expect(plan).toEqual({ writes: [{ key: 'a', field: 'order', value: 2.5 }], index: 1 });
    });

    it('should give a card moved to the end one past the last order, and one moved to the start one below the first', () => {
        // Assert
        expect(planMove({ ...base, index: 2 }).writes).toEqual([{ key: 'a', field: 'order', value: 4 }]);
        expect(planMove({ ...base, key: 'c', index: 0 }).writes).toEqual([{ key: 'c', field: 'order', value: 0 }]);
    });

    it('should write the column and an order between the neighbours when a card moves to another column', () => {
        // Act
        const plan = planMove({ ...base, to: 'done', index: 1, targetKeys: ['x', 'y'] });

        // Assert
        expect(plan).toEqual({
            writes: [
                { key: 'a', field: 'column', value: 'done' },
                { key: 'a', field: 'order', value: 15 }
            ],
            index: 1
        });
    });

    it('should put a card in an empty column at 1', () => {
        // Act
        const plan = planMove({ ...base, to: 'done', index: 0, targetKeys: [] });

        // Assert
        expect(plan.writes).toEqual([
            { key: 'a', field: 'column', value: 'done' },
            { key: 'a', field: 'order', value: 1 }
        ]);
    });

    it('should number the whole column when a neighbour has no number', () => {
        // Act
        const plan = planMove({ ...base, to: 'done', index: 1, targetKeys: ['x', 'n', 'y'] });

        // Assert
        expect(plan.writes).toEqual([
            { key: 'a', field: 'column', value: 'done' },
            { key: 'x', field: 'order', value: 1 },
            { key: 'a', field: 'order', value: 2 },
            { key: 'n', field: 'order', value: 3 },
            { key: 'y', field: 'order', value: 4 }
        ]);
    });

    it('should number the column when the neighbours have equal numbers', () => {
        // Arrange
        const equal: Record<string, number> = { a: 5, p: 7, q: 7 };

        // Act
        const plan = planMove({ ...base, to: 'done', index: 1, targetKeys: ['p', 'q'], orderOf: (key) => equal[key] });

        // Assert
        expect(plan.writes.filter((write) => write.field === 'order')).toEqual([
            { key: 'p', field: 'order', value: 1 },
            { key: 'a', field: 'order', value: 2 },
            { key: 'q', field: 'order', value: 3 }
        ]);
    });

    it('should write only the column when the board has no order field, and end where the record order puts the card', () => {
        // Act
        const plan = planMove({ ...base, key: 'a', to: 'done', index: 0, targetKeys: ['x', 'y'], ordered: false });

        // Assert
        expect(plan).toEqual({ writes: [{ key: 'a', field: 'column', value: 'done' }], index: 0 });
        expect(planMove({ ...base, key: 'y', from: 'done', to: 'todo', index: 0, targetKeys: ['a', 'b'], ordered: false }).index).toBe(2);
    });

    it('should write nothing for a move inside a column when the board has no order field', () => {
        // Assert
        expect(planMove({ ...base, index: 2, ordered: false })).toEqual({ writes: [], index: 0 });
    });

    it('should clamp an index past the end', () => {
        // Assert
        expect(planMove({ ...base, index: 99 }).index).toBe(2);
    });
});
