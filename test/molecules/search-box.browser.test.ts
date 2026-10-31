import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const control = (element: Element): HTMLInputElement => element.shadowRoot?.querySelector('input') as HTMLInputElement;
const clearButton = (element: Element): HTMLButtonElement | null => element.shadowRoot?.querySelector('button.clear') ?? null;

type Commanded = Element & { commands: Record<string, () => void> };

const record = (element: Element, name: string): unknown[] => {
    const details: unknown[] = [];
    element.addEventListener(name, (event) => details.push((event as CustomEvent).detail));
    return details;
};

describe('searchBox in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should show a search icon and the placeholder and label', () => {
        // Arrange
        const mounted = mountComponent('searchBox', {});

        // Act
        const input = control(mounted.element);

        // Assert
        expect(mounted.element.shadowRoot?.querySelector('ui-icon[name=search]')).not.toBeNull();
        expect(input.placeholder).toBe('Search');
        expect(input.getAttribute('aria-label')).toBe('Search');
    });

    it('should write $.data through a <-value link when the user types', async () => {
        // Arrange
        const mounted = mountComponent('searchBox', { '<-value': '$.data.query' }, { data: { query: '' } });
        mounted.store.set('$.data.query', '');

        // Act
        await userEvent.type(control(mounted.element), 'ada');

        // Assert
        expect(mounted.store.get('$.data.query')).toBe('ada');
    });

    it('should raise search once on Enter with the text', async () => {
        // Arrange
        const mounted = mountComponent('searchBox', { value: '' });
        const searches = record(mounted.element, 'search');
        await userEvent.type(control(mounted.element), 'ada');

        // Act
        await userEvent.keyboard('{Enter}');

        // Assert
        expect(searches).toEqual(['ada']);
    });

    it('should hide the clear button while the value is empty', () => {
        // Arrange
        const mounted = mountComponent('searchBox', { value: '' });

        // Act
        const before = clearButton(mounted.element);
        mounted.store.set('$.app.value', 'x');

        // Assert
        expect(before).toBeNull();
        expect(clearButton(mounted.element)).not.toBeNull();
    });

    it('should clear the value, write data and refocus when the button is pressed', async () => {
        // Arrange
        const mounted = mountComponent('searchBox', { '<-value': '$.data.query' }, { data: { query: 'seed' } });
        mounted.store.set('$.data.query', 'seed');

        // Act
        await userEvent.click(clearButton(mounted.element) as HTMLButtonElement);

        // Assert
        expect(mounted.store.get('$.data.query')).toBe('');
        expect(control(mounted.element).value).toBe('');
        expect(mounted.element.shadowRoot?.activeElement).toBe(control(mounted.element));
        expect(clearButton(mounted.element)).toBeNull();
    });

    it('should clear and focus through the commands', () => {
        // Arrange
        const mounted = mountComponent('searchBox', { '<-value': '$.data.query' }, { data: { query: 'seed' } });
        mounted.store.set('$.data.query', 'seed');
        const host = mounted.element as Commanded;

        // Act
        host.commands.clear();

        // Assert
        expect(mounted.store.get('$.data.query')).toBe('');
        expect(mounted.element.shadowRoot?.activeElement).toBe(control(mounted.element));
    });

    it('should raise change on blur with the value', async () => {
        // Arrange
        const mounted = mountComponent('searchBox', { value: '' });
        const changes = record(mounted.element, 'change');
        await userEvent.type(control(mounted.element), 'abc');

        // Act
        await userEvent.tab();

        // Assert
        expect(changes).toEqual(['abc']);
    });

    it('should show the German texts after the locale switches', () => {
        // Arrange
        const mounted = mountComponent('searchBox', { value: 'x' });

        // Act
        mounted.setLocale('de');

        // Assert
        expect(control(mounted.element).placeholder).toBe('Suchen');
        expect(control(mounted.element).getAttribute('aria-label')).toBe('Suche');
        expect(clearButton(mounted.element)?.getAttribute('aria-label')).toBe('Suche löschen');
    });
});
