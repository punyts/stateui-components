import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async (): Promise<void> => {
    await flush();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await flush();
};

const BOOKINGS = [
    { id: 'a', title: 'Standup', start: '2026-03-10T09:30', end: '2026-03-10T10:00', room: 'north' },
    { id: 'b', title: 'Planning', start: '2026-03-10T09:45', end: '2026-03-10T11:00', room: 'north' },
    { id: 'c', title: 'Interview', start: '2026-03-10T13:00', end: '2026-03-10T14:00', room: 'south' },
    { id: 'd', title: 'Offsite', start: '2026-03-18', room: 'south' }
];

const root = (mounted: MountedComponent): ShadowRoot => mounted.element.shadowRoot as ShadowRoot;
const texts = (mounted: MountedComponent, selector: string): string[] => Array.from(root(mounted).querySelectorAll(selector)).map((node) => node.textContent?.trim() ?? '');

const mountCalendar = async (extra: Record<string, unknown>, records: unknown = BOOKINGS): Promise<MountedComponent> => {
    const mounted = mountComponent('calendar', { date: '2026-03-10', resourceField: 'room', '<-records': '$.data.bookings', ...extra }, { data: { bookings: records } });
    (mounted.element as HTMLElement).style.inlineSize = '900px';
    await settle();
    return mounted;
};

describe('calendar agenda and timeline views in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should list the days of the month that have records, with their times', async () => {
        // Arrange and Act
        const mounted = await mountCalendar({ view: 'agenda' });
        const first = root(mounted).querySelector('.agendaday');

        // Assert
        expect(texts(mounted, '.heading')).toEqual(['March 2026']);
        expect(root(mounted).querySelectorAll('.agendaday')).toHaveLength(2);
        expect(first?.querySelector('.dayname')?.getAttribute('data-date')).toBe('2026-03-10');
        expect(Array.from(first?.querySelectorAll('.record .name') ?? []).map((name) => name.textContent)).toEqual(['Standup', 'Planning', 'Interview']);
        expect(first?.querySelector('.record')?.getAttribute('aria-label')).toMatch(/^Standup, 9:30\sAM – 10:00\sAM$/);
    });

    it('should raise open for a record and select for a day in the agenda, and page by month', async () => {
        // Arrange
        const mounted = await mountCalendar({ view: 'agenda' });
        const opened: unknown[] = [];
        const selected: unknown[] = [];
        mounted.element.addEventListener('open', (event) => opened.push((event as CustomEvent).detail));
        mounted.element.addEventListener('select', (event) => selected.push((event as CustomEvent).detail));

        // Act
        root(mounted).querySelector<HTMLElement>('[data-record="d"]')?.click();
        root(mounted).querySelector<HTMLElement>('.dayname')?.click();
        root(mounted).querySelector<HTMLElement>('.dayname')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, composed: true }));
        await settle();

        // Assert
        expect(opened).toEqual(['d']);
        expect(selected).toEqual(['2026-03-10']);
        expect(mounted.store.get('$.app.date')).toBe('2026-04-10');
        expect(texts(mounted, '.empty')).toEqual(['Nothing scheduled']);
    });

    it('should draw a timeline row per resource with overlapping records in lanes', async () => {
        // Arrange and Act
        const mounted = await mountCalendar({ view: 'timeline', resources: { north: { _label: 'North room' }, south: { _label: 'South room' } } });
        const rows = Array.from(root(mounted).querySelectorAll<HTMLElement>('.lane[data-resource]'));
        const standup = root(mounted).querySelector<HTMLElement>('[data-record="a"]') as HTMLElement;
        const planning = root(mounted).querySelector<HTMLElement>('[data-record="b"]') as HTMLElement;

        // Assert
        expect(rows.map((row) => row.querySelector('.resource > .name')?.textContent)).toEqual(['North room', 'South room']);
        expect(rows[0]?.style.getPropertyValue('--sui-lanes').trim()).toBe('2');
        expect(standup.style.getPropertyValue('--sui-start').trim()).toBe('570');
        expect(standup.getBoundingClientRect().top).toBeLessThan(planning.getBoundingClientRect().top);
        expect(planning.getBoundingClientRect().left).toBeGreaterThan(standup.getBoundingClientRect().left);
        expect(rows[1]?.querySelector('[data-record="c"]')?.getAttribute('aria-label')).toMatch(/^Interview, South room, 1:00\sPM – 2:00\sPM$/);
        expect(texts(mounted, '.tick')).toHaveLength(24);
    });

    it('should take the rows from the records when no resources are given', async () => {
        // Arrange and Act
        const mounted = await mountCalendar({ view: 'timeline' });

        // Assert
        expect(texts(mounted, '.lane[data-resource] .resource > .name')).toEqual(['north', 'south']);
    });
});
