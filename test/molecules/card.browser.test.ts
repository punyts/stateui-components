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

    it('should replace the title and body with skeletons and set aria-busy while loading', () => {
        // Arrange
        const mounted = mountComponent('card', { _title: 'Plan', _subtitle: 'Monthly', loading: true, children: { a: text('Body text') } });

        // Assert
        expect(part(mounted.element, '.title-skeleton')).not.toBeNull();
        expect(part(mounted.element, '.title')).toBeNull();
        expect(part(mounted.element, '.subtitle')).toBeNull();
        expect(part(mounted.element, '.body-skeleton ui-skeleton')).not.toBeNull();
        expect(getComputedStyle(part(mounted.element, '.body') as HTMLElement).display).toBe('none');
        expect(mounted.element.getAttribute('aria-busy')).toBe('true');
    });

    it('should show the title and body and drop aria-busy when loading is off or turned off', () => {
        // Arrange
        const off = mountComponent('card', { _title: 'Plan', children: { a: text('Body text') } });
        const mounted = mountComponent('card', { _title: 'Plan', loading: true, children: { a: text('Body text') } });

        // Act
        mounted.store.set('$.app.loading', false);

        // Assert
        expect(off.element.hasAttribute('aria-busy')).toBe(false);
        expect(part(off.element, '.title-skeleton')).toBeNull();
        expect(part(off.element, '.title')?.textContent?.trim()).toBe('Plan');
        expect(part(off.element, '.body-skeleton')).toBeNull();
        expect(mounted.element.hasAttribute('aria-busy')).toBe(false);
        expect(part(mounted.element, '.title')?.textContent?.trim()).toBe('Plan');
        expect(part(mounted.element, '.body-skeleton')).toBeNull();
        expect(getComputedStyle(part(mounted.element, '.body') as HTMLElement).display).not.toBe('none');
    });

    it('should keep the actions and the interactive press while loading', () => {
        // Arrange
        const mounted = mountComponent('card', { interactive: true, loading: true, actions: { component: 'button', _title: 'Edit' } });
        const seen = presses(mounted.element);

        // Act
        surface(mounted.element).click();

        // Assert
        expect(part(mounted.element, '.actions ui-button')).not.toBeNull();
        expect(seen.count).toBe(1);
    });

    /** Records the drag events of a card, each as its name and where the pointer was */
    const drags = (element: Element): string[] => {
        const seen: string[] = [];
        for (const name of ['dragStart', 'dragMove', 'dragEnd']) {
            element.addEventListener(name, (event) => {
                const detail = (event as CustomEvent<{ x: number; y: number; cancelled?: boolean }>).detail;
                seen.push(`${name} ${Math.round(detail.x)},${Math.round(detail.y)}${detail.cancelled === true ? ' cancelled' : ''}`);
            });
        }
        return seen;
    };
    const pointer = (element: Element, type: string, x: number, y: number): void => {
        surface(element).dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y }));
    };

    it('should raise dragStart, dragMove and dragEnd with the pointer while draggable, and no press after a drag', () => {
        // Arrange
        const mounted = mountComponent('card', { _title: 'button', interactive: true, draggable: true });
        const seen = drags(mounted.element);
        const pressed = presses(mounted.element);

        // Act
        pointer(mounted.element, 'pointerdown', 10, 10);
        pointer(mounted.element, 'pointermove', 12, 11);
        pointer(mounted.element, 'pointermove', 40, 30);
        pointer(mounted.element, 'pointermove', 90, 60);
        pointer(mounted.element, 'pointerup', 90, 60);
        surface(mounted.element).click();

        // Assert: under the threshold nothing moves; the click that ends a drag is not a press
        expect(seen).toEqual(['dragStart 40,30', 'dragMove 40,30', 'dragMove 90,60', 'dragEnd 90,60']);
        expect(pressed.count).toBe(0);
    });

    it('should press, not drag, when the pointer stays put, and never drag when not draggable', () => {
        // Arrange
        const still = mountComponent('card', { _title: 'still', interactive: true, draggable: true });
        const plain = mountComponent('card', { _title: 'plain', interactive: true });
        const stillSeen = drags(still.element);
        const plainSeen = drags(plain.element);
        const pressed = presses(still.element);

        // Act
        pointer(still.element, 'pointerdown', 10, 10);
        pointer(still.element, 'pointermove', 12, 12);
        pointer(still.element, 'pointerup', 12, 12);
        surface(still.element).click();
        pointer(plain.element, 'pointerdown', 10, 10);
        pointer(plain.element, 'pointermove', 90, 90);
        pointer(plain.element, 'pointerup', 90, 90);

        // Assert
        expect(stillSeen).toEqual([]);
        expect(pressed.count).toBe(1);
        expect(plainSeen).toEqual([]);
    });

    it('should end a drag as cancelled on Escape or when the browser cancels the pointer', () => {
        // Arrange
        const escaped = mountComponent('card', { _title: 'escaped', draggable: true });
        const lost = mountComponent('card', { _title: 'lost', draggable: true });
        const escapedSeen = drags(escaped.element);
        const lostSeen = drags(lost.element);

        // Act
        pointer(escaped.element, 'pointerdown', 0, 0);
        pointer(escaped.element, 'pointermove', 30, 0);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        pointer(escaped.element, 'pointerup', 50, 0);
        pointer(lost.element, 'pointerdown', 0, 0);
        pointer(lost.element, 'pointermove', 0, 30);
        pointer(lost.element, 'pointercancel', 0, 40);

        // Assert
        expect(escapedSeen).toEqual(['dragStart 30,0', 'dragMove 30,0', 'dragEnd 30,0 cancelled']);
        expect(lostSeen).toEqual(['dragStart 0,30', 'dragMove 0,30', 'dragEnd 0,40 cancelled']);
    });
});
