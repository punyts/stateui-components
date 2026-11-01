import { describe, expect, it } from 'vitest';
import { createRowLayout, layoutWindow } from './rowLayout.js';
import type { RowLayout } from './rowLayout.js';

const sourceOf = (initial: string[]): { keys: string[]; layout: RowLayout } => {
    const keys = [...initial];
    const layout = createRowLayout({
        total: () => keys.length,
        keyAt: (position) => keys[position],
        positionOf: (key) => {
            const at = keys.indexOf(key);
            return at < 0 ? undefined : at;
        }
    });
    return { keys, layout };
};
const names = (count: number): string[] => Array.from({ length: count }, (_v, i) => `k${i}`);

describe('createRowLayout', () => {
    it('should lay every row out at the estimate while nothing is measured', () => {
        // Arrange
        const { layout } = sourceOf(names(10));

        // Act
        layout.configure(3, 100);

        // Assert
        expect(layout.rows()).toBe(4);
        expect(layout.height()).toBe(400);
        expect(layout.offsetOfRow(2)).toBe(200);
        expect(layout.offsetOf(7)).toBe(200);
        expect(layout.rowAt(250)).toBe(2);
    });

    it('should make a row as tall as its tallest item and move the rows below it', () => {
        // Arrange
        const { layout } = sourceOf(names(6));
        layout.configure(2, 100);

        // Act
        const changed = layout.measure('k1', 180);
        layout.measure('k0', 120);

        // Assert
        expect(changed).toBe(true);
        expect(layout.heightOfRow(0)).toBe(180);
        expect(layout.offsetOfRow(1)).toBe(180);
        expect(layout.height()).toBe(180 + 100 + 100);
    });

    it('should report a measurement that does not change the kept height as unchanged and ignore a height that is not positive', () => {
        // Arrange
        const { layout } = sourceOf(names(4));
        layout.configure(1, 100);
        layout.measure('k0', 150);

        // Act and Assert
        expect(layout.measure('k0', 150)).toBe(false);
        expect(layout.measure('k0', 150.004)).toBe(false);
        expect(layout.measure('k0', 0)).toBe(false);
        expect(layout.measure('k0', Number.NaN)).toBe(false);
        expect(layout.measured('k0')).toBe(150);
    });

    it('should let a measured height shrink below the estimate', () => {
        // Arrange
        const { layout } = sourceOf(names(3));
        layout.configure(1, 100);

        // Act
        layout.measure('k1', 40);

        // Assert
        expect(layout.height()).toBe(240);
    });

    it('should keep each height with its record when the keys reorder', () => {
        // Arrange
        const { keys, layout } = sourceOf(['a', 'b', 'c']);
        layout.configure(1, 100);
        layout.measure('a', 300);
        layout.measure('b', 200);
        expect(layout.offsetOfRow(1)).toBe(300);

        // Act
        keys.reverse();
        layout.invalidate();

        // Assert
        expect(layout.heightOfRow(0)).toBe(100);
        expect(layout.heightOfRow(1)).toBe(200);
        expect(layout.heightOfRow(2)).toBe(300);
        expect(layout.offsetOf(2)).toBe(300);
        expect(layout.height()).toBe(600);
    });

    it('should work out the rows again when a record is added or removed', () => {
        // Arrange
        const { keys, layout } = sourceOf(['a', 'b']);
        layout.configure(1, 100);
        layout.measure('a', 150);

        // Act
        keys.push('c');
        const grown = layout.height();
        keys.shift();
        const shrunk = layout.height();

        // Assert
        expect(grown).toBe(350);
        expect(shrunk).toBe(200);
    });

    it('should work out the rows again when the columns or the estimate change', () => {
        // Arrange
        const { layout } = sourceOf(names(6));
        layout.configure(2, 100);
        layout.measure('k5', 250);
        expect(layout.height()).toBe(450);

        // Act
        layout.configure(3, 100);
        const threeColumns = layout.height();
        layout.configure(3, 50);

        // Assert
        expect(threeColumns).toBe(350);
        expect(layout.height()).toBe(300);
    });

    it('should drop the heights of records that are gone once more are kept than there are positions', () => {
        // Arrange
        const { keys, layout } = sourceOf(names(100));
        layout.configure(1, 10);
        for (const key of keys) layout.measure(key, 20);
        keys.splice(0, 80);

        // Act
        layout.invalidate();
        layout.height();

        // Assert
        expect(layout.size()).toBe(20);
        expect(layout.measured('k0')).toBeUndefined();
        expect(layout.measured('k90')).toBe(20);
    });

    it('should find the row under an offset by its top, the last row for an offset past the end and the first for a negative one', () => {
        // Arrange
        const { layout } = sourceOf(names(4));
        layout.configure(1, 100);
        layout.measure('k1', 50);

        // Act and Assert
        expect(layout.rowAt(-20)).toBe(0);
        expect(layout.rowAt(99)).toBe(0);
        expect(layout.rowAt(100)).toBe(1);
        expect(layout.rowAt(149)).toBe(1);
        expect(layout.rowAt(150)).toBe(2);
        expect(layout.rowAt(5000)).toBe(3);
    });

    it('should have no rows for no records', () => {
        // Arrange
        const { layout } = sourceOf([]);
        layout.configure(3, 100);

        // Act and Assert
        expect(layout.rows()).toBe(0);
        expect(layout.height()).toBe(0);
        expect(layout.rowAt(10)).toBe(0);
    });
});

describe('layoutWindow', () => {
    it('should list the whole rows that reach into the viewport', () => {
        // Arrange
        const { layout } = sourceOf(names(40));
        layout.configure(4, 100);
        layout.measure('k8', 300);

        // Act and Assert
        expect(layout.offsetOfRow(3)).toBe(500);
        expect(layout.offsetOfRow(2)).toBe(200);
        expect(layoutWindow(layout, 0, 250, 4)).toEqual({ first: 0, count: 12 });
        expect(layoutWindow(layout, 250, 100, 4)).toEqual({ first: 8, count: 4 });
        expect(layoutWindow(layout, 450, 200, 4)).toEqual({ first: 8, count: 12 });
    });

    it('should show nothing while there are no rows or the viewport is unknown', () => {
        // Arrange
        const { layout } = sourceOf(names(5));
        layout.configure(1, 100);

        // Act and Assert
        expect(layoutWindow(layout, 0, 0, 1)).toEqual({ first: 0, count: 0 });
        expect(layoutWindow(sourceOf([]).layout, 0, 100, 1)).toEqual({ first: 0, count: 0 });
    });
});
