import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const radios = (element: Element): HTMLInputElement[] => Array.from(element.shadowRoot?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? []);
const labels = (element: Element): string[] => Array.from(element.shadowRoot?.querySelectorAll('.text') ?? []).map((text) => text.textContent ?? '');
const checked = (element: Element): string[] => radios(element).filter((radio) => radio.checked).map((radio) => radio.value);
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface CommandElement extends Element {
    commands: { validate(): void; reset(): void; focus(): void; clear(): void };
}

const commands = (element: Element): CommandElement['commands'] => (element as CommandElement).commands;
const statuses = [
    { value: 'open', label: 'Open' },
    { value: 'done', label: 'Done' }
];

describe('radioField in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should list $.data.statuses as a radiogroup, check the linked value and write a click back', async () => {
        // Arrange
        const mounted = mountComponent('radioField', { _label: 'Status', '<-options': '$.data.statuses', '<-value': '$.data.current' }, { data: { statuses, current: 'done' } });
        mounted.store.set('$.data.statuses', statuses);
        mounted.store.set('$.data.current', 'done');
        await flush();
        const before = checked(mounted.element);

        // Act
        radios(mounted.element)[0]?.click();

        // Assert
        expect(part(mounted.element, '[role="radiogroup"]')).not.toBeNull();
        expect(labels(mounted.element)).toEqual(['Open', 'Done']);
        expect(before).toEqual(['done']);
        expect(mounted.store.get('$.data.current')).toBe('open');
        expect(part(mounted.element, '[role="radiogroup"]').getAttribute('aria-labelledby')).toBe('label');
    });

    it('should show an option added to the data and follow a data write', async () => {
        // Arrange
        const mounted = mountComponent('radioField', { '<-options': '$.data.statuses', '<-value': '$.data.current' }, { data: { statuses, current: 'open' } });
        mounted.store.set('$.data.statuses', statuses);
        mounted.store.set('$.data.current', 'open');
        await flush();

        // Act
        mounted.store.set('$.data.statuses', [...statuses, { value: 'late', label: 'Late' }]);
        mounted.store.set('$.data.current', 'late');
        await flush();

        // Assert
        expect(labels(mounted.element)).toEqual(['Open', 'Done', 'Late']);
        expect(checked(mounted.element)).toEqual(['late']);
    });

    it('should translate a static map into German and leave data labels alone', async () => {
        // Arrange
        const locales = { de: { options: { open: { _label: 'Offen' }, done: { _label: 'Erledigt' } } } };
        const fixed = mountComponent('radioField', { options: { open: { _label: 'Open' }, done: { _label: 'Done' } } }, { locales });
        const linked = mountComponent('radioField', { '<-options': '$.data.statuses' }, { data: { statuses }, locales: { de: {} } });
        linked.store.set('$.data.statuses', statuses);

        // Act
        fixed.setLocale('de');
        linked.setLocale('de');
        await flush();

        // Assert
        expect(labels(fixed.element)).toEqual(['Offen', 'Erledigt']);
        expect(labels(linked.element)).toEqual(['Open', 'Done']);
        expect(part(fixed.element, 'label').textContent).toBe('Beschriftung');
    });

    it('should move the choice with the arrow keys and write the linked value', async () => {
        // Arrange
        const mounted = mountComponent('radioField', { options: { a: { _label: 'A' }, b: { _label: 'B' }, c: { _label: 'C' } }, '<-value': '$.data.pick' }, { data: { pick: 'a' } });
        mounted.store.set('$.data.pick', 'a');
        await flush();
        radios(mounted.element)[0]?.focus();

        // Act
        await userEvent.keyboard('{ArrowDown}');

        // Assert
        expect(mounted.store.get('$.data.pick')).toBe('b');
        expect(checked(mounted.element)).toEqual(['b']);
    });

    it('should keep a numeric value a number with optionValue and optionLabel', async () => {
        // Arrange
        const rows = [{ id: 1, name: 'One' }, { id: 2, name: 'Two' }];
        const mounted = mountComponent('radioField', { optionValue: 'id', optionLabel: 'name', '<-options': '$.data.rows', '<-value': '$.data.picked' }, { data: { rows, picked: 0 } });
        mounted.store.set('$.data.rows', rows);
        await flush();

        // Act
        radios(mounted.element)[1]?.click();

        // Assert
        expect(labels(mounted.element)).toEqual(['One', 'Two']);
        expect(mounted.store.get('$.data.picked')).toBe(2);
    });

    it('should lay the options out in a column, or in a row with orientation horizontal', async () => {
        // Arrange
        const options = { a: { _label: 'A' }, b: { _label: 'B' } };
        const mounted = mountComponent('radioField', { options });
        await flush();
        const [first, second] = radios(mounted.element);
        const vertical = (second as HTMLElement).getBoundingClientRect().top > (first as HTMLElement).getBoundingClientRect().top;

        // Act
        mounted.store.set('$.app.orientation', 'horizontal');
        await flush();

        // Assert
        expect(vertical).toBe(true);
        expect(mounted.element.getAttribute('orientation')).toBe('horizontal');
        expect((second as HTMLElement).getBoundingClientRect().top).toBe((first as HTMLElement).getBoundingClientRect().top);
        expect((second as HTMLElement).getBoundingClientRect().left).toBeGreaterThan((first as HTMLElement).getBoundingClientRect().left);
    });

    it('should set error to required when nothing is selected and clear it after a choice', async () => {
        // Arrange
        const mounted = mountComponent('radioField', { required: true, options: { a: { _label: 'A' } } });
        await flush();

        // Act
        commands(mounted.element).validate();
        const failed = mounted.store.get('$.app.error');
        const message = part(mounted.element, '.error')?.textContent;
        radios(mounted.element)[0]?.click();
        commands(mounted.element).validate();

        // Assert
        expect(failed).toBe('required');
        expect(message).toBe('This field is required');
        expect(mounted.store.get('$.app.error')).toBe('');
        expect(part(mounted.element, '[role="radiogroup"]').getAttribute('aria-required')).toBe('true');
    });

    it('should restore the baseline with reset and empty with clear', async () => {
        // Arrange
        const mounted = mountComponent('radioField', { options: { a: { _label: 'A' }, b: { _label: 'B' } }, value: 'a' });
        await flush();
        radios(mounted.element)[1]?.click();
        const dirty = mounted.store.get('$.app.dirty');

        // Act
        commands(mounted.element).reset();
        await flush();
        const reset = checked(mounted.element);
        commands(mounted.element).clear();
        await flush();

        // Assert
        expect(dirty).toBe(true);
        expect(reset).toEqual(['a']);
        expect(checked(mounted.element)).toEqual([]);
        expect(mounted.store.get('$.app.value')).toBe('');
    });

    it('should raise change, disable every radio and ignore a click while readonly', async () => {
        // Arrange
        const mounted = mountComponent('radioField', { options: { a: { _label: 'A' }, b: { _label: 'B' } }, value: 'a' });
        const seen: unknown[] = [];
        mounted.element.addEventListener('change', (event) => seen.push((event as CustomEvent).detail));
        await flush();
        radios(mounted.element)[1]?.click();
        mounted.store.set('$.app.readonly', true);

        // Act
        radios(mounted.element)[0]?.click();
        await flush();
        const afterReadonly = mounted.store.get('$.app.value');
        mounted.store.set('$.app.disabled', true);

        // Assert
        expect(seen).toEqual([{ value: 'b' }]);
        expect(afterReadonly).toBe('b');
        expect(checked(mounted.element)).toEqual(['b']);
        expect(radios(mounted.element).every((radio) => radio.disabled)).toBe(true);
    });

    it('should move focus to the checked radio with the focus command', async () => {
        // Arrange
        const mounted = mountComponent('radioField', { options: { a: { _label: 'A' }, b: { _label: 'B' } }, value: 'b' });
        await flush();

        // Act
        commands(mounted.element).focus();

        // Assert
        expect(mounted.element.shadowRoot?.activeElement).toBe(radios(mounted.element)[1]);
    });
});
