import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const NBSP = ' ';

interface CommandElement extends Element {
    commands: { validate(): void; reset(): void; focus(): void; clear(): void };
}

const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const input = (element: Element): HTMLInputElement => part<HTMLInputElement>(element, 'input');
const buttons = (element: Element): HTMLButtonElement[] => Array.from(element.shadowRoot?.querySelectorAll<HTMLButtonElement>('button.step') ?? []);
const commands = (element: Element): CommandElement['commands'] => (element as CommandElement).commands;
const get = (mounted: { store: { get(path: string): unknown } }, name: string): unknown => mounted.store.get(`$.app.${name}`);
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const events = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};
/** Puts the whole text into the field in one input event, then leaves it */
async function enter(element: Element, text: string, leave = true): Promise<void> {
    await userEvent.fill(input(element), text);
    if (leave) input(element).blur();
    await flush();
}

/** Types the text key by key, as a user does, and stays in the field */
async function typeIn(element: Element, text: string): Promise<void> {
    await userEvent.clear(input(element));
    await userEvent.type(input(element), text);
    await flush();
}

describe('numberField parsing and showing in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render a labelled spinbutton input with the stepper buttons named by content', () => {
        // Arrange
        const mounted = mountComponent('numberField', { _label: 'Quantity', min: 0, max: 10 });

        // Assert
        expect(part(mounted.element, 'label').textContent).toBe('Quantity');
        expect(input(mounted.element).getAttribute('role')).toBe('spinbutton');
        expect(input(mounted.element).getAttribute('inputmode')).toBe('decimal');
        expect(input(mounted.element).getAttribute('aria-valuemin')).toBe('0');
        expect(input(mounted.element).getAttribute('aria-valuemax')).toBe('10');
        expect(buttons(mounted.element).map((button) => button.getAttribute('aria-label'))).toEqual(['Decrease', 'Increase']);
        expect(mounted.element.hasAttribute('stepper')).toBe(true);
    });

    it('should read 1,234.5 in en and write the number to a linked data path', async () => {
        // Arrange
        const mounted = mountComponent('numberField', { '<-value': '$.data.qty' }, { data: { qty: '' } });

        // Act
        await enter(mounted.element, '1,234.5');

        // Assert
        expect(mounted.store.get('$.data.qty')).toBe(1234.5);
        expect(typeof mounted.store.get('$.data.qty')).toBe('number');
        expect(input(mounted.element).value).toBe('1,234.5');
        expect(get(mounted, 'error')).toBe('');
    });

    it('should read 1.234,5 in de, write the number and show it the German way after blur', async () => {
        // Arrange
        const mounted = mountComponent('numberField', { '<-value': '$.data.qty' }, { data: { qty: '' }, locale: 'de' });

        // Act
        await enter(mounted.element, '1234,5');

        // Assert
        expect(mounted.store.get('$.data.qty')).toBe(1234.5);
        expect(input(mounted.element).value).toBe('1.234,5');
    });

    it('should not rewrite the text while the user types, and reformat it on blur', async () => {
        // Arrange
        const mounted = mountComponent('numberField', { '<-value': '$.data.qty' }, { data: { qty: '' }, locale: 'de' });

        // Act
        await typeIn(mounted.element, '1234,5');
        const typed = input(mounted.element).value;
        const written = mounted.store.get('$.data.qty');
        input(mounted.element).blur();
        await flush();

        // Assert
        expect(typed).toBe('1234,5');
        expect(written).toBe(1234.5);
        expect(input(mounted.element).value).toBe('1.234,5');
    });

    it('should show a data value formatted for the locale and follow a data write and a language switch', async () => {
        // Arrange
        const mounted = mountComponent('numberField', { '<-value': '$.data.qty' }, { data: { qty: 1234.5 } });
        await flush();
        const english = input(mounted.element).value;

        // Act
        mounted.store.set('$.data.qty', 9876.25);
        await flush();
        const written = input(mounted.element).value;
        mounted.setLocale('de');
        await flush();

        // Assert
        expect(english).toBe('1,234.5');
        expect(written).toBe('9,876.25');
        expect(input(mounted.element).value).toBe('9.876,25');
    });

    it('should type a percent as a percentage, write a fraction and show the sign', async () => {
        // Arrange
        const en = mountComponent('numberField', { format: 'percent', '<-value': '$.data.rate' }, { data: { rate: '' } });
        const de = mountComponent('numberField', { format: 'percent', '<-value': '$.data.rate' }, { data: { rate: '' }, locale: 'de' });

        // Act
        await enter(en.element, '12.5');
        await enter(de.element, '12,5');

        // Assert
        expect(en.store.get('$.data.rate')).toBe(0.125);
        expect(input(en.element).value).toBe('12.5%');
        expect(de.store.get('$.data.rate')).toBe(0.125);
        expect(input(de.element).value).toBe(`12,5${NBSP}%`);
    });

    it('should type a currency with or without its symbol and show it with the symbol', async () => {
        // Arrange
        const en = mountComponent('numberField', { format: 'currency', currency: 'EUR', '<-value': '$.data.price' }, { data: { price: '' } });
        const de = mountComponent('numberField', { format: 'currency', currency: 'EUR', '<-value': '$.data.price' }, { data: { price: '' }, locale: 'de' });

        // Act
        await enter(en.element, '1,234.5');
        await enter(de.element, `1.234,5${NBSP}€`);

        // Assert
        expect(en.store.get('$.data.price')).toBe(1234.5);
        expect(input(en.element).value).toBe('€1,234.50');
        expect(de.store.get('$.data.price')).toBe(1234.5);
        expect(input(de.element).value).toBe(`1.234,50${NBSP}€`);
    });

    it('should keep unparseable text, write nothing and set error to number', async () => {
        // Arrange
        const mounted = mountComponent('numberField', { value: 7, '<-value': '$.data.qty' }, { data: { qty: 7 } });
        await flush();
        const invalid = events(mounted.element, 'invalid');

        // Act
        await enter(mounted.element, '12abc');

        // Assert
        expect(input(mounted.element).value).toBe('12abc');
        expect(mounted.store.get('$.data.qty')).toBe(7);
        expect(get(mounted, 'error')).toBe('number');
        expect(part(mounted.element, '.error').textContent).toBe('Enter a number');
        expect(input(mounted.element).getAttribute('aria-invalid')).toBe('true');
        expect(input(mounted.element).hasAttribute('aria-valuenow')).toBe(false);
        expect(invalid).toEqual([{ rule: 'number' }]);
    });

    it('should clear the number error and write the value once the text parses, also before the field is touched', async () => {
        // Arrange
        const mounted = mountComponent('numberField', { '<-value': '$.data.qty' }, { data: { qty: '' } });
        await enter(mounted.element, 'abc', false);
        const failing = get(mounted, 'error');

        // Act
        await enter(mounted.element, '42', false);

        // Assert
        expect(failing).toBe('number');
        expect(get(mounted, 'error')).toBe('');
        expect(mounted.store.get('$.data.qty')).toBe(42);
    });

    it('should write an empty value when the text is cleared', async () => {
        // Arrange
        const mounted = mountComponent('numberField', { '<-value': '$.data.qty' }, { data: { qty: 5 } });
        await flush();

        // Act
        await enter(mounted.element, '');

        // Assert
        expect(mounted.store.get('$.data.qty')).toBe('');
        expect(input(mounted.element).value).toBe('');
        expect(get(mounted, 'error')).toBe('');
    });

    it('should replace an unparseable entry when data is written from outside', async () => {
        // Arrange
        const mounted = mountComponent('numberField', { '<-value': '$.data.qty' }, { data: { qty: 1 } });
        await enter(mounted.element, 'abc');

        // Act
        mounted.store.set('$.data.qty', 3);
        await flush();

        // Assert
        expect(input(mounted.element).value).toBe('3');
        expect(get(mounted, 'error')).toBe('');
    });

    it('should empty the field by the clear command and focus it by the focus command', async () => {
        // Arrange
        const mounted = mountComponent('numberField', { value: 5 });
        await flush();

        // Act
        commands(mounted.element).focus();
        const focused = (mounted.element.shadowRoot as ShadowRoot).activeElement === input(mounted.element);
        commands(mounted.element).clear();
        await flush();

        // Assert
        expect(focused).toBe(true);
        expect(get(mounted, 'value')).toBe('');
        expect(input(mounted.element).value).toBe('');
    });
});

