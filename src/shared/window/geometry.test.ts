import { describe, expect, it } from 'vitest';
import { KEEP_VISIBLE, SNAP_ZONE, clampMove, isMovablePlacement, keyStep, moveBy, placementOf, resizeBy, sameBox, shownControls, snapBox, snapTarget } from './geometry.js';

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

describe('resizeBy at the north and west edges', () => {
    it('should move the window so the opposite edge stays where it was', () => {
        expect(resizeBy(start, 'w', -50, 0, area, min)).toEqual({ x: 50, y: 50, width: 450, height: 300 });
        expect(resizeBy(start, 'n', 0, 30, area, min)).toEqual({ x: 100, y: 80, width: 400, height: 270 });
        expect(resizeBy(start, 'nw', 20, -20, area, min)).toEqual({ x: 120, y: 30, width: 380, height: 320 });
        expect(resizeBy(start, 'ne', 20, -20, area, min)).toEqual({ x: 100, y: 30, width: 420, height: 320 });
        expect(resizeBy(start, 'sw', -20, 20, area, min)).toEqual({ x: 80, y: 50, width: 420, height: 320 });
    });

    it('should stop at the left and top edges of the area, and at the minimum size', () => {
        expect(resizeBy(start, 'nw', -5000, -5000, area, min)).toEqual({ x: 0, y: 0, width: 500, height: 350 });
        expect(resizeBy(start, 'nw', 5000, 5000, area, min)).toEqual({ x: 260, y: 190, width: 240, height: 160 });
    });

    it('should let a window that already hangs off the left shrink there, but not grow', () => {
        const off = { x: -100, y: 0, width: 400, height: 300 };

        expect(resizeBy(off, 'w', -50, 0, area, min)).toEqual(off);
        expect(resizeBy(off, 'w', 50, 0, area, min)).toEqual({ ...off, x: -50, width: 350 });
    });
});

describe('snapTarget and snapBox', () => {
    const all = shownControls(['snapLeft', 'snapRight', 'maximize']);

    it('should snap at the sides to a half and at the top to the whole area, the sides first', () => {
        expect(snapTarget(SNAP_ZONE, 300, area, all)).toBe('snapLeft');
        expect(snapTarget(-40, 0, area, all)).toBe('snapLeft');
        expect(snapTarget(1000 - SNAP_ZONE, 300, area, all)).toBe('snapRight');
        expect(snapTarget(500, 0, area, all)).toBe('maximize');
        expect(snapTarget(500, 300, area, all)).toBeUndefined();
        expect(snapTarget(SNAP_ZONE + 1, SNAP_ZONE + 1, area, all)).toBeUndefined();
    });

    it('should snap only to what the frame buttons offer', () => {
        expect(snapTarget(0, 300, area, shownControls(undefined))).toBeUndefined();
        expect(snapTarget(0, 0, area, shownControls(undefined))).toBe('maximize');
        expect(snapTarget(500, 0, area, shownControls(['close']))).toBeUndefined();
    });

    it('should cover the left half, the right half or the whole area', () => {
        const odd = { width: 1001, height: 700 };

        expect(snapBox('snapLeft', odd)).toEqual({ x: 0, y: 0, width: 500, height: 700 });
        expect(snapBox('snapRight', odd)).toEqual({ x: 500, y: 0, width: 501, height: 700 });
        expect(snapBox('maximize', odd)).toEqual({ x: 0, y: 0, width: 1001, height: 700 });
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
