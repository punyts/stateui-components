import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async (): Promise<void> => {
    await flush();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await flush();
};

interface Entry {
    id: string;
    title: string;
    start: string;
    end?: string;
}

const entries = (): Entry[] => [
    { id: 'a', title: 'Standup', start: '2026-03-10T09:30', end: '2026-03-10T10:00' },
    { id: 'b', title: 'Trip', start: '2026-03-12', end: '2026-03-14' },
    { id: 'c', title: 'Review', start: '2026-03-20' }
];

const root = (mounted: MountedComponent): ShadowRoot => mounted.element.shadowRoot as ShadowRoot;
const cells = (mounted: MountedComponent): HTMLElement[] => Array.from(root(mounted).querySelectorAll<HTMLElement>('.day'));
const cellOf = (mounted: MountedComponent, iso: string): HTMLElement => cells(mounted).find((cell) => cell.dataset['date'] === iso) as HTMLElement;
const recordsOf = (cell: HTMLElement): string[] => Array.from(cell.querySelectorAll<HTMLElement>('.record .name')).map((name) => name.textContent?.trim() ?? '');
const moreOf = (cell: HTMLElement): HTMLElement | null => cell.querySelector<HTMLElement>('.more');
const heading = (mounted: MountedComponent): string => root(mounted).querySelector('.heading')?.textContent?.trim() ?? '';
const weekdays = (mounted: MountedComponent): string[] => Array.from(root(mounted).querySelectorAll('.weekday')).map((head) => head.textContent?.trim() ?? '');
const tabStops = (mounted: MountedComponent): string[] => cells(mounted).filter((cell) => cell.tabIndex === 0).map((cell) => cell.dataset['date'] ?? '');

const mountCalendar = async (
    records: unknown = entries(),
    extra: Record<string, unknown> = {},
    options: Parameters<typeof mountComponent>[2] = {}
): Promise<MountedComponent> => {
    const mounted = mountComponent('calendar', { date: '2026-03-10', '<-records': '$.data.entries', ...extra }, { data: { entries: records }, ...options });
    (mounted.element as HTMLElement).style.inlineSize = '800px';
    await settle();
    return mounted;
};

const press = (cell: HTMLElement, key: string, init: KeyboardEventInit = {}): void => {
    cell.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true, ...init }));
};
const listen = (mounted: MountedComponent, name: string): unknown[] => {
    const seen: unknown[] = [];
    mounted.element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};
const focused = (mounted: MountedComponent): string => (root(mounted).activeElement as HTMLElement | null)?.dataset['date'] ?? '';

