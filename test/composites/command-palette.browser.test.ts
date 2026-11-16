import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

type Commanded = Element & { commands: Record<string, () => void> };

const part = <T extends Element = HTMLElement>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const all = (element: Element, selector: string): HTMLElement[] => Array.from(element.shadowRoot?.querySelectorAll<HTMLElement>(selector) ?? []);
const dialog = (element: Element): HTMLDialogElement => part<HTMLDialogElement>(element, 'dialog');
const search = (element: Element): HTMLInputElement => part<HTMLInputElement>(element, '#query');
const options = (element: Element): string[] => all(element, '[role=option] .label').map((label) => label.textContent ?? '');
const headings = (element: Element): string[] => all(element, '.heading').map((heading) => heading.textContent ?? '');
const activeLabel = (element: Element): string | undefined => {
    const id = search(element).getAttribute('aria-activedescendant');
    return id === null ? undefined : (element.shadowRoot?.getElementById(id)?.querySelector('.label')?.textContent ?? undefined);
};
const command = (element: Element, name: string): void => (element as Commanded).commands[name]?.();

const record = (element: Element, name: string): unknown[] => {
    const details: unknown[] = [];
    element.addEventListener(name, (event) => details.push((event as CustomEvent).detail ?? name));
    return details;
};

const COMMANDS = {
    open: { _label: 'Open file', icon: 'upload', group: 'File', shortcut: 'Ctrl+O', keywords: ['load'] },
    save: { _label: 'Save', group: 'File', shortcut: 'Ctrl+S' },
    theme: { _label: 'Thème sombre', group: 'View', keywords: ['dark'] },
    zoom: { _label: 'Zoom in', group: 'View' },
    help: { _label: 'Help' }
};

/** A button on the page that opens the palette, as an app would have */
const opener = (): HTMLButtonElement => {
    const button = document.createElement('button');
    button.textContent = 'Commands';
    document.body.append(button);
    button.focus();
    return button;
};

