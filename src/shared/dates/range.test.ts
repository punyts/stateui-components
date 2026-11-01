import { describe, expect, it } from 'vitest';
import { PICKER_MONTHS, buildPicker, firstOfMonth, monthsFor } from './picker.js';
import { failingRangeRule, isPickable, markDay, orderRange, pickDay, rangeDays, readRange } from './range.js';
import type { RangeSettings } from './range.js';

const none: RangeSettings = { required: false, min: '', max: '', minDays: 0, maxDays: 0 };
const range = (start: string, end: string) => ({ start, end });

describe('readRange', () => {
    it('should read two ISO dates and treat anything else as an empty side', () => {
        // Assert
        expect(readRange({ start: '2026-03-01', end: '2026-03-05' })).toEqual(range('2026-03-01', '2026-03-05'));
        expect(readRange({ start: '2026-02-30', end: 5 })).toEqual(range('', ''));
        expect(readRange('2026-03-01')).toEqual(range('', ''));
        expect(readRange(undefined)).toEqual(range('', ''));
        expect(readRange({ start: '2026-03-01' })).toEqual(range('2026-03-01', ''));
    });
});

describe('orderRange and rangeDays', () => {
    it('should swap a start after the end and leave the rest', () => {
        // Assert
        expect(orderRange(range('2026-03-09', '2026-03-02'))).toEqual(range('2026-03-02', '2026-03-09'));
        expect(orderRange(range('2026-03-02', ''))).toEqual(range('2026-03-02', ''));
    });

    it('should count the days of a range with both ends', () => {
        // Assert
        expect(rangeDays(range('2026-03-01', '2026-03-03'))).toBe(3);
        expect(rangeDays(range('2026-03-01', '2026-03-01'))).toBe(1);
        expect(rangeDays(range('2026-02-27', '2026-03-02'))).toBe(4);
        expect(rangeDays(range('2026-03-03', '2026-03-01'))).toBeUndefined();
        expect(rangeDays(range('2026-03-03', ''))).toBeUndefined();
    });
});

describe('failingRangeRule', () => {
    it('should pass an empty range unless it is required, and need both dates when required', () => {
        // Assert
        expect(failingRangeRule(range('', ''), none)).toBe('');
        expect(failingRangeRule(range('', ''), { ...none, required: true })).toBe('required');
        expect(failingRangeRule(range('2026-03-01', ''), { ...none, required: true })).toBe('required');
        expect(failingRangeRule(range('2026-03-01', '2026-03-02'), { ...none, required: true })).toBe('');
    });

    it('should fail min or max when either date is outside', () => {
        // Arrange
        const bounds = { ...none, min: '2026-03-05', max: '2026-03-20' };

        // Assert
        expect(failingRangeRule(range('2026-03-04', '2026-03-10'), bounds)).toBe('min');
        expect(failingRangeRule(range('2026-03-06', '2026-03-21'), bounds)).toBe('max');
        expect(failingRangeRule(range('2026-03-05', '2026-03-20'), bounds)).toBe('');
        expect(failingRangeRule(range('2026-03-04', ''), bounds)).toBe('min');
    });

    it('should fail minDays and maxDays by the count of days with both ends, and ignore an incomplete range', () => {
        // Assert
        expect(failingRangeRule(range('2026-03-01', '2026-03-03'), { ...none, minDays: 4 })).toBe('minDays');
        expect(failingRangeRule(range('2026-03-01', '2026-03-03'), { ...none, minDays: 3 })).toBe('');
        expect(failingRangeRule(range('2026-03-01', '2026-03-03'), { ...none, maxDays: 2 })).toBe('maxDays');
        expect(failingRangeRule(range('2026-03-01', '2026-03-03'), { ...none, maxDays: 3 })).toBe('');
        expect(failingRangeRule(range('2026-03-01', ''), { ...none, minDays: 5 })).toBe('');
    });

    it('should check required, min and max before minDays and maxDays', () => {
        // Assert
        expect(failingRangeRule(range('2026-03-01', '2026-03-02'), { ...none, min: '2026-03-02', minDays: 5 })).toBe('min');
    });

    it('should judge a reversed range by its days', () => {
        // Assert
        expect(failingRangeRule(range('2026-03-09', '2026-03-01'), { ...none, maxDays: 5 })).toBe('maxDays');
    });
});

describe('pickDay', () => {
    it('should wait for the end after the first press and finish after the second', () => {
        // Act
        const first = pickDay(undefined, '2026-03-10');
        const second = pickDay(first.pending, '2026-03-14');

        // Assert
        expect(first).toEqual({ pending: '2026-03-10', range: undefined });
        expect(second).toEqual({ pending: undefined, range: range('2026-03-10', '2026-03-14') });
    });

    it('should swap a second press before the first, and allow a range of one day', () => {
        // Assert
        expect(pickDay('2026-03-14', '2026-03-10').range).toEqual(range('2026-03-10', '2026-03-14'));
        expect(pickDay('2026-03-14', '2026-03-14').range).toEqual(range('2026-03-14', '2026-03-14'));
    });
});

