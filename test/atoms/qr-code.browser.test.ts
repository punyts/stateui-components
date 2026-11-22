import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;

describe('qrCode in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should draw the code of its value inside a quiet zone, named by its label', () => {
        // Arrange and Act
        const mounted = mountComponent('qrCode', { value: 'https://example.com/b/42', _label: 'Booking 42' });
        const svg = root(mounted.element).querySelector('svg');

        // Assert
        expect(svg?.getAttribute('viewBox')).toBe('0 0 33 33');
        expect(root(mounted.element).querySelector('path.dark')?.getAttribute('d')).toMatch(/^M4 4h7v1h-7z/);
        expect(root(mounted.element).querySelector('.code')?.getAttribute('aria-label')).toBe('Booking 42');
        expect(getComputedStyle(root(mounted.element).querySelector('rect.light') as Element).fill).not.toBe(getComputedStyle(root(mounted.element).querySelector('path.dark') as Element).fill);
    });

    it('should grow to a larger version for a higher level and follow a linked value', () => {
        // Arrange
        const mounted = mountComponent('qrCode', { '<-value': '$.data.link', level: 'low' }, { data: { link: 'https://example.com/b/42' } });
        const extent = (): string | null | undefined => root(mounted.element).querySelector('svg')?.getAttribute('viewBox');
        const before = extent();

        // Act
        mounted.store.set('$.app.level', 'high');
        const high = extent();
        mounted.store.set('$.data.link', '');

        // Assert
        expect(before).toBe('0 0 33 33');
        expect(high).toBe('0 0 37 37');
        expect(root(mounted.element).querySelector('svg')).toBeNull();
    });

    it('should draw nothing and mark itself overflowing for a value past version 40', () => {
        // Arrange and Act
        const mounted = mountComponent('qrCode', { value: 'x'.repeat(3000) });

        // Assert
        expect(mounted.element.hasAttribute('overflow')).toBe(true);
        expect(root(mounted.element).querySelector('svg')).toBeNull();
    });
});
