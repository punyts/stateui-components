import { describe, expect, it } from 'vitest';
import { createBandScale, createLinearScale, extentOf, niceTicks, stack, stackExtent } from './scale.js';

describe('createLinearScale', () => {
    it('should map the domain onto the range and back', () => {
        // Arrange
        const scale = createLinearScale([0, 200], [100, 0]);

        // Assert
        expect(scale.scale(0)).toBe(100);
        expect(scale.scale(200)).toBe(0);
        expect(scale.scale(50)).toBe(75);
        expect(scale.invert(75)).toBe(50);
    });

    it('should round-trip values, also outside the domain and for negative domains', () => {
        // Arrange
        const scale = createLinearScale([-40, 60], [10, 310]);

        // Assert
        for (const value of [-40, -12.5, 0, 33, 60, 100, -90]) expect(scale.invert(scale.scale(value))).toBeCloseTo(value, 9);
    });

    it('should map every value to the start of the range when the domain has no span', () => {
        // Arrange
        const scale = createLinearScale([5, 5], [20, 80]);

        // Assert
        expect(scale.scale(5)).toBe(20);
        expect(scale.scale(9)).toBe(20);
        expect(scale.invert(50)).toBe(5);
    });

    it('should take an end that is not finite as 0', () => {
        // Assert
        expect(createLinearScale([Number.NaN, 10], [0, 100]).scale(5)).toBe(50);
    });
});

describe('createBandScale', () => {
    it('should give one category the band that the padding leaves', () => {
        // Arrange
        const scale = createBandScale(['a'], [0, 100], { padding: 0.2, outerPadding: 0.2 });

        // Assert
        expect(scale.step).toBeCloseTo(100 / 1.2, 9);
        expect(scale.bandwidth).toBeCloseTo((100 / 1.2) * 0.8, 9);
        expect(scale.scale('a')).toBeCloseTo((100 / 1.2) * 0.2, 9);
        expect(scale.invert(50)).toBe('a');
    });

    it('should place many categories in order, evenly, inside the range', () => {
        // Arrange
        const scale = createBandScale(['a', 'b', 'c', 'd'], [0, 400], { padding: 0, outerPadding: 0 });

        // Assert
        expect(scale.step).toBe(100);
        expect(scale.bandwidth).toBe(100);
        expect(['a', 'b', 'c', 'd'].map((category) => scale.scale(category))).toEqual([0, 100, 200, 300]);
    });

    it('should round-trip the centre of every band', () => {
        // Arrange
        const domain = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul'];
        const scale = createBandScale(domain, [30, 530]);

        // Assert
        for (const category of domain) expect(scale.invert((scale.scale(category) as number) + scale.bandwidth / 2)).toBe(category);
    });

    it('should answer undefined for an unknown category, a position outside the range and an empty domain', () => {
        // Arrange
        const scale = createBandScale(['a', 'b'], [0, 100]);

        // Assert
        expect(scale.scale('z')).toBeUndefined();
        expect(scale.invert(-1)).toBeUndefined();
        expect(scale.invert(101)).toBeUndefined();
        expect(createBandScale([], [0, 100]).invert(10)).toBeUndefined();
        expect(createBandScale([], [0, 100]).step).toBe(0);
    });

    it('should keep the first place of a repeated category', () => {
        // Arrange
        const scale = createBandScale(['a', 'b', 'a'], [0, 200], { padding: 0, outerPadding: 0 });

        // Assert
        expect(scale.domain).toEqual(['a', 'b']);
        expect(scale.scale('a')).toBe(0);
    });
});

