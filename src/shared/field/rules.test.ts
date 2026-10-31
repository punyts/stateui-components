import { describe, expect, it } from 'vitest';
import { FIELD_RULES, NAMED_PATTERNS, failingRule, patternOf } from './rules.js';
import type { FieldSettings } from './rules.js';

const settings = (overrides: Partial<FieldSettings> = {}): FieldSettings => ({
    required: false,
    minLength: 0,
    maxLength: 0,
    min: '',
    max: '',
    pattern: '',
    ...overrides
});

describe('failingRule', () => {
    it('should pass an empty value unless it is required', () => {
        // Act
        const results = [failingRule('', settings({ minLength: 3, pattern: 'email' })), failingRule('', settings({ required: true }))];

        // Assert
        expect(results).toEqual(['', 'required']);
    });

    it('should fail required for an empty array, null, undefined and false', () => {
        // Act
        const results = [[], null, undefined, false].map((value) => failingRule(value, settings({ required: true })));

        // Assert
        expect(new Set(results)).toEqual(new Set(['required']));
    });

    it('should fail minLength and maxLength by the length of the text', () => {
        // Act
        const results = [
            failingRule('ab', settings({ minLength: 3 })),
            failingRule('abc', settings({ minLength: 3 })),
            failingRule('abcd', settings({ maxLength: 3 })),
            failingRule('abc', settings({ maxLength: 3 }))
        ];

        // Assert
        expect(results).toEqual(['minLength', '', 'maxLength', '']);
    });

    it('should compare a number bound as numbers and fail a value that is not a number', () => {
        // Act
        const results = [
            failingRule('4', settings({ min: 5 })),
            failingRule('5', settings({ min: 5 })),
            failingRule('11', settings({ max: 10 })),
            failingRule('10', settings({ max: 10 })),
            failingRule('abc', settings({ min: 5 })),
            failingRule(12, settings({ max: 10 }))
        ];

        // Assert
        expect(results).toEqual(['min', '', 'max', '', 'min', 'max']);
    });

    it('should fail step for a value that is not a whole number of steps from min, from 0 without a min', () => {
        // Act
        const results = [
            failingRule(10, settings({ step: 5 })),
            failingRule(12, settings({ step: 5 })),
            failingRule(12, settings({ step: 5, min: 2 })),
            failingRule(13, settings({ step: 5, min: 2 })),
            failingRule(0.3, settings({ step: 0.1 })),
            failingRule(0.35, settings({ step: 0.1 })),
            failingRule(7, settings({ step: 0 })),
            failingRule(7.5, settings({}))
        ];

        // Assert
        expect(results).toEqual(['', 'step', '', 'step', '', 'step', '', '']);
    });

    it('should judge min and max before step', () => {
        // Act
        const result = failingRule(3, settings({ step: 5, min: 5 }));

        // Assert
        expect(result).toBe('min');
    });

    it('should compare a string bound as text, so ISO dates order correctly', () => {
        // Act
        const results = [
            failingRule('2024-01-01', settings({ min: '2024-02-01' })),
            failingRule('2024-03-01', settings({ max: '2024-02-01' })),
            failingRule('2024-02-01', settings({ min: '2024-02-01', max: '2024-02-01' }))
        ];

        // Assert
        expect(results).toEqual(['min', 'max', '']);
    });

    it.each([
        ['email', 'a@b.co', 'a@b'],
        ['url', 'https://example.com/a?b=1', 'example.com'],
        ['integer', '-42', '4.2'],
        ['decimal', '4.25', '4.'],
        ['tel', '+49 (30) 1234-567', 'call me'],
        ['alphanumeric', 'Ab12', 'Ab 12']
    ])('should check the named pattern %s', (pattern, good, bad) => {
        // Act
        const results = [failingRule(good, settings({ pattern })), failingRule(bad, settings({ pattern }))];

        // Assert
        expect(results).toEqual(['', 'pattern']);
    });

    it('should match a regular expression against the whole value', () => {
        // Act
        const results = [failingRule('AB12', settings({ pattern: '[A-Z]{2}[0-9]{2}' })), failingRule('xAB12', settings({ pattern: '[A-Z]{2}[0-9]{2}' }))];

        // Assert
        expect(results).toEqual(['', 'pattern']);
    });

    it('should fail pattern for an expression that does not compile', () => {
        // Act
        const result = failingRule('a', settings({ pattern: '(' }));

        // Assert
        expect(result).toBe('pattern');
    });

    it('should report the first failing rule in the fixed order', () => {
        // Arrange
        const all = settings({ required: true, minLength: 5, maxLength: 2, min: 100, max: 1, pattern: 'integer' });

        // Act
        const noLength = { ...all, minLength: 0, maxLength: 0 };
        const results = [failingRule('', all), failingRule('abc', all), failingRule('abcdef', all), failingRule('50', noLength), failingRule('500', noLength)];

        // Assert
        expect(results).toEqual(['required', 'minLength', 'maxLength', 'min', 'max']);
        expect(FIELD_RULES).toEqual(['required', 'minLength', 'maxLength', 'min', 'max', 'step', 'pattern']);
    });

    it('should reach pattern only when every earlier rule passes', () => {
        // Act
        const result = failingRule('12.5', settings({ pattern: 'integer', min: 1, max: 100 }));

        // Assert
        expect(result).toBe('pattern');
    });
});

describe('patternOf', () => {
    it('should give the named expression and cache a compiled one', () => {
        // Assert
        expect(patternOf('email')).toBe(NAMED_PATTERNS['email']);
        expect(patternOf('[a-z]+')).toBe(patternOf('[a-z]+'));
        expect(patternOf('(')).toBeNull();
    });

    it('should not treat an inherited property name as a named pattern', () => {
        // Assert
        expect(patternOf('toString')?.test('toString')).toBe(true);
        expect(patternOf('constructor')?.test('x')).toBe(false);
    });
});
