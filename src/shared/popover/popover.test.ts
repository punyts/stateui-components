import { describe, expect, it } from 'vitest';
import { ALIGNED_PLACEMENTS, PLACEMENTS, isAlignedPlacement, isAnchorName, isPlacement, positionAreaOf } from './popover.js';

describe('positionAreaOf', () => {
    it.each([
        ['top', 'top'],
        ['bottom', 'bottom'],
        ['start', 'inline-start'],
        ['end', 'inline-end']
    ] as const)('should map the placement %s to the position-area %s', (placement, area) => {
        // Act and Assert
        expect(positionAreaOf(placement)).toBe(area);
    });

    it('should know a position-area for every placement', () => {
        // Act and Assert
        expect(PLACEMENTS.every((placement) => positionAreaOf(placement) !== undefined)).toBe(true);
    });
});

describe('aligned placements', () => {
    it.each([
        ['bottomStart', 'block-end span-inline-end'],
        ['bottomEnd', 'block-end span-inline-start'],
        ['topStart', 'block-start span-inline-end'],
        ['topEnd', 'block-start span-inline-start']
    ] as const)('should map the aligned placement %s to the position-area %s', (placement, area) => {
        // Act and Assert
        expect(positionAreaOf(placement)).toBe(area);
    });

    it('should accept the four aligned placements, which are not plain placements, and refuse anything else', () => {
        // Act and Assert
        expect(ALIGNED_PLACEMENTS.every(isAlignedPlacement)).toBe(true);
        expect(ALIGNED_PLACEMENTS.some(isPlacement)).toBe(false);
        expect(isAlignedPlacement('bottom')).toBe(false);
        expect(isAlignedPlacement(undefined)).toBe(false);
    });
});

describe('isPlacement', () => {
    it('should accept the four placements and refuse anything else', () => {
        // Act and Assert
        expect(PLACEMENTS.every(isPlacement)).toBe(true);
        expect(isPlacement('left')).toBe(false);
        expect(isPlacement(undefined)).toBe(false);
    });
});

describe('isAnchorName', () => {
    it('should accept a dashed identifier', () => {
        // Act and Assert
        expect(isAnchorName('--t')).toBe(true);
        expect(isAnchorName('--menu-anchor_2')).toBe(true);
    });

    it.each(['', 't', '-t', '--', '--a b', '--a;color:red', 42])('should refuse %j', (value) => {
        // Act and Assert
        expect(isAnchorName(value)).toBe(false);
    });
});
