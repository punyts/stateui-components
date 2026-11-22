import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;
const part = (element: Element, selector: string): HTMLElement => root(element).querySelector(selector) as HTMLElement;
const isOpen = (menu: Element): boolean => part(menu, '.popup').matches(':popover-open');
const item = (label: string): Record<string, unknown> => ({ component: 'menuItem', _label: label });
const itemButton = (menu: Element, key: string): HTMLButtonElement => {
    const node = root(menu).querySelector(`sui-node[state$=".children.${key}"]`) as Element;
    return node.firstElementChild?.shadowRoot?.querySelector('button') as HTMLButtonElement;
};

const mountContextMenu = async () => {
    const mounted = mountComponent('menu', {
        anchor: 'pointer',
        trigger: { component: 'card', _title: 'Order 42' },
        children: { copy: item('Copy'), archive: item('Archive') }
    });
    (mounted.element as HTMLElement).style.cssText = 'display: block; inline-size: 400px; block-size: 200px; margin: 40px';
    await flush();
    return mounted;
};
const pointerAt = (target: Element, type: string, x: number, y: number, pointerType = 'touch'): void => {
    target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerType, isPrimary: true, pointerId: 7, bubbles: true, composed: true }));
};

describe('menu at the pointer in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should open at the pointer on a right-click and not on a press', async () => {
        // Arrange
        const mounted = await mountContextMenu();
        const trigger = part(mounted.element, '.trigger');

        // Act
        await userEvent.click(trigger);
        await flush();
        const afterPress = isOpen(mounted.element);
        const menu = new MouseEvent('contextmenu', { clientX: 200, clientY: 120, bubbles: true, composed: true, cancelable: true });
        trigger.dispatchEvent(menu);
        await flush();
        const popup = part(mounted.element, '.popup').getBoundingClientRect();

        // Assert
        expect(afterPress).toBe(false);
        expect(menu.defaultPrevented).toBe(true);
        expect(isOpen(mounted.element)).toBe(true);
        expect(popup.left).toBeCloseTo(200, 0);
        expect(popup.top).toBeGreaterThanOrEqual(120);
        expect(popup.top).toBeLessThan(140);
        expect((itemButton(mounted.element, 'copy').getRootNode() as ShadowRoot).activeElement).toBe(itemButton(mounted.element, 'copy'));
    });

    it('should flip to stay on screen near the bottom right corner', async () => {
        // Arrange
        const mounted = await mountContextMenu();

        // Act
        part(mounted.element, '.trigger').dispatchEvent(new MouseEvent('contextmenu', { clientX: window.innerWidth - 4, clientY: window.innerHeight - 4, bubbles: true, composed: true, cancelable: true }));
        await flush();
        const popup = part(mounted.element, '.popup').getBoundingClientRect();

        // Assert
        expect(popup.right).toBeLessThanOrEqual(window.innerWidth);
        expect(popup.bottom).toBeLessThanOrEqual(window.innerHeight);
    });

    it('should open on a touch held still and not on one that moves', async () => {
        // Arrange
        const mounted = await mountContextMenu();
        const trigger = part(mounted.element, '.trigger');

        // Act
        pointerAt(trigger, 'pointerdown', 100, 100);
        pointerAt(trigger, 'pointermove', 140, 100);
        await new Promise((resolve) => setTimeout(resolve, 600));
        const afterMove = isOpen(mounted.element);
        pointerAt(trigger, 'pointerup', 140, 100);
        pointerAt(trigger, 'pointerdown', 150, 110);
        await new Promise((resolve) => setTimeout(resolve, 600));

        // Assert
        expect(afterMove).toBe(false);
        expect(isOpen(mounted.element)).toBe(true);
        expect(part(mounted.element, '.popup').getBoundingClientRect().left).toBeCloseTo(150, 0);
    });

    it('should open on Shift+F10 and raise select for a choice', async () => {
        // Arrange
        const mounted = await mountContextMenu();
        const chosen: unknown[] = [];
        mounted.element.addEventListener('select', (event) => chosen.push((event as CustomEvent).detail));

        // Act
        part(mounted.element, '.trigger').dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, composed: true, cancelable: true }));
        await flush();
        const opened = isOpen(mounted.element);
        itemButton(mounted.element, 'archive').click();
        await flush();

        // Assert
        expect(opened).toBe(true);
        expect(chosen).toEqual(['archive']);
        expect(isOpen(mounted.element)).toBe(false);
    });
});
