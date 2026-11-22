import { failingRule, NUMBER_RULE } from '../field/rules.js';
import type { FieldSettings } from '../field/rules.js';
import { optionLabels } from './tableView.js';

type Entry = Record<string, unknown>;

/** The editors a table column can name; `check` is drawn as a checkbox in the cell, the others open over the cell */
export const EDIT_KINDS = ['text', 'number', 'date', 'select', 'check'] as const;

export type EditKind = (typeof EDIT_KINDS)[number];

const FIELD = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

const isEntry = (value: unknown): value is Entry => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const count = (value: unknown): number => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0);
const bound = (value: unknown): unknown => (typeof value === 'number' || typeof value === 'string' ? value : '');

/** What a column's editor needs: its kind, the record field it writes, the rules of a form field and a select's labels by key */
export interface CellEditor {
    kind: EditKind;
    field: string;
    settings: FieldSettings;
    /** A select's options in key order, key to label */
    options: Record<string, string>;
}

/** The editor a column names with `edit` and a `field`, or undefined when it has none */
export function readEditor(column: unknown): CellEditor | undefined {
    if (!isEntry(column)) return undefined;
    const kind = text(column['edit']);
    const field = text(column['field']);
    if (!(EDIT_KINDS as readonly string[]).includes(kind) || !FIELD.test(field)) return undefined;
    const options = kind === 'select' ? optionLabels(column['options']) : {};
    const step = column['step'];
    return {
        kind: kind as EditKind,
        field,
        options,
        settings: {
            required: column['required'] === true,
            minLength: count(column['minLength']),
            maxLength: count(column['maxLength']),
            min: bound(column['min']),
            max: bound(column['max']),
            ...(typeof step === 'number' && step > 0 ? { step } : {}),
            pattern: text(column['pattern'])
        }
    };
}

/** The text an editor starts with for a stored value: numbers and strings as text, anything else empty */
export function draftOf(value: unknown): string {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return typeof value === 'string' ? value : '';
}

/** The outcome of checking a draft: the value to write, or the rule it fails */
export type CellCheck = { value: unknown; rule?: undefined } | { rule: string };

/**
 * Reads what was typed or chosen into the value to write and checks it against the column's rules, as a form field
 * does. A number editor writes a number, or `null` for an empty draft; text that is not a number fails `number`. A
 * select writes the option key, and a key the column does not list fails `pattern`
 */
export function checkDraft(editor: CellEditor, draft: string): CellCheck {
    if (editor.kind === 'number') {
        const trimmed = draft.trim();
        if (trimmed === '') return editor.settings.required ? { rule: 'required' } : { value: null };
        const number = Number(trimmed);
        if (!Number.isFinite(number)) return { rule: NUMBER_RULE };
        const rule = failingRule(number, editor.settings);
        return rule === '' ? { value: number } : { rule };
    }
    if (editor.kind === 'select' && draft !== '' && !Object.hasOwn(editor.options, draft)) return { rule: 'pattern' };
    const rule = failingRule(draft, editor.kind === 'select' ? { ...editor.settings, pattern: '' } : editor.settings);
    return rule === '' ? { value: draft } : { rule };
}

/** The keys of the columns that open an editor over the cell (every editor but `check`), in key order */
export function editableColumns(columns: unknown): string[] {
    if (!isEntry(columns)) return [];
    return Object.keys(columns).filter((key) => {
        const editor = readEditor(columns[key]);
        return editor !== undefined && editor.kind !== 'check';
    });
}
