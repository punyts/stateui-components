import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseShape, validateNode } from '@punyts/stateui-app/core';

const load = (folder: string) => {
    const file = resolve(import.meta.dirname, `../../components/molecules/${folder}/${folder}.state.json`);
    const parsed = parseShape(readFileSync(file, 'utf8'), file);
    if (!parsed.shape) throw new Error(`${folder} shape did not parse: ${JSON.stringify(parsed.errors)}`);
    return parsed.shape;
};
const textarea = load('textarea-field');
const date = load('date-field');
const codes = (shape: ReturnType<typeof load>, component: string, node: Record<string, unknown>): string[] =>
    validateNode(shape, { component, ...node } as never, '$.app').map((error) => error.code);

describe('textareaField shape', () => {
    it('should accept rows, autoGrow and the validation settings', () => {
        // Act
        const result = codes(textarea, 'textareaField', { rows: 5, autoGrow: true, required: true, minLength: 2, maxLength: 200 });

        // Assert
        expect(result).toEqual([]);
    });

    it.each([0, 51])('should report SUI-STATE-INVALID for rows %s', (rows) => {
        // Act
        const result = codes(textarea, 'textareaField', { rows });

        // Assert
        expect(result).toEqual(['SUI-STATE-INVALID']);
    });

    it.each(['error', 'touched', 'dirty', 'locked'])('should report SUI-STATE-RUNTIME for a node that sets %s', (name) => {
        // Act
        const result = codes(textarea, 'textareaField', { [name]: name === 'error' ? 'required' : true });

        // Assert
        expect(result).toEqual(['SUI-STATE-RUNTIME']);
    });
});

describe('dateField shape', () => {
    it('should accept ISO dates for min and max', () => {
        // Act
        const result = codes(date, 'dateField', { min: '2026-01-01', max: '2026-12-31', value: '2026-06-01', required: true });

        // Assert
        expect(result).toEqual([]);
    });

    it.each(['error', 'touched', 'dirty', 'locked'])('should report SUI-STATE-RUNTIME for a node that sets %s', (name) => {
        // Act
        const result = codes(date, 'dateField', { [name]: name === 'error' ? 'min' : true });

        // Assert
        expect(result).toEqual(['SUI-STATE-RUNTIME']);
    });
});
