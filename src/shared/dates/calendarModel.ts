import { eventsOnDay } from './events.js';
import type { CalendarEvent } from './events.js';
import { addDays, addMonths, dayOf, isoOfDay, monthGrid, parseIsoDate, startOfWeekDay } from './isoDate.js';
import { formatDayNumber, formatLongDate, formatMonthYear, formatTime, weekdayNames } from './localeDates.js';

/** The views of a calendar */
export const CALENDAR_VIEWS = ['month'] as const;

export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/** The most records a day shows in the month view; the rest collapse into one `+n` entry */
export const MAX_PER_DAY = 3;

/** The range of days a view shows, as ISO dates, both included. This is what `range` reports */
export interface VisibleRange {
    readonly start: string;
    readonly end: string;
}

/** A record on one day of the month grid */
export interface MonthRecord {
    readonly key: string;
    readonly title: string;
    /** The start time as the locale writes it for a record that has one on this day, otherwise empty */
    readonly time: string;
}

/** One day of the month grid */
export interface MonthCell {
    readonly iso: string;
    /** The day of the month, in the locale's digits */
    readonly number: string;
    /** The whole date in words, the name of the cell for a screen reader */
    readonly label: string;
    readonly today: boolean;
    /** True for a day of the previous or next month, shown to fill the first and last rows */
    readonly outside: boolean;
    /** True for the focused date: the one tab stop of the grid */
    readonly active: boolean;
    /** The records shown on the day, at most `MAX_PER_DAY` */
    readonly records: readonly MonthRecord[];
    /** How many more records the day has than are shown */
    readonly more: number;
}

export interface MonthModel {
    readonly heading: string;
    readonly weekdays: readonly { readonly short: string; readonly long: string }[];
    readonly weeks: readonly (readonly MonthCell[])[];
    readonly range: VisibleRange;
}

export interface MonthInput {
    /** The focused date, an ISO date */
    readonly focus: string;
    readonly events: readonly CalendarEvent[];
    readonly locale: string;
    /** The weekday a row starts on, 0 for Sunday */
    readonly firstDay: number;
    /** Today, an ISO date */
    readonly today: string;
}

/** The seven weekday names from the first day: the short one to show and the long one to read */
export function weekdayHeads(locale: string, firstDay: number): { short: string; long: string }[] {
    const short = weekdayNames(locale, firstDay, 'short');
    const long = weekdayNames(locale, firstDay, 'long');
    return short.map((name, index) => ({ short: name, long: long[index] ?? name }));
}

const COLUMNS = 7;

/**
 * The month grid of a focused date: 6 rows of 7 days (`monthGrid`), each day with the records that fall on it (a record
 * that spans days is on each of them), at most `MAX_PER_DAY` of them, and the count of those that do not fit. The visible
 * range is the first and last day of the grid, so it includes the days of the neighbouring months
 */
export function buildMonth(input: MonthInput): MonthModel {
    const parts = parseIsoDate(input.focus) ?? parseIsoDate(input.today) ?? { year: 1970, month: 1, day: 1 };
    const grid = monthGrid(parts.year, parts.month, input.firstDay);
    const cells: MonthCell[] = grid.map((day) => {
        const found = eventsOnDay(input.events, dayOf(day.iso) as number);
        return {
            iso: day.iso,
            number: formatDayNumber(Number(day.iso.slice(8)), input.locale),
            label: formatLongDate(day.iso, input.locale),
            today: day.iso === input.today,
            outside: !day.inMonth,
            active: day.iso === input.focus,
            records: found.slice(0, MAX_PER_DAY).map((event) => ({
                key: event.key,
                title: event.title,
                time: event.allDay || event.firstDay !== dayOf(day.iso) ? '' : formatTime(event.startMinute, input.locale)
            })),
            more: Math.max(0, found.length - MAX_PER_DAY)
        };
    });
    const weeks: MonthCell[][] = [];
    for (let row = 0; row < cells.length; row += COLUMNS) weeks.push(cells.slice(row, row + COLUMNS));
    return {
        heading: formatMonthYear(input.focus, input.locale),
        weekdays: weekdayHeads(input.locale, input.firstDay),
        weeks,
        range: { start: grid[0]?.iso ?? input.focus, end: grid[grid.length - 1]?.iso ?? input.focus }
    };
}

/** The visible range of a view around a focused date, without building the cells */
export function visibleRange(view: CalendarView, focus: string, firstDay: number): VisibleRange {
    switch (view) {
        case 'month': {
            const parts = parseIsoDate(focus);
            if (parts === undefined) return { start: focus, end: focus };
            const grid = monthGrid(parts.year, parts.month, firstDay);
            return { start: grid[0]?.iso ?? focus, end: grid[grid.length - 1]?.iso ?? focus };
        }
    }
}

/** The date one page before (`-1`) or after (`1`) the focused date: a month in the month view */
export function stepDate(view: CalendarView, focus: string, direction: 1 | -1): string {
    switch (view) {
        case 'month':
            return addMonths(focus, direction);
    }
}

/** What a key does in the grid */
export interface KeyOptions {
    readonly firstDay: number;
    /** True in right-to-left text, where Left and Right swap */
    readonly rtl: boolean;
    readonly shift: boolean;
}

/**
 * The date a navigation key moves the focus to, or `undefined` for a key the grid does not use. Left and Right move a
 * day (swapped in right-to-left text), Up and Down a week, Home and End to the first and last day of the week, Page Up
 * and Page Down a month, and with Shift a year. The day of the month is kept as far as the new month reaches
 */
export function dateForKey(key: string, focus: string, options: KeyOptions): string | undefined {
    const days = dayOf(focus);
    if (days === undefined) return undefined;
    const sideways = options.rtl ? -1 : 1;
    switch (key) {
        case 'ArrowLeft':
            return addDays(focus, -sideways);
        case 'ArrowRight':
            return addDays(focus, sideways);
        case 'ArrowUp':
            return addDays(focus, -COLUMNS);
        case 'ArrowDown':
            return addDays(focus, COLUMNS);
        case 'Home':
            return isoOfDay(startOfWeekDay(days, options.firstDay));
        case 'End':
            return isoOfDay(startOfWeekDay(days, options.firstDay) + COLUMNS - 1);
        case 'PageUp':
            return addMonths(focus, options.shift ? -12 : -1);
        case 'PageDown':
            return addMonths(focus, options.shift ? 12 : 1);
        default:
            return undefined;
    }
}

