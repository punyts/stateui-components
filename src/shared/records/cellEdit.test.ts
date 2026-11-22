import { describe, expect, it } from 'vitest';
import { checkDraft, draftOf, editableColumns, readEditor } from './cellEdit.js';
import type { CellEditor } from './cellEdit.js';

const editor = (column: Record<string, unknown>): CellEditor => readEditor({ field: 'f', ...column }) as CellEditor;

describe('readEditor', () => {
    it('should read the kind, field, rules and select labels of a column', () => {
        // Act
        const read = readEditor({ field: 'state', edit: 'select', required: true, options: { open: { _label: 'Open' }, done: {} } });

        // Assert
        expect(read).toEqual({
            kind: 'select',
            field: 'state',
            options: { open: 'Open', done: 'done' },
            settings: { required: true, minLength: 0, maxLength: 0, min: '', max: '', pattern: '' }
        });
    });

    it('should give no editor without a known kind or a field', () => {
        // Assert
        expect(readEditor({ field: 'a' })).toBeUndefined();
        expect(readEditor({ field: 'a', edit: 'color' })).toBeUndefined();
        expect(readEditor({ edit: 'text' })).toBeUndefined();
        expect(readEditor({ field: 'a b', edit: 'text' })).toBeUndefined();
    });
});

describe('checkDraft', () => {
    it('should write a number for a number draft and null for an empty one, and fail text that is not a number', () => {
        // Arrange
        const number = editor({ edit: 'number', min: 0, max: 10 });

        // Act and Assert
        expect(checkDraft(number, ' 4.5 ')).toEqual({ value: 4.5 });
        expect(checkDraft(number, '')).toEqual({ value: null });
        expect(checkDraft(number, 'four')).toEqual({ rule: 'number' });
        expect(checkDraft(number, '11')).toEqual({ rule: 'max' });
        expect(checkDraft(editor({ edit: 'number', required: true }), '')).toEqual({ rule: 'required' });
    });

    it('should check text by the rules of a form field', () => {
        // Arrange
        const name = editor({ edit: 'text', required: true, maxLength: 5, pattern: 'alphanumeric' });

        // Act and Assert
        expect(checkDraft(name, 'Ada')).toEqual({ value: 'Ada' });
        expect(checkDraft(name, '')).toEqual({ rule: 'required' });
        expect(checkDraft(name, 'Lovelace')).toEqual({ rule: 'maxLength' });
        expect(checkDraft(name, 'a-b')).toEqual({ rule: 'pattern' });
    });

    it('should accept only a listed option key for a select', () => {
        // Arrange
        const state = editor({ edit: 'select', options: { open: {}, done: {} } });

        // Act and Assert
        expect(checkDraft(state, 'done')).toEqual({ value: 'done' });
        expect(checkDraft(state, 'lost')).toEqual({ rule: 'pattern' });
        expect(checkDraft(state, '')).toEqual({ value: '' });
    });

    it('should compare dates as ISO text against min and max', () => {
        // Arrange
        const due = editor({ edit: 'date', min: '2026-01-01' });

        // Act and Assert
        expect(checkDraft(due, '2026-03-04')).toEqual({ value: '2026-03-04' });
        expect(checkDraft(due, '2025-12-31')).toEqual({ rule: 'min' });
    });
});

describe('draftOf and editableColumns', () => {
    it('should start a draft from a number or a string and leave anything else empty', () => {
        // Assert
        expect([draftOf(3), draftOf('x'), draftOf(null), draftOf(true), draftOf(Number.NaN)]).toEqual(['3', 'x', '', '', '']);
    });

    it('should list the columns that open an editor, leaving out check columns', () => {
        // Act
        const keys = editableColumns({ a: { field: 'a', edit: 'text' }, b: { field: 'b' }, c: { field: 'c', edit: 'check' }, d: { field: 'd', edit: 'number' } });

        // Assert
        expect(keys).toEqual(['a', 'd']);
    });
});
