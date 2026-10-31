import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const control = (element: Element): HTMLSelectElement => element.shadowRoot?.querySelector('select') as HTMLSelectElement;
const labels = (element: Element): string[] => Array.from(control(element).options).map((option) => option.text);
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type Commanded = Element & { commands: Record<string, () => void> };

const statuses = [
    { value: 'open', label: 'Open' },
    { value: 'done', label: 'Done' }
];

const choose = (select: HTMLSelectElement, ...values: string[]): void => {
    for (const option of Array.from(select.options)) option.selected = values.includes(option.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('select in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should list the options of $.data.statuses and select the linked value', async () => {
        // Arrange
        const mounted = mountComponent('select', { '<-options': '$.data.statuses', value: 'done' }, { data: { statuses } });
        mounted.store.set('$.data.statuses', statuses);

        // Act
        await flush();

        // Assert
        expect(labels(mounted.element)).toEqual(['Open', 'Done']);
        expect(control(mounted.element).value).toBe('done');
    });

    it('should follow data written to the options and to the value', async () => {
        // Arrange
        const mounted = mountComponent('select', { '<-options': '$.data.statuses', '<-value': '$.data.current' }, { data: { statuses, current: 'open' } });
        mounted.store.set('$.data.statuses', statuses);
        mounted.store.set('$.data.current', 'open');
        await flush();

        // Act
        mounted.store.set('$.data.current', 'done');
        mounted.store.set('$.data.statuses', [...statuses, { value: 'late', label: 'Late' }]);
        await flush();

        // Assert
        expect(labels(mounted.element)).toEqual(['Open', 'Done', 'Late']);
        expect(control(mounted.element).value).toBe('done');
    });

    it('should honour optionValue and optionLabel and keep a numeric value a number', async () => {
        // Arrange
        const rows = [{ id: 1, name: 'One' }, { id: 2, name: 'Two' }];
        const mounted = mountComponent('select', { optionValue: 'id', optionLabel: 'name', '<-options': '$.data.rows', '<-value': '$.data.picked' }, { data: { rows, picked: 0 } });
        mounted.store.set('$.data.rows', rows);
        await flush();

        // Act
        choose(control(mounted.element), '2');

        // Assert
        expect(labels(mounted.element)).toEqual(['One', 'Two']);
        expect(mounted.store.get('$.data.picked')).toBe(2);
    });

    it('should show a static value set at mount once the options have rendered', async () => {
        // Arrange
        const options = { open: { _label: 'Open' }, done: { _label: 'Done' } };

        // Act
        const mounted = mountComponent('select', { options, value: 'done' });
        await flush();

        // Assert
        expect(labels(mounted.element)).toEqual(['Open', 'Done']);
        expect(control(mounted.element).value).toBe('done');
    });

    it('should show a static value and a static multiple selection at mount', async () => {
        // Arrange
        const options = { a: { _label: 'A' }, b: { _label: 'B' }, c: { _label: 'C' } };

        // Act
        const mounted = mountComponent('select', { options, multiple: true, value: ['a', 'c'] });
        await flush();

        // Assert
        expect(Array.from(control(mounted.element).selectedOptions).map((option) => option.value)).toEqual(['a', 'c']);
    });

    it('should list a static map by key and write the key when selected', async () => {
        // Arrange
        const mounted = mountComponent('select', { options: { open: { _label: 'Open' }, done: { _label: 'Done' } }, '<-value': '$.data.status' }, { data: { status: '' } });
        mounted.store.set('$.data.status', '');
        const seen: unknown[] = [];
        mounted.element.addEventListener('change', (event) => seen.push([(event as CustomEvent).detail, mounted.store.get('$.data.status')]));
        await flush();

        // Act
        choose(control(mounted.element), 'done');

        // Assert
        expect(labels(mounted.element)).toEqual(['Open', 'Done']);
        expect(mounted.store.get('$.data.status')).toBe('done');
        expect(seen).toEqual([['done', 'done']]);
    });

    it('should translate the labels of a static map and leave data labels alone', async () => {
        // Arrange
        const locales = { de: { options: { open: { _label: 'Offen' }, done: { _label: 'Erledigt' } } } };
        const fixed = mountComponent('select', { options: { open: { _label: 'Open' }, done: { _label: 'Done' } } }, { locales });
        const linked = mountComponent('select', { '<-options': '$.data.statuses' }, { data: { statuses }, locales: { de: {} } });
        linked.store.set('$.data.statuses', statuses);

        // Act
        fixed.setLocale('de');
        linked.setLocale('de');
        await flush();

        // Assert
        expect(labels(fixed.element)).toEqual(['Offen', 'Erledigt']);
        expect(labels(linked.element)).toEqual(['Open', 'Done']);
        expect(control(fixed.element).getAttribute('aria-label')).toBe('Auswahl');
    });

    it('should write an array of values with multiple', async () => {
        // Arrange
        const mounted = mountComponent(
            'select',
            { multiple: true, options: { a: { _label: 'A' }, b: { _label: 'B' }, c: { _label: 'C' } }, '<-value': '$.data.picked' },
            { data: { picked: ['b'] } }
        );
        mounted.store.set('$.data.picked', ['b']);
        await flush();
        const before = Array.from(control(mounted.element).selectedOptions).map((option) => option.value);

        // Act
        choose(control(mounted.element), 'a', 'c');

        // Assert
        expect(before).toEqual(['b']);
        expect(mounted.store.get('$.data.picked')).toEqual(['a', 'c']);
    });

    it('should empty the value with clear and move focus with focus', async () => {
        // Arrange
        const single = mountComponent('select', { options: { a: { _label: 'A' } }, value: 'a' });
        const many = mountComponent('select', { multiple: true, options: { a: { _label: 'A' } }, value: ['a'] });
        await flush();

        // Act
        (single.element as Commanded).commands.clear?.();
        (many.element as Commanded).commands.clear?.();
        (single.element as Commanded).commands.focus?.();
        await flush();

        // Assert
        expect(single.store.get('$.app.value')).toBe('');
        expect(many.store.get('$.app.value')).toEqual([]);
        expect(control(single.element).selectedIndex).toBe(-1);
        expect(single.element.shadowRoot?.activeElement).toBe(control(single.element));
    });

    it('should change colours in the dark overlay', () => {
        // Arrange
        const mounted = mountComponent('select', {}, { mode: 'light' });
        const light = getComputedStyle(control(mounted.element)).backgroundColor;

        // Act
        mounted.setTheme('mode', 'dark');

        // Assert
        expect(getComputedStyle(control(mounted.element)).backgroundColor).not.toBe(light);
    });

    it('should disable the select and size it with size', () => {
        // Arrange
        const mounted = mountComponent('select', { disabled: true, size: 'sm' });
        const small = control(mounted.element).offsetHeight;

        // Act
        mounted.store.set('$.app.size', 'lg');

        // Assert
        expect(control(mounted.element).disabled).toBe(true);
        expect(control(mounted.element).offsetHeight).toBeGreaterThan(small);
    });
});
