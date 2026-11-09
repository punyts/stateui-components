import { describe, expect, it } from 'vitest';
import { KEEP_VISIBLE, clampMove, isMovablePlacement, keyStep, moveBy, placementOf, resizeBy, sameBox, shownControls } from './geometry.js';

const area = { width: 1000, height: 700 };
const start = { x: 100, y: 50, width: 400, height: 300 };
const min = { width: 240, height: 160 };

describe('moveBy', () => {
    it('should move by the pointer delta inside the area', () => {
        expect(moveBy(start, 30, -20, area)).toEqual({ x: 130, y: 30, width: 400, height: 300 });
    });

    it('should keep part of the title bar inside the area on every side', () => {
        expect(moveBy(start, -2000, 0, area).x).toBe(KEEP_VISIBLE - 400);
        expect(moveBy(start, 2000, 0, area).x).toBe(1000 - KEEP_VISIBLE);
        expect(moveBy(start, 0, -500, area).y).toBe(0);
        expect(moveBy(start, 0, 2000, area).y).toBe(700 - KEEP_VISIBLE);
    });

    it('should round to whole pixels', () => {
        expect(clampMove({ ...start, x: 10.4, y: 20.6 }, area)).toMatchObject({ x: 10, y: 21 });
    });
});

describe('resizeBy', () => {
    it('should resize the right edge, the bottom edge or both', () => {
        expect(resizeBy(start, 'e', 50, 80, area, min)).toEqual({ ...start, width: 450 });
        expect(resizeBy(start, 's', 50, 80, area, min)).toEqual({ ...start, height: 380 });
        expect(resizeBy(start, 'se', 50, 80, area, min)).toEqual({ ...start, width: 450, height: 380 });
    });

    it('should not go under the minimum size', () => {
        expect(resizeBy(start, 'se', -1000, -1000, area, min)).toEqual({ ...start, width: 240, height: 160 });
    });

    it('should stop at the right and bottom edges of the area', () => {
        expect(resizeBy(start, 'se', 5000, 5000, area, min)).toEqual({ ...start, width: 900, height: 650 });
    });

    it('should let a window that already reaches past the area shrink, but not grow', () => {
        const wide = { x: 800, y: 0, width: 400, height: 300 };

        expect(resizeBy(wide, 'e', 100, 0, area, min).width).toBe(400);
        expect(resizeBy(wide, 'e', -100, 0, area, min).width).toBe(300);
    });
});

describe('keyStep', () => {
    it('should move with an arrow key and resize with Shift', () => {
        expect(keyStep('ArrowLeft', false)).toEqual({ kind: 'move', dx: -16, dy: 0 });
        expect(keyStep('ArrowDown', true)).toEqual({ kind: 'resize', dx: 0, dy: 16 });
        expect(keyStep('Enter', false)).toBeUndefined();
    });
});

describe('placementOf and sameBox', () => {
    it('should write whole pixels and compare in whole pixels', () => {
        expect(placementOf({ x: 10.2, y: 0, width: 300.6, height: 200 })).toEqual({ x: '10px', y: '0px', width: '301px', height: '200px' });
        expect(sameBox(start, { ...start, x: 100.3 })).toBe(true);
        expect(sameBox(start, { ...start, x: 101 })).toBe(false);
    });
});

describe('shownControls', () => {
    it('should show the listed buttons, and minimize, maximize and close by default', () => {
        expect(shownControls(['close', 'snapLeft', 'nonsense'])).toEqual({ snapLeft: true, snapRight: false, minimize: false, maximize: false, close: true });
        expect(shownControls(undefined)).toEqual({ snapLeft: false, snapRight: false, minimize: true, maximize: true, close: true });
        expect(shownControls([])).toEqual({ snapLeft: false, snapRight: false, minimize: false, maximize: false, close: false });
    });
});

describe('isMovablePlacement', () => {
    it('should accept a placement with x and y only', () => {
        expect(isMovablePlacement({ x: '0px', y: '0px' })).toBe(true);
        expect(isMovablePlacement({ grow: 1 })).toBe(false);
        expect(isMovablePlacement(undefined)).toBe(false);
    });
});
