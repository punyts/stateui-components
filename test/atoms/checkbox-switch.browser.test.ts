import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const control = (element: Element): HTMLInputElement => element.shadowRoot?.querySelector('input') as HTMLInputElement;

type Commanded = Element & { commands: Record<string, () => void> };

describe.each([
    ['checkbox', 'Kontrollkästchen', 'Checkbox'],
    ['switch', 'Schalter', 'Switch']
])('%s in Chromium', (name, german, english) => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should show checked and follow a state write', () => {
        // Arrange
        const mounted = mountComponent(name, { checked: true, required: true });

        // Act
        mounted.store.set('$.app.checked', false);

        // Assert
        expect(control(mounted.element).checked).toBe(false);
        expect(control(mounted.element).required).toBe(true);
        expect(control(mounted.element).getAttribute('aria-label')).toBe(english);
    });

    it('should toggle by Space and write $.data through a <-checked link', async () => {
        // Arrange
        const mounted = mountComponent(name, { '<-checked': '$.data.done' }, { data: { done: false } });
        mounted.store.set('$.data.done', false);
        const seen: unknown[] = [];
        mounted.element.addEventListener('change', (event) => seen.push([(event as CustomEvent).detail, mounted.store.get('$.data.done')]));
        control(mounted.element).focus();

        // Act
        await userEvent.keyboard(' ');
        await userEvent.keyboard(' ');
        await userEvent.keyboard(' ');

        // Assert
        expect(mounted.store.get('$.data.done')).toBe(true);
        expect(seen).toEqual([[true, true], [false, false], [true, true]]);
    });

    it('should show a data write', () => {
        // Arrange
        const mounted = mountComponent(name, { '<-checked': '$.data.done' }, { data: { done: false } });
        mounted.store.set('$.data.done', false);

        // Act
        mounted.store.set('$.data.done', true);

        // Assert
        expect(control(mounted.element).checked).toBe(true);
    });

    it('should not change when readonly, and be disabled when disabled', async () => {
        // Arrange
        const readonly = mountComponent(name, { readonly: true });
        const disabled = mountComponent(name, { disabled: true });

        // Act
        await userEvent.click(control(readonly.element));

        // Assert
        expect(readonly.store.get('$.app.checked')).toBe(false);
        expect(control(readonly.element).checked).toBe(false);
        expect(control(disabled.element).disabled).toBe(true);
    });

    it('should set false with clear and move focus with focus', () => {
        // Arrange
        const mounted = mountComponent(name, { '<-checked': '$.data.done' }, { data: { done: false } });
        mounted.store.set('$.data.done', true);

        // Act
        (mounted.element as Commanded).commands.clear?.();
        (mounted.element as Commanded).commands.focus?.();

        // Assert
        expect(mounted.store.get('$.data.done')).toBe(false);
        expect(control(mounted.element).checked).toBe(false);
        expect(mounted.element.shadowRoot?.activeElement).toBe(control(mounted.element));
    });

    it('should change colours in the dark overlay', async () => {
        // Arrange
        const mounted = mountComponent(name, {}, { mode: 'light' });
        const light = getComputedStyle(control(mounted.element)).backgroundColor;

        // Act
        mounted.setTheme('mode', 'dark');
        await new Promise((resolve) => setTimeout(resolve, 400));

        // Assert
        expect(getComputedStyle(control(mounted.element)).backgroundColor).not.toBe(light);
    });

    it('should show the German accessible name', () => {
        // Arrange
        const mounted = mountComponent(name);

        // Act
        mounted.setLocale('de');

        // Assert
        expect(control(mounted.element).getAttribute('aria-label')).toBe(german);
    });
});

describe('switch role in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should have role switch and a matching aria-checked, and a checkbox has neither', () => {
        // Arrange
        const mounted = mountComponent('switch', { checked: false });
        const box = mountComponent('checkbox');

        // Act
        const before = control(mounted.element).getAttribute('aria-checked');
        mounted.store.set('$.app.checked', true);

        // Assert
        expect(control(mounted.element).getAttribute('role')).toBe('switch');
        expect(before).toBe('false');
        expect(control(mounted.element).getAttribute('aria-checked')).toBe('true');
        expect(control(box.element).hasAttribute('role')).toBe(false);
    });
});
