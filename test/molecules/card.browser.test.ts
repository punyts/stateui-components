import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;
const part = (element: Element, selector: string): HTMLElement | null => root(element).querySelector(selector);
const surface = (element: Element): HTMLElement => part(element, '.surface') as HTMLElement;
const height = (element: Element, selector: string): number => part(element, selector)?.getBoundingClientRect().height ?? 0;
const bodyInset = (mounted: MountedComponent): string => getComputedStyle(part(mounted.element, '.body') as HTMLElement).paddingLeft;

const tokenColour = (mounted: MountedComponent, token: string): string => {
    const probe = root(mounted.element).appendChild(document.createElement('span'));
    probe.style.color = `var(${token})`;
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
};

const presses = (element: Element): { count: number } => {
    const seen = { count: 0 };
    element.addEventListener('press', () => {
        seen.count += 1;
    });
    return seen;
};

const text = (value: string): Record<string, unknown> => ({ component: 'text', _text: value });

describe('card in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render each slot, the title and the body when all are present', () => {
        // Arrange
        const mounted = mountComponent('card', {
            _title: 'Plan',
            _subtitle: 'Monthly',
            media: { component: 'image', src: PIXEL, _alt: 'Cover' },
            actions: { component: 'button', _title: 'Edit' },
            footer: text('Footer text'),
            children: { a: text('Body text') }
        });

        // Assert
        expect(part(mounted.element, '.media ui-image')).not.toBeNull();
        expect(part(mounted.element, '.title')?.textContent?.trim()).toBe('Plan');
        expect(part(mounted.element, '.subtitle')?.textContent?.trim()).toBe('Monthly');
        expect(part(mounted.element, '.actions ui-button')).not.toBeNull();
        expect(part(mounted.element, '.body ui-text')).not.toBeNull();
        expect(part(mounted.element, '.footer ui-text')).not.toBeNull();
    });

    it('should render nothing for a slot with no node', () => {
        // Arrange
        const mounted = mountComponent('card', { children: { a: text('Only body') } });

        // Assert
        expect(part(mounted.element, '.media')).toBeNull();
        expect(part(mounted.element, '.header')).toBeNull();
        expect(part(mounted.element, '.footer')).toBeNull();
        expect(part(mounted.element, '.body ui-text')).not.toBeNull();
    });

    it('should take no space for an empty body and show a slot once it is written', () => {
        // Arrange
        const mounted = mountComponent('card', {});
        const empty = height(mounted.element, '.surface');
        expect(getComputedStyle(part(mounted.element, '.body') as HTMLElement).display).toBe('none');

        // Act
        mounted.store.set('$.app.footer', text('Late'));
        mounted.store.set('$.app._title', 'Now');

        // Assert
        expect(part(mounted.element, '.footer ui-text')).not.toBeNull();
        expect(part(mounted.element, '.title')?.textContent?.trim()).toBe('Now');
        expect(height(mounted.element, '.surface')).toBeGreaterThan(empty);
    });

    it('should lay the body children out in a grid', () => {
        // Arrange
        const mounted = mountComponent('card', {
            layout: { type: 'grid', cols: 2 },
            children: { a: text('A'), b: text('B'), c: text('C') }
        });
        const [a, b, c] = Array.from(root(mounted.element).querySelectorAll('.body ui-text')).map((item) => item.getBoundingClientRect());

        // Assert
        expect(getComputedStyle(part(mounted.element, '.body') as HTMLElement).display).toBe('grid');
        expect(a?.top).toBe(b?.top);
        expect(c?.top).toBeGreaterThan(a?.top ?? 0);
        expect(c?.left).toBe(a?.left);
    });

    it('should remove the section padding with padding none and scale it with sm and lg', () => {
        // Arrange
        const body = { children: { a: text('A') } };
        const none = mountComponent('card', { ...body, padding: 'none' });
        const sm = mountComponent('card', { ...body, padding: 'sm' });
        const md = mountComponent('card', body);
        const lg = mountComponent('card', { ...body, padding: 'lg' });

        // Assert
        expect(parseFloat(bodyInset(none))).toBe(0);
        expect(parseFloat(bodyInset(sm))).toBeGreaterThan(0);
        expect(parseFloat(bodyInset(sm))).toBeLessThan(parseFloat(bodyInset(md)));
        expect(parseFloat(bodyInset(lg))).toBeGreaterThan(parseFloat(bodyInset(md)));
    });

    it('should change the padding when the padding token is written', () => {
        // Arrange
        const mounted = mountComponent('card', { children: { a: text('A') } });
        expect(bodyInset(mounted)).not.toBe('40px');

        // Act
        mounted.store.set('$.theme.tokens.card.padding', '40px');

        // Assert
        expect(bodyInset(mounted)).toBe('40px');
    });

    it('should style selected from the accent tokens', () => {
        // Arrange
        const plain = mountComponent('card', {});
        const selected = mountComponent('card', { selected: true });

        // Assert
        expect(getComputedStyle(surface(plain.element)).borderTopColor).toBe(tokenColour(plain, '--ui-color-border-base'));
        expect(getComputedStyle(surface(selected.element)).borderTopColor).toBe(tokenColour(selected, '--ui-color-accent-base'));
        expect(getComputedStyle(surface(selected.element)).backgroundColor).toBe(tokenColour(selected, '--ui-color-accent-soft'));
    });

    it('should default to a raised elevation and follow elevation flat', () => {
        // Arrange
        const raised = mountComponent('card', {});
        const flat = mountComponent('card', { elevation: 'flat' });

        // Assert
        expect(raised.element.getAttribute('elevation')).toBe('raised');
        expect(getComputedStyle(surface(raised.element)).boxShadow).not.toBe('none');
        expect(getComputedStyle(surface(flat.element)).boxShadow).toBe('none');
    });

    it('should not be focusable and never raise press without interactive', async () => {
        // Arrange
        const mounted = mountComponent('card', { _title: 'Plain' });
        const seen = presses(mounted.element);

        // Act
        await userEvent.click(surface(mounted.element));
        surface(mounted.element).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        // Assert
        expect(surface(mounted.element).hasAttribute('tabindex')).toBe(false);
        expect(surface(mounted.element).hasAttribute('role')).toBe(false);
        expect(seen.count).toBe(0);
    });

    it('should raise press on click, Enter and Space when interactive', async () => {
        // Arrange
        const mounted = mountComponent('card', { interactive: true, _title: 'Open' });
        const seen = presses(mounted.element);

        // Act
        await userEvent.click(surface(mounted.element));
        await userEvent.keyboard('{Enter}');
        await userEvent.keyboard(' ');

        // Assert
        expect(surface(mounted.element).getAttribute('role')).toBe('button');
        expect(root(mounted.element).activeElement).toBe(surface(mounted.element));
        expect(seen.count).toBe(3);
    });

    it('should draw a focus ring when focused with the keyboard', async () => {
        // Arrange
        const mounted = mountComponent('card', { interactive: true });

        // Act
        await userEvent.tab();

        // Assert
        const style = getComputedStyle(surface(mounted.element));
        expect(root(mounted.element).activeElement).toBe(surface(mounted.element));
        expect(style.outlineStyle).toBe('solid');
        expect(parseFloat(style.outlineWidth)).toBeGreaterThan(0);
    });

    it('should not raise press for a click on a button in actions', async () => {
        // Arrange
        const mounted = mountComponent('card', {
            interactive: true,
            _title: 'Row',
            actions: { component: 'button', _title: 'Edit' }
        });
        const seen = presses(mounted.element);
        const inner = part(mounted.element, '.actions ui-button') as HTMLElement;

        // Act
        await userEvent.click((inner.shadowRoot as ShadowRoot).querySelector('button') as HTMLElement);

        // Assert
        expect(seen.count).toBe(0);
    });

    it('should show the German title and subtitle from the document overlay', () => {
        // Arrange
        const mounted = mountComponent(
            'card',
            { _title: 'Settings', _subtitle: 'Account' },
            { locales: { de: { _title: 'Einstellungen', _subtitle: 'Konto' } } }
        );

        // Act
        mounted.setLocale('de');

        // Assert
        expect(part(mounted.element, '.title')?.textContent?.trim()).toBe('Einstellungen');
        expect(part(mounted.element, '.subtitle')?.textContent?.trim()).toBe('Konto');
    });
});
