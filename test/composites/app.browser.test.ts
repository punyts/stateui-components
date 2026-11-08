import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;
const text = (value: string): Record<string, unknown> => ({ component: 'text', _text: value });

/** The text a person sees in `from`: its shadow root's text and its light children's, skipping `hidden` elements */
function visibleText(from: Node): string {
    if (from instanceof HTMLElement && from.hidden) return '';
    if (from.nodeType === Node.TEXT_NODE) return from.textContent ?? '';
    const shadow = from instanceof Element && from.shadowRoot ? visibleText(from.shadowRoot) : '';
    return shadow + Array.from(from.childNodes).map(visibleText).join('');
}

/** Two screens, each a panel that places its own header */
const SCREENS = Object.freeze({
    home: { title: 'Home', root: { component: 'panel', children: { header: text('Shop'), welcome: text('Welcome home') } } },
    cart: { title: 'Cart', root: { component: 'panel', children: { header: text('Shop'), lines: text('Your cart') } } }
});

const screens = (): Record<string, Record<string, unknown>> => JSON.parse(JSON.stringify(SCREENS)) as Record<string, Record<string, unknown>>;
const layoutHost = (app: Element): HTMLElement => root(app).querySelector('[layout-host]') as HTMLElement;
const screenNode = (app: Element, name: string): HTMLElement => layoutHost(app).querySelector(`[data-sui-screen="${name}"]`) as HTMLElement;

describe('app in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
        document.title = '';
    });

    it('should place the start screen in its layout host and show only that screen', () => {
        // Arrange and Act
        const mounted = mountComponent('app', {}, { screens: screens(), start: 'home' });

        // Assert
        expect(screenNode(mounted.element, 'home')).not.toBeNull();
        expect(visibleText(mounted.element)).toContain('Welcome home');
        expect(visibleText(mounted.element)).toContain('Shop');
        expect(visibleText(mounted.element)).not.toContain('Your cart');
    });

    it('should show the other screen after navigating, keep the first hidden and move focus to the new screen', () => {
        // Arrange
        const mounted = mountComponent('app', {}, { screens: screens(), start: 'home' });
        const focusedAtStart = root(mounted.element).activeElement;

        // Act
        const moved = mounted.navigate('cart');

        // Assert
        expect(moved).toBeUndefined();
        expect(focusedAtStart).toBeNull();
        expect(screenNode(mounted.element, 'home').hidden).toBe(true);
        expect(visibleText(mounted.element)).toContain('Your cart');
        expect(visibleText(mounted.element)).not.toContain('Welcome home');
        expect(root(mounted.element).activeElement).toBe(screenNode(mounted.element, 'cart').firstElementChild);
    });

    it('should not move focus when only the params change', () => {
        // Arrange
        const mounted = mountComponent('app', {}, {
            screens: { ...screens(), item: { root: text('An item'), params: { id: { type: 'string', default: 'a' } } } },
            start: 'item'
        });

        // Act
        mounted.navigate('item', { id: 'b' });

        // Assert
        expect(mounted.store.get('$.route.params.id' as never)).toBe('b');
        expect(root(mounted.element).activeElement).toBeNull();
    });

    it('should set the document title from its title and put the old one back on dispose', () => {
        // Arrange
        document.title = 'Before';
        const mounted = mountComponent('app', { _title: 'Shop' }, { screens: screens(), start: 'home' });
        const shown = document.title;

        // Act
        mounted.store.set('$.app._title' as never, 'Store' as never);
        const changed = document.title;
        mounted.dispose();

        // Assert
        expect(shown).toBe('Shop');
        expect(changed).toBe('Store');
        expect(document.title).toBe('Before');
    });

    it('should lay out the screens with its own layout', () => {
        // Arrange and Act
        const mounted = mountComponent('app', { layout: { type: 'row' } }, { screens: screens(), start: 'home' });

        // Assert
        expect(getComputedStyle(layoutHost(mounted.element)).display).toBe('flex');
    });
});
