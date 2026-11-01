import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async (): Promise<void> => {
    await flush();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await flush();
};

const entries = (): Record<string, string>[] => [
    { id: 'whole', title: 'Whole', start: '2026-03-10T09:00', end: '2026-03-10T10:00' },
    { id: 'part', title: 'Part', start: '2026-03-10T10:15', end: '2026-03-10T11:50' },
    { id: 'night', title: 'Night', start: '2026-03-10T22:00', end: '2026-03-11T02:30' },
    { id: 'a', title: 'A', start: '2026-03-12T09:00', end: '2026-03-12T11:00' },
    { id: 'b', title: 'B', start: '2026-03-12T10:00', end: '2026-03-12T12:00' },
    { id: 'trip', title: 'Trip', start: '2026-03-13', end: '2026-03-14' }
];

const root = (mounted: MountedComponent): ShadowRoot => mounted.element.shadowRoot as ShadowRoot;
const columns = (mounted: MountedComponent): HTMLElement[] => Array.from(root(mounted).querySelectorAll<HTMLElement>('.column'));
const columnOf = (mounted: MountedComponent, iso: string): HTMLElement => columns(mounted).find((column) => column.dataset['date'] === iso) as HTMLElement;
const recordOf = (mounted: MountedComponent, iso: string, title: string): HTMLElement =>
    Array.from(columnOf(mounted, iso).querySelectorAll<HTMLElement>('.record')).find((record) => record.querySelector('.name')?.textContent?.trim() === title) as HTMLElement;
const prop = (element: HTMLElement, name: string): string => element.style.getPropertyValue(name).trim();
const heading = (mounted: MountedComponent): string => (root(mounted).querySelector('.heading')?.textContent ?? '').replace(/\s/gu, ' ').trim();
const listen = (mounted: MountedComponent, name: string): unknown[] => {
    const seen: unknown[] = [];
    mounted.element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};

const mountCalendar = async (extra: Record<string, unknown> = {}, options: Parameters<typeof mountComponent>[2] = {}): Promise<MountedComponent> => {
    const mounted = mountComponent('calendar', { view: 'week', date: '2026-03-10', '<-records': '$.data.entries', ...extra }, { data: { entries: entries() }, ...options });
    (mounted.element as HTMLElement).style.inlineSize = '900px';
    await settle();
    return mounted;
};

