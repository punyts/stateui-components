import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

type Commanded = Element & { commands: Record<string, () => void> };

const button = (element: Element): HTMLButtonElement => element.shadowRoot?.querySelector('button') as HTMLButtonElement;

const record = (element: Element, name: string): unknown[] => {
    const details: unknown[] = [];
    element.addEventListener(name, (event) => details.push((event as CustomEvent).detail));
    return details;
};

describe('toggleButton in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render one button with its text, icon and aria-pressed false by default', () => {
        // Arrange and Act
        const mounted = mountComponent('toggleButton', { _text: 'Bold', icon: 'check' });

        // Assert
        expect(mounted.element.shadowRoot?.querySelectorAll('button')).toHaveLength(1);
        expect(button(mounted.element).getAttribute('aria-pressed')).toBe('false');
        expect(button(mounted.element).textContent?.trim()).toBe('Bold');
        expect(button(mounted.element).querySelector('.glyph svg')).not.toBeNull();
    });

    it('should flip pressed and raise change with the new value on a press, Enter and Space', async () => {
        // Arrange
        const mounted = mountComponent('toggleButton', { '<-pressed': '$.data.muted' }, { data: { muted: false } });
        const changes = record(mounted.element, 'change');

        // Act
        await userEvent.click(button(mounted.element));
        const pressed = button(mounted.element).getAttribute('aria-pressed');
        await userEvent.keyboard('{Enter}');
        await userEvent.keyboard(' ');

        // Assert
        expect(pressed).toBe('true');
        expect(changes).toEqual([true, false, true]);
        expect(mounted.store.get('$.data.muted')).toBe(true);
        expect(mounted.element.hasAttribute('pressed')).toBe(true);
    });

    it('should paint the pressed button in the solid tone whatever the variant', () => {
        // Arrange
        const off = mountComponent('toggleButton', { variant: 'ghost' });
        const on = mountComponent('toggleButton', { variant: 'ghost', pressed: true });
        const fill = (element: Element): string => getComputedStyle(button(element)).backgroundColor;

        // Assert
        expect(fill(on.element)).not.toBe(fill(off.element));
        expect(fill(on.element)).toBe(getComputedStyle(button(off.element)).color);
    });

    it('should not raise change for a write to pressed', () => {
        // Arrange
        const mounted = mountComponent('toggleButton', {});
        const changes = record(mounted.element, 'change');

        // Act
        mounted.store.set('$.app.pressed', true);

        // Assert
        expect(changes).toEqual([]);
        expect(button(mounted.element).getAttribute('aria-pressed')).toBe('true');
    });

    it('should be named by _text when only its icon shows', () => {
        // Arrange and Act
        const mounted = mountComponent('toggleButton', { icon: 'check', iconPosition: 'only', _text: 'Favourite' });

        // Assert
        expect(button(mounted.element).getAttribute('aria-label')).toBe('Favourite');
        expect(button(mounted.element).querySelector('.label')).toBeNull();
    });

    it('should take focus through the focus command', () => {
        // Arrange
        const mounted = mountComponent('toggleButton', {});

        // Act
        (mounted.element as Commanded).commands.focus();

        // Assert
        expect(mounted.element.shadowRoot?.activeElement).toBe(button(mounted.element));
    });

    it('should neither flip nor raise change when disabled', async () => {
        // Arrange
        const mounted = mountComponent('toggleButton', { disabled: true });
        const changes = record(mounted.element, 'change');

        // Act
        await userEvent.click(button(mounted.element), { force: true });

        // Assert
        expect(button(mounted.element).disabled).toBe(true);
        expect(mounted.store.get('$.app.pressed')).toBe(false);
        expect(changes).toEqual([]);
    });

    it('should show the Spanish text after switching language', () => {
        // Arrange
        const mounted = mountComponent('toggleButton', {});

        // Act
        mounted.setLocale('es');

        // Assert
        expect(button(mounted.element).textContent?.trim()).toBe('Alternar');
    });
});
