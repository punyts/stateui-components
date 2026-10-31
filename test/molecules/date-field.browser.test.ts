import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

interface CommandElement extends Element {
    commands: { validate(): void; reset(): void; clear(): void };
}

const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const control = (element: Element): HTMLInputElement => part<HTMLInputElement>(element, 'input');
const commands = (element: Element): CommandElement['commands'] => (element as CommandElement).commands;
const rect = (element: Element): DOMRect => element.getBoundingClientRect();

describe('dateField in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should use the date input and pass min and max to it', () => {
        // Arrange
        const mounted = mountComponent('dateField', { min: '2026-01-01', max: '2026-12-31' });

        // Act
        const input = control(mounted.element);

        // Assert
        expect(input.type).toBe('date');
        expect(input.min).toBe('2026-01-01');
        expect(input.max).toBe('2026-12-31');
    });

    it('should write $.data as an ISO date string when the user types a date', async () => {
        // Arrange
        const mounted = mountComponent('dateField', { '<-value': '$.data.due' }, { data: { due: '' } });

        // Act
        control(mounted.element).focus();
        await userEvent.keyboard('03152026');

        // Assert
        expect(mounted.store.get('$.data.due')).toBe('2026-03-15');
    });

    it('should show a data write in the input', () => {
        // Arrange
        const mounted = mountComponent('dateField', { '<-value': '$.data.due' }, { data: { due: '2026-01-02' } });

        // Act
        mounted.store.set('$.data.due', '2027-05-06');

        // Assert
        expect(control(mounted.element).value).toBe('2027-05-06');
    });

    it('should set error to min for a date before min and max for a date after max', () => {
        // Arrange
        const mounted = mountComponent('dateField', { min: '2026-02-01', max: '2026-02-28', value: '2026-01-31' });

        // Act
        commands(mounted.element).validate();
        const early = mounted.store.get('$.app.error');
        mounted.store.set('$.app.value', '2026-03-01');
        commands(mounted.element).validate();
        const late = mounted.store.get('$.app.error');
        mounted.store.set('$.app.value', '2026-02-10');
        commands(mounted.element).validate();

        // Assert
        expect(early).toBe('min');
        expect(late).toBe('max');
        expect(mounted.store.get('$.app.error')).toBe('');
    });

    it('should accept the boundary dates', () => {
        // Arrange
        const mounted = mountComponent('dateField', { min: '2026-02-01', max: '2026-02-28', value: '2026-02-01' });

        // Act
        commands(mounted.element).validate();
        const first = mounted.store.get('$.app.error');
        mounted.store.set('$.app.value', '2026-02-28');
        commands(mounted.element).validate();

        // Assert
        expect(first).toBe('');
        expect(mounted.store.get('$.app.error')).toBe('');
    });

    it('should fail required for an empty date and show the message', () => {
        // Arrange
        const mounted = mountComponent('dateField', { required: true });

        // Act
        commands(mounted.element).validate();

        // Assert
        expect(mounted.store.get('$.app.error')).toBe('required');
        expect(part(mounted.element, '.error')?.textContent).toBe('This field is required');
    });

    it('should raise invalid and valid, restore the baseline on reset and lock through locked', () => {
        // Arrange
        const mounted = mountComponent('dateField', { min: '2026-02-01', value: '2026-02-05' });
        const seen: string[] = [];
        mounted.element.addEventListener('invalid', () => seen.push('invalid'));
        mounted.element.addEventListener('valid', () => seen.push('valid'));

        // Act
        mounted.store.set('$.app.value', '2026-01-01');
        commands(mounted.element).validate();
        mounted.store.set('$.app.value', '2026-02-09');
        commands(mounted.element).validate();
        commands(mounted.element).reset();
        const restored = control(mounted.element).value;
        mounted.store.set('$.app.locked', true);

        // Assert
        expect(seen).toEqual(['invalid', 'valid']);
        expect(restored).toBe('2026-02-05');
        expect(control(mounted.element).disabled).toBe(true);
    });

    it('should empty the value with the clear command', () => {
        // Arrange
        const mounted = mountComponent('dateField', { value: '2026-02-05' });

        // Act
        commands(mounted.element).clear();

        // Assert
        expect(mounted.store.get('$.app.value')).toBe('');
        expect(control(mounted.element).value).toBe('');
    });

    it('should place the label for titlePosition as textField does', () => {
        // Arrange
        const mounted = mountComponent('dateField', { titlePosition: 'top' });
        const label = (): DOMRect => rect(part(mounted.element, 'label'));
        const box = (): DOMRect => rect(control(mounted.element));

        // Act
        const top = label().bottom <= box().top;
        mounted.store.set('$.app.titlePosition', 'left');
        const left = label().right <= box().left;
        mounted.store.set('$.app.titlePosition', 'hidden');

        // Assert
        expect(top).toBe(true);
        expect(left).toBe(true);
        expect(label().width).toBeLessThanOrEqual(1);
        expect(mounted.element.getAttribute('title-position')).toBe('hidden');
    });

    it('should render the error and link help and error to the control', () => {
        // Arrange
        const mounted = mountComponent('dateField', { _help: 'Hint' });

        // Act
        mounted.store.set('$.app.error', 'max');

        // Assert
        expect(part(mounted.element, '.error')?.textContent).toBe('Too late');
        expect(control(mounted.element).getAttribute('aria-describedby')).toBe('help error');
        expect(control(mounted.element).getAttribute('aria-invalid')).toBe('true');
    });

    it('should show the German label and error after switching language', () => {
        // Arrange
        const mounted = mountComponent('dateField', { min: '2026-02-01', value: '2026-01-01' });
        commands(mounted.element).validate();

        // Act
        mounted.setLocale('de');

        // Assert
        expect(part(mounted.element, 'label').textContent).toBe('Datum');
        expect(part(mounted.element, '.error')?.textContent).toBe('Zu früh');
    });
});
