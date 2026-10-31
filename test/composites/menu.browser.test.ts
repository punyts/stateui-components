import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;
const part = (element: Element, selector: string): HTMLElement | null => root(element).querySelector(selector);
const box = (element: Element): DOMRect => element.getBoundingClientRect();
const item = (label: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ component: 'menuItem', _label: label, ...extra });
const itemButton = (menu: Element, key: string): HTMLButtonElement => {
    const node = root(menu).querySelector(`sui-node[state$=".children.${key}"]`) as Element;
    return node.firstElementChild?.shadowRoot?.querySelector('button') as HTMLButtonElement;
};
const triggerButton = (menu: Element): HTMLButtonElement =>
    part(menu, '.trigger ui-button')?.shadowRoot?.querySelector('button') as HTMLButtonElement;
const isOpen = (menu: Element): boolean => (part(menu, '.popup') as HTMLElement).matches(':popover-open');
const activeKey = (menu: Element): string | undefined =>
    ['one', 'two', 'three', 'four'].find((key) => {
        const button = itemButton(menu, key);
        return button !== undefined && (button.getRootNode() as ShadowRoot).activeElement === button;
    });
const command = (element: Element, name: string): void => {
    (element as Element & { commands: Record<string, () => void> }).commands[name]?.();
};
const events = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};

const children = { one: item('One'), two: item('Two'), three: item('Three') };
const trigger = { component: 'button', _title: 'Actions' };
const mountMenu = (extra: Record<string, unknown> = {}, options = {}) =>
    mountComponent('menu', { trigger, children, ...extra }, options);

