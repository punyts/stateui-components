import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;
const part = (element: Element, selector: string): HTMLElement | null => root(element).querySelector(selector);
const box = (element: Element): DOMRect => element.getBoundingClientRect();
const popup = (element: Element): HTMLElement => part(element, '.popup') as HTMLElement;
const isOpen = (element: Element): boolean => popup(element).matches(':popover-open');
const triggerButton = (element: Element): HTMLButtonElement =>
    part(element, '.trigger ui-button')?.shadowRoot?.querySelector('button') as HTMLButtonElement;
const command = (element: Element, name: string): void => {
    (element as Element & { commands: Record<string, () => void> }).commands[name]?.();
};
const events = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail ?? true));
    return seen;
};
const deep = (start: ParentNode, tag: string): Element[] => {
    const found: Element[] = [];
    for (const child of Array.from(start.children)) {
        if (child.localName === tag) found.push(child);
        if (child.shadowRoot) found.push(...deep(child.shadowRoot, tag));
        found.push(...deep(child, tag));
    }
    return found;
};
/** The deepest focused element, looking through shadow roots */
const focused = (): Element | null => {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
};
const inputOf = (field: Element | undefined): HTMLInputElement => field?.shadowRoot?.querySelector('input') as HTMLInputElement;
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const trigger = { component: 'button', _title: 'Filter' };
const body = { component: 'text', _text: 'Quick info' };
const fieldBody = { component: 'textField', _label: 'Name' };
const mountPopover = (extra: Record<string, unknown> = {}, options = {}) => mountComponent('popover', { trigger, body: fieldBody, ...extra }, options);

