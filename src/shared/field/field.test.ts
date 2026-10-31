import { describe, expect, it } from 'vitest';
import { fieldDescribedBy, fieldMessage, fieldWidth } from './field.js';

describe('fieldWidth', () => {
    it('should fill the row for fill and for anything that is not a valid width', () => {
        // Act
        const widths = ['fill', 'wide', 0, -3, 2.5, null, undefined].map(fieldWidth);

        // Assert
        expect(new Set(widths)).toEqual(new Set(['100%']));
    });

    it('should fit the content for auto', () => {
        // Assert
        expect(fieldWidth('auto')).toBe('fit-content');
    });

    it('should give a ch count for a positive integer', () => {
        // Assert
        expect(fieldWidth(20)).toBe('20ch');
    });
});

describe('fieldDescribedBy', () => {
    it('should name only the text that is shown', () => {
        // Assert
        expect(fieldDescribedBy('Help', 'Oops')).toBe('help error');
        expect(fieldDescribedBy('Help', '')).toBe('help');
        expect(fieldDescribedBy('', 'Oops')).toBe('error');
        expect(fieldDescribedBy('', undefined)).toBeNull();
    });
});

describe('fieldMessage', () => {
    it('should give the message of the failing rule and nothing otherwise', () => {
        // Arrange
        const errors = { required: 'Needed', pattern: '' };

        // Assert
        expect(fieldMessage(errors, 'required')).toBe('Needed');
        expect(fieldMessage(errors, 'min')).toBe('');
        expect(fieldMessage(errors, '')).toBe('');
        expect(fieldMessage(errors, 'toString')).toBe('');
        expect(fieldMessage(undefined, 'required')).toBe('');
    });
});
