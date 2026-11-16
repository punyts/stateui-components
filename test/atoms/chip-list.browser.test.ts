import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const ITEMS = { f1: { text: 'button · save' }, f2: { text: 'panel · header', icon: 'check' }, f3: { text: 'text · title' } };

const all = <T extends Element>(element: Element, selector: string): T[] => Array.from(element.shadowRoot?.querySelectorAll<T>(selector) ?? []);
const texts = (element: Element): string[] => all(element, '.text').map((text) => text.textContent ?? '');
const removes = (element: Element): HTMLButtonElement[] => all<HTMLButtonElement>(element, 'button.remove');

const record = (element: Element, name: string): unknown[] => {
    const details: unknown[] = [];
    element.addEventListener(name, (event) => details.push((event as CustomEvent).detail));
    return details;
};

describe('chipList in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should draw a chip per item in the order of the map, with its icon, as a labelled list', () => {
        // Act
        const mounted = mountComponent('chipList', { items: ITEMS, _label: 'About' });

        // Assert
        expect(texts(mounted.element)).toEqual(['button · save', 'panel · header', 'text · title']);
        expect(all(mounted.element, 'ui-icon.glyph').map((icon) => icon.getAttribute('name'))).toEqual(['check']);
        expect(mounted.element.shadowRoot?.querySelector('.chips')?.getAttribute('role')).toBe('list');
        expect(mounted.element.shadowRoot?.querySelector('.chips')?.getAttribute('aria-label')).toBe('About');
        expect(removes(mounted.element).map((button) => button.getAttribute('aria-label'))).toEqual(['Remove button · save', 'Remove panel · header', 'Remove text · title']);
    });

    it('should raise remove with the key of the chip pressed, and leave the data to the app', async () => {
        // Arrange
        const mounted = mountComponent('chipList', { items: ITEMS });
        const removed = record(mounted.element, 'remove');

        // Act
        await userEvent.click(removes(mounted.element)[1] as HTMLButtonElement);

        // Assert
        expect(removed).toEqual(['f2']);
        expect(texts(mounted.element)).toHaveLength(3);
    });

    it('should raise remove on Delete or Backspace, and move the focus to the next chip', async () => {
        // Arrange
        const mounted = mountComponent('chipList', { items: ITEMS });
        const removed = record(mounted.element, 'remove');
        const [first, second, third] = removes(mounted.element) as [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement];

        // Act
        first.focus();
        await userEvent.keyboard('{Delete}');
        const afterDelete = mounted.element.shadowRoot?.activeElement;
        third.focus();
        await userEvent.keyboard('{Backspace}');

        // Assert
        expect(removed).toEqual(['f1', 'f3']);
        expect(afterDelete).toBe(second);
        expect(mounted.element.shadowRoot?.activeElement).toBe(second);
    });

    it('should follow the data: a chip goes when its item is removed', () => {
        // Arrange
        const mounted = mountComponent('chipList', { '<-items': '$.data.about' }, { data: { about: ITEMS } });

        // Act
        mounted.store.delete('$.data.about.f2');

        // Assert
        expect(texts(mounted.element)).toEqual(['button · save', 'text · title']);
    });

    it('should draw no buttons when not removable, and raise nothing while disabled', async () => {
        // Arrange
        const fixed = mountComponent('chipList', { items: ITEMS, removable: false });
        const disabled = mountComponent('chipList', { items: ITEMS, disabled: true });
        const removed = record(disabled.element, 'remove');

        // Act
        (removes(disabled.element)[0] as HTMLButtonElement).click();

        // Assert
        expect(removes(fixed.element)).toEqual([]);
        expect(removed).toEqual([]);
    });

    it('should name the remove buttons in German', () => {
        // Act
        const mounted = mountComponent('chipList', { items: { f1: { text: 'Titel' } } }, { locale: 'de' });

        // Assert
        expect(removes(mounted.element)[0]?.getAttribute('aria-label')).toBe('Titel entfernen');
    });
});
