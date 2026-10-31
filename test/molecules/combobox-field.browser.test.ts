import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

interface CommandElement extends Element {
    commands: { validate(): void; reset(): void; focus(): void; clear(): void };
}

const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const input = (element: Element): HTMLInputElement => part<HTMLInputElement>(element, 'input');
const popup = (element: Element): HTMLElement => part<HTMLElement>(element, '.popup');
const optionTexts = (element: Element): string[] => Array.from(element.shadowRoot?.querySelectorAll('.option') ?? []).map((option) => option.textContent ?? '');
const isOpen = (element: Element): boolean => popup(element).matches(':popover-open');
const get = (mounted: { store: { get(path: string): unknown } }, name: string): unknown => mounted.store.get(`$.app.${name}`);
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const commands = (element: Element): CommandElement['commands'] => (element as CommandElement).commands;
const events = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};

const cities = [
    { value: 'zh', label: 'Zürich' },
    { value: 'be', label: 'Bern' },
    { value: 'ge', label: 'Genève' },
    { value: 'ec', label: 'Éclair-sur-Mer' },
    { value: 'ba', label: 'Basel' }
];

async function typeIn(element: Element, text: string): Promise<void> {
    input(element).focus();
    await userEvent.clear(input(element));
    await userEvent.type(input(element), text);
    await flush();
}

