import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

interface CommandElement extends Element {
    commands: { validate(): void; reset(): void; clear(): void; focus(): void };
}

const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const control = (element: Element): HTMLInputElement => part<HTMLInputElement>(element, 'input');
const commands = (element: Element): CommandElement['commands'] => (element as CommandElement).commands;

const record = (element: Element, name: string): unknown[] => {
    const details: unknown[] = [];
    element.addEventListener(name, (event) => details.push((event as CustomEvent).detail));
    return details;
};

describe('timeField in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should use the time input, labelled, with min, max and step passed to it', () => {
        // Arrange
        const mounted = mountComponent('timeField', { min: '09:00', max: '17:30', step: 900, _label: 'Start' });

        // Act
        const input = control(mounted.element);

        // Assert
        expect(input.type).toBe('time');
        expect(input.min).toBe('09:00');
        expect(input.max).toBe('17:30');
        expect(input.step).toBe('900');
        expect(input.labels?.[0]?.textContent).toBe('Start');
    });

    it('should write $.data as HH:MM and raise change when the user types a time', async () => {
        // Arrange
        const mounted = mountComponent('timeField', { '<-value': '$.data.start' }, { data: { start: '' } });
        const changes = record(mounted.element, 'change');

        // Act
        control(mounted.element).focus();
        await userEvent.keyboard('0930AM');

        // Assert
        expect(mounted.store.get('$.data.start')).toBe('09:30');
        expect(changes.at(-1)).toEqual({ value: '09:30' });
    });

    it('should show a data write in the input', () => {
        // Arrange
        const mounted = mountComponent('timeField', { '<-value': '$.data.start' }, { data: { start: '08:00' } });

        // Act
        mounted.store.set('$.data.start', '13:45');

        // Assert
        expect(control(mounted.element).value).toBe('13:45');
    });

    it('should set error to min before min, max after max and accept the boundaries', () => {
        // Arrange
        const mounted = mountComponent('timeField', { min: '09:00', max: '17:00', value: '08:59' });

        // Act
        commands(mounted.element).validate();
        const early = mounted.store.get('$.app.error');
        mounted.store.set('$.app.value', '17:01');
        commands(mounted.element).validate();
        const late = mounted.store.get('$.app.error');
        mounted.store.set('$.app.value', '17:00');
        commands(mounted.element).validate();

        // Assert
        expect(early).toBe('min');
        expect(late).toBe('max');
        expect(mounted.store.get('$.app.error')).toBe('');
        expect(part(mounted.element, '.error')).toBeNull();
    });

    it('should fail required for an empty time, show the message and mark the input invalid', () => {
        // Arrange
        const mounted = mountComponent('timeField', { required: true });

        // Act
        commands(mounted.element).validate();

        // Assert
        expect(mounted.store.get('$.app.error')).toBe('required');
        expect(part(mounted.element, '.error')?.textContent).toBe('This field is required');
        expect(control(mounted.element).getAttribute('aria-invalid')).toBe('true');
        expect(control(mounted.element).getAttribute('aria-required')).toBe('true');
        expect(control(mounted.element).getAttribute('aria-describedby')).toBe('error');
    });

    it('should focus the input, empty it on clear and restore the baseline on reset', () => {
        // Arrange
        const mounted = mountComponent('timeField', { value: '10:15' });

        // Act
        commands(mounted.element).focus();
        const focused = mounted.element.shadowRoot?.activeElement;
        commands(mounted.element).clear();
        const cleared = control(mounted.element).value;
        commands(mounted.element).reset();

        // Assert
        expect(focused).toBe(control(mounted.element));
        expect(cleared).toBe('');
        expect(control(mounted.element).value).toBe('10:15');
    });

    it('should disable the input when disabled or locked and make it read-only with readonly', () => {
        // Arrange
        const disabled = mountComponent('timeField', { disabled: true });
        const readonly = mountComponent('timeField', { readonly: true });
        const locked = mountComponent('timeField', {});

        // Act
        locked.store.set('$.app.locked', true);

        // Assert
        expect(control(disabled.element).disabled).toBe(true);
        expect(control(readonly.element).readOnly).toBe(true);
        expect(control(readonly.element).disabled).toBe(false);
        expect(control(locked.element).disabled).toBe(true);
    });

    it('should show the German label and error after switching language', () => {
        // Arrange
        const mounted = mountComponent('timeField', { max: '12:00', value: '13:00' });
        commands(mounted.element).validate();

        // Act
        mounted.setLocale('de');

        // Assert
        expect(part(mounted.element, 'label').textContent).toBe('Uhrzeit');
        expect(part(mounted.element, '.error')?.textContent).toBe('Zu spät');
    });
});
