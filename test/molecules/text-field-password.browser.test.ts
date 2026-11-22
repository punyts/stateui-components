import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const control = (element: Element): HTMLInputElement => part<HTMLInputElement>(element, 'input');
const reveal = (element: Element): HTMLButtonElement => part<HTMLButtonElement>(element, '.reveal');

describe('textField passwords in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should show and hide what is typed with the reveal button', async () => {
        // Arrange
        const mounted = mountComponent('textField', { inputType: 'password', value: 'secret', _label: 'Password' });

        // Act
        reveal(mounted.element).click();
        await flush();
        const shown = control(mounted.element).type;
        const pressed = reveal(mounted.element).getAttribute('aria-pressed');
        const label = reveal(mounted.element).getAttribute('aria-label');
        reveal(mounted.element).click();
        await flush();

        // Assert
        expect(shown).toBe('text');
        expect(pressed).toBe('true');
        expect(label).toBe('Hide password');
        expect(control(mounted.element).type).toBe('password');
        expect(reveal(mounted.element).getAttribute('aria-label')).toBe('Show password');
    });

    it('should draw no reveal button for other types or when reveal is off', () => {
        // Arrange and Act
        const text = mountComponent('textField', { inputType: 'email' });
        const off = mountComponent('textField', { inputType: 'password', reveal: false });

        // Assert
        expect(reveal(text.element)).toBeNull();
        expect(reveal(off.element)).toBeNull();
    });

    it('should keep the reveal button inside the control box', () => {
        // Arrange and Act
        const mounted = mountComponent('textField', { inputType: 'password' });
        const box = control(mounted.element).getBoundingClientRect();
        const button = reveal(mounted.element).getBoundingClientRect();

        // Assert
        expect(button.right).toBeLessThanOrEqual(box.right);
        expect(button.top).toBeGreaterThanOrEqual(box.top);
        expect(button.bottom).toBeLessThanOrEqual(box.bottom);
    });

    it('should hint the strength of the typed password and describe the control with it', async () => {
        // Arrange
        const mounted = mountComponent('textField', { inputType: 'password', strength: true, _label: 'New password' });

        // Act
        await userEvent.type(control(mounted.element), 'Meadowlark-river-7');
        await flush();

        // Assert
        expect(mounted.element.getAttribute('level')).toBe('strong');
        expect(part(mounted.element, '.strength .level').textContent).toBe('Strong password');
        expect(control(mounted.element).getAttribute('aria-describedby')).toBe('strength');
        expect(part<HTMLElement>(mounted.element, '.fill').getBoundingClientRect().width).toBeCloseTo(part(mounted.element, '.track').getBoundingClientRect().width, 0);
    });

    it('should show no hint for an empty password or with strength off, and the German text after switching', async () => {
        // Arrange
        const empty = mountComponent('textField', { inputType: 'password', strength: true });
        const off = mountComponent('textField', { inputType: 'password', value: 'cat' });
        const weak = mountComponent('textField', { inputType: 'password', strength: true, value: 'cat' });

        // Act
        weak.setLocale('de');
        await flush();

        // Assert
        expect(part(empty.element, '.strength')).toBeNull();
        expect(part(off.element, '.strength')).toBeNull();
        expect(part(weak.element, '.strength .level').textContent).toBe('Schwaches Passwort');
        expect(weak.element.getAttribute('level')).toBe('weak');
    });
});
