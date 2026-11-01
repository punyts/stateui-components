import { describe, expect, it } from 'vitest';
import { MAX_PER_DAY, buildMonth, dateForKey, stepDate, visibleRange } from './calendarModel.js';
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
    const options = { firstDay: 0, rtl: false, shift: false };

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
