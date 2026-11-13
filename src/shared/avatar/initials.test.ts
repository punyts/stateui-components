import { describe, expect, it } from 'vitest';
import { initialsOf } from './initials.js';

describe('initialsOf', () => {
    it('should take the first letter of the first and the last word, in capitals', () => {
        // Act
        const result = initialsOf('ada king lovelace');

        // Assert
        expect(result).toBe('AL');
    });

    it('should give one letter for one word and nothing for blank text', () => {
        // Assert
        expect(initialsOf('  Grace ')).toBe('G');
        expect(initialsOf('   ')).toBe('');
    });

    it('should keep a letter outside the basic plane whole', () => {
        // Act
        const result = initialsOf('𝒜da Byron');

        // Assert
        expect(result).toBe('𝒜B');
    });
});
