import { describe, expect, it } from 'vitest';
import { isOrderKey, orderBetween, orderKeys } from './order.js';

describe('orderBetween', () => {
    it('should make a key between two keys, and before and after one', () => {
        // Arrange
        const low = 'V';
        const high = 'k';

        // Act
        const middle = orderBetween(low, high);
        const first = orderBetween(undefined, low);
        const last = orderBetween(high);

        // Assert
        expect(low < middle && middle < high).toBe(true);
        expect(first < low).toBe(true);
        expect(last > high).toBe(true);
        expect([middle, first, last].every(isOrderKey)).toBe(true);
    });

    it('should keep finding room when keys are inserted at the same place many times', () => {
        // Arrange
        let low = 'a';
        const high = 'b';

        // Act
        const made: string[] = [];
        for (let step = 0; step < 200; step++) {
            low = orderBetween(low, high);
            made.push(low);
        }

        // Assert
        expect(made.every((key, index) => key > (made[index - 1] ?? 'a') && key < high && isOrderKey(key))).toBe(true);
    });

    it('should read a key that is not an order key as missing, and keys out of order as after the first', () => {
        // Act
        const fromBad = orderBetween('not a key!', 'V');
        const reversed = orderBetween('k', 'V');

        // Assert
        expect(fromBad < 'V').toBe(true);
        expect(reversed > 'k').toBe(true);
    });
});

describe('orderKeys', () => {
    it('should give keys of one length in rising order that leave room between them', () => {
        // Act
        const keys = orderKeys(70);

        // Assert
        expect(keys).toHaveLength(70);
        expect(new Set(keys.map((key) => key.length))).toEqual(new Set([3]));
        expect([...keys].sort()).toEqual(keys);
        const between = orderBetween(keys[3], keys[4]);
        expect(between > (keys[3] as string) && between < (keys[4] as string)).toBe(true);
    });
});
