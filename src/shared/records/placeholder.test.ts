import { describe, expect, it } from 'vitest';
import { isPlaceholderKey, placeholderKey, placeholderOwner } from './placeholder.js';

describe('placeholder keys', () => {
    it('should tell a placeholder key from a record key and give back the record it waits for', () => {
        // Arrange
        const key = placeholderKey('folder 1');

        // Assert
        expect(isPlaceholderKey(key)).toBe(true);
        expect(placeholderOwner(key)).toBe('folder 1');
        expect(isPlaceholderKey('folder 1')).toBe(false);
        expect(placeholderOwner('folder 1')).toBeUndefined();
    });

    it('should never equal the key of a record', () => {
        // Assert
        expect(placeholderKey('a')).not.toBe('a');
        expect(placeholderKey('a')).not.toBe(placeholderKey('b'));
    });
});
