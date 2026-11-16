import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

interface CommandElement extends Element {
    commands: { validate(): void; reset(): void; clear(): void; focus(): void };
}

const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const boxes = (element: Element): HTMLInputElement[] => Array.from(element.shadowRoot?.querySelectorAll<HTMLInputElement>('input.cell') ?? []);
const focusedIndex = (element: Element): number => boxes(element).indexOf(element.shadowRoot?.activeElement as HTMLInputElement);
const commands = (element: Element): CommandElement['commands'] => (element as CommandElement).commands;

const record = (element: Element, name: string): unknown[] => {
    const details: unknown[] = [];
    element.addEventListener(name, (event) => details.push((event as CustomEvent).detail));
    return details;
};

const paste = (input: HTMLInputElement, text: string): void => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true, composed: true }));
};

describe('pinField in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should draw six boxes in one labelled group, each named by its position, the first offering the one-time code', () => {
        // Arrange and Act
        const mounted = mountComponent('pinField', { _label: 'Verification code' });
        const group = part<HTMLElement>(mounted.element, '[role=group]');
        const cells = boxes(mounted.element);

        // Assert
        expect(cells).toHaveLength(6);
        expect(mounted.element.shadowRoot?.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Verification code');
        expect(cells.map((cell) => cell.getAttribute('aria-label'))).toEqual(['Digit 1 of 6', 'Digit 2 of 6', 'Digit 3 of 6', 'Digit 4 of 6', 'Digit 5 of 6', 'Digit 6 of 6']);
        expect(cells.map((cell) => cell.autocomplete)).toEqual(['one-time-code', 'off', 'off', 'off', 'off', 'off']);
        expect(cells.every((cell) => cell.inputMode === 'numeric' && cell.type === 'text')).toBe(true);
        expect(cells.map((cell) => cell.tabIndex)).toEqual([0, -1, -1, -1, -1, -1]);
    });

    it('should take length from 4 to 8 boxes', () => {
        // Arrange and Act
        const mounted = mountComponent('pinField', { length: 4 });

        // Assert
        expect(boxes(mounted.element)).toHaveLength(4);
        expect(boxes(mounted.element)[3]?.getAttribute('aria-label')).toBe('Digit 4 of 4');
    });

    it('should write each digit typed, move on to the next box and raise change', async () => {
        // Arrange
        const mounted = mountComponent('pinField', { '<-value': '$.data.code' }, { data: { code: '' } });
        const changes = record(mounted.element, 'change');

        // Act
        await userEvent.click(boxes(mounted.element)[0] as HTMLInputElement);
        await userEvent.keyboard('12a3');

        // Assert
        expect(mounted.store.get('$.data.code')).toBe('123');
        expect(boxes(mounted.element).map((cell) => cell.value)).toEqual(['1', '2', '3', '', '', '']);
        expect(focusedIndex(mounted.element)).toBe(3);
        expect(changes.at(-1)).toEqual({ value: '123' });
        expect(boxes(mounted.element)[3]?.tabIndex).toBe(0);
    });

    it('should take letters too with alphanumeric', async () => {
        // Arrange
        const mounted = mountComponent('pinField', { alphanumeric: true, length: 4 });

        // Act
        await userEvent.click(boxes(mounted.element)[0] as HTMLInputElement);
        await userEvent.keyboard('a1-B');

        // Assert
        expect(mounted.store.get('$.app.value')).toBe('a1B');
        expect(boxes(mounted.element)[0]?.inputMode).toBe('text');
    });

    it('should send focus from a box past the first empty one back to it', async () => {
        // Arrange
        const mounted = mountComponent('pinField', { value: '12' });

        // Act
        await userEvent.click(boxes(mounted.element)[5] as HTMLInputElement);

        // Assert
        expect(focusedIndex(mounted.element)).toBe(2);
    });

    it('should clear backwards with Backspace and move with the arrows, Home and End', async () => {
        // Arrange
        const mounted = mountComponent('pinField', { value: '1234' });
        await userEvent.click(boxes(mounted.element)[4] as HTMLInputElement);

        // Act
        await userEvent.keyboard('{Backspace}');
        const afterBackspace = [mounted.store.get('$.app.value'), focusedIndex(mounted.element)];
        await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
        const afterLeft = focusedIndex(mounted.element);
        await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}');
        const afterRight = focusedIndex(mounted.element);
        await userEvent.keyboard('{Home}');
        const afterHome = focusedIndex(mounted.element);
        await userEvent.keyboard('{Delete}');

        // Assert
        expect(afterBackspace).toEqual(['123', 3]);
        expect(afterLeft).toBe(1);
        expect(afterRight).toBe(3);
        expect(afterHome).toBe(0);
        expect(mounted.store.get('$.app.value')).toBe('23');
    });

    it('should fill every box from a paste, keeping only digits, and raise complete once', () => {
        // Arrange
        const mounted = mountComponent('pinField', {});
        const completes = record(mounted.element, 'complete');

        // Act
        paste(boxes(mounted.element)[2] as HTMLInputElement, '12-34 56 78');

        // Assert
        expect(mounted.store.get('$.app.value')).toBe('123456');
        expect(boxes(mounted.element).map((cell) => cell.value).join('')).toBe('123456');
        expect(completes).toEqual([{ value: '123456' }]);
        expect(focusedIndex(mounted.element)).toBe(5);
    });

    it('should raise complete when the last box is typed', async () => {
        // Arrange
        const mounted = mountComponent('pinField', { value: '123', length: 4 });
        const completes = record(mounted.element, 'complete');

        // Act
        await userEvent.click(boxes(mounted.element)[3] as HTMLInputElement);
        await userEvent.keyboard('9');

        // Assert
        expect(completes).toEqual([{ value: '1239' }]);
    });

    it('should hide the characters when masked', () => {
        // Arrange and Act
        const mounted = mountComponent('pinField', { masked: true, value: '42' });

        // Assert
        expect(boxes(mounted.element).every((cell) => cell.type === 'password')).toBe(true);
        expect(boxes(mounted.element)[1]?.value).toBe('2');
    });

    it('should fail required when empty and incomplete when partly typed, and pass when full', () => {
        // Arrange
        const mounted = mountComponent('pinField', { required: true, length: 4 });

        // Act
        commands(mounted.element).validate();
        const empty = mounted.store.get('$.app.error');
        mounted.store.set('$.app.value', '12');
        commands(mounted.element).validate();
        const partial = mounted.store.get('$.app.error');
        const message = part<HTMLElement>(mounted.element, '.error')?.textContent;
        const invalid = boxes(mounted.element)[0]?.getAttribute('aria-invalid');
        mounted.store.set('$.app.value', '1234');
        commands(mounted.element).validate();

        // Assert
        expect(empty).toBe('required');
        expect(partial).toBe('incomplete');
        expect(message).toBe('Enter the whole code');
        expect(invalid).toBe('true');
        expect(mounted.store.get('$.app.error')).toBe('');
    });

    it('should focus the box that takes the next digit and empty every box on clear', () => {
        // Arrange
        const mounted = mountComponent('pinField', { value: '12' });

        // Act
        commands(mounted.element).focus();
        const focused = focusedIndex(mounted.element);
        commands(mounted.element).clear();

        // Assert
        expect(focused).toBe(2);
        expect(mounted.store.get('$.app.value')).toBe('');
        expect(boxes(mounted.element).map((cell) => cell.value).join('')).toBe('');
    });

    it('should disable every box and write nothing when disabled', async () => {
        // Arrange
        const mounted = mountComponent('pinField', { disabled: true });

        // Act
        await userEvent.click(boxes(mounted.element)[0] as HTMLInputElement, { force: true });
        await userEvent.keyboard('1');
        paste(boxes(mounted.element)[0] as HTMLInputElement, '123456');

        // Assert
        expect(boxes(mounted.element).every((cell) => cell.disabled)).toBe(true);
        expect(mounted.store.get('$.app.value')).toBe('');
    });

    it('should name the boxes in German after switching language', () => {
        // Arrange
        const mounted = mountComponent('pinField', { length: 4 });

        // Act
        mounted.setLocale('de');

        // Assert
        expect(boxes(mounted.element)[1]?.getAttribute('aria-label')).toBe('Ziffer 2 von 4');
    });
});
