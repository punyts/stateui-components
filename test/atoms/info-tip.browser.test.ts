import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const toggle = (element: Element): HTMLButtonElement => part<HTMLButtonElement>(element, '.toggle');
const note = (element: Element): HTMLElement => part<HTMLElement>(element, '.note');

describe('infoTip in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should show its note on a press and hide it on the next, raising open and close', async () => {
        // Arrange
        const mounted = mountComponent('infoTip', { _text: 'The name shown on invoices' });
        const events: string[] = [];
        mounted.element.addEventListener('open', () => events.push('open'));
        mounted.element.addEventListener('close', () => events.push('close'));
        await flush();

        // Act
        await userEvent.click(toggle(mounted.element));
        await flush();
        const shown = note(mounted.element).matches(':popover-open');
        const text = note(mounted.element).textContent;
        await userEvent.click(toggle(mounted.element));
        await flush();

        // Assert
        expect(shown).toBe(true);
        expect(text).toBe('The name shown on invoices');
        expect(note(mounted.element).matches(':popover-open')).toBe(false);
        expect(note(mounted.element).textContent).toBe('');
        expect(events).toEqual(['open', 'close']);
    });

    it('should open on keyboard focus, sit beside the button and close on Escape', async () => {
        // Arrange
        const mounted = mountComponent('infoTip', { _text: 'Shown on focus', _label: 'About the name' });
        await flush();

        // Act
        await userEvent.tab();
        await flush();
        const expanded = toggle(mounted.element).getAttribute('aria-expanded');
        const tip = note(mounted.element).getBoundingClientRect();
        const button = toggle(mounted.element).getBoundingClientRect();
        // Above the button, or flipped below it when the page has no room above
        const beside = tip.bottom <= button.top || tip.top >= button.bottom;
        await userEvent.keyboard('{Escape}');
        await flush();

        // Assert
        expect(toggle(mounted.element).getAttribute('aria-label')).toBe('About the name');
        expect(expanded).toBe('true');
        expect(beside).toBe(true);
        expect(mounted.store.get('$.app.open')).toBe(false);
    });

    it('should not open on hover', async () => {
        // Arrange
        const mounted = mountComponent('infoTip', { _text: 'Not on hover' });
        await flush();

        // Act
        await userEvent.hover(toggle(mounted.element));
        await new Promise((resolve) => setTimeout(resolve, 700));

        // Assert
        expect(note(mounted.element).matches(':popover-open')).toBe(false);
    });

    it('should close when the focus leaves the button', async () => {
        // Arrange
        const mounted = mountComponent('infoTip', { _text: 'Closes on blur' });
        await flush();
        await userEvent.tab();
        await flush();

        // Act
        toggle(mounted.element).blur();
        await flush();

        // Assert
        expect(note(mounted.element).matches(':popover-open')).toBe(false);
        expect(mounted.element.hasAttribute('open')).toBe(false);
    });
});
