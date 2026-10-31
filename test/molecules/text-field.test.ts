import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseShape, validateNode } from '@punyts/stateui-app/core';

const file = resolve(import.meta.dirname, '../../components/molecules/text-field/text-field.state.json');
const parsed = parseShape(readFileSync(file, 'utf8'), file);
const shape = parsed.shape;
if (!shape) throw new Error(`text-field shape did not parse: ${JSON.stringify(parsed.errors)}`);

const codes = (node: Record<string, unknown>): string[] =>
    validateNode(shape, { component: 'textField', ...node } as never, '$.app').map((error) => error.code);

describe('textField shape', () => {
    it('should accept the validation settings', () => {
        // Act
        const result = codes({ required: true, minLength: 2, maxLength: 20, min: 1, max: '2030-01-01', pattern: 'email' });

        // Assert
        expect(result).toEqual([]);
    });

    it.each(['email', 'url', 'integer', 'decimal', 'tel', 'alphanumeric', '^[A-Z]{2}[0-9]{4}$', '(a|b)+c'])(
        'should accept the pattern %s',
        (pattern) => {
            // Act
            const result = codes({ pattern });

            // Assert
            expect(result).toEqual([]);
        }
    );

    it.each(['(', '[a-', '(a+)+', '(a*)*', '(a+){2,}', 'a'.repeat(121)])('should report SUI-STATE-INVALID for the pattern %s', (pattern) => {
        // Act
        const result = codes({ pattern });

        // Assert
        expect(result).toEqual(['SUI-STATE-INVALID']);
    });

    it('should accept a pattern of exactly 120 characters', () => {
        // Act
        const result = codes({ pattern: 'a'.repeat(120) });

        // Assert
        expect(result).toEqual([]);
    });

    it.each(['error', 'touched', 'dirty', 'locked'])('should report SUI-STATE-RUNTIME for a node that sets %s', (name) => {
        // Arrange
        const value = name === 'error' ? 'required' : true;

        // Act
        const result = codes({ [name]: value });

        // Assert
        expect(result).toEqual(['SUI-STATE-RUNTIME']);
    });

    it('should report SUI-STATE-RUNTIME for a link to a runtime property', () => {
        // Act
        const result = codes({ '<-touched': '$.data.touched' });

        // Assert
        expect(result).toEqual(['SUI-STATE-RUNTIME']);
    });

    it('should report SUI-STATE-INVALID for a negative minLength', () => {
        // Act
        const result = codes({ minLength: -1 });

        // Assert
        expect(result).toEqual(['SUI-STATE-INVALID']);
    });

    it('should declare the change, invalid and valid events and the validate, reset, focus and clear commands', () => {
        // Assert
        expect(shape.events).toEqual(['change', 'invalid', 'valid']);
        expect(shape.commands).toEqual(['validate', 'reset', 'focus', 'clear']);
    });
});
