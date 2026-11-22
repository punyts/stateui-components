import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const part = <T extends HTMLElement>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const display = (element: Element): HTMLButtonElement => part<HTMLButtonElement>(element, '.display');
const input = (element: Element): HTMLInputElement => part<HTMLInputElement>(element, '.input');
const changes = (element: Element): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener('change', (event) => seen.push((event as CustomEvent).detail));
    return seen;
};

describe('editableText in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should show the text as a button and turn into a focused input with it selected on a press', async () => {
        // Arrange
        const mounted = mountComponent('editableText', { value: 'To do', _label: 'Column name' });

        // Act
        await userEvent.click(display(mounted.element));

        // Assert
        expect(display(mounted.element).hidden).toBe(true);
        expect(input(mounted.element).hidden).toBe(false);
        expect(mounted.element.shadowRoot?.activeElement).toBe(input(mounted.element));
        expect(input(mounted.element).value).toBe('To do');
        expect(input(mounted.element).selectionEnd).toBe(5);
        expect(input(mounted.element).getAttribute('aria-label')).toBe('Column name');
        expect(mounted.element.hasAttribute('editing')).toBe(true);
    });

    it('should write the trimmed text on Enter, raise change and give the focus back to the text', async () => {
        // Arrange
        const mounted = mountComponent('editableText', { '<-value': '$.data.name' }, { data: { name: 'To do' } });
        const seen = changes(mounted.element);
        await userEvent.click(display(mounted.element));

        // Act
        await userEvent.keyboard('  Doing  {Enter}');
        await flush();

        // Assert
        expect(mounted.store.get('$.data.name')).toBe('Doing');
        expect(seen).toEqual([{ value: 'Doing', previous: 'To do' }]);
        expect(display(mounted.element).textContent).toBe('Doing');
        expect(mounted.element.shadowRoot?.activeElement).toBe(display(mounted.element));
    });

    it('should write on blur and drop the draft on Escape', async () => {
        // Arrange
        const mounted = mountComponent('editableText', { value: 'Backlog' });
        const seen = changes(mounted.element);

        // Act
        await userEvent.click(display(mounted.element));
        await userEvent.keyboard('Later{Escape}');
        const afterEscape = mounted.store.get('$.app.value');
        await userEvent.click(display(mounted.element));
        await userEvent.keyboard('Icebox');
        input(mounted.element).blur();
        await flush();

        // Assert
        expect(afterEscape).toBe('Backlog');
        expect(mounted.store.get('$.app.value')).toBe('Icebox');
        expect(seen).toEqual([{ value: 'Icebox', previous: 'Backlog' }]);
    });

    it('should keep a required text when the draft is emptied, and raise nothing for no change', async () => {
        // Arrange
        const mounted = mountComponent('editableText', { value: 'Done', required: true });
        const seen = changes(mounted.element);

        // Act
        await userEvent.click(display(mounted.element));
        await userEvent.keyboard('{Control>}a{/Control}{Backspace}{Enter}');
        await userEvent.click(display(mounted.element));
        await userEvent.keyboard('{Enter}');

        // Assert
        expect(mounted.store.get('$.app.value')).toBe('Done');
        expect(seen).toEqual([]);
    });

    it('should show the placeholder muted when empty and describe the button with the German hint', async () => {
        // Arrange
        const mounted = mountComponent('editableText', { _placeholder: 'Untitled' });

        // Act
        mounted.setLocale('de');
        await flush();

        // Assert
        expect(display(mounted.element).textContent).toBe('Untitled');
        expect(display(mounted.element).hasAttribute('data-empty')).toBe(true);
        expect(display(mounted.element).getAttribute('aria-describedby')).toBe('hint');
        expect(part(mounted.element, '#hint').textContent).toBe('Zum Bearbeiten drücken');
    });
});
