import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const control = (element: Element): HTMLSelectElement => element.shadowRoot?.querySelector('select') as HTMLSelectElement;
const labels = (element: Element): string[] => Array.from(control(element).options).map((option) => option.text);
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface CommandElement extends Element {
    commands: { validate(): void; reset(): void; focus(): void; clear(): void };
}

const commands = (element: Element): CommandElement['commands'] => (element as CommandElement).commands;
const statuses = [
    { value: 'open', label: 'Open' },
    { value: 'done', label: 'Done' }
];
const choose = (select: HTMLSelectElement, ...values: string[]): void => {
    for (const option of Array.from(select.options)) option.selected = values.includes(option.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('selectField in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should list $.data.statuses, select the linked value and write the choice back', async () => {
        // Arrange
        const mounted = mountComponent('selectField', { _label: 'Status', '<-options': '$.data.statuses', '<-value': '$.data.current' }, { data: { statuses, current: 'done' } });
        mounted.store.set('$.data.statuses', statuses);
        mounted.store.set('$.data.current', 'done');
        await flush();
        const before = control(mounted.element).value;

        // Act
        choose(control(mounted.element), 'open');

        // Assert
        expect(labels(mounted.element)).toEqual(['Open', 'Done']);
        expect(before).toBe('done');
        expect(mounted.store.get('$.data.current')).toBe('open');
        expect(mounted.element.shadowRoot?.querySelector('label')?.textContent).toBe('Status');
    });

    it('should show an option added to the data', async () => {
        // Arrange
        const mounted = mountComponent('selectField', { '<-options': '$.data.statuses' }, { data: { statuses } });
        mounted.store.set('$.data.statuses', statuses);
        await flush();

        // Act
        mounted.store.set('$.data.statuses', [...statuses, { value: 'late', label: 'Late' }]);
        await flush();

        // Assert
        expect(labels(mounted.element)).toEqual(['Open', 'Done', 'Late']);
    });

    it('should translate a static map into German and leave data labels alone', async () => {
        // Arrange
        const locales = { de: { options: { open: { _label: 'Offen' }, done: { _label: 'Erledigt' } } } };
        const fixed = mountComponent('selectField', { options: { open: { _label: 'Open' }, done: { _label: 'Done' } } }, { locales });
        const linked = mountComponent('selectField', { '<-options': '$.data.statuses' }, { data: { statuses }, locales: { de: {} } });
        linked.store.set('$.data.statuses', statuses);

        // Act
        fixed.setLocale('de');
        linked.setLocale('de');
        await flush();

        // Assert
        expect(labels(fixed.element)).toEqual(['Offen', 'Erledigt']);
        expect(labels(linked.element)).toEqual(['Open', 'Done']);
        expect(fixed.element.shadowRoot?.querySelector('label')?.textContent).toBe('Beschriftung');
    });

    it('should honour optionValue, optionLabel and multiple', async () => {
        // Arrange
        const rows = [{ id: 1, name: 'One' }, { id: 2, name: 'Two' }, { id: 3, name: 'Three' }];
        const mounted = mountComponent('selectField', { multiple: true, optionValue: 'id', optionLabel: 'name', '<-options': '$.data.rows', '<-value': '$.data.picked' }, { data: { rows, picked: [2] } });
        mounted.store.set('$.data.rows', rows);
        mounted.store.set('$.data.picked', [2]);
        await flush();
        const before = Array.from(control(mounted.element).selectedOptions).map((option) => option.text);

        // Act
        choose(control(mounted.element), '1', '3');

        // Assert
        expect(before).toEqual(['Two']);
        expect(mounted.store.get('$.data.picked')).toEqual([1, 3]);
    });

    it('should set error to required when nothing is selected, and clear it once something is', async () => {
        // Arrange
        const mounted = mountComponent('selectField', { required: true, options: { a: { _label: 'A' } }, value: '' });
        await flush();

        // Act
        commands(mounted.element).validate();
        const failed = mounted.store.get('$.app.error');
        const message = mounted.element.shadowRoot?.querySelector('.error')?.textContent;
        choose(control(mounted.element), 'a');
        commands(mounted.element).validate();

        // Assert
        expect(failed).toBe('required');
        expect(message).toBe('This field is required');
        expect(mounted.store.get('$.app.error')).toBe('');
    });

    it('should fail required for an empty multiple selection', async () => {
        // Arrange
        const mounted = mountComponent('selectField', { required: true, multiple: true, options: { a: { _label: 'A' } }, value: [] });
        await flush();

        // Act
        commands(mounted.element).validate();

        // Assert
        expect(mounted.store.get('$.app.error')).toBe('required');
    });

    it('should restore the baseline with reset, empty with clear and mark dirty', async () => {
        // Arrange
        const mounted = mountComponent('selectField', { options: { a: { _label: 'A' }, b: { _label: 'B' } }, value: 'a' });
        await flush();
        choose(control(mounted.element), 'b');
        const dirty = mounted.store.get('$.app.dirty');

        // Act
        commands(mounted.element).reset();
        await flush();
        const reset = control(mounted.element).value;
        commands(mounted.element).clear();
        await flush();

        // Assert
        expect(dirty).toBe(true);
        expect(reset).toBe('a');
        expect(mounted.store.get('$.app.value')).toBe('');
        expect(control(mounted.element).selectedIndex).toBe(-1);
    });

    it('should raise change with the value, and disable the select from disabled', async () => {
        // Arrange
        const mounted = mountComponent('selectField', { options: { a: { _label: 'A' } } });
        const seen: unknown[] = [];
        mounted.element.addEventListener('change', (event) => seen.push((event as CustomEvent).detail));
        await flush();

        // Act
        choose(control(mounted.element), 'a');
        mounted.store.set('$.app.disabled', true);

        // Assert
        expect(seen).toEqual([{ value: 'a' }]);
        expect(control(mounted.element).disabled).toBe(true);
    });

    it('should move focus to the select with the focus command', async () => {
        // Arrange
        const mounted = mountComponent('selectField', { options: { a: { _label: 'A' } } });
        await flush();

        // Act
        commands(mounted.element).focus();

        // Assert
        expect(mounted.element.shadowRoot?.activeElement).toBe(control(mounted.element));
    });
});
