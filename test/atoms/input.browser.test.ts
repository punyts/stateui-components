import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const control = (element: Element): HTMLInputElement => element.shadowRoot?.querySelector('input') as HTMLInputElement;

type Commanded = Element & { commands: Record<string, () => void> };

const record = (element: Element, name: string): unknown[] => {
    const details: unknown[] = [];
    element.addEventListener(name, (event) => details.push((event as CustomEvent).detail));
    return details;
};

describe('input in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should show no placeholder by default', () => {
        // Arrange
        const mounted = mountComponent('input');

        // Assert
        expect(control(mounted.element).placeholder).toBe('');
        expect(control(mounted.element).getAttribute('placeholder') ?? '').toBe('');
        expect(mounted.store.get('$.app._placeholder')).toBe('');
    });

    it('should render the properties and follow a state write', () => {
        // Arrange
        const mounted = mountComponent('input', { value: 'Jo', inputType: 'email', required: true, maxLength: 20 });

        // Act
        mounted.store.set('$.app.value', 'Jane');

        // Assert
        const input = control(mounted.element);
        expect(input.value).toBe('Jane');
        expect(input.type).toBe('email');
        expect(input.required).toBe(true);
        expect(input.maxLength).toBe(20);
        expect(input.getAttribute('aria-label')).toBe('Input');
    });

    it('should write $.data through a <-value link when the user types', async () => {
        // Arrange
        const mounted = mountComponent('input', { '<-value': '$.data.name' }, { data: { name: '' } });
        mounted.store.set('$.data.name', '');

        // Act
        await userEvent.type(control(mounted.element), 'Ada');

        // Assert
        expect(mounted.store.get('$.data.name')).toBe('Ada');
    });

    it('should show a data write in the input', () => {
        // Arrange
        const mounted = mountComponent('input', { '<-value': '$.data.name' }, { data: { name: '' } });
        mounted.store.set('$.data.name', 'One');

        // Act
        mounted.store.set('$.data.name', 'Two');

        // Assert
        expect(control(mounted.element).value).toBe('Two');
    });

    it('should write a number to $.data when inputType is number', async () => {
        // Arrange
        const mounted = mountComponent('input', { inputType: 'number', '<-value': '$.data.qty' }, { data: { qty: 0 } });
        mounted.store.set('$.data.qty', 1);

        // Act
        await userEvent.fill(control(mounted.element), '42');

        // Assert
        expect(mounted.store.get('$.data.qty')).toBe(42);
        expect(control(mounted.element).type).toBe('number');
    });

    it('should raise input for each keystroke with the value and nothing else', async () => {
        // Arrange
        const mounted = mountComponent('input', { value: '' });
        const inputs = record(mounted.element, 'input');

        // Act
        await userEvent.type(control(mounted.element), 'abc');

        // Assert
        expect(inputs).toEqual(['a', 'ab', 'abc']);
    });

    it('should raise change on blur and on Enter, with the data already written', async () => {
        // Arrange
        const mounted = mountComponent('input', { '<-value': '$.data.name' }, { data: { name: '' } });
        mounted.store.set('$.data.name', '');
        const seen: unknown[] = [];
        mounted.element.addEventListener('change', (event) => seen.push([(event as CustomEvent).detail, mounted.store.get('$.data.name')]));
        const input = control(mounted.element);

        // Act
        await userEvent.type(input, 'ab');
        const beforeBlur = seen.length;
        await userEvent.tab();
        await userEvent.type(input, 'c{Enter}');

        // Assert
        expect(beforeBlur).toBe(0);
        expect(seen).toEqual([['ab', 'ab'], ['abc', 'abc']]);
    });

    it('should empty the input and write $.data when the clear command runs', () => {
        // Arrange
        const mounted = mountComponent('input', { '<-value': '$.data.name' }, { data: { name: '' } });
        mounted.store.set('$.data.name', 'Ada');

        // Act
        (mounted.element as Commanded).commands.clear?.();

        // Assert
        expect(control(mounted.element).value).toBe('');
        expect(mounted.store.get('$.data.name')).toBe('');
    });

    it('should empty a number input and write null when the clear command runs', () => {
        // Arrange
        const mounted = mountComponent('input', { inputType: 'number', '<-value': '$.data.qty' }, { data: { qty: 0 } });
        mounted.store.set('$.data.qty', 7);

        // Act
        (mounted.element as Commanded).commands.clear?.();

        // Assert
        expect(control(mounted.element).value).toBe('');
        expect(mounted.store.get('$.data.qty')).toBeNull();
    });

    it('should move focus into the input when the focus command runs', () => {
        // Arrange
        const mounted = mountComponent('input');

        // Act
        (mounted.element as Commanded).commands.focus?.();

        // Assert
        expect(mounted.element.shadowRoot?.activeElement).toBe(control(mounted.element));
    });

    it('should change the height token and the rendered height with size', () => {
        // Arrange
        const mounted = mountComponent('input', { size: 'sm' });
        const small = control(mounted.element).offsetHeight;

        // Act
        mounted.store.set('$.app.size', 'lg');

        // Assert
        expect(control(mounted.element).offsetHeight).toBeGreaterThan(small);
        expect(getComputedStyle(mounted.element).getPropertyValue('--control-height').trim()).toBe(
            getComputedStyle(mounted.element).getPropertyValue('--ui-size-control-lg').trim()
        );
    });

    it('should apply the control radius token and a node override of it', () => {
        // Arrange
        const mounted = mountComponent('input');
        const before = getComputedStyle(control(mounted.element)).borderTopLeftRadius;

        // Act
        (mounted.element as HTMLElement).style.setProperty('--ui-control-radius', '0px');

        // Assert
        expect(before).toBe('6px');
        expect(getComputedStyle(control(mounted.element)).borderTopLeftRadius).toBe('0px');
    });

    it('should disable the input and dim it', () => {
        // Arrange
        const mounted = mountComponent('input', { disabled: true });

        // Act
        const style = getComputedStyle(control(mounted.element));

        // Assert
        expect(control(mounted.element).disabled).toBe(true);
        expect(style.cursor).toBe('not-allowed');
    });

    it('should change colours in the dark overlay', () => {
        // Arrange
        const mounted = mountComponent('input', {}, { mode: 'light' });
        const light = getComputedStyle(control(mounted.element)).backgroundColor;

        // Act
        mounted.setTheme('mode', 'dark');

        // Assert
        expect(getComputedStyle(control(mounted.element)).backgroundColor).not.toBe(light);
    });

    it('should show the German label and no placeholder after switching language', () => {
        // Arrange
        const mounted = mountComponent('input');

        // Act
        mounted.setLocale('de');

        // Assert
        expect(control(mounted.element).placeholder).toBe('');
        expect(control(mounted.element).getAttribute('aria-label')).toBe('Eingabe');
    });

    it('should keep a placeholder the author wrote when the language changes', () => {
        // Arrange
        const mounted = mountComponent('input', { _placeholder: 'Name' });

        // Act
        mounted.setLocale('de');

        // Assert
        expect(control(mounted.element).placeholder).toBe('Name');
    });
});