describe('calendar month view in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should draw a grid of six rows of seven days with the weekday headings, Sunday first for en', async () => {
        // Arrange and Act
        const mounted = await mountCalendar();
        const grid = root(mounted).querySelector('.month') as HTMLElement;

        // Assert
        expect(grid.getAttribute('role')).toBe('grid');
        expect(grid.getAttribute('aria-labelledby')).toBe('heading');
        expect(root(mounted).querySelectorAll('.row[role="row"]')).toHaveLength(7);
        expect(cells(mounted)).toHaveLength(42);
        expect(cells(mounted).every((cell) => cell.getAttribute('role') === 'gridcell')).toBe(true);
        expect(weekdays(mounted)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
        expect(heading(mounted)).toBe('March 2026');
        expect(cells(mounted)[0]?.dataset['date']).toBe('2026-03-01');
        expect(cells(mounted)[41]?.dataset['date']).toBe('2026-04-11');
        expect(cells(mounted).filter((cell) => !cell.hasAttribute('data-outside'))).toHaveLength(31);
        expect(cellOf(mounted, '2026-03-14').getAttribute('aria-label')).toBe('Saturday, March 14, 2026');
    });

    it('should lay the weekday headings out in one row, each above its column of days', async () => {
        // Arrange and Act
        const mounted = await mountCalendar();
        const heads = Array.from(root(mounted).querySelectorAll<HTMLElement>('.month .weekday')).map((head) => head.getBoundingClientRect());
        const firstWeek = cells(mounted).slice(0, 7).map((cell) => cell.getBoundingClientRect());

        // Assert: one shared top, and the left edge of each heading at the left edge of its day
        expect(new Set(heads.map((box) => Math.round(box.top))).size).toBe(1);
        heads.forEach((box, index) => expect(Math.abs(box.left - (firstWeek[index]?.left ?? 0)), `column ${index}`).toBeLessThan(1));
    });

    it('should show each record on the days it covers, with the time of a timed record', async () => {
        // Arrange and Act
        const mounted = await mountCalendar();

        // Assert
        expect(recordsOf(cellOf(mounted, '2026-03-10'))).toEqual(['Standup']);
        expect(cellOf(mounted, '2026-03-10').querySelector('.time')?.textContent?.replace(/\s/gu, ' ')).toBe('9:30 AM');
        for (const iso of ['2026-03-12', '2026-03-13', '2026-03-14']) expect(recordsOf(cellOf(mounted, iso))).toEqual(['Trip']);
        expect(recordsOf(cellOf(mounted, '2026-03-11'))).toEqual([]);
        expect(recordsOf(cellOf(mounted, '2026-03-15'))).toEqual([]);
        expect(recordsOf(cellOf(mounted, '2026-03-20'))).toEqual(['Review']);
        expect(cellOf(mounted, '2026-03-20').querySelector('.time')).toBeNull();
    });

    it('should show records of the neighbouring months on the days that fill the grid', async () => {
        // Arrange and Act
        const mounted = await mountCalendar([{ id: 'x', title: 'Edge', start: '2026-04-02' }]);

        // Assert
        expect(cellOf(mounted, '2026-04-02').hasAttribute('data-outside')).toBe(true);
        expect(recordsOf(cellOf(mounted, '2026-04-02'))).toEqual(['Edge']);
    });

    it('should show three records of a day and collapse the rest into +n', async () => {
        // Arrange
        const many = ['p', 'q', 'r', 's', 't'].map((id, index) => ({ id, title: id.toUpperCase(), start: `2026-03-10T1${index}:00` }));

        // Act
        const mounted = await mountCalendar(many);
        const cell = cellOf(mounted, '2026-03-10');

        // Assert
        expect(recordsOf(cell)).toEqual(['P', 'Q', 'R']);
        expect(moreOf(cell)?.textContent?.trim()).toBe('+2');
        expect(moreOf(cell)?.getAttribute('aria-label')).toBe('More records: 2');
    });

    it('should show exactly three records without a +n', async () => {
        // Arrange and Act
        const mounted = await mountCalendar(['p', 'q', 'r'].map((id) => ({ id, title: id, start: '2026-03-10' })));

        // Assert
        expect(recordsOf(cellOf(mounted, '2026-03-10'))).toHaveLength(3);
        expect(moreOf(cellOf(mounted, '2026-03-10'))).toBeNull();
    });

    it('should raise select with the day when the +n entry or a day is pressed', async () => {
        // Arrange
        const many = ['p', 'q', 'r', 's'].map((id) => ({ id, title: id, start: '2026-03-10' }));
        const mounted = await mountCalendar(many);
        const selected = listen(mounted, 'select');

        // Act
        (moreOf(cellOf(mounted, '2026-03-10')) as HTMLElement).click();
        cellOf(mounted, '2026-03-17').click();
        await settle();

        // Assert
        expect(selected).toEqual(['2026-03-10', '2026-03-17']);
        expect(mounted.store.get('$.app.date')).toBe('2026-03-17');
    });

    it('should raise open with the key when a record is pressed, and not select the day', async () => {
        // Arrange
        const mounted = await mountCalendar();
        const opened = listen(mounted, 'open');
        const selected = listen(mounted, 'select');

        // Act
        (cellOf(mounted, '2026-03-13').querySelector('.record') as HTMLElement).click();

        // Assert
        expect(opened).toEqual(['b']);
        expect(selected).toEqual([]);
    });

    it('should have one tab stop, the focused date, and give its records the same stop', async () => {
        // Arrange and Act
        const mounted = await mountCalendar();

        // Assert
        expect(tabStops(mounted)).toEqual(['2026-03-10']);
        expect(cellOf(mounted, '2026-03-10').querySelector<HTMLElement>('.record')?.tabIndex).toBe(0);
        expect(cellOf(mounted, '2026-03-13').querySelector<HTMLElement>('.record')?.tabIndex).toBe(-1);
    });

    it('should move the focus with the arrow keys, writing date and moving into the new cell', async () => {
        // Arrange
        const mounted = await mountCalendar();
        cellOf(mounted, '2026-03-10').focus();

        // Act and Assert
        press(cellOf(mounted, '2026-03-10'), 'ArrowRight');
        await settle();
        expect(mounted.store.get('$.app.date')).toBe('2026-03-11');
        expect(focused(mounted)).toBe('2026-03-11');
        expect(tabStops(mounted)).toEqual(['2026-03-11']);

        press(cellOf(mounted, '2026-03-11'), 'ArrowDown');
        await settle();
        expect(focused(mounted)).toBe('2026-03-18');

        press(cellOf(mounted, '2026-03-18'), 'ArrowLeft');
        await settle();
        expect(focused(mounted)).toBe('2026-03-17');

        press(cellOf(mounted, '2026-03-17'), 'ArrowUp');
        await settle();
        expect(focused(mounted)).toBe('2026-03-10');
    });

    it('should go to the first and last day of the week with Home and End', async () => {
        // Arrange
        const mounted = await mountCalendar();
        cellOf(mounted, '2026-03-10').focus();

        // Act and Assert
        press(cellOf(mounted, '2026-03-10'), 'End');
        await settle();
        expect(focused(mounted)).toBe('2026-03-14');
        press(cellOf(mounted, '2026-03-14'), 'Home');
        await settle();
        expect(focused(mounted)).toBe('2026-03-08');
    });

    it('should move a month with Page Up and Page Down and a year with Shift, and cross into the next month with an arrow', async () => {
        // Arrange
        const mounted = await mountCalendar(entries(), { date: '2026-01-31' });
        cellOf(mounted, '2026-01-31').focus();

        // Act and Assert
        press(cellOf(mounted, '2026-01-31'), 'PageDown');
        await settle();
        expect(mounted.store.get('$.app.date')).toBe('2026-02-28');
        expect(heading(mounted)).toBe('February 2026');
        press(cellOf(mounted, '2026-02-28'), 'PageUp');
        await settle();
        expect(mounted.store.get('$.app.date')).toBe('2026-01-28');
        press(cellOf(mounted, '2026-01-28'), 'PageDown', { shiftKey: true });
        await settle();
        expect(mounted.store.get('$.app.date')).toBe('2027-01-28');
        expect(heading(mounted)).toBe('January 2027');
        press(cellOf(mounted, '2027-01-28'), 'ArrowDown');
        press(cellOf(mounted, '2027-02-04'), 'ArrowDown');
        await settle();
        expect(heading(mounted)).toBe('February 2027');
    });

    it('should raise select on Enter and Space for the focused day and ignore other keys', async () => {
        // Arrange
        const mounted = await mountCalendar();
        const selected = listen(mounted, 'select');

        // Act
        press(cellOf(mounted, '2026-03-10'), 'Enter');
        press(cellOf(mounted, '2026-03-10'), ' ');
        press(cellOf(mounted, '2026-03-10'), 'a');
        press(cellOf(mounted, '2026-03-10'), 'ArrowRight', { ctrlKey: true });

        // Assert
        expect(selected).toEqual(['2026-03-10', '2026-03-10']);
        expect(mounted.store.get('$.app.date')).toBe('2026-03-10');
    });

    it('should raise range once with the first and last day of the grid when date moves to another month', async () => {
        // Arrange
        const mounted = await mountCalendar();
        const ranges = listen(mounted, 'range');

        // Act
        mounted.store.set('$.app.date', '2026-03-25');
        await settle();
        mounted.store.set('$.app.date', '2026-04-15');
        await settle();

        // Assert
        expect(ranges).toEqual([{ start: '2026-03-29', end: '2026-05-09' }]);
        expect(mounted.store.get('$.app.visible')).toEqual({ start: '2026-03-29', end: '2026-05-09' });
    });

    it('should not raise range at load and write the range it shows to visible', async () => {
        // Arrange
        const mounted = mountComponent('calendar', { date: '2026-03-10' });
        const ranges = listen(mounted, 'range');
        await settle();

        // Assert
        expect(ranges).toEqual([]);
        expect(mounted.store.get('$.app.visible')).toEqual({ start: '2026-03-01', end: '2026-04-11' });
    });

    it('should move with the previous and next buttons and raise range for each', async () => {
        // Arrange
        const mounted = await mountCalendar();
        const ranges = listen(mounted, 'range');
        const buttons = Array.from(root(mounted).querySelectorAll<HTMLElement>('.nav'));

        // Act
        buttons[1]?.click();
        await settle();
        buttons[0]?.click();
        await settle();
        buttons[0]?.click();
        await settle();

        // Assert
        expect(mounted.store.get('$.app.date')).toBe('2026-02-10');
        expect(heading(mounted)).toBe('February 2026');
        expect(ranges).toHaveLength(3);
        expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Previous', 'Next']);
    });

    it('should draw a data change: a record added, moved and removed', async () => {
        // Arrange
        const mounted = await mountCalendar();

        // Act
        mounted.store.set('$.data.entries.2.start', '2026-03-21');
        await settle();

        // Assert
        expect(recordsOf(cellOf(mounted, '2026-03-20'))).toEqual([]);
        expect(recordsOf(cellOf(mounted, '2026-03-21'))).toEqual(['Review']);

        // Act
        mounted.store.set('$.data.entries', [...entries(), { id: 'd', title: 'Late', start: '2026-03-21' }]);
        await settle();
        expect(recordsOf(cellOf(mounted, '2026-03-21'))).toEqual(['Late']);
        expect(recordsOf(cellOf(mounted, '2026-03-20'))).toEqual(['Review']);

        // Act
        mounted.store.set('$.data.entries', []);
        await settle();
        expect(cells(mounted).every((cell) => recordsOf(cell).length === 0)).toBe(true);
    });

    it('should read records from the fields named by startField, endField and titleField', async () => {
        // Arrange and Act
        const mounted = await mountCalendar([{ ref: 1, what: 'Camp', from: '2026-03-03', until: '2026-03-04' }], { key: 'ref', startField: 'from', endField: 'until', titleField: 'what' });

        // Assert
        expect(recordsOf(cellOf(mounted, '2026-03-03'))).toEqual(['Camp']);
        expect(recordsOf(cellOf(mounted, '2026-03-04'))).toEqual(['Camp']);
        expect(recordsOf(cellOf(mounted, '2026-03-05'))).toEqual([]);
    });

    it('should show German names, the Monday start and the German content after the locale switch', async () => {
        // Arrange
        const mounted = await mountCalendar();

        // Act
        mounted.setLocale('de');
        await settle();

        // Assert
        expect(heading(mounted)).toBe('März 2026');
        expect(weekdays(mounted).map((name) => name.replace('.', ''))).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
        expect(cells(mounted)[0]?.dataset['date']).toBe('2026-02-23');
        expect(cellOf(mounted, '2026-03-14').getAttribute('aria-label')).toBe('Samstag, 14. März 2026');
        expect(root(mounted).querySelector('.today')?.textContent?.trim()).toBe('Heute');
        expect(cellOf(mounted, '2026-03-10').querySelector('.time')?.textContent?.trim()).toBe('9:30');
        expect(Array.from(root(mounted).querySelectorAll('.weekday')).map((head) => head.getAttribute('aria-label'))[0]).toBe('Montag');
    });

    it('should mark today and show the current month without a date', async () => {
        // Arrange
        const mounted = mountComponent('calendar', {});
        await settle();
        const today = new Date();
        const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        // Assert
        expect(cellOf(mounted, iso).getAttribute('aria-current')).toBe('date');
        expect(tabStops(mounted)).toEqual([iso]);
        expect(mounted.store.get('$.app.date')).toBe('');
    });

    it('should colour the days through tokens, so the dark overlay changes them', async () => {
        // Arrange and Act
        const light = await mountCalendar();
        const lightColour = getComputedStyle(cellOf(light, '2026-03-10')).backgroundColor;
        mountComponent.unmountAll();
        const dark = await mountCalendar(entries(), {}, { mode: 'dark' });

        // Assert
        expect(getComputedStyle(cellOf(dark, '2026-03-10')).backgroundColor).not.toBe(lightColour);
    });
});
