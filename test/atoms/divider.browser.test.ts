import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const line = (element: Element): HTMLElement => element.shadowRoot?.querySelector('[role=separator]') as HTMLElement;
const label = (element: Element): Element | null => element.shadowRoot?.querySelector('.label') ?? null;

describe('divider in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should be a horizontal separator by default and follow a state write', () => {
        // Arrange
        const mounted = mountComponent('divider');
        const before = line(mounted.element).getAttribute('aria-orientation');

        // Act
        mounted.store.set('$.app.orientation', 'vertical');

        // Assert
        expect(line(mounted.element).getAttribute('role')).toBe('separator');
        expect(before).toBe('horizontal');
        expect(line(mounted.element).getAttribute('aria-orientation')).toBe('vertical');
    });

    it('should show the label only when it is not empty', () => {
        // Arrange
        const mounted = mountComponent('divider');
        const empty = label(mounted.element);

        // Act
        mounted.store.set('$.app._label', 'or');
        const shown = label(mounted.element)?.textContent;
        mounted.store.set('$.app._label', '');

        // Assert
        expect(empty).toBeNull();
        expect(shown).toBe('or');
        expect(label(mounted.element)).toBeNull();
    });

    it('should name the separator by its label only when there is one', () => {
        // Arrange
        const labelled = mountComponent('divider', { _label: 'or' });
        const bare = mountComponent('divider');

        // Act
        const name = line(labelled.element).getAttribute('aria-label');

        // Assert
        expect(name).toBe('or');
        expect(line(bare.element).hasAttribute('aria-label')).toBe(false);
    });

    it('should draw the line with the border token and change it in the dark overlay', () => {
        // Arrange
        const mounted = mountComponent('divider');
        const before = getComputedStyle(line(mounted.element), '::before').borderBlockStartColor;

        // Act
        mounted.setTheme('mode', 'dark');

        // Assert
        expect(getComputedStyle(line(mounted.element), '::before').borderBlockStartWidth).toBe('1px');
        expect(getComputedStyle(line(mounted.element), '::before').borderBlockStartColor).not.toBe(before);
    });

    it('should draw a vertical line as a column', () => {
        // Arrange and Act
        const mounted = mountComponent('divider', { orientation: 'vertical' });

        // Assert
        expect(getComputedStyle(line(mounted.element)).flexDirection).toBe('column');
        expect(getComputedStyle(line(mounted.element), '::before').borderInlineStartWidth).toBe('1px');
    });

    it('should show a linked label and update when the data changes', () => {
        // Arrange
        const mounted = mountComponent('divider', { '<-_label': '$.data.heading' }, { data: { heading: 'First' } });

        // Act
        mounted.store.set('$.data.heading', 'Second');

        // Assert
        expect(label(mounted.element)?.textContent).toBe('Second');
    });

    it('should keep an empty label under the German overlay', () => {
        // Arrange
        const mounted = mountComponent('divider');

        // Act
        mounted.setLocale('de');

        // Assert
        expect(label(mounted.element)).toBeNull();
    });
});
