import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const ring = (element: Element): HTMLElement => element.shadowRoot?.querySelector('.spinner') as HTMLElement;

describe('spinner in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render a status named by its label and follow a write', () => {
        // Arrange
        const mounted = mountComponent('spinner', { _label: 'Saving' });

        // Act
        mounted.store.set('$.app._label', 'Uploading');

        // Assert
        expect(ring(mounted.element).getAttribute('role')).toBe('status');
        expect(ring(mounted.element).getAttribute('aria-label')).toBe('Uploading');
    });

    it('should show a label linked to $.data and update when the data changes', () => {
        // Arrange
        const mounted = mountComponent('spinner', { '<-_label': '$.data.what' }, { data: { what: 'Saving' } });

        // Act
        mounted.store.set('$.data.what', 'Sending');

        // Assert
        expect(ring(mounted.element).getAttribute('aria-label')).toBe('Sending');
    });

    it('should turn with a duration from the motion token', () => {
        // Arrange and Act
        const mounted = mountComponent('spinner');
        const style = getComputedStyle(ring(mounted.element));

        // Assert
        expect(style.animationName).toBe('spin');
        expect(style.animationDuration).toBe('0.8s');
        expect(style.animationIterationCount).toBe('infinite');
    });

    it('should have a zero computed animation duration with reduced motion', () => {
        // Arrange and Act
        const mounted = mountComponent('spinner', {}, { motion: 'reduced' });

        // Assert
        expect(getComputedStyle(ring(mounted.element)).animationDuration).toBe('0s');
    });

    it('should stop when the reduced motion overlay is applied later', () => {
        // Arrange
        const mounted = mountComponent('spinner');

        // Act
        mounted.setTheme('motion', 'reduced');

        // Assert
        expect(getComputedStyle(ring(mounted.element)).animationDuration).toBe('0s');
    });

    it('should take its size from the shared size', () => {
        // Arrange
        const small = mountComponent('spinner', { size: 'sm' });
        const large = mountComponent('spinner', { size: 'lg' });

        // Assert
        expect(ring(large.element).getBoundingClientRect().width).toBeGreaterThan(ring(small.element).getBoundingClientRect().width);
    });

    it('should colour the arc with the tone and change it in the dark overlay', () => {
        // Arrange
        const mounted = mountComponent('spinner', { tone: 'danger' });
        const before = getComputedStyle(ring(mounted.element)).borderTopColor;

        // Act
        mounted.setTheme('mode', 'dark');

        // Assert
        expect(before).not.toBe(getComputedStyle(ring(mounted.element)).borderRightColor);
        expect(getComputedStyle(ring(mounted.element)).borderTopColor).not.toBe(before);
    });

    it('should show the German label', () => {
        // Arrange and Act
        const mounted = mountComponent('spinner', {}, { locale: 'de' });

        // Assert
        expect(ring(mounted.element).getAttribute('aria-label')).toBe('Wird geladen');
    });
});