describe('markDay and isPickable', () => {
    it('should mark the days from the start to the end with their edges', () => {
        // Arrange
        const shown = range('2026-03-10', '2026-03-12');

        // Assert
        expect(markDay('2026-03-09', shown, undefined)).toEqual({ inRange: false, edge: '' });
        expect(markDay('2026-03-10', shown, undefined)).toEqual({ inRange: true, edge: 'start' });
        expect(markDay('2026-03-11', shown, undefined)).toEqual({ inRange: true, edge: '' });
        expect(markDay('2026-03-12', shown, undefined)).toEqual({ inRange: true, edge: 'end' });
        expect(markDay('2026-03-13', shown, undefined)).toEqual({ inRange: false, edge: '' });
    });

    it('should show a waiting start as a range of one day, and a one day range as both edges', () => {
        // Assert
        expect(markDay('2026-03-10', range('2026-03-01', '2026-03-05'), '2026-03-10')).toEqual({ inRange: true, edge: 'both' });
        expect(markDay('2026-03-02', range('2026-03-01', '2026-03-05'), '2026-03-10')).toEqual({ inRange: false, edge: '' });
        expect(markDay('2026-03-10', range('2026-03-10', '2026-03-10'), undefined)).toEqual({ inRange: true, edge: 'both' });
    });

    it('should let a day be picked inside min and max, both ends included', () => {
        // Assert
        expect(isPickable('2026-03-05', '2026-03-05', '2026-03-10')).toBe(true);
        expect(isPickable('2026-03-10', '2026-03-05', '2026-03-10')).toBe(true);
        expect(isPickable('2026-03-04', '2026-03-05', '')).toBe(false);
        expect(isPickable('2026-03-11', '', '2026-03-10')).toBe(false);
        expect(isPickable('2030-01-01', '', '')).toBe(true);
    });
});

describe('buildPicker', () => {
    const input = { first: '2026-03-17', range: range('2026-03-10', '2026-03-12'), pending: undefined, min: '2026-03-05', max: '', locale: 'en', firstDay: 0, today: '2026-03-14', cursor: '2026-03-10' };

    it('should build two months of 6 × 7 days that start with the month of the first date', () => {
        // Act
        const months = buildPicker(input);

        // Assert
        expect(PICKER_MONTHS).toBe(2);
        expect(months.map((month) => month.heading)).toEqual(['March 2026', 'April 2026']);
        expect(months.every((month) => month.weeks.length === 6 && month.weeks.every((week) => week.length === 7))).toBe(true);
    });

    it('should blank the days of other months so a date is never shown twice', () => {
        // Act
        const shown = buildPicker(input).flatMap((month) => month.weeks.flat()).filter((day) => !day.blank);

        // Assert
        expect(shown).toHaveLength(31 + 30);
        expect(new Set(shown.map((day) => day.iso)).size).toBe(61);
    });

    it('should mark the range, today, the cursor and the days that cannot be picked', () => {
        // Act
        const days = buildPicker(input).flatMap((month) => month.weeks.flat()).filter((day) => !day.blank);
        const day = (iso: string) => days.find((candidate) => candidate.iso === iso);

        // Assert
        expect(days.filter((candidate) => candidate.inRange).map((candidate) => candidate.iso)).toEqual(['2026-03-10', '2026-03-11', '2026-03-12']);
        expect(day('2026-03-14')?.today).toBe(true);
        expect(day('2026-03-10')?.cursor).toBe(true);
        expect(day('2026-03-04')?.pickable).toBe(false);
        expect(day('2026-03-05')?.pickable).toBe(true);
        expect(day('2026-03-10')?.edge).toBe('start');
        expect(day('2026-03-14')?.label).toBe('Saturday, March 14, 2026');
    });
});

describe('monthsFor', () => {
    it('should keep the months when the cursor is in one of the two, and move them when it leaves', () => {
        // Assert
        expect(firstOfMonth('2026-03-17')).toBe('2026-03-01');
        expect(monthsFor('2026-03-01', '2026-04-30')).toBe('2026-03-01');
        expect(monthsFor('2026-03-01', '2026-05-02')).toBe('2026-04-01');
        expect(monthsFor('2026-03-01', '2026-02-27')).toBe('2026-02-01');
        expect(monthsFor('2026-12-01', '2027-02-01')).toBe('2027-01-01');
    });
});
