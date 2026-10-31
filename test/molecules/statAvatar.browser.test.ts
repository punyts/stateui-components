import { afterEach, describe, expect, it } from 'vitest';
import { CORE_ICONS } from '../../.test-build/real/icons/core.js';
import { mountComponent } from '../harness/mountComponent.js';

const NBSP = ' ';

const part = (element: Element, selector: string): HTMLElement | null => element.shadowRoot?.querySelector(selector) ?? null;
const shown = (element: Element): string => part(element, '.value')?.textContent?.trim() ?? '';
const delta = (element: Element): string => part(element, '.delta')?.textContent?.trim() ?? '';
const trendPaths = (element: Element): string[] =>
    Array.from(part(element, '.glyph')?.querySelectorAll('path') ?? []).map((path) => path.getAttribute('d') ?? '');
const dataOf = (name: string): string[] => (CORE_ICONS[name]?.outline ?? []).map((path) => (typeof path === 'string' ? path : path.d));
const initials = (element: Element): string => part(element, '.initials')?.textContent?.trim() ?? '';

describe('stat in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should format a number in en and de', () => {
        // Arrange
        const en = mountComponent('stat', { value: 1234.5 });
        const de = mountComponent('stat', { value: 1234.5 }, { locale: 'de' });

        // Assert
        expect(shown(en.element)).toBe('1,234.5');
        expect(shown(de.element)).toBe('1.234,5');
    });

    it('should format a percent in en and de', () => {
        // Arrange
        const en = mountComponent('stat', { value: 0.5, format: 'percent' });
        const de = mountComponent('stat', { value: 0.5, format: 'percent' }, { locale: 'de' });

        // Assert
        expect(shown(en.element)).toBe('50%');
        expect(shown(de.element)).toBe(`50${NBSP}%`);
    });

    it('should format a currency in en and de', () => {
        // Arrange
        const en = mountComponent('stat', { value: 1234.5, format: 'currency', currency: 'EUR' });
        const de = mountComponent('stat', { value: 1234.5, format: 'currency', currency: 'EUR' }, { locale: 'de' });

        // Assert
        expect(shown(en.element)).toBe('€1,234.50');
        expect(shown(de.element)).toBe(`1.234,50${NBSP}€`);
    });

    it('should format a duration as m:ss and h:mm:ss in en and de', () => {
        // Arrange
        const minutes = mountComponent('stat', { value: 125, format: 'duration' });
        const hours = mountComponent('stat', { value: 3725, format: 'duration' }, { locale: 'de' });

        // Assert
        expect(shown(minutes.element)).toBe('2:05');
        expect(shown(hours.element)).toBe('1:02:05');
    });

    it('should reformat when the language is switched', () => {
        // Arrange
        const mounted = mountComponent('stat', { value: 1234.5 });

        // Act
        mounted.setLocale('de');

        // Assert
        expect(shown(mounted.element)).toBe('1.234,5');
    });

    it('should update when value linked to $.data changes', () => {
        // Arrange
        const mounted = mountComponent('stat', { '<-value': '$.data.total' }, { data: { total: 10 } });
        expect(shown(mounted.element)).toBe('10');

        // Act
        mounted.store.set('$.data.total', 2500);

        // Assert
        expect(shown(mounted.element)).toBe('2,500');
    });

    it('should show a dash when there is no value', () => {
        // Act
        const mounted = mountComponent('stat', {});

        // Assert
        expect(shown(mounted.element)).toBe('—');
    });

    it('should show the label and unit, and the German label', () => {
        // Arrange
        const mounted = mountComponent('stat', { value: 3, _unit: 'ms' });

        // Assert
        expect(part(mounted.element, '.label')?.textContent?.trim()).toBe('Label');
        expect(part(mounted.element, '.unit')?.textContent?.trim()).toBe('ms');

        // Act
        mounted.setLocale('de');

        // Assert
        expect(part(mounted.element, '.label')?.textContent?.trim()).toBe('Beschriftung');
    });

    it('should draw a different icon for up, down and flat, and none without a trend', () => {
        // Arrange
        const mounted = mountComponent('stat', { value: 1 });
        expect(part(mounted.element, '.glyph')).toBeNull();

        // Act and Assert
        for (const [trend, icon] of [['up', 'chevron-up'], ['down', 'chevron-down'], ['flat', 'minus']] as const) {
            mounted.store.set('$.app.trend', trend);
            expect(trendPaths(mounted.element)).toEqual(dataOf(icon));
        }
    });

    it('should show the signed delta beside the trend', () => {
        // Act
        const mounted = mountComponent('stat', { value: 100, trend: 'up', delta: 0.125, format: 'percent' });

        // Assert
        expect(delta(mounted.element)).toBe('+12.5%');
    });

    it('should colour the trend only when tone is set', () => {
        // Arrange
        const plain = mountComponent('stat', { value: 1, trend: 'up' });
        const toned = mountComponent('stat', { value: 1, trend: 'up', tone: 'success' });
        const colour = (element: Element): string => getComputedStyle(part(element, '.change') as Element).color;

        // Assert
        expect(colour(toned.element)).not.toBe(colour(plain.element));
        expect(colour(plain.element)).toBe(getComputedStyle(part(plain.element, '.label') as Element).color);
    });

    it('should reject a currency format without a currency code', () => {
        // Assert
        expect(() => mountComponent('stat', { value: 1, format: 'currency' })).toThrow(/currency/);
    });

    it('should change colours with the dark overlay', () => {
        // Arrange
        const mounted = mountComponent('stat', { value: 1 });
        const colour = (): string => getComputedStyle(part(mounted.element, '.value') as Element).color;
        const light = colour();

        // Act
        mounted.setTheme('mode', 'dark');

        // Assert
        expect(colour()).not.toBe(light);
    });

    it('should show a skeleton for the value and set aria-busy on the host while loading', () => {
        // Arrange
        const mounted = mountComponent('stat', { value: 42, loading: true });

        // Assert
        expect(part(mounted.element, '.value-skeleton')).not.toBeNull();
        expect(part(mounted.element, '.value')).toBeNull();
        expect(mounted.element.getAttribute('aria-busy')).toBe('true');
    });

    it('should show the value and drop aria-busy when loading is off or turned off', () => {
        // Arrange
        const off = mountComponent('stat', { value: 42 });
        const mounted = mountComponent('stat', { value: 42, loading: true });

        // Act
        mounted.store.set('$.app.loading', false);

        // Assert
        expect(off.element.hasAttribute('aria-busy')).toBe(false);
        expect(part(off.element, '.value-skeleton')).toBeNull();
        expect(shown(off.element)).toBe('42');
        expect(mounted.element.hasAttribute('aria-busy')).toBe(false);
        expect(part(mounted.element, '.value-skeleton')).toBeNull();
        expect(shown(mounted.element)).toBe('42');
    });
});

