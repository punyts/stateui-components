import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const control = (element: Element): HTMLTextAreaElement => element.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement;

type Commanded = Element & { commands: Record<string, () => void> };

const flush = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));

describe('textarea in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render the properties and follow a state write', () => {
        // Arrange
        const mounted = mountComponent('textarea', { value: 'one', rows: 5, required: true, maxLength: 80 });

        // Act
        mounted.store.set('$.app.value', 'two');

        // Assert
        const area = control(mounted.element);
        expect(area.value).toBe('two');
        expect(area.rows).toBe(5);
        expect(area.required).toBe(true);
        expect(area.maxLength).toBe(80);
        expect(area.getAttribute('aria-label')).toBe('Text area');
    });

    it('should write $.data through a <-value link when the user types, newlines included', async () => {
        // Arrange
        const mounted = mountComponent('textarea', { '<-value': '$.data.notes' }, { data: { notes: '' } });

        // Act
        await userEvent.type(control(mounted.element), 'a{Enter}b');

        // Assert
        expect(mounted.store.get('$.data.notes')).toBe('a\nb');
    });

    it('should show a data write in the text area', () => {
        // Arrange
        const mounted = mountComponent('textarea', { '<-value': '$.data.notes' }, { data: { notes: 'One' } });

        // Act
        mounted.store.set('$.data.notes', 'Two');

        // Assert
        expect(control(mounted.element).value).toBe('Two');
    });

    it('should raise input for each keystroke and change on blur only', async () => {
        // Arrange
        const mounted = mountComponent('textarea', { value: '' });
        const inputs: unknown[] = [];
        const changes: unknown[] = [];
        mounted.element.addEventListener('input', (event) => inputs.push((event as CustomEvent).detail));
        mounted.element.addEventListener('change', (event) => changes.push((event as CustomEvent).detail));

        // Act
        await userEvent.type(control(mounted.element), 'ab{Enter}');
        const beforeBlur = changes.length;
        await userEvent.tab();

        // Assert
        expect(inputs).toEqual(['a', 'ab', 'ab\n']);
        expect(beforeBlur).toBe(0);
        expect(changes).toEqual(['ab\n']);
    });

    it('should empty the text area and write $.data when the clear command runs', () => {
        // Arrange
        const mounted = mountComponent('textarea', { '<-value': '$.data.notes' }, { data: { notes: 'text' } });

        // Act
        (mounted.element as Commanded).commands.clear?.();

        // Assert
        expect(control(mounted.element).value).toBe('');
        expect(mounted.store.get('$.data.notes')).toBe('');
    });

    it('should move focus into the text area when the focus command runs', () => {
        // Arrange
        const mounted = mountComponent('textarea');

        // Act
        (mounted.element as Commanded).commands.focus?.();

        // Assert
        expect(mounted.element.shadowRoot?.activeElement).toBe(control(mounted.element));
    });

    it('should grow with its text when autoGrow is set and stay fixed when it is not', async () => {
        // Arrange
        const grown = mountComponent('textarea', { autoGrow: true, rows: 2 });
        const fixed = mountComponent('textarea', { rows: 2 });
        const lines = Array.from({ length: 12 }, (_value, index) => `line ${index}`).join('\n');
        const start = control(grown.element).offsetHeight;

        // Act
        await userEvent.fill(control(grown.element), lines);
        await userEvent.fill(control(fixed.element), lines);

        // Assert
        expect(control(grown.element).offsetHeight).toBeGreaterThan(start * 2);
        expect(control(fixed.element).offsetHeight).toBe(start);
    });

    it('should grow when data is written into an autoGrow text area', async () => {
        // Arrange
        const mounted = mountComponent('textarea', { autoGrow: true, rows: 2, '<-value': '$.data.notes' }, { data: { notes: '' } });
        const start = control(mounted.element).offsetHeight;

        // Act
        mounted.store.set('$.data.notes', Array.from({ length: 12 }, () => 'x').join('\n'));
        await flush();

        // Assert
        expect(control(mounted.element).offsetHeight).toBeGreaterThan(start * 2);
    });

    it('should change the minimum height with size', () => {
        // Arrange
        const mounted = mountComponent('textarea', { size: 'sm', rows: 1 });
        const small = control(mounted.element).offsetHeight;

        // Act
        mounted.store.set('$.app.size', 'lg');

        // Assert
        expect(control(mounted.element).offsetHeight).toBeGreaterThan(small);
        expect(getComputedStyle(mounted.element).getPropertyValue('--control-height').trim()).toBe(
            getComputedStyle(mounted.element).getPropertyValue('--ui-size-control-lg').trim()
        );
    });

    it('should change colours in the dark overlay', () => {
        // Arrange
        const mounted = mountComponent('textarea', {}, { mode: 'light' });
        const light = getComputedStyle(control(mounted.element)).backgroundColor;

        // Act
        mounted.setTheme('mode', 'dark');

        // Assert
        expect(getComputedStyle(control(mounted.element)).backgroundColor).not.toBe(light);
    });

    it('should show the German placeholder and label after switching language', () => {
        // Arrange
        const mounted = mountComponent('textarea');

        // Act
        mounted.setLocale('de');

        // Assert
        expect(control(mounted.element).placeholder).toBe('Hier eingeben');
        expect(control(mounted.element).getAttribute('aria-label')).toBe('Textbereich');
    });
});
