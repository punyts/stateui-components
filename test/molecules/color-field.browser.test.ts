import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

interface CommandElement extends Element {
    commands: { validate(): void; reset(): void; clear(): void; focus(): void };
}

const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const control = (element: Element): HTMLInputElement => part<HTMLInputElement>(element, '#control');
const picker = (element: Element): HTMLInputElement => part<HTMLInputElement>(element, 'input[type=color]');
const presets = (element: Element): HTMLButtonElement[] => Array.from(element.shadowRoot?.querySelectorAll<HTMLButtonElement>('.preset') ?? []);
const commands = (element: Element): CommandElement['commands'] => (element as CommandElement).commands;

const record = (element: Element, name: string): unknown[] => {
    const details: unknown[] = [];
    element.addEventListener(name, (event) => details.push((event as CustomEvent).detail));
    return details;
};

describe('colorField in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should show the value in the labelled hex text and in the named colour picker', () => {
        // Arrange and Act
        const mounted = mountComponent('colorField', { value: '#1a2b3c', _label: 'Brand' });

        // Assert
        expect(control(mounted.element).value).toBe('#1a2b3c');
        expect(control(mounted.element).labels?.[0]?.textContent).toBe('Brand');
        expect(picker(mounted.element).value).toBe('#1a2b3c');
        expect(picker(mounted.element).getAttribute('aria-label')).toBe('Open the colour picker');
    });

    it('should write $.data as the person types and normalize the text on commit', async () => {
        // Arrange
        const mounted = mountComponent('colorField', { '<-value': '$.data.color' }, { data: { color: '' } });
        const changes = record(mounted.element, 'change');

        // Act
        await userEvent.type(control(mounted.element), 'F0A');
        const typed = mounted.store.get('$.data.color');
        await userEvent.keyboard('{Tab}');

        // Assert
        expect(typed).toBe('F0A');
        expect(mounted.store.get('$.data.color')).toBe('#ff00aa');
        expect(control(mounted.element).value).toBe('#ff00aa');
        expect(picker(mounted.element).value).toBe('#ff00aa');
        expect(changes.at(-1)).toEqual({ value: '#ff00aa' });
    });

    it('should write the colour the picker gives', () => {
        // Arrange
        const mounted = mountComponent('colorField', {});
        const input = picker(mounted.element);

        // Act
        input.value = '#00ff80';
        input.dispatchEvent(new Event('input', { bubbles: true }));

        // Assert
        expect(mounted.store.get('$.app.value')).toBe('#00ff80');
        expect(control(mounted.element).value).toBe('#00ff80');
    });

    it('should fail pattern for text that is not a colour and required for an empty value', () => {
        // Arrange
        const mounted = mountComponent('colorField', { required: true });

        // Act
        commands(mounted.element).validate();
        const empty = mounted.store.get('$.app.error');
        mounted.store.set('$.app.value', 'teal');
        commands(mounted.element).validate();

        // Assert
        expect(empty).toBe('required');
        expect(mounted.store.get('$.app.error')).toBe('pattern');
        expect(part(mounted.element, '.error')?.textContent).toBe('Enter a colour as # and six hex digits');
        expect(control(mounted.element).getAttribute('aria-invalid')).toBe('true');
    });

    it('should draw the valid swatches as named toggle buttons in a group and press the current one', async () => {
        // Arrange
        const mounted = mountComponent('colorField', { swatches: ['#FF0000', 'nope', '#00ff00'], value: '#00ff00' });
        const buttons = presets(mounted.element);

        // Act
        await userEvent.click(buttons[0] as HTMLButtonElement);

        // Assert
        expect(part(mounted.element, '.presets').getAttribute('role')).toBe('group');
        expect(part(mounted.element, '.presets').getAttribute('aria-label')).toBe('Preset colours');
        expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Use #ff0000', 'Use #00ff00']);
        expect(mounted.store.get('$.app.value')).toBe('#ff0000');
        expect(presets(mounted.element).map((button) => button.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    });

    it('should draw no swatch group without swatches', () => {
        // Arrange and Act
        const mounted = mountComponent('colorField', {});

        // Assert
        expect(part(mounted.element, '.presets')).toBeNull();
    });

    it('should disable the text, picker and swatches when disabled, and keep the value when readonly', async () => {
        // Arrange
        const disabled = mountComponent('colorField', { disabled: true, swatches: ['#ff0000'] });
        const readonly = mountComponent('colorField', { readonly: true, value: '#123456', swatches: ['#ff0000'] });

        // Act
        await userEvent.click(presets(readonly.element)[0] as HTMLButtonElement, { force: true });

        // Assert
        expect(control(disabled.element).disabled).toBe(true);
        expect(picker(disabled.element).disabled).toBe(true);
        expect(presets(disabled.element)[0]?.disabled).toBe(true);
        expect(control(readonly.element).readOnly).toBe(true);
        expect(picker(readonly.element).disabled).toBe(true);
        expect(readonly.store.get('$.app.value')).toBe('#123456');
    });

    it('should focus the hex text and empty it on clear', () => {
        // Arrange
        const mounted = mountComponent('colorField', { value: '#abcdef' });

        // Act
        commands(mounted.element).focus();
        const focused = mounted.element.shadowRoot?.activeElement;
        commands(mounted.element).clear();

        // Assert
        expect(focused).toBe(control(mounted.element));
        expect(mounted.store.get('$.app.value')).toBe('');
    });

    it('should speak Spanish after switching language', () => {
        // Arrange
        const mounted = mountComponent('colorField', { swatches: ['#ff0000'] });

        // Act
        mounted.setLocale('es');

        // Assert
        expect(part(mounted.element, 'label').textContent).toBe('Color');
        expect(picker(mounted.element).getAttribute('aria-label')).toBe('Abrir el selector de color');
        expect(presets(mounted.element)[0]?.getAttribute('aria-label')).toBe('Usar #ff0000');
    });
});
