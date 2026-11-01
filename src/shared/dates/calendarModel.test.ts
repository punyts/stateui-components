import { describe, expect, it } from 'vitest';
import { MAX_PER_DAY, buildMonth, buildTimeView, dateForKey, stepDate, visibleRange } from './calendarModel.js';
import { readEvents } from './events.js';
import type { EventFields } from './events.js';

const fields: EventFields = { key: 'id', startField: 'start', endField: 'end', titleField: 'title' };
const base = { focus: '2026-03-10', locale: 'en', firstDay: 0, today: '2026-03-14' };

describe('buildMonth', () => {
    it('should build six weeks of seven days with the heading and weekday names of the locale', () => {
        // Act
        const model = buildMonth({ ...base, events: [] });
        const german = buildMonth({ ...base, locale: 'de', firstDay: 1, events: [] });

        // Assert
        expect(model.weeks).toHaveLength(6);
        expect(model.weeks.every((week) => week.length === 7)).toBe(true);
        expect(model.heading).toBe('March 2026');
        expect(model.weekdays.map((head) => head.short)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
        expect(german.heading).toBe('März 2026');
        expect(german.weeks[0]?.[0]?.iso).toBe('2026-02-23');
        expect(german.weekdays[0]?.long).toBe('Montag');
    });

    it('should mark today, the focused date and the days outside the month', () => {
        // Act
        const cells = buildMonth({ ...base, events: [] }).weeks.flat();

        // Assert
        expect(cells.filter((cell) => cell.today).map((cell) => cell.iso)).toEqual(['2026-03-14']);
        expect(cells.filter((cell) => cell.active).map((cell) => cell.iso)).toEqual(['2026-03-10']);
        expect(cells.filter((cell) => !cell.outside)).toHaveLength(31);
    });

    it('should report the first and last day of the grid as the visible range', () => {
        // Act
        const model = buildMonth({ ...base, events: [] });

        // Assert
        expect(model.range).toEqual({ start: '2026-03-01', end: '2026-04-11' });
        expect(visibleRange('month', '2026-03-10', 1)).toEqual({ start: '2026-02-23', end: '2026-04-05' });
    });

    it('should put a record on every day it covers and cap a day at three with a count of the rest', () => {
        // Arrange
        const events = readEvents(
            [
                { id: 'trip', title: 'Trip', start: '2026-03-10', end: '2026-03-11' },
                { id: 'a', title: 'A', start: '2026-03-10T08:00' },
                { id: 'b', title: 'B', start: '2026-03-10T09:00' },
                { id: 'c', title: 'C', start: '2026-03-10T10:00' }
            ],
            fields
        );

        // Act
        const cells = buildMonth({ ...base, events }).weeks.flat();
        const tenth = cells.find((cell) => cell.iso === '2026-03-10');
        const eleventh = cells.find((cell) => cell.iso === '2026-03-11');

        // Assert
        expect(MAX_PER_DAY).toBe(3);
        expect(tenth?.records.map((record) => record.title)).toEqual(['Trip', 'A', 'B']);
        expect(tenth?.more).toBe(1);
        expect(tenth?.records[1]?.time.replace(/\s/gu, ' ')).toBe('8:00 AM');
        expect(eleventh?.records.map((record) => record.title)).toEqual(['Trip']);
        expect(eleventh?.more).toBe(0);
    });
});

describe('dateForKey', () => {
    const options = { view: 'month' as const, firstDay: 0, rtl: false, shift: false };

    it('should move by days, weeks and to the ends of the week', () => {
        // Assert
        expect(dateForKey('ArrowRight', '2026-03-10', options)).toBe('2026-03-11');
        expect(dateForKey('ArrowLeft', '2026-03-01', options)).toBe('2026-02-28');
        expect(dateForKey('ArrowDown', '2026-12-30', options)).toBe('2027-01-06');
        expect(dateForKey('ArrowUp', '2026-03-10', options)).toBe('2026-03-03');
        expect(dateForKey('Home', '2026-03-10', options)).toBe('2026-03-08');
        expect(dateForKey('End', '2026-03-10', options)).toBe('2026-03-14');
        expect(dateForKey('Home', '2026-03-10', { ...options, firstDay: 1 })).toBe('2026-03-09');
        expect(dateForKey('End', '2026-03-10', { ...options, firstDay: 1 })).toBe('2026-03-15');
    });

    it('should swap Left and Right in right-to-left text', () => {
        // Assert
        expect(dateForKey('ArrowRight', '2026-03-10', { ...options, rtl: true })).toBe('2026-03-09');
        expect(dateForKey('ArrowLeft', '2026-03-10', { ...options, rtl: true })).toBe('2026-03-11');
    });

    it('should move by months, and by years with Shift, keeping the day as far as the month reaches', () => {
        // Assert
        expect(dateForKey('PageDown', '2026-01-31', options)).toBe('2026-02-28');
        expect(dateForKey('PageUp', '2026-01-15', options)).toBe('2025-12-15');
        expect(dateForKey('PageDown', '2024-02-29', { ...options, shift: true })).toBe('2025-02-28');
    });

    it('should leave a key it does not use and a date it cannot read', () => {
        // Assert
        expect(dateForKey('a', '2026-03-10', options)).toBeUndefined();
        expect(dateForKey('ArrowRight', 'soon', options)).toBeUndefined();
    });
});

describe('stepDate', () => {
    it('should step a month in the month view', () => {
        // Assert
        expect(stepDate('month', '2026-03-31', 1)).toBe('2026-04-30');
        expect(stepDate('month', '2026-01-10', -1)).toBe('2025-12-10');
    });
});

describe('visibleRange and stepDate by view', () => {
    it('should be the week that holds the date, or the date, in the week and day views', () => {
        // Assert
        expect(visibleRange('week', '2026-03-10', 0)).toEqual({ start: '2026-03-08', end: '2026-03-14' });
        expect(visibleRange('week', '2026-03-10', 1)).toEqual({ start: '2026-03-09', end: '2026-03-15' });
        expect(visibleRange('week', '2026-03-08', 1)).toEqual({ start: '2026-03-02', end: '2026-03-08' });
        expect(visibleRange('day', '2026-03-10', 1)).toEqual({ start: '2026-03-10', end: '2026-03-10' });
    });

    it('should step a week in the week view and a day in the day view', () => {
        // Assert
        expect(stepDate('week', '2026-03-10', 1)).toBe('2026-03-17');
        expect(stepDate('week', '2026-01-03', -1)).toBe('2025-12-27');
        expect(stepDate('day', '2026-03-31', 1)).toBe('2026-04-01');
    });

    it('should use the keys the view has', () => {
        // Arrange
        const week = { view: 'week' as const, firstDay: 1, rtl: false, shift: false };
        const day = { ...week, view: 'day' as const };

        // Assert
        expect(dateForKey('PageDown', '2026-03-10', week)).toBe('2026-03-17');
        expect(dateForKey('Home', '2026-03-10', week)).toBe('2026-03-09');
        expect(dateForKey('ArrowUp', '2026-03-10', week)).toBeUndefined();
        expect(dateForKey('ArrowRight', '2026-03-10', week)).toBe('2026-03-11');
        expect(dateForKey('PageUp', '2026-03-10', day)).toBe('2026-03-09');
        expect(dateForKey('Home', '2026-03-10', day)).toBeUndefined();
        expect(dateForKey('ArrowLeft', '2026-03-10', day)).toBe('2026-03-09');
    });
});

describe('buildTimeView', () => {
    const events = readEvents(
        [
            { id: 'whole', title: 'Whole', start: '2026-03-10T09:00', end: '2026-03-10T10:00' },
            { id: 'part', title: 'Part', start: '2026-03-10T10:15', end: '2026-03-10T11:50' },
            { id: 'night', title: 'Night', start: '2026-03-10T22:00', end: '2026-03-11T02:30' },
            { id: 'a', title: 'A', start: '2026-03-12T09:00', end: '2026-03-12T11:00' },
            { id: 'b', title: 'B', start: '2026-03-12T10:00', end: '2026-03-12T12:00' },
            { id: 'trip', title: 'Trip', start: '2026-03-13', end: '2026-03-14' }
        ],
        fields
    );

    it('should make seven day columns for the week, with 24 hour labels and the range of the week', () => {
        // Act
        const model = buildTimeView({ ...base, view: 'week', events });

        // Assert
        expect(model.days.map((day) => day.iso)).toEqual(['2026-03-08', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14']);
        expect(model.hours).toHaveLength(24);
        expect(model.hours[9]?.replace(/\s/gu, ' ')).toBe('9 AM');
        expect(model.range).toEqual({ start: '2026-03-08', end: '2026-03-14' });
        expect(model.heading.replace(/\s/gu, ' ')).toBe('Mar 8 – 14, 2026');
        expect(model.days[0]?.weekday).toBe('Sun');
    });

    it('should make one column for the day view with the whole date as heading', () => {
        // Act
        const model = buildTimeView({ ...base, view: 'day', events });

        // Assert
        expect(model.days.map((day) => day.iso)).toEqual(['2026-03-10']);
        expect(model.heading).toBe('Tuesday, March 10, 2026');
        expect(model.days[0]?.records.map((record) => record.key)).toEqual(['whole', 'part', 'night']);
    });

    it('should place whole and partial hours by their minutes from the start of the day', () => {
        // Act
        const day = buildTimeView({ ...base, view: 'week', events }).days[2];

        // Assert
        expect(day?.records.find((record) => record.key === 'whole')).toMatchObject({ start: 540, span: 60, column: 0, columns: 1 });
        expect(day?.records.find((record) => record.key === 'part')).toMatchObject({ start: 615, span: 95 });
    });

    it('should put records that overlap side by side', () => {
        // Act
        const day = buildTimeView({ ...base, view: 'week', events }).days[4];

        // Assert
        expect(day?.records.map((record) => [record.key, record.column, record.columns])).toEqual([
            ['a', 0, 2],
            ['b', 1, 2]
        ]);
    });

    it('should split a record that crosses midnight over both days, clipped to each', () => {
        // Act
        const days = buildTimeView({ ...base, view: 'week', events }).days;
        const first = days[2]?.records.find((record) => record.key === 'night');
        const second = days[3]?.records.find((record) => record.key === 'night');

        // Assert
        expect(first).toMatchObject({ start: 1320, span: 120 });
        expect(first?.time).not.toBe('');
        expect(second).toMatchObject({ start: 0, span: 150, time: '' });
        expect(second?.label.replace(/\s/gu, ' ')).toBe('Night, 10:00 PM – 2:30 AM');
    });

    it('should list all-day records with the day heading, not in the hours', () => {
        // Act
        const days = buildTimeView({ ...base, view: 'week', events }).days;

        // Assert
        expect(days[5]?.allDay.map((record) => record.key)).toEqual(['trip']);
        expect(days[6]?.allDay.map((record) => record.key)).toEqual(['trip']);
        expect(days[5]?.records).toEqual([]);
    });

    it('should start the week on Monday for de', () => {
        // Act
        const model = buildTimeView({ ...base, locale: 'de', firstDay: 1, view: 'week', events });

        // Assert
        expect(model.days[0]?.iso).toBe('2026-03-09');
        expect(model.days[0]?.weekday.replace('.', '')).toBe('Mo');
        expect(model.heading).toContain('März');
    });
});
