import { describe, expect, it } from 'vitest';
import { MAX_SLOTS, poolSize, poolStart, readWindow } from './window.js';

describe('readWindow', () => {
    it('should read first and count and treat anything else as 0', () => {
        // Act and Assert
        expect(readWindow({ first: 4, count: 12 })).toEqual({ first: 4, count: 12 });
        expect(readWindow({ first: -3, count: 'x' })).toEqual({ first: 0, count: 0 });
        expect(readWindow(undefined)).toEqual({ first: 0, count: 0 });
        expect(readWindow({ first: 2.9, count: 5.2 })).toEqual({ first: 2, count: 5 });
    });
});

describe('poolSize', () => {
    it('should add the overscan on both sides of the visible rows', () => {
        // Act and Assert
        expect(poolSize(20, 5)).toBe(30);
        expect(poolSize(0, 5)).toBe(10);
        expect(poolSize(10, 0)).toBe(10);
    });

    it('should cap at 200 and take the cap from the overscan first', () => {
        // Act and Assert
        expect(poolSize(190, 20)).toBe(MAX_SLOTS);
        expect(poolSize(196, 20)).toBe(200);
        expect(poolSize(195, 20)).toBe(199);
        expect(poolSize(300, 5)).toBe(MAX_SLOTS);
    });
});

describe('poolStart', () => {
    it('should start the overscan above the first visible row and not before 0', () => {
        // Act and Assert
        expect(poolStart(100, 1000, 30, 5)).toBe(95);
        expect(poolStart(2, 1000, 30, 5)).toBe(0);
    });

    it('should move up near the end so the pool stays inside the records', () => {
        // Act and Assert
        expect(poolStart(990, 1000, 30, 5)).toBe(970);
        expect(poolStart(5, 10, 30, 5)).toBe(0);
    });
});
