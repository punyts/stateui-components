import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;
const lines = (element: Element): HTMLElement[] => Array.from(root(element).querySelectorAll<HTMLElement>('.line'));
const block = (element: Element): HTMLElement => root(element).querySelector('.block') as HTMLElement;
const box = (element: Element): DOMRect => element.getBoundingClientRect();

describe('skeleton in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should draw one text line by default and hide itself from assistive technology', () => {
        // Arrange and Act
        const mounted = mountComponent('skeleton', {});

        // Assert
        expect(lines(mounted.element)).toHaveLength(1);
        expect(block(mounted.element)).toBeNull();
        expect(root(mounted.element).querySelector('.skeleton')?.getAttribute('aria-hidden')).toBe('true');
        expect(lines(mounted.element)[0]?.getBoundingClientRect().height).toBeGreaterThan(0);
    });

    it('should draw three lines with a shorter last line for lines 3', () => {
        // Arrange and Act
        const mounted = mountComponent('skeleton', { lines: 3 });
        const widths = lines(mounted.element).map((line) => line.getBoundingClientRect().width);

        // Assert
        expect(widths).toHaveLength(3);
        expect(widths[0]).toBeCloseTo(widths[1] as number, 1);
        expect(widths[2]).toBeCloseTo((widths[0] as number) * 0.6, 0);
    });

    it('should follow a write to lines', () => {
        // Arrange
        const mounted = mountComponent('skeleton', { lines: 2 });

        // Act
        mounted.store.set('$.app.lines', 4);

        // Assert
        expect(lines(mounted.element)).toHaveLength(4);
    });

    it('should draw a rect with the ratio and a circle as a square with a full radius', () => {
        // Arrange
        const rect = mountComponent('skeleton', { shape: 'rect', ratio: '4:3' });
        const circle = mountComponent('skeleton', { shape: 'circle' });

        // Assert
        expect(lines(rect.element)).toHaveLength(0);
        const rectBox = block(rect.element).getBoundingClientRect();
        expect(rectBox.width / rectBox.height).toBeCloseTo(4 / 3, 2);
        const circleBox = block(circle.element).getBoundingClientRect();
        expect(circleBox.width).toBeGreaterThan(0);
        expect(circleBox.width).toBeCloseTo(circleBox.height, 1);
        expect(getComputedStyle(block(circle.element)).borderTopLeftRadius).not.toBe('0px');
    });

    it('should fill the container with width fill and take a percent or ch width', () => {
        // Arrange
        const fill = mountComponent('skeleton', { shape: 'rect' });
        const half = mountComponent('skeleton', { shape: 'rect', width: '50%' });
        const chars = mountComponent('skeleton', { shape: 'rect', width: '10ch' });
        const full = box(fill.element).width;

        // Assert
        expect(block(fill.element).getBoundingClientRect().width).toBeCloseTo(full, 0);
        expect(block(half.element).getBoundingClientRect().width).toBeCloseTo(full / 2, 0);
        const ten = block(chars.element).getBoundingClientRect().width;
        expect(ten).toBeGreaterThan(0);
        expect(ten).toBeLessThan(full);
    });

    it('should refuse a width that is not fill, ch or percent', () => {
        // Arrange and Act
        const mount = (): unknown => mountComponent('skeleton', { width: '12px' });

        // Assert
        expect(mount).toThrow();
    });

    it('should shimmer from the motion token and be static with reduced motion', () => {
        // Arrange
        const running = mountComponent('skeleton', {});
        const stopped = mountComponent('skeleton', {}, { motion: 'reduced' });

        // Assert
        const style = getComputedStyle(lines(running.element)[0] as HTMLElement);
        expect(style.animationName).toBe('shimmer');
        expect(style.animationDuration).not.toBe('0s');
        expect(getComputedStyle(lines(stopped.element)[0] as HTMLElement).animationDuration).toBe('0s');
    });

    it('should stop when the reduced motion overlay is applied later', () => {
        // Arrange
        const mounted = mountComponent('skeleton', { shape: 'rect' });

        // Act
        mounted.setTheme('motion', 'reduced');

        // Assert
        expect(getComputedStyle(block(mounted.element)).animationDuration).toBe('0s');
    });

    it('should take the radius from the component token', () => {
        // Arrange
        const mounted = mountComponent('skeleton', { shape: 'rect' });
        const before = getComputedStyle(block(mounted.element)).borderTopLeftRadius;

        // Act
        (mounted.element as HTMLElement).style.setProperty('--ui-skeleton-radius', '9px');

        // Assert
        expect(before).not.toBe('9px');
        expect(getComputedStyle(block(mounted.element)).borderTopLeftRadius).toBe('9px');
    });
});