describe('avatar in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should show two initials for two words and name the image role', () => {
        // Act
        const mounted = mountComponent('avatar', { _name: 'Ada Lovelace' });
        const box = part(mounted.element, '.avatar');

        // Assert
        expect(initials(mounted.element)).toBe('AL');
        expect(box?.getAttribute('role')).toBe('img');
        expect(box?.getAttribute('aria-label')).toBe('Ada Lovelace');
    });

    it('should show one initial for one word', () => {
        // Act
        const mounted = mountComponent('avatar', { _name: 'plato' });

        // Assert
        expect(initials(mounted.element)).toBe('P');
    });

    it('should use the first and last word for three words', () => {
        // Act
        const mounted = mountComponent('avatar', { _name: 'Mary Jane  Watson' });

        // Assert
        expect(initials(mounted.element)).toBe('MW');
    });

    it('should follow a name linked to $.data', () => {
        // Arrange
        const mounted = mountComponent('avatar', { '<-_name': '$.data.owner' }, { data: { owner: 'Grace Hopper' } });
        expect(initials(mounted.element)).toBe('GH');

        // Act
        mounted.store.set('$.data.owner', 'Alan Turing');

        // Assert
        expect(initials(mounted.element)).toBe('AT');
        expect(part(mounted.element, '.avatar')?.getAttribute('aria-label')).toBe('Alan Turing');
    });

    it('should show the image instead of the initials when src is set', () => {
        // Arrange
        const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
        const mounted = mountComponent('avatar', { _name: 'Ada Lovelace' });

        // Act
        mounted.store.set('$.app.src', src);

        // Assert
        expect(part(mounted.element, 'img')?.getAttribute('src')).toBe(src);
        expect(part(mounted.element, '.initials')).toBeNull();
    });

    it('should reject an http src', () => {
        // Assert
        expect(() => mountComponent('avatar', { src: 'http://example.com/a.png' })).toThrow(/src/);
    });

    it('should reflect the shape and size the square avatar', () => {
        // Arrange
        const round = mountComponent('avatar', { _name: 'A B' });
        const square = mountComponent('avatar', { _name: 'A B', shape: 'square', size: 'lg' });
        const radius = (element: Element): string => getComputedStyle(part(element, '.avatar') as Element).borderTopLeftRadius;
        const width = (element: Element): number => (part(element, '.avatar') as Element).getBoundingClientRect().width;

        // Assert
        expect(radius(square.element)).not.toBe(radius(round.element));
        expect(width(square.element)).toBeGreaterThan(width(round.element));
    });

    it('should translate the default name and change colours with the dark overlay', () => {
        // Arrange
        const mounted = mountComponent('avatar', {}, { locale: 'de' });
        const colour = (): string => getComputedStyle(part(mounted.element, '.avatar') as Element).backgroundColor;
        const light = colour();

        // Act
        mounted.setTheme('mode', 'dark');

        // Assert
        expect(part(mounted.element, '.avatar')?.getAttribute('aria-label')).toBe('Beispielname');
        expect(initials(mounted.element)).toBe('B');
        expect(colour()).not.toBe(light);
    });
});
