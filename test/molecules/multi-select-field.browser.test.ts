import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

interface CommandElement extends Element {
    commands: { validate(): void; reset(): void; focus(): void; clear(): void };
}

const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const input = (element: Element): HTMLInputElement => part<HTMLInputElement>(element, 'input');
const popup = (element: Element): HTMLElement => part<HTMLElement>(element, '.popup');
const all = <T extends Element>(element: Element, selector: string): T[] => Array.from(element.shadowRoot?.querySelectorAll<T>(selector) ?? []);
const chips = (element: Element): string[] => all(element, '.chip-label').map((chip) => chip.textContent ?? '');
const removeButtons = (element: Element): HTMLButtonElement[] => all<HTMLButtonElement>(element, '.remove');
const optionTexts = (element: Element): string[] => all(element, '.option').map((option) => option.textContent ?? '');
const isOpen = (element: Element): boolean => popup(element).matches(':popover-open');
const get = (mounted: { store: { get(path: string): unknown } }, name: string): unknown => mounted.store.get(`$.app.${name}`);
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const commands = (element: Element): CommandElement['commands'] => (element as CommandElement).commands;
const events = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};

const fruit = [
    { value: 'ap', label: 'Apple' },
    { value: 'ba', label: 'Banana' },
    { value: 'ch', label: 'Cherry' },
    { value: 'fi', label: 'Fig' }
];

async function typeIn(element: Element, text: string): Promise<void> {
    input(element).focus();
    await userEvent.type(input(element), text);
    await flush();
}

const mountFruit = (extra: Record<string, unknown> = {}, tags: string[] = []): ReturnType<typeof mountComponent> =>
    mountComponent('multiSelectField', { '<-options': '$.data.fruit', '<-value': '$.data.picked', ...extra }, { data: { fruit, picked: tags } });

