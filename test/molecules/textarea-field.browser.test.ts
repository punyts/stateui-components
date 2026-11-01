import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

interface CommandElement extends Element {
    commands: { validate(): void; reset(): void; clear(): void; send(): void };
}

const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const control = (element: Element): HTMLTextAreaElement => part<HTMLTextAreaElement>(element, 'textarea');
const commands = (element: Element): CommandElement['commands'] => (element as CommandElement).commands;
const rect = (element: Element): DOMRect => element.getBoundingClientRect();
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('textareaField in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should write a multi-line value to $.data through a <-value link', async () => {
        // Arrange
        const mounted = mountComponent('textareaField', { '<-value': '$.data.note' }, { data: { note: '' } });

        // Act
        await userEvent.type(control(mounted.element), 'one{Enter}two');

        // Assert
        expect(mounted.store.get('$.data.note')).toBe('one\ntwo');
    });

    it('should show a data write in the control', () => {
        // Arrange
        const mounted = mountComponent('textareaField', { '<-value': '$.data.note' }, { data: { note: 'a' } });

        // Act
        mounted.store.set('$.data.note', 'a\nb');

        // Assert
        expect(control(mounted.element).value).toBe('a\nb');
    });

    it('should take rows from the property', () => {
        // Arrange
        const mounted = mountComponent('textareaField', { rows: 6 });
        const taller = rect(control(mounted.element)).height;

        // Act
        mounted.store.set('$.app.rows', 2);

        // Assert
        expect(control(mounted.element).rows).toBe(2);
        expect(rect(control(mounted.element)).height).toBeLessThan(taller);
    });

    it('should grow with its content when autoGrow is set and keep its height otherwise', async () => {
        // Arrange
        const lines = Array.from({ length: 12 }, (_, index) => `line ${index}`).join('\n');
        const growing = mountComponent('textareaField', { autoGrow: true, rows: 2 });
        const fixed = mountComponent('textareaField', { rows: 2 });
        const before = rect(control(growing.element)).height;
        const fixedBefore = rect(control(fixed.element)).height;

        // Act
        growing.store.set('$.app.value', lines);
        fixed.store.set('$.app.value', lines);
        await settle();

        // Assert
        expect(rect(control(growing.element)).height).toBeGreaterThan(before * 2);
        expect(rect(control(fixed.element)).height).toBe(fixedBefore);
    });

    it('should shrink again when the content is removed', async () => {
        // Arrange
        const mounted = mountComponent('textareaField', { autoGrow: true, rows: 2, value: 'a\nb\nc\nd\ne\nf\ng' });
        await settle();
        const grown = rect(control(mounted.element)).height;

        // Act
        mounted.store.set('$.app.value', '');
        await settle();

        // Assert
        expect(rect(control(mounted.element)).height).toBeLessThan(grown);
    });

    it('should set error to minLength and maxLength when validate finds them failing', () => {
        // Arrange
        const short = mountComponent('textareaField', { minLength: 5, value: 'ab' });
        const long = mountComponent('textareaField', { maxLength: 3, value: 'abcd' });

        // Act
        commands(short.element).validate();
        commands(long.element).validate();

        // Assert
        expect(short.store.get('$.app.error')).toBe('minLength');
        expect(long.store.get('$.app.error')).toBe('maxLength');
        expect(part(long.element, '.error')?.textContent).toBe('Too long');
    });

    it('should fail required for an empty value and pass once text is typed', async () => {
        // Arrange
        const mounted = mountComponent('textareaField', { required: true });
        commands(mounted.element).validate();
        const failed = mounted.store.get('$.app.error');

        // Act
        await userEvent.type(control(mounted.element), 'x');
        commands(mounted.element).validate();

        // Assert
        expect(failed).toBe('required');
        expect(mounted.store.get('$.app.error')).toBe('');
    });

    it('should raise change with the value, and reset, clear and locked follow the field contract', async () => {
        // Arrange
        const mounted = mountComponent('textareaField', { value: 'start' });
        const seen: unknown[] = [];
        mounted.element.addEventListener('change', (event) => seen.push((event as CustomEvent).detail));

        // Act
        await userEvent.type(control(mounted.element), '!');
        const dirty = mounted.store.get('$.app.dirty');
        commands(mounted.element).reset();
        const restored = control(mounted.element).value;
        commands(mounted.element).clear();
        mounted.store.set('$.app.locked', true);

        // Assert
        expect(seen[0]).toEqual({ value: 'start!' });
        expect(dirty).toBe(true);
        expect(restored).toBe('start');
        expect(control(mounted.element).value).toBe('');
        expect(control(mounted.element).disabled).toBe(true);
    });

    it('should put the label above, beside, inside or away from the control for titlePosition', () => {
        // Arrange
        const mounted = mountComponent('textareaField', { titlePosition: 'top' });
        const label = (): DOMRect => rect(part(mounted.element, 'label'));
        const box = (): DOMRect => rect(control(mounted.element));

        // Act
        const top = label().bottom <= box().top;
        mounted.store.set('$.app.titlePosition', 'left');
        const left = label().right <= box().left;
        mounted.store.set('$.app.titlePosition', 'inner');
        const inner = label().top >= box().top && label().bottom <= box().bottom;
        mounted.store.set('$.app.titlePosition', 'hidden');

        // Assert
        expect(top).toBe(true);
        expect(left).toBe(true);
        expect(inner).toBe(true);
        expect(label().width).toBeLessThanOrEqual(1);
        expect(mounted.element.getAttribute('title-position')).toBe('hidden');
    });

    it('should render the error message and link help and error to the control', () => {
        // Arrange
        const mounted = mountComponent('textareaField', { _help: 'Hint' });

        // Act
        mounted.store.set('$.app.error', 'required');

        // Assert
        expect(part(mounted.element, '.error')?.textContent).toBe('This field is required');
        expect(control(mounted.element).getAttribute('aria-describedby')).toBe('help error');
        expect(control(mounted.element).getAttribute('aria-invalid')).toBe('true');
    });

    it('should show the German label and error after switching language', () => {
        // Arrange
        const mounted = mountComponent('textareaField', { maxLength: 2, value: 'abc' });
        commands(mounted.element).validate();

        // Act
        mounted.setLocale('de');

        // Assert
        expect(part(mounted.element, 'label').textContent).toBe('Beschriftung');
        expect(part(mounted.element, '.error')?.textContent).toBe('Zu lang');
    });
    it('should raise send with the trimmed text on the send command and never clear the field itself', async () => {
        // Arrange
        const mounted = mountComponent('textareaField', { value: '  hello \n' });
        const seen: unknown[] = [];
        mounted.element.addEventListener('send', (event) => seen.push((event as CustomEvent).detail));

        // Act
        commands(mounted.element).send();

        // Assert
        expect(seen).toEqual(['hello']);
        expect(mounted.store.get('$.app.value')).toBe('  hello \n');
    });

    it('should not raise send for an empty value, a disabled field or a read-only field', () => {
        // Arrange
        const seen: unknown[] = [];
        const trial = (state: Record<string, unknown>): void => {
            const mounted = mountComponent('textareaField', state);
            mounted.element.addEventListener('send', (event) => seen.push((event as CustomEvent).detail));
            commands(mounted.element).send();
        };

        // Act
        trial({ value: '   ' });
        trial({ value: 'x', disabled: true });
        trial({ value: 'x', readonly: true });

        // Assert
        expect(seen).toEqual([]);
    });

    it('should raise send on Enter with sendOnEnter, add a line on Shift+Enter and keep a plain Enter a new line without it', async () => {
        // Arrange
        const on = mountComponent('textareaField', { sendOnEnter: true });
        const off = mountComponent('textareaField', {});
        const seen: unknown[] = [];
        on.element.addEventListener('send', (event) => seen.push((event as CustomEvent).detail));
        off.element.addEventListener('send', (event) => seen.push(['off', (event as CustomEvent).detail]));

        // Act
        await userEvent.type(control(on.element), 'a');
        await userEvent.keyboard('{Shift>}{Enter}{/Shift}b');
        await userEvent.keyboard('{Enter}');
        await userEvent.type(control(off.element), 'c{Enter}d');
        await settle();

        // Assert
        expect(seen).toEqual(['a\nb']);
        expect(control(off.element).value).toBe('c\nd');
    });
});
