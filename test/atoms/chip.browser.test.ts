import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

type Commanded = Element & { commands: Record<string, () => void> };

const part = <T extends Element>(element: Element, selector: string): T | null => element.shadowRoot?.querySelector<T>(selector) ?? null;
const main = (element: Element): HTMLElement => part<HTMLElement>(element, '.main') as HTMLElement;
const removeButton = (element: Element): HTMLButtonElement | null => part<HTMLButtonElement>(element, 'button.remove');

const record = (element: Element, name: string): unknown[] => {
    const details: unknown[] = [];
    element.addEventListener(name, (event) => details.push((event as CustomEvent).detail));
    return details;
};

describe('chip in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render the text and icon as plain content, with no button, by default', () => {
        // Arrange and Act
        const mounted = mountComponent('chip', { _text: 'Design', icon: 'check' });

        // Assert
        expect(main(mounted.element).localName).toBe('span');
        expect(part(mounted.element, '.text')?.textContent).toBe('Design');
        expect(part(mounted.element, 'ui-icon.glyph')?.getAttribute('name')).toBe('check');
        expect(mounted.element.shadowRoot?.querySelector('button')).toBeNull();
    });

    it('should paint the tone and draw solid when the variant is solid', () => {
        // Arrange
        const soft = mountComponent('chip', { tone: 'success' });
        const solid = mountComponent('chip', { tone: 'success', variant: 'solid' });
        const chip = (element: Element): CSSStyleDeclaration => getComputedStyle(part(element, '.chip') as Element);

        // Assert
        expect(chip(solid.element).backgroundColor).not.toBe(chip(soft.element).backgroundColor);
        expect(chip(solid.element).backgroundColor).toBe(chip(soft.element).color);
    });

    it('should toggle selected with aria-pressed and raise change on a press, Enter or Space', async () => {
        // Arrange
        const mounted = mountComponent('chip', { selectable: true, _text: 'Open' });
        const changes = record(mounted.element, 'change');
        const button = main(mounted.element) as HTMLButtonElement;

        // Act
        await userEvent.click(button);
        const pressed = button.getAttribute('aria-pressed');
        await userEvent.keyboard('{Enter}');
        await userEvent.keyboard(' ');

        // Assert
        expect(button.localName).toBe('button');
        expect(pressed).toBe('true');
        expect(changes).toEqual([true, false, true]);
        expect(mounted.store.get('$.app.selected')).toBe(true);
        expect(mounted.element.hasAttribute('selected')).toBe(true);
    });

    it('should not raise change for a write to selected', () => {
        // Arrange
        const mounted = mountComponent('chip', { selectable: true });
        const changes = record(mounted.element, 'change');

        // Act
        mounted.store.set('$.app.selected', true);

        // Assert
        expect(changes).toEqual([]);
        expect(main(mounted.element).getAttribute('aria-pressed')).toBe('true');
    });

    it('should name the remove button after the text and raise remove on a press, Delete and Backspace', async () => {
        // Arrange
        const mounted = mountComponent('chip', { removable: true, _text: 'Urgent' });
        const removes = record(mounted.element, 'remove');
        const button = removeButton(mounted.element) as HTMLButtonElement;

        // Act
        await userEvent.click(button);
        button.focus();
        await userEvent.keyboard('{Delete}');
        await userEvent.keyboard('{Backspace}');

        // Assert
        expect(button.getAttribute('aria-label')).toBe('Remove Urgent');
        expect(removes).toHaveLength(3);
    });

    it('should raise remove from the toggle button of a chip that is both selectable and removable', async () => {
        // Arrange
        const mounted = mountComponent('chip', { removable: true, selectable: true });
        const removes = record(mounted.element, 'remove');
        const changes = record(mounted.element, 'change');

        // Act
        (mounted.element as Commanded).commands.focus();
        await userEvent.keyboard('{Delete}');

        // Assert
        expect(mounted.element.shadowRoot?.activeElement).toBe(main(mounted.element));
        expect(removes).toHaveLength(1);
        expect(changes).toEqual([]);
    });

    it('should disable both buttons and raise nothing when disabled', async () => {
        // Arrange
        const mounted = mountComponent('chip', { removable: true, selectable: true, disabled: true });
        const changes = record(mounted.element, 'change');
        const removes = record(mounted.element, 'remove');
        const toggle = main(mounted.element) as HTMLButtonElement;

        // Act
        await userEvent.click(toggle, { force: true });
        await userEvent.click(removeButton(mounted.element) as HTMLButtonElement, { force: true });

        // Assert
        expect(toggle.disabled).toBe(true);
        expect(removeButton(mounted.element)?.disabled).toBe(true);
        expect(mounted.store.get('$.app.selected')).toBe(false);
        expect([...changes, ...removes]).toEqual([]);
        expect(mounted.element.hasAttribute('disabled')).toBe(true);
    });

    it('should show the French text and remove name after switching language', () => {
        // Arrange
        const mounted = mountComponent('chip', { removable: true });

        // Act
        mounted.setLocale('fr');

        // Assert
        expect(part(mounted.element, '.text')?.textContent).toBe('Puce');
        expect(removeButton(mounted.element)?.getAttribute('aria-label')).toBe('Retirer Puce');
    });
});
