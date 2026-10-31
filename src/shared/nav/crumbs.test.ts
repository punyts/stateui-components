import { describe, expect, it } from 'vitest';
import { currentKey, planCrumbs } from './crumbs.js';

const keys = ['a', 'b', 'c', 'd', 'e', 'f'];
const shape = (slots: ReturnType<typeof planCrumbs>): string[] => slots.map((slot) => (slot.kind === 'item' ? slot.key : `[${slot.keys.join('')}]`));

describe('currentKey', () => {
    it('should be the named item and otherwise the last key', () => {
        // Assert
        expect(currentKey(keys, 'c')).toBe('c');
        expect(currentKey(keys, '')).toBe('f');
        expect(currentKey(keys, 'zzz')).toBe('f');
        expect(currentKey(keys, undefined)).toBe('f');
        expect(currentKey([], '')).toBe('');
    });
});

describe('planCrumbs', () => {
    it('should show every item of a trail that fits', () => {
        // Assert
        expect(shape(planCrumbs(keys.slice(0, 4), 'd', 4))).toEqual(['a', 'b', 'c', 'd']);
        expect(shape(planCrumbs([], '', 4))).toEqual([]);
    });

    it('should keep the first item and the last maxVisible - 1 and collapse the middle into one slot', () => {
        // Assert
        expect(shape(planCrumbs(keys, 'f', 4))).toEqual(['a', '[bc]', 'd', 'e', 'f']);
        expect(shape(planCrumbs(keys, 'f', 2))).toEqual(['a', '[bcde]', 'f']);
        expect(shape(planCrumbs(keys.slice(0, 5), 'e', 4))).toEqual(['a', '[b]', 'c', 'd', 'e']);
    });

    it('should never collapse the current item', () => {
        // Assert
        expect(shape(planCrumbs(keys, 'c', 4))).toEqual(['a', '[b]', 'c', 'd', 'e', 'f']);
        expect(shape(planCrumbs(keys, 'b', 4))).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
        expect(shape(planCrumbs(keys, 'e', 4))).toEqual(['a', '[bc]', 'd', 'e', 'f']);
    });

    it('should read maxVisible as at least 2, whole, and 4 when it is not a number', () => {
        // Assert
        expect(shape(planCrumbs(keys, 'f', 0))).toEqual(['a', '[bcde]', 'f']);
        expect(shape(planCrumbs(keys, 'f', 3.9))).toEqual(['a', '[bcd]', 'e', 'f']);
        expect(shape(planCrumbs(keys, 'f', 'many'))).toEqual(['a', '[bc]', 'd', 'e', 'f']);
    });
});