describe('popover in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should be closed and hidden at first, with the body in the DOM, role dialog named by _label and the trigger marked', async () => {
        // Arrange
        const mounted = mountPopover({ _label: 'Filters' });
        await Promise.resolve();

        // Assert
        expect(isOpen(mounted.element)).toBe(false);
        expect(popup(mounted.element).checkVisibility()).toBe(false);
        expect(popup(mounted.element).getAttribute('role')).toBe('dialog');
        expect(popup(mounted.element).getAttribute('aria-label')).toBe('Filters');
        expect(root(mounted.element).querySelectorAll('.popup > sui-node')).toHaveLength(1);
        expect(triggerButton(mounted.element).getAttribute('aria-expanded')).toBe('false');
        expect(triggerButton(mounted.element).getAttribute('aria-haspopup')).toBe('dialog');
        expect(mounted.element.getAttribute('elevation')).toBe('overlay');
    });

    it('should open on a press of the trigger and close on a second press, raising open and close once each', async () => {
        // Arrange
        const mounted = mountPopover();
        const opens = events(mounted.element, 'open');
        const closes = events(mounted.element, 'close');

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
        expect(opens).toHaveLength(1);
        expect(closes).toHaveLength(1);
    });

    it('should open and close by the commands and by state, raising an event per transition', async () => {
        // Arrange
        const mounted = mountPopover();
        await flush();
        const opens = events(mounted.element, 'open');
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
        expect(opens).toHaveLength(3);
        expect(closes).toHaveLength(3);
    });

    it('should raise nothing for a popover that is open at load', async () => {
        // Arrange
        const mounted = mountPopover({ open: true });
        const opens = events(mounted.element, 'open');

        // Act
        await flush();

        // Assert
        expect(isOpen(mounted.element)).toBe(true);
        expect(opens).toEqual([]);
    });

    it('should place the panel by each anchor next to the trigger', () => {
        // Arrange
        const place = (anchor: string): { panel: DOMRect; trigger: DOMRect } => {
            const mounted = mountPopover({ anchor, body });
            mounted.host.style.paddingBlock = '200px';
            mounted.host.style.paddingInline = '150px';
            mounted.host.style.inlineSize = '300px';
            command(mounted.element, 'open');
            return { panel: box(popup(mounted.element)), trigger: box(part(mounted.element, '.trigger') as HTMLElement) };
        };

        // Act
        const bottomStart = place('bottomStart');
        const bottomEnd = place('bottomEnd');
        const topStart = place('topStart');
        const topEnd = place('topEnd');

        // Assert
        expect(bottomStart.panel.top).toBeGreaterThanOrEqual(bottomStart.trigger.bottom - 1);
        expect(Math.abs(bottomStart.panel.left - bottomStart.trigger.left)).toBeLessThan(2);
        expect(bottomEnd.panel.top).toBeGreaterThanOrEqual(bottomEnd.trigger.bottom - 1);
        expect(Math.abs(bottomEnd.panel.right - bottomEnd.trigger.right)).toBeLessThan(2);
        expect(topStart.panel.bottom).toBeLessThanOrEqual(topStart.trigger.top + 1);
        expect(Math.abs(topStart.panel.left - topStart.trigger.left)).toBeLessThan(2);
        expect(topEnd.panel.bottom).toBeLessThanOrEqual(topEnd.trigger.top + 1);
        expect(Math.abs(topEnd.panel.right - topEnd.trigger.right)).toBeLessThan(2);
    });

    it('should follow an anchor written while open', () => {
        // Arrange
        const mounted = mountPopover();
        mounted.host.style.paddingBlock = '200px';
        command(mounted.element, 'open');
        const below = box(popup(mounted.element)).top;

        // Act
        mounted.store.set('$.app.anchor', 'topStart');

        // Assert
        expect(box(popup(mounted.element)).top).toBeLessThan(below);
    });

    it('should size the panel by width: sm and md are fixed token widths, auto fits the content', () => {
        // Arrange
        const widthOf = (width: string): number => {
            const mounted = mountPopover({ width });
            command(mounted.element, 'open');
            return box(popup(mounted.element)).width;
        };

        // Act
        const sm = widthOf('sm');
        const md = widthOf('md');
        const auto = widthOf('auto');

        // Assert
        expect(md).toBeGreaterThan(sm);
        expect(auto).not.toBe(sm);
        expect(auto).not.toBe(md);
    });

    it('should move focus into the body on open and back to the trigger after Escape', async () => {
        // Arrange
        const mounted = mountPopover();
        triggerButton(mounted.element).focus();

        // Act
        command(mounted.element, 'open');
        const inside = focused();
        await userEvent.keyboard('{Escape}');

        // Assert
        expect(inside).toBe(inputOf(deep(root(mounted.element), 'ui-text-field')[0]));
        expect(isOpen(mounted.element)).toBe(false);
        expect(focused()).toBe(triggerButton(mounted.element));
    });

    it('should focus the panel itself when the body has nothing focusable, and return focus to the trigger after a close command', () => {
        // Arrange
        const mounted = mountPopover({ body });
        triggerButton(mounted.element).focus();

        // Act
        command(mounted.element, 'open');
        const inside = (root(mounted.element).activeElement as Element | null) === popup(mounted.element);
        command(mounted.element, 'close');

        // Assert
        expect(inside).toBe(true);
        expect(focused()).toBe(triggerButton(mounted.element));
    });

    it('should leave the focus where the user pressed after an outside press', async () => {
        // Arrange
        const mounted = mountPopover();
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

    it('should let a form inside the body validate and submit without closing the popover', async () => {
        // Arrange
        const form = { component: 'form', children: { name: { component: 'textField', _label: 'Name', required: true } } };
        const mounted = mountPopover({ body: form });
        command(mounted.element, 'open');
        const formElement = deep(root(mounted.element), 'ui-form')[0] as Element;
        const submitted = events(formElement, 'submitted');
        const invalid = events(formElement, 'invalid');

        // Act
        command(formElement, 'submit');
        await userEvent.type(inputOf(deep(root(mounted.element), 'ui-text-field')[0]), 'Ada');
        command(formElement, 'submit');

        // Assert
        expect(invalid.length).toBeGreaterThan(0);
        expect(submitted).toEqual([{ values: { name: 'Ada' } }]);
        expect(isOpen(mounted.element)).toBe(true);
    });

    it('should ignore Escape and an outside press while dismissible is false, and still close by the command', async () => {
        // Arrange
        const mounted = mountPopover({ dismissible: false });
        const outside = document.body.appendChild(document.createElement('input'));
        outside.style.cssText = 'position: fixed; top: 0; right: 0; z-index: 2147483647';
        const closes = events(mounted.element, 'close');
        command(mounted.element, 'open');

        // Act
        await userEvent.keyboard('{Escape}');
        await userEvent.click(outside);
        const stillOpen = isOpen(mounted.element);
        command(mounted.element, 'close');

        // Assert
        expect(stillOpen).toBe(true);
        expect(isOpen(mounted.element)).toBe(false);
        expect(closes).toHaveLength(1);
        outside.remove();
    });

    it('should close on Escape and on an outside press while dismissible, and follow a write to dismissible', async () => {
        // Arrange
        const mounted = mountPopover({ dismissible: false });
        const outside = document.body.appendChild(document.createElement('input'));
        outside.style.cssText = 'position: fixed; top: 0; right: 0; z-index: 2147483647';
        command(mounted.element, 'open');
        await userEvent.keyboard('{Escape}');
        const ignored = isOpen(mounted.element);

        // Act
        mounted.store.set('$.app.dismissible', true);
        await userEvent.keyboard('{Escape}');
        const byEscape = isOpen(mounted.element);
        command(mounted.element, 'open');
        await userEvent.click(outside);

        // Assert
        expect(ignored).toBe(true);
        expect(byEscape).toBe(false);
        expect(isOpen(mounted.element)).toBe(false);
        outside.remove();
    });

    it('should show the German label and a German body', () => {
        // Arrange
        const mounted = mountPopover({ body: { component: 'textField' } }, { locales: { de: { body: { _label: 'Ihr Name' } } } });

        // Act
        mounted.setLocale('de');

        // Assert
        expect(popup(mounted.element).getAttribute('aria-label')).toBe('Infofenster');
        expect(deep(root(mounted.element), 'ui-text-field')[0]?.shadowRoot?.querySelector('label')?.textContent).toBe('Ihr Name');
    });

    it('should show a German _label written by the application', () => {
        // Arrange
        const mounted = mountPopover({ _label: 'Filters' }, { locales: { de: { _label: 'Filter' } } });

        // Act
        mounted.setLocale('de');

        // Assert
        expect(popup(mounted.element).getAttribute('aria-label')).toBe('Filter');
    });
});
