import { afterEach, describe, expect, it } from 'vitest';
import { CORE_ICONS } from '../../.test-build/real/icons/core.js';
import { mountComponent } from '../harness/mountComponent.js';

const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const dataOf = (name: string): string[] => (CORE_ICONS[name]?.outline ?? []).map((path) => (typeof path === 'string' ? path : path.d));
const drawn = (element: Element, selector: string): string[] =>
    Array.from(part(element, selector)?.querySelectorAll('path') ?? []).map((path) => path.getAttribute('d') ?? '');

const findByTag = (root: ParentNode, tag: string): Element | undefined => {
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        if (candidate.localName === tag) return candidate;
        const inner = candidate.shadowRoot ? findByTag(candidate.shadowRoot, tag) : undefined;
        if (inner) return inner;
    }
    return undefined;
};

const undoAction = {
    component: 'button',
    _title: 'Undo',
    on: { press: { command: 'set', target: '$.data.undone', value: true } }
};

describe('toast in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it.each([
        ['danger', 'alert'],
        ['warning', 'alert'],
        ['neutral', 'status'],
        ['info', 'status'],
        ['success', 'status'],
        ['accent', 'status']
    ])('should give the %s tone the role %s', (tone, role) => {
        // Arrange
        const mounted = mountComponent('toast', { tone });

        // Assert
        expect(part(mounted.element, '.toast').getAttribute('role')).toBe(role);
    });

    it('should default to the neutral tone and be dismissible', () => {
        // Arrange
        const mounted = mountComponent('toast');

        // Assert
        expect(mounted.element.getAttribute('tone')).toBe('neutral');
        expect(part(mounted.element, '.close').getAttribute('aria-label')).toBe('Close');
    });

    it.each([
        ['neutral', 'info-circle'],
        ['danger', 'alert-circle'],
        ['warning', 'alert-triangle'],
        ['success', 'circle-check']
    ])('should draw the default icon of the %s tone', (tone, icon) => {
        // Arrange
        const mounted = mountComponent('toast', { tone });

        // Assert
        expect(drawn(mounted.element, '.toast > .glyph')).toEqual(dataOf(icon));
    });

    it('should draw the icon property over the tone default and follow a change', () => {
        // Arrange
        const mounted = mountComponent('toast', { tone: 'danger', icon: 'check' });
        expect(drawn(mounted.element, '.toast > .glyph')).toEqual(dataOf('check'));

        // Act
        mounted.store.set('$.app.icon', '');

        // Assert
        expect(drawn(mounted.element, '.toast > .glyph')).toEqual(dataOf('alert-circle'));
    });

    it('should show the title and text', () => {
        // Arrange
        const mounted = mountComponent('toast', { _title: 'Saved', _text: 'Order 12 stored' });

        // Assert
        expect(part(mounted.element, '.title').textContent).toBe('Saved');
        expect(part(mounted.element, '.text').textContent).toBe('Order 12 stored');
    });

    it('should show no close button when not dismissible', () => {
        // Arrange
        const mounted = mountComponent('toast', { dismissible: false });

        // Assert
        expect(part(mounted.element, '.close')).toBeNull();
    });

    it('should raise close once when the close button is pressed', () => {
        // Arrange
        const mounted = mountComponent('toast');
        let closed = 0;
        mounted.element.addEventListener('close', () => {
            closed += 1;
        });

        // Act
        part<HTMLButtonElement>(mounted.element, '.close').click();

        // Assert
        expect(closed).toBe(1);
    });

    it('should draw no action wrapper when there is no action', () => {
        // Arrange
        const mounted = mountComponent('toast');

        // Assert
        expect(part(mounted.element, '.action')).toBeNull();
    });

    it('should render a button in the action slot that fires on.press', () => {
        // Arrange
        const mounted = mountComponent('toast', { action: undoAction }, { data: { undone: false } });
        const button = findByTag(mounted.element.shadowRoot as ShadowRoot, 'ui-button');

        // Act
        button?.shadowRoot?.querySelector('button')?.click();

        // Assert
        expect(mounted.store.get('$.data.undone')).toBe(true);
    });

    it('should show German text and close label', () => {
        // Arrange
        const mounted = mountComponent('toast', {}, { locale: 'de' });

        // Assert
        expect(part(mounted.element, '.text').textContent).toBe('Nachricht');
        expect(part(mounted.element, '.close').getAttribute('aria-label')).toBe('Schließen');
    });

    it('should show a minion title and text in German through the document overlay', () => {
        // Arrange
        const mounted = mountComponent(
            'toast',
            { _title: 'Saved', _text: 'Stored' },
            { locale: 'de', locales: { de: { _title: 'Gespeichert', _text: 'Gesichert' } } }
        );

        // Assert
        expect(part(mounted.element, '.title').textContent).toBe('Gespeichert');
        expect(part(mounted.element, '.text').textContent).toBe('Gesichert');
    });
});
