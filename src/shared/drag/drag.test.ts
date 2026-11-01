import { describe, expect, it } from 'vitest';
import { announce, columnAt, dropIndex, passedThreshold, placeAfterKey } from './drag.js';
import type { ColumnBox, ColumnSize } from './drag.js';

const boxes: ColumnBox[] = [
    { key: 'todo', left: 0, right: 100, top: 50, scroll: 0, size: 3 },
    { key: 'doing', left: 110, right: 210, top: 50, scroll: 40, size: 0 },
    { key: 'done', left: 220, right: 320, top: 50, scroll: 0, size: 5 }
];

describe('passedThreshold', () => {
    it('should be false for a small move and true from the threshold on', () => {
        // Assert
        expect(passedThreshold(10, 10, 12, 12)).toBe(false);
        expect(passedThreshold(10, 10, 14, 10)).toBe(true);
        expect(passedThreshold(10, 10, 10, 6)).toBe(true);
        expect(passedThreshold(0, 0, 3, 3, 10)).toBe(false);
    });
});

describe('columnAt', () => {
    it('should give the column the pointer is over, and the nearest one outside them all', () => {
        // Assert
        expect(columnAt(50, boxes)?.key).toBe('todo');
        expect(columnAt(215, boxes)?.key).toBe('doing');
        expect(columnAt(105, boxes)?.key).toBe('todo');
        expect(columnAt(-40, boxes)?.key).toBe('todo');
        expect(columnAt(900, boxes)?.key).toBe('done');
        expect(columnAt(10, [])).toBeUndefined();
    });
});

describe('dropIndex', () => {
    const todo = boxes[0] as ColumnBox;

    it('should be the card the pointer is over, from the top of the body and the card height', () => {
        // Assert
        expect(dropIndex(50, todo, 40, false)).toBe(0);
        expect(dropIndex(89, todo, 40, false)).toBe(0);
        expect(dropIndex(90, todo, 40, false)).toBe(1);
        expect(dropIndex(130, todo, 40, false)).toBe(2);
    });

    it('should count the scroll of the body', () => {
        // Assert
        expect(dropIndex(50, { ...todo, scroll: 80 }, 40, false)).toBe(2);
    });

    it('should stop at the end of another column, past its last card, and at the last card of the own column', () => {
        // Assert
        expect(dropIndex(900, todo, 40, false)).toBe(3);
        expect(dropIndex(900, todo, 40, true)).toBe(2);
    });

    it('should stop at the start above the body, and give the end for no card height', () => {
        // Assert
        expect(dropIndex(-500, todo, 40, false)).toBe(0);
        expect(dropIndex(80, todo, 0, false)).toBe(3);
    });

    it('should give 0 for an empty column', () => {
        // Assert
        expect(dropIndex(500, boxes[1] as ColumnBox, 40, false)).toBe(0);
        expect(dropIndex(500, { ...(boxes[1] as ColumnBox), size: 0 }, 40, true)).toBe(0);
    });
});

describe('placeAfterKey', () => {
    const columns: ColumnSize[] = [
        { key: 'todo', size: 3 },
        { key: 'doing', size: 1 },
        { key: 'done', size: 0 }
    ];

    it('should move one place inside the column with Up and Down and stop at the ends', () => {
        // Assert
        expect(placeAfterKey({ column: 'todo', index: 1 }, 'ArrowDown', columns, 'todo')).toEqual({ column: 'todo', index: 2 });
        expect(placeAfterKey({ column: 'todo', index: 1 }, 'ArrowUp', columns, 'todo')).toEqual({ column: 'todo', index: 0 });
        expect(placeAfterKey({ column: 'todo', index: 2 }, 'ArrowDown', columns, 'todo')).toBeUndefined();
        expect(placeAfterKey({ column: 'todo', index: 0 }, 'ArrowUp', columns, 'todo')).toBeUndefined();
    });

    it('should let a card in another column go one past its last card', () => {
        // Assert
        expect(placeAfterKey({ column: 'doing', index: 0 }, 'ArrowDown', columns, 'todo')).toEqual({ column: 'doing', index: 1 });
        expect(placeAfterKey({ column: 'doing', index: 1 }, 'ArrowDown', columns, 'todo')).toBeUndefined();
    });

    it('should move to the next and previous column with Right and Left, keeping the index as far as the list reaches', () => {
        // Assert
        expect(placeAfterKey({ column: 'todo', index: 2 }, 'ArrowRight', columns, 'todo')).toEqual({ column: 'doing', index: 1 });
        expect(placeAfterKey({ column: 'doing', index: 1 }, 'ArrowRight', columns, 'todo')).toEqual({ column: 'done', index: 0 });
        expect(placeAfterKey({ column: 'doing', index: 1 }, 'ArrowLeft', columns, 'todo')).toEqual({ column: 'todo', index: 1 });
        expect(placeAfterKey({ column: 'todo', index: 0 }, 'ArrowLeft', columns, 'todo')).toBeUndefined();
        expect(placeAfterKey({ column: 'done', index: 0 }, 'ArrowRight', columns, 'todo')).toBeUndefined();
    });

    it('should swap Left and Right in right-to-left text', () => {
        // Assert
        expect(placeAfterKey({ column: 'doing', index: 0 }, 'ArrowLeft', columns, 'todo', { rtl: true })).toEqual({ column: 'done', index: 0 });
    });

    it('should not move inside the home column when the board cannot reorder, but still between columns', () => {
        // Assert
        expect(placeAfterKey({ column: 'todo', index: 0 }, 'ArrowDown', columns, 'todo', { reorder: false })).toBeUndefined();
        expect(placeAfterKey({ column: 'todo', index: 0 }, 'ArrowRight', columns, 'todo', { reorder: false })).toEqual({ column: 'doing', index: 0 });
        expect(placeAfterKey({ column: 'doing', index: 0 }, 'ArrowDown', columns, 'todo', { reorder: false })).toEqual({ column: 'doing', index: 1 });
    });

    it('should answer nothing for another key or an unknown column', () => {
        // Assert
        expect(placeAfterKey({ column: 'todo', index: 0 }, 'a', columns, 'todo')).toBeUndefined();
        expect(placeAfterKey({ column: 'gone', index: 0 }, 'ArrowDown', columns, 'todo')).toBeUndefined();
    });
});

describe('announce', () => {
    it('should fill the fields of a template', () => {
        // Assert
        expect(announce('{name} is at {position} of {count} in {column}', { name: 'Fix', position: 2, count: 5, column: 'Doing' })).toBe('Fix is at 2 of 5 in Doing');
    });

    it('should leave out a field with no value and give nothing for a template that is not text', () => {
        // Assert
        expect(announce('{name} {other}.', { name: 'Fix' })).toBe('Fix .');
        expect(announce(undefined, {})).toBe('');
        expect(announce(3, {})).toBe('');
    });
});