describe('numberField stepping in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should step by the buttons by step, clamped to min and max, and keep the value a number', async () => {
        // Arrange
        const mounted = mountComponent('numberField', { min: 0, max: 10, step: 4, '<-value': '$.data.qty' }, { data: { qty: 5 } });
        await flush();
        const changes = events(mounted.element, 'change');
        const [decrement, increment] = buttons(mounted.element) as [HTMLButtonElement, HTMLButtonElement];

        // Act
        increment.click();
        const up = mounted.store.get('$.data.qty');
        increment.click();
        const clampedMax = mounted.store.get('$.data.qty');
        decrement.click();
        decrement.click();
        decrement.click();
        await flush();

        // Assert
        expect(up).toBe(9);
        expect(clampedMax).toBe(10);
        expect(mounted.store.get('$.data.qty')).toBe(0);
        expect(typeof mounted.store.get('$.data.qty')).toBe('number');
        expect(input(mounted.element).value).toBe('0');
        expect(changes).toEqual([{ value: 9 }, { value: 10 }, { value: 6 }, { value: 2 }, { value: 0 }]);
    });

    it('should step by 1 when step is not set and by the arrow keys', async () => {
        // Arrange
        const mounted = mountComponent('numberField', { '<-value': '$.data.qty' }, { data: { qty: 5 } });
        await flush();
        input(mounted.element).focus();

        // Act
        await userEvent.keyboard('{ArrowUp}{ArrowUp}');
        const up = mounted.store.get('$.data.qty');
        await userEvent.keyboard('{ArrowDown}');

        // Assert
        expect(up).toBe(7);
        expect(mounted.store.get('$.data.qty')).toBe(6);
        expect(input(mounted.element).value).toBe('6');
    });

    it('should start from 0 or from min when the field is empty, and clamp the first step', async () => {
        // Arrange
        const plain = mountComponent('numberField', {});
        const bounded = mountComponent('numberField', { min: 5 });

        // Act
        buttons(plain.element)[1]?.click();
        buttons(bounded.element)[0]?.click();

        // Assert
        expect(get(plain, 'value')).toBe(1);
        expect(get(bounded, 'value')).toBe(5);
    });

    it('should add steps without floating-point drift', async () => {
        // Arrange
        const mounted = mountComponent('numberField', { step: 0.1, value: 0.2 });
        await flush();

        // Act
        buttons(mounted.element)[1]?.click();

        // Assert
        expect(get(mounted, 'value')).toBe(0.3);
        expect(input(mounted.element).value).toBe('0.3');
    });

    it('should step from the last valid value after an unparseable entry and show the number again', async () => {
        // Arrange
        const mounted = mountComponent('numberField', { '<-value': '$.data.qty' }, { data: { qty: 5 } });
        await enter(mounted.element, 'abc');

        // Act
        buttons(mounted.element)[1]?.click();
        await flush();

        // Assert
        expect(mounted.store.get('$.data.qty')).toBe(6);
        expect(input(mounted.element).value).toBe('6');
        expect(get(mounted, 'error')).toBe('');
    });

    it('should not step while disabled or read-only', async () => {
        // Arrange
        const disabled = mountComponent('numberField', { value: 5, disabled: true });
        const readonly = mountComponent('numberField', { value: 5, readonly: true });
        await flush();

        // Act
        buttons(disabled.element)[1]?.click();
        buttons(readonly.element)[1]?.click();
        input(readonly.element).focus();
        await userEvent.keyboard('{ArrowUp}');

        // Assert
        expect(buttons(disabled.element).every((button) => button.disabled)).toBe(true);
        expect(buttons(readonly.element).every((button) => button.disabled)).toBe(true);
        expect(get(disabled, 'value')).toBe(5);
        expect(get(readonly, 'value')).toBe(5);
    });

    it('should draw no buttons when stepper is false, and still step with the arrow keys', async () => {
        // Arrange
        const mounted = mountComponent('numberField', { stepper: false, value: 5 });
        await flush();
        input(mounted.element).focus();

        // Act
        await userEvent.keyboard('{ArrowUp}');

        // Assert
        expect(buttons(mounted.element)).toHaveLength(0);
        expect(mounted.element.hasAttribute('stepper')).toBe(false);
        expect(get(mounted, 'value')).toBe(6);
    });

    it('should name the buttons in German', () => {
        // Arrange
        const mounted = mountComponent('numberField', {}, { locale: 'de' });

        // Assert
        expect(buttons(mounted.element).map((button) => button.getAttribute('aria-label'))).toEqual(['Verringern', 'Erhöhen']);
    });
});

