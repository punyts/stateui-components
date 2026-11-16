import { describe, expect, it } from 'vitest';
import { isHexColor, normalizeHex } from './color.js';

describe('isHexColor', () => {
    it('should accept # and six hexadecimal digits in either case', () => {
        // Assert
        expect(isHexColor('#1a2b3c')).toBe(true);
        expect(isHexColor('#ABCDEF')).toBe(true);
    });

    it('should refuse short forms, names, missing # and other types', () => {
        // Assert
        expect(isHexColor('#abc')).toBe(false);
        expect(isHexColor('1a2b3c')).toBe(false);
        expect(isHexColor('red')).toBe(false);
        expect(isHexColor('#1a2b3c4d')).toBe(false);
        expect(isHexColor(0x1a2b3c)).toBe(false);
    });
});

describe('normalizeHex', () => {
    it('should add the #, write three digits out as six and lower the case', () => {
        // Assert
        expect(normalizeHex(' 1A2B3C ')).toBe('#1a2b3c');
        expect(normalizeHex('#ABC')).toBe('#aabbcc');
        expect(normalizeHex('f0a')).toBe('#ff00aa');
    });

    it('should return other text trimmed, for validation to report', () => {
        // Assert
        expect(normalizeHex('  blue ')).toBe('blue');
        expect(normalizeHex('#12345')).toBe('#12345');
        expect(normalizeHex('')).toBe('');
    });
});