describe('comboboxField in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render a labelled combobox with a listbox popup that is closed', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { _label: 'City', '<-options': '$.data.cities' }, { data: { cities } });
        await flush();

        // Assert
        expect(part(mounted.element, 'label').textContent).toBe('City');
        expect(input(mounted.element).getAttribute('role')).toBe('combobox');
        expect(input(mounted.element).getAttribute('aria-expanded')).toBe('false');
        expect(input(mounted.element).hasAttribute('aria-activedescendant')).toBe(false);
        expect(input(mounted.element).getAttribute('aria-controls')).toBe('listbox');
        expect(popup(mounted.element).getAttribute('role')).toBe('listbox');
        expect(isOpen(mounted.element)).toBe(false);
    });

    it('should filter by label ignoring case and accents, in option order', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { '<-options': '$.data.cities' }, { data: { cities } });
        await flush();

        // Act
        await typeIn(mounted.element, 'e');
        const withE = optionTexts(mounted.element);
        await typeIn(mounted.element, 'ZURICH');

        // Assert
        expect(withE).toEqual(['Bern', 'Genève', 'Éclair-sur-Mer', 'Basel']);
        expect(optionTexts(mounted.element)).toEqual(['Zürich']);
        expect(isOpen(mounted.element)).toBe(true);
        expect(input(mounted.element).getAttribute('aria-expanded')).toBe('true');
    });

    it('should match é when the user types e and the reverse', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { '<-options': '$.data.cities' }, { data: { cities } });
        await flush();

        // Act
        await typeIn(mounted.element, 'eclair');
        const first = optionTexts(mounted.element);
        await typeIn(mounted.element, 'genè');

        // Assert
        expect(first).toEqual(['Éclair-sur-Mer']);
        expect(optionTexts(mounted.element)).toEqual(['Genève']);
    });

    it('should cap the list at maxResults and show a keep typing row', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { maxResults: 2, '<-options': '$.data.cities' }, { data: { cities } });
        await flush();

        // Act
        await typeIn(mounted.element, 'e');

        // Assert
        expect(optionTexts(mounted.element)).toEqual(['Bern', 'Genève']);
        expect(part(mounted.element, '.hint').textContent).toBe('Keep typing to narrow the results');
    });

    it('should show a no matches row when nothing matches', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { '<-options': '$.data.cities' }, { data: { cities } });
        await flush();

        // Act
        await typeIn(mounted.element, 'qqq');

        // Assert
        expect(optionTexts(mounted.element)).toEqual([]);
        expect(part(mounted.element, '.hint').textContent).toBe('No matches');
    });

    it('should not open before minChars were typed', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { minChars: 2, '<-options': '$.data.cities' }, { data: { cities } });
        await flush();

        // Act
        await typeIn(mounted.element, 'b');
        const short = isOpen(mounted.element);
        await userEvent.keyboard('a');
        await flush();

        // Assert
        expect(short).toBe(false);
        expect(isOpen(mounted.element)).toBe(true);
        expect(optionTexts(mounted.element)).toEqual(['Basel']);
    });

    it('should open with ArrowDown, move with the arrows, choose with Enter and write the value through a link', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { '<-options': '$.data.cities', '<-value': '$.data.city' }, { data: { cities, city: '' } });
        await flush();
        input(mounted.element).focus();
        const changes = events(mounted.element, 'change');

        // Act
        await userEvent.keyboard('{ArrowDown}');
        const opened = isOpen(mounted.element);
        const firstActive = input(mounted.element).getAttribute('aria-activedescendant');
        await userEvent.keyboard('{ArrowDown}{ArrowDown}');
        const thirdActive = input(mounted.element).getAttribute('aria-activedescendant');
        await userEvent.keyboard('{ArrowUp}');
        await userEvent.keyboard('{Enter}');
        await flush();

        // Assert
        expect(opened).toBe(true);
        expect(firstActive).toBe('option-0');
        expect(thirdActive).toBe('option-2');
        expect(mounted.store.get('$.data.city')).toBe('be');
        expect(input(mounted.element).value).toBe('Bern');
        expect(isOpen(mounted.element)).toBe(false);
        expect(changes).toEqual([{ value: 'be' }]);
    });

    it('should put the active option on the chosen one when it opens again', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { '<-options': '$.data.cities', '<-value': '$.data.city' }, { data: { cities, city: 'ge' } });
        await flush();
        input(mounted.element).focus();

        // Act
        await userEvent.keyboard('{ArrowDown}');

        // Assert
        expect(input(mounted.element).value).toBe('Genève');
        expect(optionTexts(mounted.element)).toHaveLength(5);
        expect(input(mounted.element).getAttribute('aria-activedescendant')).toBe('option-2');
        expect(part(mounted.element, '#option-2').getAttribute('aria-selected')).toBe('true');
    });

    it('should close on Escape and restore the text of the value', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { '<-options': '$.data.cities', '<-value': '$.data.city' }, { data: { cities, city: 'be' } });
        await flush();
        await typeIn(mounted.element, 'gen');

        // Act
        await userEvent.keyboard('{Escape}');
        await flush();

        // Assert
        expect(isOpen(mounted.element)).toBe(false);
        expect(input(mounted.element).value).toBe('Bern');
        expect(mounted.store.get('$.data.city')).toBe('be');
    });

    it('should choose an option with the pointer and keep focus in the input', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { '<-options': '$.data.cities', '<-value': '$.data.city' }, { data: { cities, city: '' } });
        await flush();
        await typeIn(mounted.element, 'ba');

        // Act
        await userEvent.click(part(mounted.element, '.option'));
        await flush();

        // Assert
        expect(mounted.store.get('$.data.city')).toBe('ba');
        expect(input(mounted.element).value).toBe('Basel');
        expect((mounted.element.shadowRoot as ShadowRoot).activeElement).toBe(input(mounted.element));
        expect(isOpen(mounted.element)).toBe(false);
    });

    it('should restore the last value when the user leaves with text that matches no option', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { '<-options': '$.data.cities', '<-value': '$.data.city' }, { data: { cities, city: 'be' } });
        await flush();
        await typeIn(mounted.element, 'Atlantis');

        // Act
        input(mounted.element).blur();
        await flush();

        // Assert
        expect(mounted.store.get('$.data.city')).toBe('be');
        expect(input(mounted.element).value).toBe('Bern');
    });

    it('should choose the option when the user leaves with text that is exactly its label, and clear the value for empty text', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { '<-options': '$.data.cities', '<-value': '$.data.city' }, { data: { cities, city: '' } });
        await flush();
        await typeIn(mounted.element, 'genEve');
        input(mounted.element).blur();
        await flush();
        const exact = mounted.store.get('$.data.city');
        await typeIn(mounted.element, 'x');
        await userEvent.clear(input(mounted.element));

        // Act
        input(mounted.element).blur();
        await flush();

        // Assert
        expect(exact).toBe('ge');
        expect(mounted.store.get('$.data.city')).toBe('');
        expect(input(mounted.element).value).toBe('');
    });

    it('should make the typed text the value with allowCustom, on leaving and on Enter', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { allowCustom: true, '<-options': '$.data.cities', '<-value': '$.data.city' }, { data: { cities, city: '' } });
        await flush();

        // Act
        await typeIn(mounted.element, ' Lugano ');
        input(mounted.element).blur();
        await flush();
        const left = mounted.store.get('$.data.city');
        await typeIn(mounted.element, 'Chur');
        const active = input(mounted.element).hasAttribute('aria-activedescendant');
        await userEvent.keyboard('{Enter}');
        await flush();

        // Assert
        expect(left).toBe('Lugano');
        expect(active).toBe(false);
        expect(mounted.store.get('$.data.city')).toBe('Chur');
        expect(input(mounted.element).value).toBe('Chur');
        expect(isOpen(mounted.element)).toBe(false);
    });

    it('should choose the option over custom text when the arrows made one active', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { allowCustom: true, '<-options': '$.data.cities', '<-value': '$.data.city' }, { data: { cities, city: '' } });
        await flush();
        await typeIn(mounted.element, 'ba');

        // Act
        await userEvent.keyboard('{ArrowDown}{Enter}');
        await flush();

        // Assert
        expect(mounted.store.get('$.data.city')).toBe('ba');
        expect(input(mounted.element).value).toBe('Basel');
    });

    it('should show static labels in German and filter by them', async () => {
        // Arrange
        const locales = { de: { options: { open: { _label: 'Offen' }, done: { _label: 'Erledigt' } } } };
        const mounted = mountComponent('comboboxField', { options: { open: { _label: 'Open' }, done: { _label: 'Done' } }, value: 'done' }, { locales });
        await flush();
        const english = input(mounted.element).value;

        // Act
        mounted.setLocale('de');
        await flush();
        const german = input(mounted.element).value;
        await typeIn(mounted.element, 'erl');

        // Assert
        expect(english).toBe('Done');
        expect(german).toBe('Erledigt');
        expect(optionTexts(mounted.element)).toEqual(['Erledigt']);
        expect(part(mounted.element, 'label').textContent).toBe('Beschriftung');
    });

    it('should show the German hints and error text', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { required: true, maxResults: 1, '<-options': '$.data.cities' }, { data: { cities }, locale: 'de' });
        await flush();

        // Act
        await typeIn(mounted.element, 'e');
        const more = part(mounted.element, '.hint').textContent;
        await typeIn(mounted.element, 'qqq');
        const empty = part(mounted.element, '.hint').textContent;
        commands(mounted.element).validate();
        await flush();

        // Assert
        expect(more).toBe('Weiter tippen, um die Treffer einzugrenzen');
        expect(empty).toBe('Keine Treffer');
        expect(part(mounted.element, '.error').textContent).toBe('Dieses Feld ist erforderlich');
    });

    it('should show a data write, set error to required and clear the value by the clear command', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { required: true, '<-options': '$.data.cities', '<-value': '$.data.city' }, { data: { cities, city: '' } });
        await flush();
        commands(mounted.element).validate();
        const required = get(mounted, 'error');

        // Act
        mounted.store.set('$.data.city', 'zh');
        await flush();
        const shown = input(mounted.element).value;
        commands(mounted.element).clear();
        await flush();

        // Assert
        expect(required).toBe('required');
        expect(shown).toBe('Zürich');
        expect(mounted.store.get('$.data.city')).toBe('');
        expect(input(mounted.element).value).toBe('');
    });

    it('should not open while readonly and be disabled when disabled', async () => {
        // Arrange
        const readonly = mountComponent('comboboxField', { readonly: true, value: 'be', '<-options': '$.data.cities' }, { data: { cities } });
        const disabled = mountComponent('comboboxField', { disabled: true, '<-options': '$.data.cities' }, { data: { cities } });
        await flush();
        input(readonly.element).focus();

        // Act
        await userEvent.keyboard('{ArrowDown}');

        // Assert
        expect(isOpen(readonly.element)).toBe(false);
        expect(input(readonly.element).readOnly).toBe(true);
        expect(input(disabled.element).disabled).toBe(true);
    });
});
