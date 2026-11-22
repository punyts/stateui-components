import { describe, expect, it } from 'vitest';
import { passwordStrength } from './strength.js';

describe('passwordStrength', () => {
    it('should give no level to an empty password', () => {
        // Act and Assert
        expect(passwordStrength('')).toEqual({ score: 0, level: '' });
    });

    it('should rate a password by its length and the kinds of characters it mixes', () => {
        // Act and Assert
        expect(passwordStrength('cat').level).toBe('weak');
        expect(passwordStrength('meadowlark').level).toBe('weak');
        expect(passwordStrength('Meadow1ark').level).toBe('fair');
        expect(passwordStrength('meadowlark river').level).toBe('good');
        expect(passwordStrength('Meadowlark-river-7').level).toBe('strong');
    });

    it('should rate a repeated or running password weak whatever its length', () => {
        // Act and Assert
        expect(passwordStrength('aaaaaaaaaaaaaaaaaa').level).toBe('weak');
        expect(passwordStrength('abcdefghijklm').score).toBe(1);
        expect(passwordStrength('987654321').level).toBe('weak');
    });

    it('should count characters, not code units', () => {
        // Act
        const strength = passwordStrength('\u{1F511}'.repeat(8));

        // Assert
        expect(strength.score).toBe(1);
    });
});