describe('niceTicks', () => {
    it('should round a range to 1, 2 or 5 times a power of ten', () => {
        // Act
        const ticks = niceTicks(0, 97, 5);

        // Assert
        expect(ticks.values).toEqual([0, 50, 100]);
        expect([ticks.min, ticks.max, ticks.step]).toEqual([0, 100, 50]);
    });

    it('should cover a range that starts above zero without starting at zero', () => {
        // Act
        const ticks = niceTicks(1003, 1047, 5);

        // Assert
        expect(ticks.min).toBeLessThanOrEqual(1003);
        expect(ticks.max).toBeGreaterThanOrEqual(1047);
        expect(ticks.values).toEqual([1000, 1020, 1040, 1060]);
    });

    it('should cover negatives and pass through zero', () => {
        // Act
        const ticks = niceTicks(-37, 12, 6);

        // Assert
        expect(ticks.values).toEqual([-40, -30, -20, -10, 0, 10, 20]);
    });

    it('should cover a range of only negatives', () => {
        // Act
        const ticks = niceTicks(-95, -5, 4);

        // Assert
        expect(ticks.values).toEqual([-100, -50, 0]);
        expect(ticks.max).toBeGreaterThanOrEqual(-5);
    });

    it('should cover zero up to the value, or the value down to zero, when the range has no span', () => {
        // Assert
        expect(niceTicks(5, 5, 6).values).toEqual([0, 1, 2, 3, 4, 5]);
        expect(niceTicks(-5, -5, 6).values).toEqual([-5, -4, -3, -2, -1, 0]);
        expect(niceTicks(0, 0, 3).values).toEqual([0, 0.5, 1]);
    });

    it('should round very large values without noise', () => {
        // Act
        const ticks = niceTicks(0, 4.2e12, 6);

        // Assert
        expect(ticks.values).toEqual([0, 1e12, 2e12, 3e12, 4e12, 5e12]);
    });

    it('should round very small values without binary noise', () => {
        // Act
        const ticks = niceTicks(0, 0.00032, 5);

        // Assert
        expect(ticks.values).toEqual([0, 0.0001, 0.0002, 0.0003, 0.0004]);
        expect(ticks.step).toBe(0.0001);
    });

    it('should swap ends given the wrong way round and take non-finite ends as 0', () => {
        // Assert
        expect(niceTicks(100, 0, 5).values).toEqual(niceTicks(0, 100, 5).values);
        expect(niceTicks(Number.NaN, 10, 3).min).toBe(0);
    });

    it('should format labels with the formatter the caller gives, and with String without one', () => {
        // Act
        const plain = niceTicks(0, 3, 4);
        const german = niceTicks(0, 3, 4, (value) => value.toFixed(1).replace('.', ','));

        // Assert
        expect(plain.labels).toEqual(['0', '1', '2', '3']);
        expect(german.labels).toEqual(['0,0', '1,0', '2,0', '3,0']);
    });

    it('should keep the tick count near the wanted count and cover the range', () => {
        // Assert
        for (const count of [2, 3, 5, 8, 12]) {
            for (const [low, high] of [[0, 1], [-3, 977], [12, 13], [0, 1e9]] as const) {
                const ticks = niceTicks(low, high, count);
                expect(ticks.values.length).toBeGreaterThanOrEqual(2);
                expect(ticks.values.length).toBeLessThanOrEqual(count * 2 + 1);
                expect(ticks.min).toBeLessThanOrEqual(low);
                expect(ticks.max).toBeGreaterThanOrEqual(high);
            }
        }
    });
});

describe('stack', () => {
    it('should stack positive values upwards in series order', () => {
        // Act
        const stacked = stack([[1, 2], [3, 4]]);

        // Assert
        expect(stacked[0]).toEqual([{ lower: 0, upper: 1 }, { lower: 0, upper: 2 }]);
        expect(stacked[1]).toEqual([{ lower: 1, upper: 4 }, { lower: 2, upper: 6 }]);
    });

    it('should stack negative values downwards from zero, apart from the positive ones', () => {
        // Act
        const stacked = stack([[5, -2], [-3, 4], [2, -1]]);

        // Assert
        expect(stacked[0]).toEqual([{ lower: 0, upper: 5 }, { lower: -2, upper: 0 }]);
        expect(stacked[1]).toEqual([{ lower: -3, upper: 0 }, { lower: 0, upper: 4 }]);
        expect(stacked[2]).toEqual([{ lower: 5, upper: 7 }, { lower: -3, upper: -2 }]);
    });

    it('should count a missing or broken value as zero and pad a short series', () => {
        // Act
        const stacked = stack([[1, 2, 3], [Number.NaN, 4]]);

        // Assert
        expect(stacked[1]).toEqual([{ lower: 1, upper: 1 }, { lower: 2, upper: 6 }, { lower: 3, upper: 3 }]);
    });

    it('should give nothing for no series', () => {
        // Assert
        expect(stack([])).toEqual([]);
    });
});

describe('extentOf and stackExtent', () => {
    it('should find the ends and ignore values that are not finite', () => {
        // Assert
        expect(extentOf([3, Number.NaN, -2, 8, Infinity])).toEqual([-2, 8]);
        expect(extentOf([])).toEqual([0, 0]);
    });

    it('should include zero in the extent of a stack', () => {
        // Assert
        expect(stackExtent(stack([[4, 6], [1, 2]]))).toEqual([0, 8]);
        expect(stackExtent(stack([[-4, -6]]))).toEqual([-6, 0]);
        expect(stackExtent([])).toEqual([0, 0]);
    });
});
