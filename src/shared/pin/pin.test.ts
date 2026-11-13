import { describe, expect, it } from 'vitest';
import { DEFAULT_PIN_LENGTH, boxForKey, currentBox, deleteAt, pinChars, pinLength, typeAt } from './pin.js';

describe('pinLength', () => {
    it('should take a whole length from 4 to 8 and fall back to six boxes otherwise', () => {
        // Assert
        expect(pinLength(4)).toBe(4);
        expect(pinLength(8)).toBe(8);
        expect([3, 9, 5.5, '6', undefined].map(pinLength)).toEqual(Array(5).fill(DEFAULT_PIN_LENGTH));
    });
});

describe('pinChars', () => {
    it('should keep only digits, or digits and letters with alphanumeric', () => {
        // Assert
        expect(pinChars('12-3 4a', false)).toBe('1234');
        expect(pinChars('ab-1é2', true)).toBe('ab12');
    });
});

describe('typeAt', () => {
    it('should replace from the box on and cut at the length', () => {
        // Assert
        expect(typeAt('1234', 1, '9', 6)).toBe('1934');
        expect(typeAt('12', 2, '345678', 6)).toBe('123456');
    });

    it('should never leave a gap: a box past the first empty one types into that one', () => {
        // Assert
        expect(typeAt('12', 5, '3', 6)).toBe('123');
    });
});

describe('deleteAt', () => {
    it('should drop the character of the box and move the rest up, and keep the value for an empty box', () => {
        // Assert
        expect(deleteAt('1234', 1)).toBe('134');
        expect(deleteAt('12', 4)).toBe('12');
    });
});

describe('currentBox and boxForKey', () => {
    it('should point at the first empty box, or the last when full', () => {
        // Assert
        expect(currentBox('12', 6)).toBe(2);
        expect(currentBox('123456', 6)).toBe(5);
    });

    it('should move with the arrows no further than the current box, and swap them in right-to-left text', () => {
        // Assert
        expect(boxForKey('ArrowRight', 1, '12', 6, false)).toBe(2);
        expect(boxForKey('ArrowRight', 2, '12', 6, false)).toBe(2);
        expect(boxForKey('ArrowLeft', 0, '12', 6, false)).toBe(0);
        expect(boxForKey('ArrowLeft', 1, '12', 6, true)).toBe(2);
        expect(boxForKey('Home', 2, '12', 6, false)).toBe(0);
        expect(boxForKey('End', 0, '12', 6, false)).toBe(2);
        expect(boxForKey('a', 0, '12', 6, false)).toBeUndefined();
    });
});
