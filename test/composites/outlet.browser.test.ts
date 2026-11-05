import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;
const text = (value: string): Record<string, unknown> => ({ component: 'text', _text: value });

/** The first element with `tag` below `from`, crossing shadow roots */
function find(from: ParentNode, tag: string): Element | undefined {
    for (const candidate of Array.from(from.querySelectorAll('*'))) {
        if (candidate.localName === tag) return candidate;
        const inner = candidate.shadowRoot ? find(candidate.shadowRoot, tag) : undefined;
        if (inner) return inner;
    }
    return undefined;
}

/** The text a person sees in `from`: its shadow root's text and its light children's, skipping `hidden` elements */
function visibleText(from: Node): string {
    if (from instanceof HTMLElement && from.hidden) return '';
    if (from.nodeType === Node.TEXT_NODE) return from.textContent ?? '';
    const shadow = from instanceof Element && from.shadowRoot ? visibleText(from.shadowRoot) : '';
    return shadow + Array.from(from.childNodes).map(visibleText).join('');
}

/** A shell page with a header and an outlet, and two screens */
const SHELL = Object.freeze({ header: text('Shop'), children: { main: { component: 'outlet' } } });
const SCREENS = Object.freeze({
    home: { title: 'Home', root: { component: 'panel', children: { welcome: text('Welcome home') } } },
    cart: { title: 'Cart', root: { component: 'panel', children: { lines: text('Your cart') } } }
});

describe('outlet in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
        document.title = '';
    });

    const mountShell = () => mountComponent('page', SHELL, { screens: JSON.parse(JSON.stringify(SCREENS)), start: 'home' });

    it('should show the start screen inside the outlet below the shell header', () => {
        // Arrange
        const mounted = mountShell();

        // Act
        const outlet = find(mounted.host, 'ui-outlet') as Element;

        // Assert
        expect(outlet.querySelector('[data-sui-screen="home"]')).not.toBeNull();
        expect(visibleText(outlet)).toContain('Welcome home');
        expect(visibleText(outlet)).not.toContain('Your cart');
        expect(root(outlet).querySelector('section')?.getAttribute('aria-label')).toBe('Current screen');
        expect(visibleText(mounted.element)).toContain('Shop');
    });

    it('should show the other screen after navigating, keep the first hidden and move focus to the outlet', () => {
        // Arrange
        const mounted = mountShell();
        const outlet = find(mounted.host, 'ui-outlet') as Element;
        const section = root(outlet).querySelector('section') as HTMLElement;
        const focusedAtStart = root(outlet).activeElement;

        // Act
        const moved = mounted.navigate('cart');

        // Assert
        expect(moved).toBeUndefined();
        expect(focusedAtStart).toBeNull();
        expect((outlet.querySelector('[data-sui-screen="home"]') as HTMLElement).hidden).toBe(true);
        expect(visibleText(outlet)).toContain('Your cart');
        expect(visibleText(outlet)).not.toContain('Welcome home');
        expect(root(outlet).activeElement).toBe(section);
    });

    it('should not move focus when only the params change', () => {
        // Arrange
        const mounted = mountComponent('page', SHELL, {
            screens: { ...JSON.parse(JSON.stringify(SCREENS)), item: { root: text('An item'), params: { id: { type: 'string', default: 'a' } } } },
            start: 'item'
        });
        const outlet = find(mounted.host, 'ui-outlet') as Element;

        // Act
        mounted.navigate('item', { id: 'b' });

        // Assert
        expect(mounted.store.get('$.route.params.id' as never)).toBe('b');
        expect(root(outlet).activeElement).toBeNull();
    });

    it('should show the German landmark name', () => {
        // Arrange
        const mounted = mountShell();

        // Act
        mounted.setLocale('de');

        // Assert
        const outlet = find(mounted.host, 'ui-outlet') as Element;
        expect(root(outlet).querySelector('section')?.getAttribute('aria-label')).toBe('Aktuelle Ansicht');
    });
});
