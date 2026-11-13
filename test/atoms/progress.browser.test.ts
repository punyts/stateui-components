import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const track = (element: Element): HTMLElement => element.shadowRoot?.querySelector('.progress') as HTMLElement;
const bar = (element: Element): HTMLElement => element.shadowRoot?.querySelector('.bar') as HTMLElement;
const ring = (element: Element): HTMLElement => element.shadowRoot?.querySelector('.ring') as HTMLElement;
const arc = (element: Element): SVGCircleElement => element.shadowRoot?.querySelector('.arc') as SVGCircleElement;
/** The share of the ring the arc draws, from its dash offset over a path length of 100 (Chromium computes it as `calc(75px)`) */
const arcShare = (element: Element): number => (100 - parseFloat(getComputedStyle(arc(element)).strokeDashoffset.replace(/^calc\(/u, ''))) / 100;
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

describe('progress ring in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should keep the bar by default and draw a ring progressbar, with no bar, for shape ring', () => {
        // Arrange
        const bar = mountComponent('progress', { value: 30 });
        const round = mountComponent('progress', { value: 30, shape: 'ring', _label: 'Upload' });

        // Assert
        expect(ring(bar.element)).toBeNull();
        expect(track(bar.element).getAttribute('aria-valuetext')).toBeNull();
        expect(track(round.element)).toBeNull();
        expect(round.element.getAttribute('shape')).toBe('ring');
        expect(ring(round.element).getAttribute('role')).toBe('progressbar');
        expect(ring(round.element).getAttribute('aria-label')).toBe('Upload');
        expect(ring(round.element).getAttribute('aria-valuenow')).toBe('30');
        expect(ring(round.element).getAttribute('aria-valuetext')).toBe('30%');
    });

    it('should draw the share of max as the arc, clamp it, and follow a linked value', () => {
        // Arrange
        const mounted = mountComponent('progress', { shape: 'ring', '<-value': '$.data.done', max: 200 }, { data: { done: 50 }, motion: 'reduced' });
        const share = arcShare(mounted.element);

        // Act
        mounted.store.set('$.data.done', 900);

        // Assert
        expect(share).toBeCloseTo(0.25, 2);
        expect(arcShare(mounted.element)).toBeCloseTo(1, 2);
        expect(ring(mounted.element).getAttribute('aria-valuetext')).toBe('100%');
    });

    it('should show the percent in the centre with showValue and hide it while indeterminate', () => {
        // Arrange
        const mounted = mountComponent('progress', { shape: 'ring', value: 42, showValue: true });
        const shown = mounted.element.shadowRoot?.querySelector('.value')?.textContent;

        // Act
        mounted.store.set('$.app.indeterminate', true);

        // Assert
        expect(shown).toBe('42%');
        expect(mounted.element.shadowRoot?.querySelector('.value')).toBeNull();
        expect(ring(mounted.element).hasAttribute('aria-valuenow')).toBe(false);
        expect(ring(mounted.element).hasAttribute('aria-valuetext')).toBe(false);
    });

    it('should spin the indeterminate ring and stop it with reduced motion', () => {
        // Arrange
        const running = mountComponent('progress', { shape: 'ring', indeterminate: true });
        const stopped = mountComponent('progress', { shape: 'ring', indeterminate: true }, { motion: 'reduced' });
        const dial = (element: Element): CSSStyleDeclaration => getComputedStyle(element.shadowRoot?.querySelector('.dial') as Element);

        // Assert
        expect(dial(running.element).animationName).toBe('turn');
        expect(dial(running.element).animationDuration).not.toBe('0s');
        expect(dial(stopped.element).animationDuration).toBe('0s');
    });

    it('should paint the arc with the tone and grow with the shared size', () => {
        // Arrange
        const small = mountComponent('progress', { shape: 'ring', size: 'sm', value: 50 });
        const large = mountComponent('progress', { shape: 'ring', size: 'lg', value: 50, tone: 'danger' });

        // Assert
        expect(ring(large.element).getBoundingClientRect().width).toBeGreaterThan(ring(small.element).getBoundingClientRect().width);
        expect(getComputedStyle(arc(large.element)).stroke).not.toBe(getComputedStyle(arc(small.element)).stroke);
    });

    it('should write the percent in the language chosen', () => {
        // Arrange
        const mounted = mountComponent('progress', { shape: 'ring', value: 25, showValue: true });

        // Act
        mounted.setLocale('fr');

        // Assert
        expect(ring(mounted.element).getAttribute('aria-label')).toBe('Progression');
        expect(mounted.element.shadowRoot?.querySelector('.value')?.textContent?.replace(/\s/gu, ' ')).toBe('25 %');
    });
});
