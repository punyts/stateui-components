import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const meter = (element: Element): HTMLElement => element.shadowRoot?.querySelector('.meter') as HTMLElement;
const part = (element: Element, selector: string): HTMLElement => element.shadowRoot?.querySelector(selector) as HTMLElement;
const fill = (element: Element): number => part(element, '.fill').getBoundingClientRect().width / part(element, '.track').getBoundingClientRect().width;

describe('meter in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should expose a meter with its range, value text and fill', () => {
        // Arrange and Act
        const mounted = mountComponent('meter', { _label: 'Disk', value: 30, min: 0, max: 120 }, { motion: 'reduced' });

        // Assert
        expect(meter(mounted.element).getAttribute('role')).toBe('meter');
        expect(meter(mounted.element).getAttribute('aria-label')).toBe('Disk');
        expect(meter(mounted.element).getAttribute('aria-valuenow')).toBe('30');
        expect(meter(mounted.element).getAttribute('aria-valuemax')).toBe('120');
        expect(meter(mounted.element).getAttribute('aria-valuetext')).toBe('30');
        expect(fill(mounted.element)).toBeCloseTo(0.25, 2);
    });

    it('should reflect a warning and then danger level as a low-is-good value rises', () => {
        // Arrange
        const mounted = mountComponent('meter', { value: 20, low: 50, high: 80, optimum: 0 }, { motion: 'reduced' });
        const good = getComputedStyle(part(mounted.element, '.fill')).backgroundColor;
        expect(mounted.element.getAttribute('level')).toBe('good');

        // Act
        mounted.store.set('$.app.value', 60);
        const middle = mounted.element.getAttribute('level');
        mounted.store.set('$.app.value', 95);

        // Assert
        expect(middle).toBe('warning');
        expect(mounted.element.getAttribute('level')).toBe('danger');
        expect(getComputedStyle(part(mounted.element, '.fill')).backgroundColor).not.toBe(good);
    });

    it('should write the value in the format and language of the app', () => {
        // Arrange and Act
        const mounted = mountComponent('meter', { value: 0.42, max: 1, format: 'percent', fractionDigits: 0 }, { locale: 'de' });

        // Assert
        expect(meter(mounted.element).getAttribute('aria-valuetext')).toBe('42 %');
    });
});
