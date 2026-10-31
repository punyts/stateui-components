import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const anchor = (element: Element): HTMLAnchorElement => element.shadowRoot?.querySelector('a') as HTMLAnchorElement;

describe('link in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render the text and href and follow a state write', () => {
        // Arrange
        const mounted = mountComponent('link', { _text: 'Before', href: '#a' });

        // Act
        mounted.store.set('$.app._text', 'After');
        mounted.store.set('$.app.href', 'orders/12');

        // Assert
        expect(anchor(mounted.element).textContent).toBe('After');
        expect(anchor(mounted.element).getAttribute('href')).toBe('orders/12');
    });

    it('should show content linked to $.data and update when the data changes', () => {
        // Arrange
        const mounted = mountComponent('link', { '<-_text': '$.data.label' }, { data: { label: 'One' } });

        // Act
        mounted.store.set('$.data.label', 'Two');

        // Assert
        expect(anchor(mounted.element).textContent).toBe('Two');
    });

    it('should change the tone colour in the dark overlay', () => {
        // Arrange
        const mounted = mountComponent('link', { tone: 'danger' });
        const light = getComputedStyle(anchor(mounted.element)).color;

        // Act
        mounted.setTheme('mode', 'dark');

        // Assert
        expect(getComputedStyle(anchor(mounted.element)).color).not.toBe(light);
    });

    it('should raise press once per click with the href and not navigate', () => {
        // Arrange
        const mounted = mountComponent('link', { href: '#target' });
        const details: unknown[] = [];
        mounted.element.addEventListener('press', (event) => details.push((event as CustomEvent).detail));
        const before = location.href;

        // Act
        anchor(mounted.element).click();

        // Assert
        expect(details).toEqual([{ href: '#target' }]);
        expect(location.href).toBe(before);
    });

    it('should raise press once when Enter activates the focused link', async () => {
        // Arrange
        const mounted = mountComponent('link');
        let count = 0;
        mounted.element.addEventListener('press', () => count++);
        anchor(mounted.element).focus();

        // Act
        await userEvent.keyboard('{Enter}');

        // Assert
        expect(count).toBe(1);
    });

    it('should run the on entry of the node, writing the target', () => {
        // Arrange
        const mounted = mountComponent('link', { on: { press: { command: 'set', target: '$.data.clicked', value: true } } });

        // Act
        anchor(mounted.element).click();

        // Assert
        expect(mounted.store.get('$.data.clicked')).toBe(true);
    });

    it.each(['http://example.com', 'https://example.com/a', 'javascript:alert(1)', '//example.com', 'mailto:a@b.c', 'data:image/png;base64,AAAA'])(
        'should reject the href %s as SUI-STATE',
        (href) => {
            // Arrange and Act
            const mount = (): unknown => mountComponent('link', { href });

            // Assert
            expect(mount).toThrow(/SUI-STATE/);
        }
    );

    it.each(['#', '#section', 'orders/12', '/orders', './x?y=1'])('should accept the href %s', (href) => {
        // Arrange and Act
        const mounted = mountComponent('link', { href });

        // Assert
        expect(anchor(mounted.element).getAttribute('href')).toBe(href);
    });

    it('should show the German text after the locale switches', () => {
        // Arrange
        const mounted = mountComponent('link');

        // Act
        mounted.setLocale('de');

        // Assert
        expect(anchor(mounted.element).textContent).toBe('Linktext');
    });
});
