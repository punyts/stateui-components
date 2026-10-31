import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const track = (element: Element): HTMLElement => element.shadowRoot?.querySelector('.progress') as HTMLElement;
const bar = (element: Element): HTMLElement => element.shadowRoot?.querySelector('.bar') as HTMLElement;
const fill = (element: Element): number =>
    bar(element).getBoundingClientRect().width / track(element).getBoundingClientRect().width;

describe('progress in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render a progressbar with its value and follow a state write', () => {
        // Arrange
        const mounted = mountComponent('progress', { value: 20, _label: 'Upload' });

        // Act
        mounted.store.set('$.app.value', 60);

        // Assert
        expect(track(mounted.element).getAttribute('role')).toBe('progressbar');
        expect(track(mounted.element).getAttribute('aria-label')).toBe('Upload');
        expect(track(mounted.element).getAttribute('aria-valuenow')).toBe('60');
        expect(track(mounted.element).getAttribute('aria-valuemax')).toBe('100');
    });

    it('should move the bar when value linked to $.data changes', () => {
        // Arrange
        const mounted = mountComponent('progress', { '<-value': '$.data.done' }, { data: { done: 25 }, motion: 'reduced' });
        expect(fill(mounted.element)).toBeCloseTo(0.25, 2);

        // Act
        mounted.store.set('$.data.done', 75);

        // Assert
        expect(fill(mounted.element)).toBeCloseTo(0.75, 2);
        expect(track(mounted.element).getAttribute('aria-valuenow')).toBe('75');
    });

    it('should scale the bar by max and clamp it to the track', () => {
        // Arrange
        const half = mountComponent('progress', { value: 5, max: 10 }, { motion: 'reduced' });
        const over = mountComponent('progress', { value: 500 }, { motion: 'reduced' });

        // Assert
        expect(fill(half.element)).toBeCloseTo(0.5, 2);
        expect(fill(over.element)).toBeCloseTo(1, 2);
    });

    it('should omit aria-valuenow when indeterminate and restore it when determinate', () => {
        // Arrange
        const mounted = mountComponent('progress', { value: 40, indeterminate: true });
        expect(track(mounted.element).hasAttribute('aria-valuenow')).toBe(false);

        // Act
        mounted.store.set('$.app.indeterminate', false);

        // Assert
        expect(track(mounted.element).getAttribute('aria-valuenow')).toBe('40');
    });

    it('should animate the indeterminate bar and stop it with reduced motion', () => {
        // Arrange
        const running = mountComponent('progress', { indeterminate: true });
        const stopped = mountComponent('progress', { indeterminate: true }, { motion: 'reduced' });

        // Assert
        expect(getComputedStyle(bar(running.element)).animationName).toBe('slide');
        expect(getComputedStyle(bar(running.element)).animationDuration).not.toBe('0s');
        expect(getComputedStyle(bar(stopped.element)).animationDuration).toBe('0s');
    });

    it('should take its height from the shared size', () => {
        // Arrange
        const small = mountComponent('progress', { size: 'sm' });
        const large = mountComponent('progress', { size: 'lg' });

        // Assert
        expect(track(large.element).getBoundingClientRect().height).toBeGreaterThan(track(small.element).getBoundingClientRect().height);
    });

    it('should paint the bar with the tone and change colours in the dark overlay', () => {
        // Arrange
        const mounted = mountComponent('progress', { value: 50, tone: 'success' });
        const before = getComputedStyle(bar(mounted.element)).backgroundColor;

        // Act
        mounted.setTheme('mode', 'dark');

        // Assert
        expect(getComputedStyle(bar(mounted.element)).backgroundColor).not.toBe(before);
    });

    it('should show the German label', () => {
        // Arrange and Act
        const mounted = mountComponent('progress', {}, { locale: 'de' });

        // Assert
        expect(track(mounted.element).getAttribute('aria-label')).toBe('Fortschritt');
    });
});
