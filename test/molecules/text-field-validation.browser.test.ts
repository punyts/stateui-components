import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

interface CommandElement extends Element {
    commands: { validate(): void; reset(): void };
}

const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const control = (element: Element): HTMLInputElement => part<HTMLInputElement>(element, 'input');
const commands = (element: Element): CommandElement['commands'] => (element as CommandElement).commands;
const errorOf = (mounted: { store: { get(path: string): unknown } }): unknown => mounted.store.get('$.app.error');
const touch = (element: Element): void => {
    control(element).focus();
    control(element).blur();
};

describe('textField validation in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it.each([
        ['required', { required: true }, ''],
        ['minLength', { minLength: 3 }, 'ab'],
        ['maxLength', { maxLength: 3 }, 'abcd'],
        ['min', { min: 5 }, '4'],
        ['max', { max: 5 }, '6'],
        ['pattern', { pattern: 'email' }, 'nobody']
    ])('should set error to %s when validate finds that rule failing', (rule, settings, value) => {
        // Arrange
        const mounted = mountComponent('textField', { ...settings, value });

        // Act
        commands(mounted.element).validate();

        // Assert
        expect(errorOf(mounted)).toBe(rule);
        expect(part(mounted.element, '.error')?.textContent).not.toBe('');
    });

    it('should leave error empty when every rule passes', () => {
        // Arrange
        const mounted = mountComponent('textField', { required: true, minLength: 2, pattern: 'alphanumeric', value: 'Ada' });

        // Act
        commands(mounted.element).validate();

        // Assert
        expect(errorOf(mounted)).toBe('');
        expect(part(mounted.element, '.error')).toBeNull();
    });

    it('should hold the first failing rule when several fail', () => {
        // Arrange
        const mounted = mountComponent('textField', { minLength: 5, maxLength: 2, pattern: 'integer', value: 'abc' });

        // Act
        commands(mounted.element).validate();

        // Assert
        expect(errorOf(mounted)).toBe('minLength');
    });

    it('should accept a regular expression for pattern', () => {
        // Arrange
        const mounted = mountComponent('textField', { pattern: '[A-Z]{2}[0-9]{2}', value: 'AB12' });

        // Act
        commands(mounted.element).validate();
        const good = errorOf(mounted);
        mounted.store.set('$.app.value', 'ab12');
        commands(mounted.element).validate();

        // Assert
        expect(good).toBe('');
        expect(errorOf(mounted)).toBe('pattern');
    });

    it('should refuse to mount a node whose pattern is a nested quantifier', () => {
        // Act
        const mount = (): unknown => mountComponent('textField', { pattern: '(a+)+' });

        // Assert
        expect(mount).toThrow(/SUI-STATE/);
    });

    it('should refuse to mount a node that sets a runtime property', () => {
        // Act
        const mount = (): unknown => mountComponent('textField', { touched: true });

        // Assert
        expect(mount).toThrow(/SUI-STATE-RUNTIME/);
    });

    it('should set touched on blur and not before', () => {
        // Arrange
        const mounted = mountComponent('textField');
        const before = mounted.store.get('$.app.touched');

        // Act
        touch(mounted.element);

        // Assert
        expect(before).toBe(false);
        expect(mounted.store.get('$.app.touched')).toBe(true);
    });

    it('should set dirty when the value differs from the baseline and clear it when it matches again', async () => {
        // Arrange
        const mounted = mountComponent('textField', { value: 'Jo' });
        const initial = mounted.store.get('$.app.dirty');

        // Act
        await userEvent.type(control(mounted.element), 'e');
        const typed = mounted.store.get('$.app.dirty');
        mounted.store.set('$.app.value', 'Jo');

        // Assert
        expect(initial).toBe(false);
        expect(typed).toBe(true);
        expect(mounted.store.get('$.app.dirty')).toBe(false);
    });

    it('should not validate on change before the field is touched', async () => {
        // Arrange
        const mounted = mountComponent('textField', { minLength: 3 });

        // Act
        await userEvent.type(control(mounted.element), 'a');

        // Assert
        expect(errorOf(mounted)).toBe('');
    });

    it('should validate on every change once touched', async () => {
        // Arrange
        const mounted = mountComponent('textField', { minLength: 3 });
        touch(mounted.element);

        // Act
        await userEvent.type(control(mounted.element), 'ab');
        const short = errorOf(mounted);
        await userEvent.type(control(mounted.element), 'c');

        // Assert
        expect(short).toBe('minLength');
        expect(errorOf(mounted)).toBe('');
    });

    it('should raise change with the value on every committed change', async () => {
        // Arrange
        const mounted = mountComponent('textField');
        const details: unknown[] = [];
        mounted.element.addEventListener('change', (event) => details.push((event as CustomEvent).detail));

        // Act
        await userEvent.type(control(mounted.element), 'ab');

        // Assert
        expect(details).toEqual([{ value: 'a' }, { value: 'ab' }]);
    });

    it('should restore the baseline and clear error, touched and dirty on reset', async () => {
        // Arrange
        const mounted = mountComponent('textField', { value: 'Jo', minLength: 5 });
        await userEvent.type(control(mounted.element), 'x');
        touch(mounted.element);
        commands(mounted.element).validate();

        // Act
        commands(mounted.element).reset();

        // Assert
        expect(mounted.store.get('$.app.value')).toBe('Jo');
        expect(control(mounted.element).value).toBe('Jo');
        expect(errorOf(mounted)).toBe('');
        expect(mounted.store.get('$.app.touched')).toBe(false);
        expect(mounted.store.get('$.app.dirty')).toBe(false);
        expect(part(mounted.element, '.error')).toBeNull();
    });

    it('should take the baseline from a linked data value at mount and write it back on reset', async () => {
        // Arrange
        const mounted = mountComponent('textField', { '<-value': '$.data.order.customer' }, { data: { order: { customer: 'Ada' } } });
        await userEvent.type(control(mounted.element), 'm');

        // Act
        commands(mounted.element).reset();

        // Assert
        expect(mounted.store.get('$.data.order.customer')).toBe('Ada');
    });

    it('should show a message the node overrides for one rule and keep the default for the others', () => {
        // Arrange
        const mounted = mountComponent('textField', { required: true, minLength: 3, _errors: { required: 'Please fill this in' } });

        // Act
        commands(mounted.element).validate();
        const overridden = part(mounted.element, '.error')?.textContent;
        mounted.store.set('$.app.value', 'a');
        commands(mounted.element).validate();

        // Assert
        expect(overridden).toBe('Please fill this in');
        expect(part(mounted.element, '.error')?.textContent).toBe('Too short');
    });

    it('should show the German text of the failing rule', () => {
        // Arrange
        const mounted = mountComponent('textField', { maxLength: 2, value: 'abc' });
        commands(mounted.element).validate();

        // Act
        mounted.setLocale('de');

        // Assert
        expect(part(mounted.element, '.error')?.textContent).toBe('Zu lang');
    });
});