describe('multiSelectField in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render a labelled combobox with a multiselectable listbox and no chips for an empty list', async () => {
        // Arrange
        const mounted = mountFruit({ _label: 'Fruit' });
        await flush();

        // Assert
        expect(part(mounted.element, 'label').textContent).toBe('Fruit');
        expect(input(mounted.element).getAttribute('role')).toBe('combobox');
        expect(input(mounted.element).getAttribute('aria-expanded')).toBe('false');
        expect(popup(mounted.element).getAttribute('role')).toBe('listbox');
        expect(popup(mounted.element).getAttribute('aria-multiselectable')).toBe('true');
        expect(chips(mounted.element)).toEqual([]);
    });

    it('should show the chosen values as chips with remove buttons named Remove {label}', async () => {
        // Arrange
        const mounted = mountFruit({}, ['ap', 'fi']);
        await flush();

        // Assert
        expect(chips(mounted.element)).toEqual(['Apple', 'Fig']);
        expect(removeButtons(mounted.element).map((button) => button.getAttribute('aria-label'))).toEqual(['Remove Apple', 'Remove Fig']);
    });

    it('should add options by the mouse, mark them in the list, keep the list open and write an array through the link', async () => {
        // Arrange
        const mounted = mountFruit();
        await flush();
        const changes = events(mounted.element, 'change');
        input(mounted.element).focus();
        await userEvent.keyboard('{ArrowDown}');

        // Act
        await userEvent.click(all(mounted.element, '.option')[1] as Element);
        await userEvent.click(all(mounted.element, '.option')[3] as Element);
        await flush();

        // Assert
        expect(mounted.store.get('$.data.picked')).toEqual(['ba', 'fi']);
        expect(Array.isArray(mounted.store.get('$.data.picked'))).toBe(true);
        expect(chips(mounted.element)).toEqual(['Banana', 'Fig']);
        expect(all(mounted.element, '.option').map((option) => option.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false', 'true']);
        expect(isOpen(mounted.element)).toBe(true);
        expect(changes).toEqual([{ value: ['ba'] }, { value: ['ba', 'fi'] }]);
    });

    it('should remove a value when its option is pressed again', async () => {
        // Arrange
        const mounted = mountFruit({}, ['ap', 'ba']);
        await flush();
        input(mounted.element).focus();
        await userEvent.keyboard('{ArrowDown}');

        // Act
        await userEvent.click(all(mounted.element, '.option')[0] as Element);
        await flush();

        // Assert
        expect(mounted.store.get('$.data.picked')).toEqual(['ba']);
        expect(chips(mounted.element)).toEqual(['Banana']);
        expect(all(mounted.element, '.option')[0]?.getAttribute('aria-selected')).toBe('false');
    });

    it('should remove a chip with its button', async () => {
        // Arrange
        const mounted = mountFruit({}, ['ap', 'ba', 'ch']);
        await flush();

        // Act
        await userEvent.click(removeButtons(mounted.element)[1] as Element);
        await flush();

        // Assert
        expect(mounted.store.get('$.data.picked')).toEqual(['ap', 'ch']);
        expect(chips(mounted.element)).toEqual(['Apple', 'Cherry']);
        expect((mounted.element.shadowRoot as ShadowRoot).activeElement).toBe(input(mounted.element));
    });

    it('should filter by what is typed, add with the keyboard and clear the text', async () => {
        // Arrange
        const mounted = mountFruit();
        await flush();

        // Act
        await typeIn(mounted.element, 'an');
        const filtered = optionTexts(mounted.element);
        await userEvent.keyboard('{Enter}');
        await flush();
        await userEvent.keyboard('{ArrowDown}');
        await userEvent.keyboard('{Enter}');
        await flush();

        // Assert
        expect(filtered).toEqual(['Banana']);
        expect(mounted.store.get('$.data.picked')).toEqual(['ba', 'ch']);
        expect(input(mounted.element).value).toBe('');
        expect(isOpen(mounted.element)).toBe(true);
    });

    it('should remove the last chip with Backspace in an empty input and not while there is text', async () => {
        // Arrange
        const mounted = mountFruit({}, ['ap', 'ba']);
        await flush();
        input(mounted.element).focus();

        // Act
        await userEvent.keyboard('x');
        await userEvent.keyboard('{Backspace}');
        const afterText = JSON.parse(JSON.stringify(mounted.store.get('$.data.picked'))) as unknown;
        await userEvent.keyboard('{Backspace}');
        await flush();
        const afterEmpty = JSON.parse(JSON.stringify(mounted.store.get('$.data.picked'))) as unknown;
        await userEvent.keyboard('{Backspace}{Backspace}');
        await flush();

        // Assert
        expect(afterText).toEqual(['ap', 'ba']);
        expect(afterEmpty).toEqual(['ap']);
        expect(mounted.store.get('$.data.picked')).toEqual([]);
        expect(chips(mounted.element)).toEqual([]);
    });

    it('should close the list with Escape', async () => {
        // Arrange
        const mounted = mountFruit();
        await flush();
        input(mounted.element).focus();
        await userEvent.keyboard('{ArrowDown}');

        // Act
        await userEvent.keyboard('{Escape}');

        // Assert
        expect(isOpen(mounted.element)).toBe(false);
    });

    it('should add typed text as a value in tag mode on Enter or a comma, trimmed, and ignore duplicates', async () => {
        // Arrange
        const mounted = mountFruit({ allowCustom: true });
        await flush();

        // Act
        await typeIn(mounted.element, '  kiwi  ');
        await userEvent.keyboard('{Enter}');
        await flush();
        await typeIn(mounted.element, 'plum,');
        await typeIn(mounted.element, 'kiwi,');
        await typeIn(mounted.element, 'KIWI{Enter}');
        await flush();

        // Assert
        expect(mounted.store.get('$.data.picked')).toEqual(['kiwi', 'plum', 'KIWI']);
        expect(chips(mounted.element)).toEqual(['kiwi', 'plum', 'KIWI']);
        expect(input(mounted.element).value).toBe('');
    });

    it('should add an option whose label is typed in tag mode instead of a custom value, and not add duplicates', async () => {
        // Arrange
        const mounted = mountFruit({ allowCustom: true });
        await flush();

        // Act
        await typeIn(mounted.element, 'apple,');
        await typeIn(mounted.element, 'Apple,');
        await flush();

        // Assert
        expect(mounted.store.get('$.data.picked')).toEqual(['ap']);
        expect(chips(mounted.element)).toEqual(['Apple']);
    });

    it('should split pasted text at commas in tag mode and leave the last piece in the input', async () => {
        // Arrange
        const mounted = mountFruit({ allowCustom: true });
        await flush();
        input(mounted.element).focus();

        // Act
        await userEvent.fill(input(mounted.element), 'a, b ,c');
        await flush();

        // Assert
        expect(mounted.store.get('$.data.picked')).toEqual(['a', 'b']);
        expect(input(mounted.element).value).toBe('c');
    });

    it('should not add text without allowCustom', async () => {
        // Arrange
        const mounted = mountFruit();
        await flush();

        // Act
        await typeIn(mounted.element, 'kiwi,');
        await userEvent.keyboard('{Enter}');
        await flush();

        // Assert
        expect(mounted.store.get('$.data.picked')).toEqual([]);
    });

    it('should stop adding at maxSelected', async () => {
        // Arrange
        const mounted = mountFruit({ maxSelected: 2, allowCustom: true }, ['ap']);
        await flush();
        input(mounted.element).focus();
        await userEvent.keyboard('{ArrowDown}');

        // Act
        await userEvent.click(all(mounted.element, '.option')[1] as Element);
        await userEvent.click(all(mounted.element, '.option')[2] as Element);
        await typeIn(mounted.element, 'plum,');
        await flush();

        // Assert
        expect(mounted.store.get('$.data.picked')).toEqual(['ap', 'ba']);
        expect(get(mounted, 'error')).toBe('');
    });

    it('should fail minSelected and maxSelected with their messages, in English and German', async () => {
        // Arrange
        const few = mountFruit({ minSelected: 2 }, ['ap']);
        const many = mountFruit({ maxSelected: 1 }, ['ap', 'ba']);
        const german = mountComponent('multiSelectField', { minSelected: 2, value: ['ap'] }, { locale: 'de' });
        await flush();

        // Act
        commands(few.element).validate();
        commands(many.element).validate();
        commands(german.element).validate();
        await flush();

        // Assert
        expect(get(few, 'error')).toBe('minSelected');
        expect(part(few.element, '.error').textContent).toBe('Choose more options');
        expect(get(many, 'error')).toBe('maxSelected');
        expect(part(many.element, '.error').textContent).toBe('Too many options chosen');
        expect(part(german.element, '.error').textContent).toBe('Bitte mehr Optionen wählen');
    });

    it('should set required for an empty list and clear it once a value is added', async () => {
        // Arrange
        const mounted = mountFruit({ required: true });
        await flush();
        commands(mounted.element).validate();
        const required = get(mounted, 'error');

        // Act
        mounted.store.set('$.data.picked', ['ap']);
        commands(mounted.element).validate();
        await flush();

        // Assert
        expect(required).toBe('required');
        expect(get(mounted, 'error')).toBe('');
    });

    it('should show chips and buttons in German and translate static option labels', async () => {
        // Arrange
        const locales = { de: { options: { red: { _label: 'Rot' }, green: { _label: 'Grün' } } } };
        const mounted = mountComponent('multiSelectField', { options: { red: { _label: 'Red' }, green: { _label: 'Green' } }, value: ['green'] }, { locales });
        await flush();
        const english = [chips(mounted.element), removeButtons(mounted.element)[0]?.getAttribute('aria-label')];

        // Act
        mounted.setLocale('de');
        await flush();

        // Assert
        expect(english).toEqual([['Green'], 'Remove Green']);
        expect(chips(mounted.element)).toEqual(['Grün']);
        expect(removeButtons(mounted.element)[0]?.getAttribute('aria-label')).toBe('Grün entfernen');
        expect(part(mounted.element, 'label').textContent).toBe('Beschriftung');
    });

    it('should keep the label of a chip after options is replaced by results without it', async () => {
        // Arrange
        const mounted = mountFruit({}, ['ba']);
        await flush();

        // Act
        mounted.store.set('$.data.fruit', [{ value: 'zz', label: 'Zucchini' }]);
        await flush();

        // Assert
        expect(chips(mounted.element)).toEqual(['Banana']);
    });

    it('should raise query as the user types, as the combobox does', async () => {
        // Arrange
        const mounted = mountFruit();
        await flush();
        const queries = events(mounted.element, 'query');

        // Act
        await typeIn(mounted.element, 'ch');
        await new Promise((resolve) => setTimeout(resolve, 400));

        // Assert
        expect(queries).toEqual(['ch']);
        expect(get(mounted, 'busy')).toBe(true);
    });

    it('should show a data write, empty by the clear command and not change while readonly', async () => {
        // Arrange
        const mounted = mountFruit({}, ['ap']);
        const locked = mountFruit({ readonly: true }, ['ap']);
        await flush();

        // Act
        mounted.store.set('$.data.picked', ['ba', 'ch']);
        await flush();
        const written = chips(mounted.element);
        commands(mounted.element).clear();
        await flush();
        input(locked.element).focus();
        await userEvent.keyboard('{Backspace}{ArrowDown}');
        await flush();

        // Assert
        expect(written).toEqual(['Banana', 'Cherry']);
        expect(mounted.store.get('$.data.picked')).toEqual([]);
        expect(chips(mounted.element)).toEqual([]);
        expect(locked.store.get('$.data.picked')).toEqual(['ap']);
        expect(isOpen(locked.element)).toBe(false);
        expect(removeButtons(locked.element)[0]?.disabled).toBe(true);
    });
});
