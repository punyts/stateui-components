import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const part = <T extends Element>(element: Element, selector: string): T | null => element.shadowRoot?.querySelector<T>(selector) ?? null;
const all = (element: Element, selector: string): HTMLElement[] => Array.from(element.shadowRoot?.querySelectorAll<HTMLElement>(selector) ?? []);
const titles = (element: Element): string[] => all(element, '.event .title').map((title) => title.textContent ?? '');

const history = [
    { _title: 'Delivered', time: 'Today, 14:02', text: 'Left at the front door', icon: 'check', tone: 'success' },
    { title: 'Out for delivery', time: 'Today, 08:15' },
    { _title: 'Shipped', title: 'ignored', time: '2 days ago', tone: 'nope' }
];

describe('timeline in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should list the events in the order given as a named ordered list, _title before title and time as given', () => {
        // Arrange and Act
        const mounted = mountComponent('timeline', { entries: history, _label: 'Order history' });
        const list = part<HTMLOListElement>(mounted.element, 'ol');

        // Assert
        expect(list?.getAttribute('aria-label')).toBe('Order history');
        expect(all(mounted.element, 'ol > li')).toHaveLength(3);
        expect(titles(mounted.element)).toEqual(['Delivered', 'Out for delivery', 'Shipped']);
        expect(all(mounted.element, '.time').map((time) => time.textContent)).toEqual(['Today, 14:02', 'Today, 08:15', '2 days ago']);
        expect(all(mounted.element, '.text').map((text) => text.textContent)).toEqual(['Left at the front door']);
    });

    it('should draw an icon in the marker of an event that has one and a plain dot otherwise, hidden from assistive technology', () => {
        // Arrange and Act
        const mounted = mountComponent('timeline', { entries: history });
        const markers = all(mounted.element, '.marker');

        // Assert
        expect(markers[0]?.querySelector('ui-icon')?.getAttribute('name')).toBe('check');
        expect(markers[1]?.querySelector('ui-icon')).toBeNull();
        expect(markers.every((marker) => marker.getAttribute('aria-hidden') === 'true')).toBe(true);
    });

    it('should paint each marker in its own tone, or the timeline tone for an event without a known one', () => {
        // Arrange
        const mounted = mountComponent('timeline', { entries: history, tone: 'info' });
        const events = all(mounted.element, '.event');
        const dot = (event: HTMLElement | undefined): string => getComputedStyle(event?.querySelector('.marker') as Element, '::after').backgroundColor;

        // Assert
        expect(events.map((event) => event.dataset['tone'] ?? '')).toEqual(['success', '', '']);
        expect(getComputedStyle(events[0]?.querySelector('.marker') as Element).color).not.toBe(dot(events[1]));
        expect(dot(events[1])).toBe(dot(events[2]));
    });

    it('should follow a map of entries in key order and a later write', () => {
        // Arrange
        const mounted = mountComponent('timeline', { '<-entries': '$.data.log' }, { data: { log: { b: { title: 'First' }, a: { title: 'Second' } } } });

        // Act
        mounted.store.set('$.data.log.c', { title: 'Third' });

        // Assert
        expect(titles(mounted.element)).toEqual(['First', 'Second', 'Third']);
    });

    it('should show the empty text instead of a list without entries', () => {
        // Arrange and Act
        const mounted = mountComponent('timeline', {});

        // Assert
        expect(part(mounted.element, 'ol')).toBeNull();
        expect(part(mounted.element, '.empty')?.textContent).toBe('Nothing has happened yet');
    });

    it('should reflect the compact appearance and tighten the gap between events', () => {
        // Arrange
        const comfortable = mountComponent('timeline', { entries: history });
        const compact = mountComponent('timeline', { entries: history, appearance: 'compact' });
        const gap = (element: Element): number => parseFloat(getComputedStyle(all(element, '.event')[0] as Element).paddingBlockEnd);

        // Assert
        expect(compact.element.getAttribute('appearance')).toBe('compact');
        expect(gap(compact.element)).toBeLessThan(gap(comfortable.element));
    });

    it('should name the list and the empty text in German after switching language', () => {
        // Arrange
        const listed = mountComponent('timeline', { entries: history });
        const empty = mountComponent('timeline', {});

        // Act
        listed.setLocale('de');
        empty.setLocale('de');

        // Assert
        expect(part(listed.element, 'ol')?.getAttribute('aria-label')).toBe('Verlauf');
        expect(part(empty.element, '.empty')?.textContent).toBe('Noch ist nichts passiert');
    });
});
