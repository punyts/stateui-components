import { afterEach, describe, expect, it } from 'vitest';
import { libraryFromCatalog, mountApp } from '@punyts/stateui-app';
import type { AppDocument } from '@punyts/stateui-app';
import type { Catalog } from '@punyts/stateui-app/build';
import catalog from '../.test-build/real/components/catalog.json';
import { mountComponent } from './harness/mountComponent.js';

const svg = (colour: string): string =>
    `data:image/svg+xml;utf8,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%272%27%20height=%272%27%3E%3Crect%20width=%272%27%20height=%272%27%20fill=%27${colour}%27/%3E%3C/svg%3E`;
const RED = svg('red');
const BLUE = svg('blue');

const imgOf = (element: Element): HTMLImageElement | null => element.shadowRoot?.querySelector('img') ?? null;
const findImage = (root: ParentNode): HTMLImageElement | null => {
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        if (candidate.localName === 'ui-image') return imgOf(candidate);
        const inner = candidate.shadowRoot ? findImage(candidate.shadowRoot) : null;
        if (inner) return inner;
    }
    return null;
};
const ratioOf = (element: Element): string => getComputedStyle(element).aspectRatio.replace(/\s/g, '');

describe('image in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render the picture with its alt text as the accessible name', () => {
        // Act
        const mounted = mountComponent('image', { src: RED, _alt: 'Company logo' });

        // Assert
        const img = imgOf(mounted.element);
        expect(img?.getAttribute('src')).toBe(RED);
        expect(img?.getAttribute('alt')).toBe('Company logo');
    });

    it('should draw an empty alt when the image is decorative', () => {
        // Act
        const mounted = mountComponent('image', { src: RED, _alt: 'Ignored', decorative: true });

        // Assert
        expect(imgOf(mounted.element)?.getAttribute('alt')).toBe('');
    });

    it('should draw an empty alt when decorative is switched on at runtime', () => {
        // Arrange
        const mounted = mountComponent('image', { src: RED, _alt: 'Logo' });

        // Act
        mounted.store.set('$.app.decorative', true);

        // Assert
        expect(imgOf(mounted.element)?.getAttribute('alt')).toBe('');
    });

    it('should update the shown picture and the alt text when state is written', () => {
        // Arrange
        const mounted = mountComponent('image', { src: RED, _alt: 'Before' });

        // Act
        mounted.store.set('$.app.src', BLUE);
        mounted.store.set('$.app._alt', 'After');

        // Assert
        expect(imgOf(mounted.element)?.getAttribute('src')).toBe(BLUE);
        expect(imgOf(mounted.element)?.getAttribute('alt')).toBe('After');
    });

    it('should show a src that arrives from $.data through a link', () => {
        // Arrange
        const host = document.body.appendChild(document.createElement('div'));
        mountComponent('image', { _alt: 'Registers the library' });
        const source = {
            locale: 'en',
            data: { photo: RED },
            app: { component: 'image', '<-src': '$.data.photo', _alt: 'Photo' }
        } as unknown as AppDocument;
        const app = mountApp(host, source, libraryFromCatalog(catalog as unknown as Catalog));
        const image = (): HTMLImageElement | null => findImage(host);
        const before = image()?.getAttribute('src');

        // Act
        app.store?.set('$.data.photo', BLUE);

        // Assert
        expect(before).toBe(RED);
        expect(image()?.getAttribute('src')).toBe(BLUE);
        app.dispose();
        host.remove();
    });

    it('should draw no picture while src is empty', () => {
        // Act
        const mounted = mountComponent('image', { _alt: 'Nothing yet' });

        // Assert
        expect(imgOf(mounted.element)).toBeNull();
    });

    it('should give ratio 4:3 a computed aspect ratio of 4 to 3', () => {
        // Act
        const mounted = mountComponent('image', { src: RED, _alt: 'x', ratio: '4:3' });

        // Assert
        expect(ratioOf(mounted.element)).toBe('4/3');
    });

    it.each([
        ['1:1', '1/1'],
        ['16:9', '16/9'],
        ['auto', 'auto']
    ])('should compute the aspect ratio of ratio %s', (ratio, expected) => {
        // Act
        const mounted = mountComponent('image', { src: RED, _alt: 'x', ratio });

        // Assert
        expect(ratioOf(mounted.element)).toBe(expected);
    });

    it('should change the computed border radius to the matching token for each radius', () => {
        // Arrange
        const mounted = mountComponent('image', { src: RED, _alt: 'x' });
        const tokens: Record<string, string> = { none: '0px', sm: '4px', md: '6px', lg: '12px' };

        for (const [name, expected] of Object.entries(tokens)) {
            // Act
            mounted.store.set('$.app.radius', name);

            // Assert
            expect(getComputedStyle(mounted.element).borderTopLeftRadius).toBe(expected);
        }
        mounted.store.set('$.app.radius', 'full');
        expect(Number.parseFloat(getComputedStyle(mounted.element).borderTopLeftRadius)).toBeGreaterThan(1000);
    });

    it('should follow a write to the radius token', () => {
        // Arrange
        const mounted = mountComponent('image', { src: RED, _alt: 'x', radius: 'md' });
        const before = getComputedStyle(mounted.element).borderTopLeftRadius;

        // Act
        mounted.store.set('$.theme.tokens.radius.md', '20px');

        // Assert
        expect(before).toBe('6px');
        expect(getComputedStyle(mounted.element).borderTopLeftRadius).toBe('20px');
    });

    it('should fit the picture by cover and then by contain', () => {
        // Arrange
        const mounted = mountComponent('image', { src: RED, _alt: 'x' });
        const img = imgOf(mounted.element) as HTMLImageElement;
        const cover = getComputedStyle(img).objectFit;

        // Act
        mounted.store.set('$.app.fit', 'contain');

        // Assert
        expect(cover).toBe('cover');
        expect(getComputedStyle(img).objectFit).toBe('contain');
    });

    it('should change the placeholder colour through tokens in the dark mode', () => {
        // Arrange
        const mounted = mountComponent('image', { _alt: 'x' }, { mode: 'light' });
        const light = getComputedStyle(mounted.element).backgroundColor;

        // Act
        mounted.setTheme('mode', 'dark');

        // Assert
        expect(getComputedStyle(mounted.element).backgroundColor).not.toBe(light);
    });

    it('should mount in German and keep the author alt text', () => {
        // Act
        const mounted = mountComponent('image', { src: RED, _alt: 'Logo' }, { locale: 'de' });

        // Assert
        expect(mounted.store.get('$.locale')).toBe('de');
        expect(imgOf(mounted.element)?.getAttribute('alt')).toBe('Logo');
    });
});
