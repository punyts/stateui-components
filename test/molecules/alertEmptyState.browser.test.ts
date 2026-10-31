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

const pressAction = {
    component: 'button',
    _title: 'Retry',
    on: { press: { command: 'set', target: '$.data.pressed', value: true } }
};

describe('alert in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it.each([
        ['info', 'info-circle'],
        ['neutral', 'info-circle'],
        ['danger', 'alert-circle'],
        ['warning', 'alert-triangle'],
        ['success', 'circle-check']
    ])('should draw the default icon of the %s tone', (tone, icon) => {
        // Arrange
        const mounted = mountComponent('alert', { tone });

        // Assert
        expect(drawn(mounted.element, '.alert > .glyph')).toEqual(dataOf(icon));
    });

    it('should draw the icon property over the tone default and follow a change', () => {
        // Arrange
        const mounted = mountComponent('alert', { tone: 'danger', icon: 'check' });
        expect(drawn(mounted.element, '.alert > .glyph')).toEqual(dataOf('check'));

        // Act
        mounted.store.set('$.app.icon', '');

        // Assert
        expect(drawn(mounted.element, '.alert > .glyph')).toEqual(dataOf('alert-circle'));
    });

    it('should use role alert for danger and warning and status for the others', () => {
        // Arrange
        const roles = ['danger', 'warning', 'info', 'success', 'neutral'].map(
            (tone) => part(mountComponent('alert', { tone }).element, '.alert').getAttribute('role')
        );

        // Assert
        expect(roles).toEqual(['alert', 'alert', 'status', 'status', 'status']);
    });

    it('should default to the info tone and the soft variant', () => {
        // Arrange
        const mounted = mountComponent('alert');

        // Assert
        expect(mounted.element.getAttribute('tone')).toBe('info');
        expect(mounted.element.getAttribute('variant')).toBe('soft');
    });

    it('should show the title and text', () => {
        // Arrange
        const mounted = mountComponent('alert', { _title: 'Saved', _text: 'All changes are stored' });

        // Assert
        expect(part(mounted.element, '.title').textContent).toBe('Saved');
        expect(part(mounted.element, '.text').textContent).toBe('All changes are stored');
    });

    it('should show no close button unless dismissible', () => {
        // Arrange
        const plain = mountComponent('alert');
        const dismissible = mountComponent('alert', { dismissible: true });

        // Assert
        expect(part(plain.element, '.close')).toBeNull();
        expect(part(dismissible.element, '.close').getAttribute('aria-label')).toBe('Close');
    });

    it('should write open false, raise close and leave the layout when dismissed', () => {
        // Arrange
        const mounted = mountComponent('alert', { dismissible: true });
        let closed = 0;
        mounted.element.addEventListener('close', () => {
            closed += 1;
        });

        // Act
        part<HTMLButtonElement>(mounted.element, '.close').click();

        // Assert
        expect(mounted.store.get('$.app.open')).toBe(false);
        expect(closed).toBe(1);
        expect(getComputedStyle(mounted.element).display).toBe('none');
    });

    it('should open and close through the commands', () => {
        // Arrange
        const mounted = mountComponent('alert');
        const commands = (mounted.element as Element & { commands: Record<string, () => void> }).commands;
        let closed = 0;
        mounted.element.addEventListener('close', () => {
            closed += 1;
        });

        // Act
        commands['close']?.();
        const hidden = getComputedStyle(mounted.element).display;
        commands['open']?.();

        // Assert
        expect(hidden).toBe('none');
        expect(mounted.store.get('$.app.open')).toBe(true);
        expect(getComputedStyle(mounted.element).display).toBe('block');
        expect(closed).toBe(1);
    });

    it('should render a button in the actions slot that fires on.press', () => {
        // Arrange
        const mounted = mountComponent('alert', { actions: pressAction }, { data: { pressed: false } });
        const button = findByTag(mounted.element.shadowRoot as ShadowRoot, 'ui-button');

        // Act
        button?.shadowRoot?.querySelector('button')?.click();

        // Assert
        expect(mounted.store.get('$.data.pressed')).toBe(true);
    });

    it('should show German title, text and close label', () => {
        // Arrange
        const mounted = mountComponent('alert', { dismissible: true }, { locale: 'de' });

        // Assert
        expect(part(mounted.element, '.text').textContent).toBe('Nachricht');
        expect(part(mounted.element, '.close').getAttribute('aria-label')).toBe('Schließen');
    });

    it('should show a minion title and text in German through the document overlay', () => {
        // Arrange
        const mounted = mountComponent(
            'alert',
            { _title: 'Saved', _text: 'Stored' },
            { locale: 'de', locales: { de: { _title: 'Gespeichert', _text: 'Alles gesichert' } } }
        );

        // Assert
        expect(part(mounted.element, '.title').textContent).toBe('Gespeichert');
        expect(part(mounted.element, '.text').textContent).toBe('Alles gesichert');
    });
});

describe('emptyState in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should show the icon, title and text', () => {
        // Arrange
        const mounted = mountComponent('emptyState', { icon: 'search', _title: 'No results', _text: 'Try another filter' });

        // Assert
        expect(drawn(mounted.element, '.glyph')).toEqual(dataOf('search'));
        expect(part(mounted.element, '.title').textContent).toBe('No results');
        expect(part(mounted.element, '.text').textContent).toBe('Try another filter');
    });

    it('should draw no icon and no actions when they are not set', () => {
        // Arrange
        const mounted = mountComponent('emptyState');

        // Assert
        expect(part(mounted.element, '.glyph')).toBeNull();
        expect(part(mounted.element, '.actions')).toBeNull();
    });

    it('should render a button in the actions slot that fires on.press', () => {
        // Arrange
        const mounted = mountComponent('emptyState', { actions: pressAction }, { data: { pressed: false } });
        const button = findByTag(mounted.element.shadowRoot as ShadowRoot, 'ui-button');

        // Act
        button?.shadowRoot?.querySelector('button')?.click();

        // Assert
        expect(mounted.store.get('$.data.pressed')).toBe(true);
    });

    it('should show the German title', () => {
        // Arrange
        const mounted = mountComponent('emptyState', {}, { locale: 'de' });

        // Assert
        expect(part(mounted.element, '.title').textContent).toBe('Noch nichts vorhanden');
    });

    it('should show a minion title and text in German through the document overlay', () => {
        // Arrange
        const mounted = mountComponent(
            'emptyState',
            { _title: 'Empty', _text: 'Nothing' },
            { locale: 'de', locales: { de: { _title: 'Leer', _text: 'Nichts' } } }
        );

        // Assert
        expect(part(mounted.element, '.title').textContent).toBe('Leer');
        expect(part(mounted.element, '.text').textContent).toBe('Nichts');
    });
});
