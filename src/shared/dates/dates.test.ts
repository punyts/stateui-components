import { afterEach, describe, expect, it } from 'vitest';
import { addDays, addMonths, dayNumber, daysInMonth, fromDayNumber, isoOfDay, monthGrid, parseIsoDate, parseMoment, weekdayOfDay } from './isoDate.js';
import { dateOrder, formatDate, formatDateRange, formatLongDate, formatMonthYear, formatTime, monthNames, parseDate, weekdayNames } from './localeDates.js';
import { FIRST_DAY_BY_REGION, firstDayFromIntl, firstDayFromTable, firstDayOf } from './weekStart.js';

const gridDays = (year: number, month: number, firstDay: number): string[] => monthGrid(year, month, firstDay).map((day) => day.iso);
const dayOfIso = (iso: string): number => dayNumber(parseIsoDate(iso) as { year: number; month: number; day: number });

describe('parseIsoDate', () => {
    it('should read a real date and reject text, a missing day and the wrong shape', () => {
        // Assert
        expect(parseIsoDate('2026-03-14')).toEqual({ year: 2026, month: 3, day: 14 });
        expect(parseIsoDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
        expect(parseIsoDate('2026-02-29')).toBeUndefined();
        expect(parseIsoDate('2026-13-01')).toBeUndefined();
        expect(parseIsoDate('2026-3-4')).toBeUndefined();
        expect(parseIsoDate(20260314)).toBeUndefined();
    });
});

describe('day numbers', () => {
    it('should count days from 1970-01-01 and go back to the same date', () => {
        // Assert
        expect(dayOfIso('1970-01-01')).toBe(0);
        expect(isoOfDay(0)).toBe('1970-01-01');
        for (const iso of ['1999-12-31', '2000-02-29', '2026-03-08', '2026-10-25', '1900-03-01', '2100-02-28']) {
            expect(isoOfDay(dayOfIso(iso))).toBe(iso);
        }
        expect(fromDayNumber(dayOfIso('2026-12-31') + 1)).toEqual({ year: 2027, month: 1, day: 1 });
    });

    it('should know the weekday: 1970-01-04 was a Sunday and 2026-03-14 is a Saturday', () => {
        // Assert
        expect(weekdayOfDay(dayOfIso('1970-01-04'))).toBe(0);
        expect(weekdayOfDay(dayOfIso('2026-03-14'))).toBe(6);
        expect(weekdayOfDay(-1)).toBe(3);
    });
});

describe('addDays and addMonths', () => {
    it('should add days across month and year ends', () => {
        // Assert
        expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
        expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    });

    it('should clamp the day when the new month is shorter and cross the year', () => {
        // Assert
        expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
        expect(addMonths('2025-12-15', 1)).toBe('2026-01-15');
        expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
        expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
        expect(daysInMonth(2024, 2)).toBe(29);
    });
});

describe('monthGrid', () => {
    it('should have 6 rows of 7 days that start on the first day of the week', () => {
        // Act
        const sunday = monthGrid(2026, 3, 0);
        const monday = monthGrid(2026, 3, 1);

        // Assert
        expect(sunday).toHaveLength(42);
        expect(monday).toHaveLength(42);
        expect(sunday[0]?.iso).toBe('2026-03-01');
        expect(monday[0]?.iso).toBe('2026-02-23');
        expect(sunday.filter((day) => day.inMonth)).toHaveLength(31);
    });

    it('should run across a year boundary without a gap', () => {
        // Act
        const days = gridDays(2026, 1, 1);

        // Assert
        expect(days[0]).toBe('2025-12-29');
        expect(days[3]).toBe('2026-01-01');
        expect(days[41]).toBe('2026-02-08');
        expect(gridDays(2025, 12, 1)[41]).toBe('2026-01-11');
    });

    it('should hold every day once, in order, for a month with a daylight saving change, in any machine time zone', () => {
        // Arrange
        const original = process.env['TZ'];
        const grids: string[][] = [];
        try {
            for (const zone of ['America/New_York', 'Europe/Berlin', 'Australia/Lord_Howe']) {
                process.env['TZ'] = zone;
                grids.push(gridDays(2026, 3, 0), gridDays(2026, 10, 1), gridDays(2026, 4, 1));
            }
        } finally {
            if (original === undefined) delete process.env['TZ'];
            else process.env['TZ'] = original;
        }

        // Assert: the United States change on 2026-03-08, the European on 2026-10-25, Lord Howe on 2026-04-05
        for (const days of grids) {
            expect(new Set(days).size).toBe(42);
            expect(days.slice(1).every((iso, index) => iso === addDays(days[index] as string, 1))).toBe(true);
        }
        expect(grids[0]).toEqual(grids[3]);
        expect(grids[0]).toContain('2026-03-08');
        expect(grids[1]).toContain('2026-10-25');
        expect(grids[2]).toContain('2026-04-05');
    });
});

describe('parseMoment', () => {
    it('should read a date as a day with no minute and a date and time as wall-clock minutes', () => {
        // Assert
        expect(parseMoment('2026-03-14')?.minute).toBeUndefined();
        expect(parseMoment('2026-03-14T09:30')?.minute).toBe(570);
        expect(parseMoment('2026-03-14 23:59:59.500')?.minute).toBe(1439);
        expect(parseMoment('2026-03-14T24:00')).toBeUndefined();
        expect(parseMoment('soon')).toBeUndefined();
    });

    it('should show an instant with a zone at the local wall-clock time', () => {
        // Arrange
        const instant = new Date('2026-03-14T12:00:00Z');

        // Act
        const moment = parseMoment('2026-03-14T12:00:00Z');

        // Assert
        expect(moment?.minute).toBe(instant.getHours() * 60 + instant.getMinutes());
    });
});

describe('week start', () => {
    it('should start the week on Sunday for en-US, Monday for de and Saturday for ar', () => {
        // Assert
        expect(firstDayOf('en-US')).toBe(0);
        expect(firstDayOf('en')).toBe(0);
        expect(firstDayOf('de')).toBe(1);
        expect(firstDayOf('ar')).toBe(6);
        expect(firstDayOf('en-GB')).toBe(1);
    });

    it('should have a fallback table that agrees with Intl', () => {
        // Assert
        for (const tag of ['en-US', 'en', 'de', 'ar', 'fr', 'ja', 'he', 'fa', 'en-GB', 'pt-BR', 'ar-SA']) {
            const fromIntl = firstDayFromIntl(tag);
            if (fromIntl !== undefined) expect(firstDayFromTable(tag)).toBe(fromIntl);
        }
        expect(firstDayFromTable('en-US')).toBe(0);
        expect(firstDayFromTable('de')).toBe(1);
        expect(firstDayFromTable('ar')).toBe(6);
        expect(firstDayFromTable('dv')).toBe(5);
        expect(firstDayFromTable('zz')).toBe(1);
        expect(FIRST_DAY_BY_REGION['US']).toBe(0);
    });

    describe('without getWeekInfo', () => {
        const original = Object.getOwnPropertyDescriptor(Intl.Locale.prototype, 'getWeekInfo');

        afterEach(() => {
            if (original) Object.defineProperty(Intl.Locale.prototype, 'getWeekInfo', original);
        });

        it('should use the table', () => {
            // Arrange
            Object.defineProperty(Intl.Locale.prototype, 'getWeekInfo', { value: undefined, configurable: true, writable: true });

            // Assert
            expect(firstDayFromIntl('de')).toBeUndefined();
            expect(firstDayOf('en-US')).toBe(0);
            expect(firstDayOf('de')).toBe(1);
            expect(firstDayOf('ar')).toBe(6);
        });
    });

    it('should read a tag Intl refuses as en', () => {
        // Assert
        expect(firstDayOf('not a tag!')).toBe(firstDayOf('en'));
    });
});

describe('names and formats', () => {
    it('should name the weekdays from the first day, in en and de', () => {
        // Assert
        expect(weekdayNames('en', 0, 'short')).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
        expect(weekdayNames('de', 1, 'long')[0]).toBe('Montag');
        expect(weekdayNames('de', 1, 'long')[6]).toBe('Sonntag');
        expect(weekdayNames('en', 6, 'long')[0]).toBe('Saturday');
    });

    it('should name the months', () => {
        // Assert
        expect(monthNames('en')[2]).toBe('March');
        expect(monthNames('de')[2]).toBe('März');
        expect(monthNames('de', 'short')).toHaveLength(12);
    });

    it('should format a month, a long date and a range for the locale', () => {
        // Assert
        expect(formatMonthYear('2026-03-14', 'en')).toBe('March 2026');
        expect(formatMonthYear('2026-03-14', 'de')).toBe('März 2026');
        expect(formatLongDate('2026-03-14', 'en')).toBe('Saturday, March 14, 2026');
        expect(formatLongDate('2026-03-14', 'de')).toBe('Samstag, 14. März 2026');
        expect(formatDateRange('2026-03-08', '2026-03-14', 'en').replace(/\s/gu, ' ')).toBe('Mar 8 – 14, 2026');
        expect(formatMonthYear('nope', 'en')).toBe('');
    });

    it('should format a numeric date in the order of the locale and a time on its clock', () => {
        // Assert
        expect(formatDate('2026-03-04', 'en')).toBe('03/04/2026');
        expect(formatDate('2026-03-04', 'de')).toBe('04.03.2026');
        expect(dateOrder('en')).toEqual(['month', 'day', 'year']);
        expect(dateOrder('de')).toEqual(['day', 'month', 'year']);
        expect(dateOrder('ja')).toEqual(['year', 'month', 'day']);
        expect(formatTime(570, 'en').replace(/\s/gu, ' ')).toBe('9:30 AM');
        expect(formatTime(570, 'de')).toBe('9:30');
    });

    it('should fall back to en for a locale Intl refuses', () => {
        // Assert
        expect(formatMonthYear('2026-03-14', 'not a tag!')).toBe('March 2026');
    });

    it('should parse a typed date in the order of the locale, with or without leading zeros', () => {
        // Assert
        expect(parseDate('03/04/2026', 'en')).toBe('2026-03-04');
        expect(parseDate('3/4/2026', 'en')).toBe('2026-03-04');
        expect(parseDate('04.03.2026', 'de')).toBe('2026-03-04');
        expect(parseDate('4.3.2026', 'de')).toBe('2026-03-04');
        expect(parseDate(' 2026-03-04 ', 'de')).toBe('2026-03-04');
        expect(parseDate('2026/03/04', 'ja')).toBe('2026-03-04');
    });

    it('should refuse a date that does not exist or is not complete', () => {
        // Assert
        expect(parseDate('31.02.2026', 'de')).toBeUndefined();
        expect(parseDate('13/01/2026', 'en')).toBeUndefined();
        expect(parseDate('3/4/26', 'en')).toBeUndefined();
        expect(parseDate('3/4', 'en')).toBeUndefined();
        expect(parseDate('', 'en')).toBeUndefined();
        expect(parseDate('tomorrow', 'en')).toBeUndefined();
    });

    it('should parse what it formats, for several locales and for locales with their own digits', () => {
        // Assert
        for (const locale of ['en', 'de', 'fr', 'ja', 'ko', 'hu', 'ar', 'ar-EG', 'th', 'sv']) {
            expect(parseDate(formatDate('2026-11-05', locale), locale)).toBe('2026-11-05');
        }
    });
});
