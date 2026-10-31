import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const part = (element: Element, selector: string): HTMLElement | null => element.shadowRoot?.querySelector(selector) ?? null;
const label = (element: Element): string => part(element, '.label')?.textContent?.trim() ?? '';

describe('badge in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render its text and follow a state write', () => {
        // Arrange
        const mounted = mountComponent('badge', { _text: 'Open' });

        // Act
        mounted.store.set('$.app._text', 'Closed');

        // Assert
        expect(label(mounted.element)).toBe('Closed');
    });

    it('should show content linked to $.data and update when the data changes', () => {
        // Arrange
        const mounted = mountComponent('badge', { '<-_text': '$.data.status' }, { data: { status: 'Paid' } });

        // Act
        mounted.store.set('$.data.status', 'Refunded');

        // Assert
        expect(label(mounted.element)).toBe('Refunded');
    });

    it('should show count 120 with max 99 as 99+', () => {
        // Arrange and Act
        const mounted = mountComponent('badge', { _text: 'Unread', count: 120, max: 99 });

        // Assert
        expect(label(mounted.element)).toBe('99+');
    });

    it('should show the count instead of the text, including 0, and follow a count linked to $.data', () => {
        // Arrange
        const mounted = mountComponent('badge', { _text: 'Unread', '<-count': '$.data.unread' }, { data: { unread: 0 } });
        expect(label(mounted.element)).toBe('0');

        // Act
        mounted.store.set('$.data.unread', 7);

        // Assert
        expect(label(mounted.element)).toBe('7');
    });

    it('should show the text when there is no count', () => {
        // Arrange and Act
        const mounted = mountComponent('badge', { _text: 'New' });

        // Assert
        expect(label(mounted.element)).toBe('New');
    });

    it('should hide the text with dot and keep it as the accessible name', () => {
        // Arrange and Act
        const mounted = mountComponent('badge', { _text: 'Online', dot: true });

        // Assert
        expect(part(mounted.element, '.label')).toBeNull();
        expect(part(mounted.element, '.dot')?.getAttribute('aria-label')).toBe('Online');
        expect(part(mounted.element, '.dot')?.getBoundingClientRect().width).toBeGreaterThan(0);
    });

    it('should draw an icon with the embedded icon component', () => {
        // Arrange and Act
        const mounted = mountComponent('badge', { _text: 'Done', icon: 'check' });
        const icon = part(mounted.element, '.icon');

        // Assert
        expect(icon?.querySelector('svg path')).not.toBeNull();
    });

    it('should paint each variant from the tone properties', () => {
        // Arrange
        const solid = mountComponent('badge', { tone: 'danger', variant: 'solid' });
        const soft = mountComponent('badge', { tone: 'danger', variant: 'soft' });
        const outline = mountComponent('badge', { tone: 'danger', variant: 'outline' });
        const ghost = mountComponent('badge', { tone: 'danger', variant: 'ghost' });
        const style = (mounted: { element: Element }): CSSStyleDeclaration =>
            getComputedStyle(part(mounted.element, '.badge') as HTMLElement);

        // Assert
        expect(style(solid).backgroundColor).not.toBe(style(soft).backgroundColor);
        expect(style(solid).color).not.toBe(style(soft).color);
        expect(style(outline).backgroundColor).toBe('rgba(0, 0, 0, 0)');
        expect(style(outline).borderTopColor).toBe(style(soft).color);
        expect(style(ghost).backgroundColor).toBe('rgba(0, 0, 0, 0)');
        expect(style(ghost).borderTopColor).toBe('rgba(0, 0, 0, 0)');
    });

    it('should default to the neutral tone and the soft variant', () => {
        // Arrange and Act
        const mounted = mountComponent('badge');

        // Assert
        expect(mounted.element.getAttribute('tone')).toBe('neutral');
        expect(mounted.element.getAttribute('variant')).toBe('soft');
    });

    it('should change colours in the dark overlay', () => {
        // Arrange
        const mounted = mountComponent('badge', { tone: 'success' });
        const badge = part(mounted.element, '.badge') as HTMLElement;
        const before = getComputedStyle(badge).backgroundColor;

        // Act
        mounted.setTheme('mode', 'dark');

        // Assert
        expect(getComputedStyle(badge).backgroundColor).not.toBe(before);
    });

    it('should show the German text', () => {
        // Arrange and Act
        const mounted = mountComponent('badge', {}, { locale: 'de' });

        // Assert
        expect(label(mounted.element)).toBe('Abzeichen');
    });
});
