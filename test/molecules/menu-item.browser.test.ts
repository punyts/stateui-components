import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const native = (element: Element): HTMLButtonElement => element.shadowRoot?.querySelector('button') as HTMLButtonElement;

const count = (element: Element): { presses: number } => {
    const state = { presses: 0 };
    element.addEventListener('press', () => {
        state.presses += 1;
    });
    return state;
};

describe('menuItem in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render the label, description, shortcut and icon', () => {
        // Arrange
        const mounted = mountComponent('menuItem', { _label: 'Save', _description: 'Write to disk', shortcut: 'Ctrl+S', icon: 'check' });

        // Act
        const root = mounted.element.shadowRoot as ShadowRoot;

        // Assert
        expect(root.querySelector('.label')?.textContent).toBe('Save');
        expect(root.querySelector('.description')?.textContent).toBe('Write to disk');
        expect(root.querySelector('.shortcut')?.textContent).toBe('Ctrl+S');
        expect(root.querySelector('.glyph path')).not.toBeNull();
        expect(native(mounted.element).getAttribute('aria-describedby')).toBe('description');
    });

    it('should raise press once on click', async () => {
        // Arrange
        const mounted = mountComponent('menuItem', {});
        const seen = count(mounted.element);

        // Act
        await userEvent.click(native(mounted.element));

        // Assert
        expect(seen.presses).toBe(1);
    });

    it('should raise press once each for Enter and Space', async () => {
        // Arrange
        const mounted = mountComponent('menuItem', {});
        const seen = count(mounted.element);
        native(mounted.element).focus();

        // Act
        await userEvent.keyboard('{Enter}');
        await userEvent.keyboard(' ');

        // Assert
        expect(seen.presses).toBe(2);
    });

    it('should not raise press while disabled', async () => {
        // Arrange
        const mounted = mountComponent('menuItem', { disabled: true });
        const seen = count(mounted.element);

        // Act
        native(mounted.element).click();
        native(mounted.element).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await userEvent.keyboard('{Enter}');

        // Assert
        expect(native(mounted.element).disabled).toBe(true);
        expect(seen.presses).toBe(0);
    });

    it('should expose selected as aria-current and style it', () => {
        // Arrange
        const mounted = mountComponent('menuItem', { selected: false });
        const plain = getComputedStyle(native(mounted.element)).fontWeight;

        // Act
        mounted.store.set('$.app.selected', true);

        // Assert
        expect(native(mounted.element).getAttribute('aria-current')).toBe('true');
        expect(getComputedStyle(native(mounted.element)).fontWeight).not.toBe(plain);
    });

    it('should leave aria-current off when not selected', () => {
        // Arrange
        const mounted = mountComponent('menuItem', {});

        // Assert
        expect(native(mounted.element).hasAttribute('aria-current')).toBe(false);
    });

    it('should show the German label after the locale switches', () => {
        // Arrange
        const mounted = mountComponent('menuItem', {});

        // Act
        mounted.setLocale('de');

        // Assert
        expect(mounted.element.shadowRoot?.querySelector('.label')?.textContent).toBe('Menüeintrag');
    });
});