describe('menu in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should be closed and hidden at first, with the items in the DOM and the trigger marked as a menu button', async () => {
        // Arrange
        const mounted = mountMenu();
        await Promise.resolve();

        // Assert
        expect(isOpen(mounted.element)).toBe(false);
        expect(root(mounted.element).querySelectorAll('.popup > sui-node')).toHaveLength(3);
        expect(triggerButton(mounted.element).getAttribute('aria-haspopup')).toBe('menu');
        expect(triggerButton(mounted.element).getAttribute('aria-expanded')).toBe('false');
        expect(part(mounted.element, '.popup')?.getAttribute('role')).toBe('menu');
        expect(part(mounted.element, '.popup')?.checkVisibility()).toBe(false);
    });

    it('should open on a press of the trigger and close on a second press', async () => {
        // Arrange
        const mounted = mountMenu();

        // Act
        await userEvent.click(triggerButton(mounted.element));
        const opened = isOpen(mounted.element);
        const expanded = triggerButton(mounted.element).getAttribute('aria-expanded');
        await userEvent.click(triggerButton(mounted.element));

        // Assert
        expect(opened).toBe(true);
        expect(expanded).toBe('true');
        expect(isOpen(mounted.element)).toBe(false);
        expect(mounted.store.get('$.app.open')).toBe(false);
    });

    it('should open and close by the commands and by state, raising close once per transition', () => {
        // Arrange
        const mounted = mountMenu();
        const closes = events(mounted.element, 'close');

        // Act
        command(mounted.element, 'open');
        const byCommand = isOpen(mounted.element);
        command(mounted.element, 'close');
        mounted.store.set('$.app.open', true);
        const byState = isOpen(mounted.element);
        mounted.store.set('$.app.open', false);
        command(mounted.element, 'toggle');
        const toggled = isOpen(mounted.element);
        command(mounted.element, 'toggle');

        // Assert
        expect([byCommand, byState, toggled]).toEqual([true, true, true]);
        expect(isOpen(mounted.element)).toBe(false);
        expect(closes).toHaveLength(3);
    });

    it('should render the items with the menuitem role', () => {
        // Arrange
        const mounted = mountMenu();

        // Assert
        for (const key of ['one', 'two', 'three']) expect(itemButton(mounted.element, key).getAttribute('role')).toBe('menuitem');
    });

    it('should place the popup by each anchor next to the trigger', () => {
        // Arrange
        const place = (anchor: string): { popup: DOMRect; trigger: DOMRect } => {
            const mounted = mountMenu({ anchor });
            mounted.host.style.paddingBlock = '200px';
            mounted.host.style.paddingInline = '150px';
            mounted.host.style.inlineSize = '300px';
            command(mounted.element, 'open');
            return { popup: box(part(mounted.element, '.popup') as HTMLElement), trigger: box(part(mounted.element, '.trigger') as HTMLElement) };
        };

        // Act
        const bottomStart = place('bottomStart');
        const bottomEnd = place('bottomEnd');
        const topStart = place('topStart');
        const topEnd = place('topEnd');

        // Assert
        expect(bottomStart.popup.top).toBeGreaterThanOrEqual(bottomStart.trigger.bottom - 1);
        expect(Math.abs(bottomStart.popup.left - bottomStart.trigger.left)).toBeLessThan(2);
        expect(bottomEnd.popup.top).toBeGreaterThanOrEqual(bottomEnd.trigger.bottom - 1);
        expect(Math.abs(bottomEnd.popup.right - bottomEnd.trigger.right)).toBeLessThan(2);
        expect(topStart.popup.bottom).toBeLessThanOrEqual(topStart.trigger.top + 1);
        expect(Math.abs(topStart.popup.left - topStart.trigger.left)).toBeLessThan(2);
        expect(topEnd.popup.bottom).toBeLessThanOrEqual(topEnd.trigger.top + 1);
        expect(Math.abs(topEnd.popup.right - topEnd.trigger.right)).toBeLessThan(2);
    });

    it('should follow an anchor written while open', () => {
        // Arrange
        const mounted = mountMenu();
        mounted.host.style.paddingBlock = '200px';
        command(mounted.element, 'open');
        const below = box(part(mounted.element, '.popup') as HTMLElement).top;

        // Act
        mounted.store.set('$.app.anchor', 'topStart');

        // Assert
        expect(box(part(mounted.element, '.popup') as HTMLElement).top).toBeLessThan(below);
    });

    it('should focus the first item on open and move with the arrow keys, wrapping and with Home and End', async () => {
        // Arrange
        const mounted = mountMenu();
        command(mounted.element, 'open');

        // Act
        const first = activeKey(mounted.element);
        await userEvent.keyboard('{ArrowDown}');
        const second = activeKey(mounted.element);
        await userEvent.keyboard('{End}');
        const last = activeKey(mounted.element);
        await userEvent.keyboard('{ArrowDown}');
        const wrapped = activeKey(mounted.element);
        await userEvent.keyboard('{ArrowUp}');
        const back = activeKey(mounted.element);
        await userEvent.keyboard('{Home}');

        // Assert
        expect([first, second, last, wrapped, back]).toEqual(['one', 'two', 'three', 'one', 'three']);
        expect(activeKey(mounted.element)).toBe('one');
    });

    it('should skip a disabled item with the arrow keys', async () => {
        // Arrange
        const mounted = mountMenu({ children: { one: item('One'), two: item('Two', { disabled: true }), three: item('Three') } });
        command(mounted.element, 'open');

        // Act
        await userEvent.keyboard('{ArrowDown}');

        // Assert
        expect(activeKey(mounted.element)).toBe('three');
    });

    it('should open from the trigger with ArrowDown', async () => {
        // Arrange
        const mounted = mountMenu();
        triggerButton(mounted.element).focus();

        // Act
        await userEvent.keyboard('{ArrowDown}');

        // Assert
        expect(isOpen(mounted.element)).toBe(true);
        expect(activeKey(mounted.element)).toBe('one');
    });

    it('should raise select with the item key and close when an item is pressed', async () => {
        // Arrange
        const mounted = mountMenu();
        const selects = events(mounted.element, 'select');
        const closes = events(mounted.element, 'close');
        command(mounted.element, 'open');

        // Act
        await userEvent.click(itemButton(mounted.element, 'two'));

        // Assert
        expect(selects).toEqual(['two']);
        expect(closes).toHaveLength(1);
        expect(isOpen(mounted.element)).toBe(false);
    });

    it('should select with Enter on the focused item and return focus to the trigger', async () => {
        // Arrange
        const mounted = mountMenu();
        const selects = events(mounted.element, 'select');
        command(mounted.element, 'open');

        // Act
        await userEvent.keyboard('{ArrowDown}{Enter}');

        // Assert
        expect(selects).toEqual(['two']);
        expect((triggerButton(mounted.element).getRootNode() as ShadowRoot).activeElement).toBe(triggerButton(mounted.element));
    });

    it('should close on Escape and return focus to the trigger', async () => {
        // Arrange
        const mounted = mountMenu();
        const closes = events(mounted.element, 'close');
        command(mounted.element, 'open');

        // Act
        await userEvent.keyboard('{Escape}');

        // Assert
        expect(isOpen(mounted.element)).toBe(false);
        expect(mounted.store.get('$.app.open')).toBe(false);
        expect(closes).toHaveLength(1);
        expect((triggerButton(mounted.element).getRootNode() as ShadowRoot).activeElement).toBe(triggerButton(mounted.element));
    });

    it('should close on a press outside and leave the focus where the user pressed', async () => {
        // Arrange
        const mounted = mountMenu();
        const outside = document.body.appendChild(document.createElement('input'));
        outside.style.cssText = 'position: fixed; top: 0; right: 0; z-index: 2147483647';
        command(mounted.element, 'open');

        // Act
        await userEvent.click(outside);

        // Assert
        expect(isOpen(mounted.element)).toBe(false);
        expect(document.activeElement).toBe(outside);
        outside.remove();
    });

    it('should not select for a press of the trigger', async () => {
        // Arrange
        const mounted = mountMenu();
        const selects = events(mounted.element, 'select');

        // Act
        await userEvent.click(triggerButton(mounted.element));

        // Assert
        expect(selects).toEqual([]);
    });

    it('should default to the overlay elevation', () => {
        // Arrange
        const mounted = mountMenu();
        command(mounted.element, 'open');

        // Assert
        expect(mounted.element.getAttribute('elevation')).toBe('overlay');
        expect(getComputedStyle(part(mounted.element, '.popup') as HTMLElement).boxShadow).not.toBe('none');
    });

    it('should show German item labels and the German menu name', () => {
        // Arrange
        const mounted = mountMenu({}, { locales: { de: { children: { one: { _label: 'Eins' } } } } });

        // Act
        mounted.setLocale('de');

        // Assert
        expect(itemButton(mounted.element, 'one').querySelector('.label')?.textContent).toBe('Eins');
        expect(part(mounted.element, '.popup')?.getAttribute('aria-label')).toBe('Menü');
    });
});