describe('calendar week and day views in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should draw the week as a grid with seven day columns, 24 hour rows and the range as heading', async () => {
        // Arrange and Act
        const mounted = await mountCalendar();
        const grid = root(mounted).querySelector('.schedule') as HTMLElement;

        // Assert
        expect(grid.getAttribute('role')).toBe('grid');
        expect(root(mounted).querySelector('.month')).toBeNull();
        expect(columns(mounted).map((column) => column.dataset['date'])).toEqual(['2026-03-08', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14']);
        expect(columns(mounted).every((column) => column.getAttribute('role') === 'gridcell')).toBe(true);
        expect(root(mounted).querySelectorAll('.hour')).toHaveLength(24);
        expect(root(mounted).querySelectorAll('.dayhead')).toHaveLength(7);
        expect(root(mounted).querySelector('.hour')?.textContent?.replace(/\s/gu, ' ')).toBe('12 AM');
        expect(heading(mounted)).toBe('Mar 8 – 14, 2026');
        expect(columns(mounted).filter((column) => column.tabIndex === 0).map((column) => column.dataset['date'])).toEqual(['2026-03-10']);
    });

    it('should position records by start and span in minutes, for whole and partial hours', async () => {
        // Arrange and Act
        const mounted = await mountCalendar();
        const whole = recordOf(mounted, '2026-03-10', 'Whole');
        const part = recordOf(mounted, '2026-03-10', 'Part');

        // Assert
        expect([prop(whole, '--sui-start'), prop(whole, '--sui-span')]).toEqual(['540', '60']);
        expect([prop(part, '--sui-start'), prop(part, '--sui-span')]).toEqual(['615', '95']);
    });

    it('should put the box where the minutes say, from the hour height', async () => {
        // Arrange
        const mounted = await mountCalendar();
        const hour = (root(mounted).querySelector('.hour') as HTMLElement).getBoundingClientRect().height;
        const column = columnOf(mounted, '2026-03-10').getBoundingClientRect();

        // Act
        const whole = recordOf(mounted, '2026-03-10', 'Whole').getBoundingClientRect();
        const part = recordOf(mounted, '2026-03-10', 'Part').getBoundingClientRect();

        // Assert
        expect(whole.top - column.top).toBeCloseTo(9 * hour, 0);
        expect(whole.height).toBeCloseTo(hour, 0);
        expect(part.top - column.top).toBeCloseTo(10.25 * hour, 0);
        expect(part.height).toBeCloseTo((95 / 60) * hour, 0);
    });

    it('should draw records that overlap side by side, each in its own part of the width', async () => {
        // Arrange and Act
        const mounted = await mountCalendar();
        const a = recordOf(mounted, '2026-03-12', 'A');
        const b = recordOf(mounted, '2026-03-12', 'B');

        // Assert
        expect([prop(a, '--sui-column'), prop(a, '--sui-columns')]).toEqual(['0', '2']);
        expect([prop(b, '--sui-column'), prop(b, '--sui-columns')]).toEqual(['1', '2']);
        const boxA = a.getBoundingClientRect();
        const boxB = b.getBoundingClientRect();
        const column = columnOf(mounted, '2026-03-12').getBoundingClientRect();
        expect(Math.abs(boxA.width - column.width / 2)).toBeLessThan(2);
        expect(boxB.left).toBeGreaterThanOrEqual(boxA.right - 1);
        expect(boxA.bottom).toBeGreaterThan(boxB.top);
    });

    it('should draw a record that crosses midnight in both days, clipped to each', async () => {
        // Arrange and Act
        const mounted = await mountCalendar();
        const first = recordOf(mounted, '2026-03-10', 'Night');
        const second = recordOf(mounted, '2026-03-11', 'Night');

        // Assert
        expect([prop(first, '--sui-start'), prop(first, '--sui-span')]).toEqual(['1320', '120']);
        expect([prop(second, '--sui-start'), prop(second, '--sui-span')]).toEqual(['0', '150']);
        expect(second.querySelector('.time')).toBeNull();
    });

    it('should show all-day records under the day heading and not in the hours', async () => {
        // Arrange and Act
        const mounted = await mountCalendar();
        const heads = Array.from(root(mounted).querySelectorAll('.dayhead'));

        // Assert
        expect(heads[5]?.querySelectorAll('.record.allday')).toHaveLength(1);
        expect(heads[6]?.querySelectorAll('.record.allday')).toHaveLength(1);
        expect(heads[4]?.querySelectorAll('.record.allday')).toHaveLength(0);
        expect(columnOf(mounted, '2026-03-13').querySelectorAll('.record')).toHaveLength(0);
    });

    it('should draw the day view as one column with the whole date as heading', async () => {
        // Arrange and Act
        const mounted = await mountCalendar({ view: 'day' });

        // Assert
        expect(columns(mounted).map((column) => column.dataset['date'])).toEqual(['2026-03-10']);
        expect(heading(mounted)).toBe('Tuesday, March 10, 2026');
        expect(root(mounted).querySelectorAll('.hour')).toHaveLength(24);
        expect(columnOf(mounted, '2026-03-10').querySelectorAll('.record')).toHaveLength(3);
        expect(prop(recordOf(mounted, '2026-03-10', 'Part'), '--sui-start')).toBe('615');
    });

    it('should keep date and raise range for the new range when the view is switched', async () => {
        // Arrange
        const mounted = await mountCalendar({ view: 'month' });
        const ranges = listen(mounted, 'range');
        expect(root(mounted).querySelector('.month')).not.toBeNull();

        // Act
        mounted.store.set('$.app.view', 'week');
        await settle();
        mounted.store.set('$.app.view', 'day');
        await settle();
        mounted.store.set('$.app.view', 'month');
        await settle();

        // Assert
        expect(mounted.store.get('$.app.date')).toBe('2026-03-10');
        expect(ranges).toEqual([
            { start: '2026-03-08', end: '2026-03-14' },
            { start: '2026-03-10', end: '2026-03-10' },
            { start: '2026-03-01', end: '2026-04-11' }
        ]);
        expect(root(mounted).querySelector('.schedule')).toBeNull();
        expect(root(mounted).querySelectorAll('.day')).toHaveLength(42);
    });

    it('should move a week with the buttons and Page Down, and a day with the arrows, raising range for a new week only', async () => {
        // Arrange
        const mounted = await mountCalendar();
        const ranges = listen(mounted, 'range');
        columnOf(mounted, '2026-03-10').focus();

        // Act
        columnOf(mounted, '2026-03-10').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true, cancelable: true }));
        await settle();

        // Assert
        expect(mounted.store.get('$.app.date')).toBe('2026-03-11');
        expect((root(mounted).activeElement as HTMLElement).dataset['date']).toBe('2026-03-11');
        expect(ranges).toEqual([]);

        // Act
        columnOf(mounted, '2026-03-11').dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, composed: true, cancelable: true }));
        await settle();

        // Assert
        expect(mounted.store.get('$.app.date')).toBe('2026-03-18');
        expect(heading(mounted)).toBe('Mar 15 – 21, 2026');
        expect(ranges).toEqual([{ start: '2026-03-15', end: '2026-03-21' }]);

        // Act
        (root(mounted).querySelectorAll<HTMLElement>('.nav')[0] as HTMLElement).click();
        await settle();
        expect(mounted.store.get('$.app.date')).toBe('2026-03-11');
    });

    it('should raise open for a record and select for a day column', async () => {
        // Arrange
        const mounted = await mountCalendar();
        const opened = listen(mounted, 'open');
        const selected = listen(mounted, 'select');

        // Act
        recordOf(mounted, '2026-03-10', 'Part').click();
        columnOf(mounted, '2026-03-09').click();
        await settle();

        // Assert
        expect(opened).toEqual(['part']);
        expect(selected).toEqual(['2026-03-09']);
    });

    it('should start the week on Monday, with German names, in de', async () => {
        // Arrange
        const mounted = await mountCalendar();

        // Act
        mounted.setLocale('de');
        await settle();

        // Assert
        expect(columns(mounted)[0]?.dataset['date']).toBe('2026-03-09');
        expect(heading(mounted)).toContain('März');
        expect(root(mounted).querySelector('.hour')?.textContent?.trim()).toMatch(/^0?0/u);
        expect(columnOf(mounted, '2026-03-10').getAttribute('aria-label')).toBe('Dienstag, 10. März 2026');
    });

    it('should draw a data change in the hours', async () => {
        // Arrange
        const mounted = await mountCalendar();

        // Act
        mounted.store.set('$.data.entries.0.start', '2026-03-10T13:30');
        mounted.store.set('$.data.entries.0.end', '2026-03-10T14:30');
        await settle();

        // Assert
        expect(prop(recordOf(mounted, '2026-03-10', 'Whole'), '--sui-start')).toBe('810');
    });
});