describe('commandPalette in Chromium', () => {
    const extras: Element[] = [];

    afterEach(() => {
        mountComponent.unmountAll();
        for (const extra of extras.splice(0)) extra.remove();
    });

    it('should stay closed until opened, then focus the search with the first command active', async () => {
        // Arrange
        const mounted = mountComponent('commandPalette', { commands: COMMANDS });
        const closed = dialog(mounted.element).open;

        // Act
        command(mounted.element, 'open');
        await vi.waitFor(() => expect(mounted.element.shadowRoot?.activeElement).toBe(search(mounted.element)));

        // Assert
        expect(closed).toBe(false);
        expect(dialog(mounted.element).open).toBe(true);
        expect(dialog(mounted.element).getAttribute('aria-label')).toBe('Command palette');
        expect(search(mounted.element).getAttribute('role')).toBe('combobox');
        expect(search(mounted.element).getAttribute('aria-controls')).toBe('listbox');
        expect(search(mounted.element).getAttribute('aria-label')).toBe('Search commands');
        expect(part(mounted.element, '#listbox').getAttribute('role')).toBe('listbox');
        expect(activeLabel(mounted.element)).toBe('Open file');
        expect(all(mounted.element, '[aria-selected=true]')).toHaveLength(1);
    });

    it('should list the commands by group under their headings, with icons and shortcuts', () => {
        // Arrange and Act
        const mounted = mountComponent('commandPalette', { commands: COMMANDS, open: true });
        const groups = all(mounted.element, '[role=group]');

        // Assert
        expect(headings(mounted.element)).toEqual(['File', 'View']);
        expect(options(mounted.element)).toEqual(['Open file', 'Save', 'Thème sombre', 'Zoom in', 'Help']);
        expect(mounted.element.shadowRoot?.getElementById(groups[0]?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('File');
        expect(groups[2]?.hasAttribute('aria-labelledby')).toBe(false);
        expect(all(mounted.element, '.shortcut').map((key) => key.textContent)).toEqual(['Ctrl+O', 'Ctrl+S']);
        expect(all(mounted.element, '[role=option]')[0]?.querySelector('ui-icon')?.getAttribute('name')).toBe('upload');
    });

    it('should filter by label and keywords as you type, apart from case and accents, and say when nothing matches', async () => {
        // Arrange
        const mounted = mountComponent('commandPalette', { commands: COMMANDS });
        command(mounted.element, 'open');
        await vi.waitFor(() => expect(mounted.element.shadowRoot?.activeElement).toBe(search(mounted.element)));

        // Act
        await userEvent.keyboard('THEME');
        const accents = [options(mounted.element), headings(mounted.element)];
        await userEvent.clear(search(mounted.element));
        await userEvent.type(search(mounted.element), 'load');
        const keyword = options(mounted.element);
        await userEvent.type(search(mounted.element), 'xyz');

        // Assert
        expect(accents).toEqual([['Thème sombre'], ['View']]);
        expect(keyword).toEqual(['Open file']);
        expect(options(mounted.element)).toEqual([]);
        expect(part(mounted.element, '.empty').textContent).toBe('No matching commands');
        expect(part(mounted.element, '[role=status]').textContent).toBe('No matching commands');
        expect(search(mounted.element).hasAttribute('aria-activedescendant')).toBe(false);
    });

    it('should move the active option with the arrows, round at either end, and run it with Enter, closing and returning focus', async () => {
        // Arrange
        const button = opener();
        extras.push(button);
        const mounted = mountComponent('commandPalette', { commands: COMMANDS });
        const runs = record(mounted.element, 'run');
        const closes = record(mounted.element, 'close');
        button.focus();
        command(mounted.element, 'open');
        await vi.waitFor(() => expect(mounted.element.shadowRoot?.activeElement).toBe(search(mounted.element)));

        // Act
        await userEvent.keyboard('{ArrowUp}');
        const wrapped = activeLabel(mounted.element);
        await userEvent.keyboard('{ArrowDown}{ArrowDown}');
        const moved = activeLabel(mounted.element);
        await userEvent.keyboard('{Enter}');

        // Assert
        expect(wrapped).toBe('Help');
        expect(moved).toBe('Save');
        expect(runs).toEqual(['save']);
        expect(closes).toHaveLength(1);
        expect(dialog(mounted.element).open).toBe(false);
        expect(mounted.store.get('$.app.open')).toBe(false);
        expect(document.activeElement).toBe(button);
    });

    it('should run a command pressed with the pointer', async () => {
        // Arrange
        const mounted = mountComponent('commandPalette', { commands: COMMANDS, open: true });
        const runs = record(mounted.element, 'run');

        // Act
        await userEvent.click(all(mounted.element, '[role=option]')[3] as HTMLElement);

        // Assert
        expect(runs).toEqual(['zoom']);
        expect(dialog(mounted.element).open).toBe(false);
    });

    it('should close on Escape and open fresh, with an empty search, through toggle', async () => {
        // Arrange
        const mounted = mountComponent('commandPalette', { commands: COMMANDS });
        const opens = record(mounted.element, 'open');
        const closes = record(mounted.element, 'close');
        command(mounted.element, 'toggle');
        await vi.waitFor(() => expect(mounted.element.shadowRoot?.activeElement).toBe(search(mounted.element)));
        await userEvent.keyboard('zoom');

        // Act
        await userEvent.keyboard('{Escape}');
        const afterEscape = dialog(mounted.element).open;
        command(mounted.element, 'toggle');

        // Assert
        expect(afterEscape).toBe(false);
        expect(opens).toHaveLength(2);
        expect(closes).toHaveLength(1);
        expect(search(mounted.element).value).toBe('');
        expect(options(mounted.element)).toHaveLength(5);
    });

    it('should name the search and the empty text in Spanish after switching language', () => {
        // Arrange
        const mounted = mountComponent('commandPalette', { open: true });

        // Act
        mounted.setLocale('es');

        // Assert
        expect(search(mounted.element).getAttribute('aria-label')).toBe('Buscar comandos');
        expect(search(mounted.element).placeholder).toBe('Escriba un comando');
        expect(part(mounted.element, '.empty').textContent).toBe('No hay comandos que coincidan');
        expect(dialog(mounted.element).getAttribute('aria-label')).toBe('Paleta de comandos');
    });
});
