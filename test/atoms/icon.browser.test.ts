import { afterEach, describe, expect, it, vi } from 'vitest';
import { report } from '@punyts/core';
import { CORE_ICONS } from '../../.test-build/real/icons/core.js';
import { mountComponent } from '../harness/mountComponent.js';

const svg = (element: Element): SVGSVGElement | null => element.shadowRoot?.querySelector('svg') ?? null;
const pathData = (element: Element): string[] =>
    Array.from(element.shadowRoot?.querySelectorAll('path') ?? []).map((path) => path.getAttribute('d') ?? '');
const glyph = (element: Element): HTMLElement => element.shadowRoot?.querySelector('.glyph') as HTMLElement;
const dataOf = (name: string): string[] =>
    (CORE_ICONS[name]?.outline ?? []).map((path) => (typeof path === 'string' ? path : path.d));
const strokeWidth = (element: Element): string =>
    getComputedStyle(svg(element)?.querySelector('path') as Element).strokeWidth;

describe('icon in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
        vi.restoreAllMocks();
    });

    it('should draw the core icon and follow a write of name', () => {
        // Arrange
        const mounted = mountComponent('icon', { name: 'search' });
        expect(pathData(mounted.element)).toEqual(dataOf('search'));

        // Act
        mounted.store.set('$.app.name', 'plus');

        // Assert
        expect(pathData(mounted.element)).toEqual(dataOf('plus'));
        expect(svg(mounted.element)?.namespaceURI).toBe('http://www.w3.org/2000/svg');
    });

    it('should draw nothing for an empty name', () => {
        // Act
        const mounted = mountComponent('icon', {});

        // Assert
        expect(svg(mounted.element)).toBeNull();
    });

    it('should follow a link to $.data', () => {
        // Arrange
        const mounted = mountComponent('icon', { '<-name': '$.data.glyph' }, { data: { glyph: 'check' } });

        // Act
        mounted.store.set('$.data.glyph', 'minus');

        // Assert
        expect(pathData(mounted.element)).toEqual(dataOf('minus'));
    });

    it('should draw an alias with the same paths as its target', () => {
        // Arrange
        const alias = mountComponent('icon', { name: 'close' });
        const target = mountComponent('icon', { name: 'x' });

        // Assert
        expect(pathData(alias.element)).toEqual(pathData(target.element));
        expect(pathData(alias.element).length).toBeGreaterThan(0);
    });

    it('should stroke outline icons and fill filled icons', () => {
        // Arrange
        const outline = mountComponent('icon', { name: 'circle-check' });
        const filled = mountComponent('icon', { name: 'circle-check', filled: true });

        // Assert
        const stroked = svg(outline.element) as SVGSVGElement;
        expect(stroked.getAttribute('stroke')).toBe('currentColor');
        expect(stroked.getAttribute('fill')).toBe('none');
        const solid = svg(filled.element) as SVGSVGElement;
        expect(solid.getAttribute('fill')).toBe('currentColor');
        expect(solid.hasAttribute('stroke')).toBe(false);
        expect(pathData(filled.element)).not.toEqual(pathData(outline.element));
    });

    it('should draw the outline when the name has no filled variant', () => {
        // Arrange
        const mounted = mountComponent('icon', { name: 'minus', filled: true });

        // Assert
        expect(svg(mounted.element)?.getAttribute('class')).toBe('outline');
        expect(pathData(mounted.element)).toEqual(dataOf('minus'));
    });

    it('should apply the own fill, stroke and opacity of a styled path', () => {
        // Arrange
        const mounted = mountComponent('icon', { name: 'styled' });

        // Act
        mounted.store.set('$.runtime.icons', {
            styled: { outline: ['M1 1h2', { d: 'M5 5h2', fill: true, stroke: false, opacity: 0.3 }] }
        });
        const paths = Array.from(mounted.element.shadowRoot?.querySelectorAll('path') ?? []);

        // Assert
        expect(paths.map((path) => path.getAttribute('d'))).toEqual(['M1 1h2', 'M5 5h2']);
        expect(paths[0]?.attributes.length).toBe(1);
        expect(paths[1]?.getAttribute('fill')).toBe('currentColor');
        expect(paths[1]?.getAttribute('stroke')).toBe('none');
        expect(paths[1]?.getAttribute('opacity')).toBe('0.3');
    });

    it('should draw an icon from $.runtime.icons and prefer it over the core set', () => {
        // Arrange
        vi.spyOn(report, 'error').mockImplementation(() => undefined);
        const mounted = mountComponent('icon', { name: 'star' });
        expect(svg(mounted.element)).toBeNull();

        // Act
        mounted.store.set('$.runtime.icons', { star: { outline: ['M12 2l3 7h7z'] } });
        const drawn = pathData(mounted.element);
        mounted.store.set('$.runtime.icons.x', { outline: ['M0 0h24'] });
        mounted.store.set('$.app.name', 'x');

        // Assert
        expect(drawn).toEqual(['M12 2l3 7h7z']);
        expect(pathData(mounted.element)).toEqual(['M0 0h24']);
    });

    it('should draw nothing and report SUI-RUN-ICON once for an unknown name', () => {
        // Arrange
        const errors = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        const mounted = mountComponent('icon', { name: 'no-such-icon' });

        // Act
        mounted.store.set('$.app.filled', true);
        mounted.store.set('$.app.filled', false);

        // Assert
        expect(svg(mounted.element)).toBeNull();
        const own = errors.mock.calls.filter(([, details]) => (details as { code?: string } | undefined)?.code === 'SUI-RUN-ICON');
        expect(own).toHaveLength(1);
        expect(String(own[0]?.[0])).toContain('no-such-icon');
    });

    it('should ignore malformed runtime icon data', () => {
        // Arrange
        vi.spyOn(report, 'error').mockImplementation(() => undefined);
        const mounted = mountComponent('icon', { name: 'bad' });

        // Act
        mounted.store.set('$.runtime.icons', { bad: { outline: [42] } });

        // Assert
        expect(svg(mounted.element)).toBeNull();
    });

    it('should hide a decorative icon from assistive technology', () => {
        // Act
        const mounted = mountComponent('icon', { name: 'x' });

        // Assert
        expect(glyph(mounted.element).getAttribute('aria-hidden')).toBe('true');
        expect(glyph(mounted.element).hasAttribute('role')).toBe(false);
        expect(glyph(mounted.element).hasAttribute('aria-label')).toBe(false);
    });

    it('should name a non-decorative icon by its _label', () => {
        // Act
        const mounted = mountComponent('icon', { name: 'x', decorative: false, _label: 'Close' });

        // Assert
        expect(glyph(mounted.element).getAttribute('role')).toBe('img');
        expect(glyph(mounted.element).getAttribute('aria-label')).toBe('Close');
        expect(glyph(mounted.element).hasAttribute('aria-hidden')).toBe(false);
    });

    it('should colour the icon through the shared sheet for a tone', () => {
        // Arrange
        const plain = mountComponent('icon', { name: 'x' });
        const danger = mountComponent('icon', { name: 'x', tone: 'danger' });
        const probe = document.createElement('span');
        probe.style.color = 'var(--ui-color-danger-base)';
        danger.element.shadowRoot?.appendChild(probe);

        // Assert
        expect(getComputedStyle(glyph(danger.element)).color).toBe(getComputedStyle(probe).color);
        expect(getComputedStyle(glyph(danger.element)).color).not.toBe(getComputedStyle(glyph(plain.element)).color);
    });

    it('should change every outline icon when $.theme.tokens.icon.stroke is written', () => {
        // Arrange
        const first = mountComponent('icon', { name: 'x' });
        expect(strokeWidth(first.element)).toBe('2px');

        // Act
        first.store.set('$.theme.tokens.icon.stroke', '4');

        // Assert
        expect(strokeWidth(first.element)).toBe('4px');
    });

    it('should not stroke a filled icon', () => {
        // Arrange
        const mounted = mountComponent('icon', { name: 'circle-check', filled: true });

        // Act
        mounted.store.set('$.theme.tokens.icon.stroke', '4');

        // Assert
        expect(getComputedStyle(svg(mounted.element)?.querySelector('path') as Element).stroke).toBe('none');
    });

    it('should take its size from the shared size', () => {
        // Arrange
        const small = mountComponent('icon', { name: 'x', size: 'sm' });
        const large = mountComponent('icon', { name: 'x', size: 'lg' });

        // Assert
        expect(glyph(large.element).getBoundingClientRect().width).toBeGreaterThan(glyph(small.element).getBoundingClientRect().width);
    });

    it('should change colour in the dark overlay when it has a tone', () => {
        // Arrange
        const mounted = mountComponent('icon', { name: 'x', tone: 'accent' });
        const light = getComputedStyle(glyph(mounted.element)).color;

        // Act
        mounted.setTheme('mode', 'dark');

        // Assert
        expect(getComputedStyle(glyph(mounted.element)).color).not.toBe(light);
    });

    it('should make no network request and load no sprite or font', () => {
        // Arrange
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const before = performance.getEntriesByType('resource').length;

        // Act
        const mounted = mountComponent('icon', { name: 'calendar' });
        mounted.store.set('$.app.name', 'upload');

        // Assert
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(performance.getEntriesByType('resource').length).toBe(before);
        expect(mounted.element.shadowRoot?.querySelector('use, image, img')).toBeNull();
    });
});
