import { afterEach, describe, expect, it } from 'vitest';
import { register } from '../../.test-build/fixture/register.js';
import { mountFixture } from './fixtureComponent.js';

const textOf = (element: Element): string => element.shadowRoot?.querySelector('p')?.textContent ?? '';

describe('mountComponent in Chromium', () => {
    afterEach(() => {
        mountFixture.unmountAll();
    });

    it('should mount one component through mountApp and return its element and store', () => {
        // Arrange
        const nodeState = { _text: 'Hi there' };

        // Act
        const mounted = mountFixture('probe', nodeState);

        // Assert
        expect(mounted.element.localName).toBe('ui-probe');
        expect(textOf(mounted.element)).toBe('Hi there');
        expect(mounted.store.get('$.app.component')).toBe('probe');
    });

    it('should update the rendered text when the state is written', () => {
        // Arrange
        const mounted = mountFixture('probe', { _text: 'Before' });

        // Act
        mounted.store.set('$.app._text', 'After');

        // Assert
        expect(textOf(mounted.element)).toBe('After');
    });

    it('should reject a node the shape does not allow', () => {
        // Act
        const mount = () => mountFixture('probe', { unknownProperty: 1 });

        // Assert
        expect(mount).toThrow(/SUI-STATE/);
    });

    it('should reject a component the library does not have', () => {
        // Act
        const mount = () => mountFixture('missing');

        // Assert
        expect(mount).toThrow('"missing" is not a root component');
    });

    it('should start in the chosen mode and change colours through tokens with setTheme', () => {
        // Arrange
        const mounted = mountFixture('probe', {}, { mode: 'light' });
        const paragraph = mounted.element.shadowRoot?.querySelector('p') as HTMLElement;
        const light = getComputedStyle(paragraph).color;

        // Act
        mounted.setTheme('mode', 'dark');
        const dark = getComputedStyle(paragraph).color;

        // Assert
        expect(mounted.store.get('$.theme.active.mode')).toBe('dark');
        expect(dark).not.toBe(light);
    });

    it('should mount with the dark mode and the reduced motion overlays when the options name them', () => {
        // Act
        const mounted = mountFixture('probe', {}, { mode: 'dark', brand: 'default', motion: 'reduced' });

        // Assert
        expect(mounted.store.get('$.theme.active.mode')).toBe('dark');
        expect(mounted.store.get('$.theme.active.motion')).toBe('reduced');
    });

    it('should show the German text after setLocale and the English text after switching back', () => {
        // Arrange
        const mounted = mountFixture('probe');

        // Act
        mounted.setLocale('de');
        const german = textOf(mounted.element);
        mounted.setLocale('en');

        // Assert
        expect(german).toBe('Hallo');
        expect(textOf(mounted.element)).toBe('Hello');
    });

    it('should start in German when the locale option is given', () => {
        // Act
        const mounted = mountFixture('probe', {}, { locale: 'de' });

        // Assert
        expect(textOf(mounted.element)).toBe('Hallo');
    });

    it('should throw for a language the library has no overlay for', () => {
        // Arrange
        const mounted = mountFixture('probe');

        // Act
        const change = () => mounted.setLocale('fr');

        // Assert
        expect(change).toThrow('SUI-LOCALE');
    });

    it('should remove the host on dispose and be safe to dispose twice', () => {
        // Arrange
        const mounted = mountFixture('probe');

        // Act
        mounted.dispose();
        mounted.dispose();

        // Assert
        expect(mounted.host.isConnected).toBe(false);
    });
});

describe('register(window)', () => {
    it('should define every component on the page once and be safe to call twice', () => {
        // Act
        const first = register(window);
        const second = register(window);

        // Assert
        expect(customElements.get('ui-probe')).toBe(first[0]);
        expect(second[0]).toBe(first[0]);
    });
});