describe('numberField rules in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it.each([
        ['required', { required: true }, ''],
        ['min', { min: 5 }, 4],
        ['max', { max: 5 }, 6],
        ['step', { step: 5 }, 12],
        ['step', { step: 5, min: 2 }, 13],
        ['number', {}, 'abc']
    ])('should set error to %s when validate finds that rule failing', (rule, settings, value) => {
        // Arrange
        const mounted = mountComponent('numberField', { ...settings, value });

        // Act
        commands(mounted.element).validate();

        // Assert
        expect(get(mounted, 'error')).toBe(rule);
        expect(part(mounted.element, '.error').textContent).not.toBe('');
    });

    it('should pass a value that satisfies every rule', () => {
        // Arrange
        const mounted = mountComponent('numberField', { required: true, min: 2, max: 20, step: 5, value: 12 });

        // Act
        commands(mounted.element).validate();

        // Assert
        expect(get(mounted, 'error')).toBe('');
    });

    it('should keep the number error through validate while the entry is unparseable', async () => {
        // Arrange
        const mounted = mountComponent('numberField', { value: 5 });
        await enter(mounted.element, 'abc');

        // Act
        commands(mounted.element).validate();

        // Assert
        expect(get(mounted, 'error')).toBe('number');
    });

    it('should check min on a typed value once the field is touched', async () => {
        // Arrange
        const mounted = mountComponent('numberField', { min: 5, '<-value': '$.data.qty' }, { data: { qty: '' } });
        await enter(mounted.element, '3');

        // Act
        await enter(mounted.element, '4');

        // Assert
        expect(get(mounted, 'error')).toBe('min');
        expect(mounted.store.get('$.data.qty')).toBe(4);
    });

    it('should show the German default messages for each rule', () => {
        // Arrange
        const messageOf = (settings: Record<string, unknown>, value: unknown): string => {
            const mounted = mountComponent('numberField', { ...settings, value }, { locale: 'de' });
            commands(mounted.element).validate();
            return part(mounted.element, '.error').textContent ?? '';
        };

        // Act
        const messages = [
            messageOf({ required: true }, ''),
            messageOf({ min: 5 }, 4),
            messageOf({ max: 5 }, 6),
            messageOf({ step: 5 }, 12),
            messageOf({}, 'abc')
        ];

        // Assert
        expect(messages).toEqual(['Dieses Feld ist erforderlich', 'Zu klein', 'Zu groß', 'Kein gültiger Schritt', 'Bitte eine Zahl eingeben']);
    });

    it('should show an application message in German and the German label', () => {
        // Arrange
        const mounted = mountComponent('numberField', { _label: 'Quantity' }, { locales: { de: { _label: 'Menge' } }, locale: 'de' });

        // Assert
        expect(part(mounted.element, 'label').textContent).toBe('Menge');
    });
});
