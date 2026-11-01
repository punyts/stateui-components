import { eventsOnDay, layoutOverlaps, segmentOn } from './events.js';
import type { CalendarEvent, Segment } from './events.js';
import { MINUTES_PER_DAY, addDays, addMonths, dayOf, isoOfDay, monthGrid, parseIsoDate, startOfWeekDay, weekdayOfDay } from './isoDate.js';
import { formatDateRange, formatDayNumber, formatHour, formatLongDate, formatMonthYear, formatTime, weekdayNames } from './localeDates.js';

/** The views of a calendar */
export const CALENDAR_VIEWS = ['month', 'week', 'day'] as const;

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

/** The visible range of a view around a focused date, without building the cells: the grid of the month, the week, or the day */
export function visibleRange(view: CalendarView, focus: string, firstDay: number): VisibleRange {
    const days = dayOf(focus);
    const parts = parseIsoDate(focus);
    if (days === undefined || parts === undefined) return { start: focus, end: focus };
    switch (view) {
        case 'month': {
            const grid = monthGrid(parts.year, parts.month, firstDay);
            return { start: grid[0]?.iso ?? focus, end: grid[grid.length - 1]?.iso ?? focus };
        }
        case 'week': {
            const start = startOfWeekDay(days, firstDay);
            return { start: isoOfDay(start), end: isoOfDay(start + COLUMNS - 1) };
        }
        case 'day':
            return { start: focus, end: focus };
    }
}

/** The date one page before (`-1`) or after (`1`) the focused date: a month in the month view, a week in the week view, a day in the day view */
export function stepDate(view: CalendarView, focus: string, direction: 1 | -1): string {
    switch (view) {
        case 'month':
            return addMonths(focus, direction);
        case 'week':
            return addDays(focus, direction * COLUMNS);
        case 'day':
            return addDays(focus, direction);
    }
}

/** What a key does in the grid */
export interface KeyOptions {
    readonly view: CalendarView;
    readonly firstDay: number;
    /** True in right-to-left text, where Left and Right swap */
    readonly rtl: boolean;
    readonly shift: boolean;
}

/**
 * The date a navigation key moves the focus to, or `undefined` for a key the view does not use. Left and Right move a day
 * in every view (swapped in right-to-left text). In the month view Up and Down move a week, Home and End go to the first
 * and last day of the week, and Page Up and Page Down move a month, with Shift a year; the day of the month is kept as far as
 * the new month reaches. In the week view Home and End do the same, Page Up and Page Down move a week, and Up and Down are
 * left to the page. In the day view Page Up and Page Down move a day and the other keys are left to the page
 */
export function dateForKey(key: string, focus: string, options: KeyOptions): string | undefined {
    const days = dayOf(focus);
    if (days === undefined) return undefined;
    const sideways = options.rtl ? -1 : 1;
    if (key === 'ArrowLeft') return addDays(focus, -sideways);
    if (key === 'ArrowRight') return addDays(focus, sideways);
    switch (options.view) {
        case 'month':
            switch (key) {
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
        case 'week':
            switch (key) {
                case 'Home':
                    return isoOfDay(startOfWeekDay(days, options.firstDay));
                case 'End':
                    return isoOfDay(startOfWeekDay(days, options.firstDay) + COLUMNS - 1);
                case 'PageUp':
                    return addDays(focus, -COLUMNS);
                case 'PageDown':
                    return addDays(focus, COLUMNS);
                default:
                    return undefined;
            }
        case 'day':
            return key === 'PageUp' ? addDays(focus, -1) : key === 'PageDown' ? addDays(focus, 1) : undefined;
    }
}

/** A record drawn in a day column of the week and day views */
export interface TimeRecord {
    readonly key: string;
    readonly title: string;
    /** The start time as the locale writes it, empty for a record that began on an earlier day */
    readonly time: string;
    /** The name of the record for a screen reader: the title and its times */
    readonly label: string;
    /** Minutes from the start of the day to the start of the record, `--sui-start` */
    readonly start: number;
    /** The length in minutes of the part on this day, `--sui-span` (the view draws at least a quarter of an hour) */
    readonly span: number;
    /** The column among records that overlap, from 0, and how many columns the group has: `--sui-column` and `--sui-columns` */
    readonly column: number;
    readonly columns: number;
}

/** A day column of the week and day views */
export interface TimeDay {
    readonly iso: string;
    readonly number: string;
    /** The short weekday name */
    readonly weekday: string;
    readonly label: string;
    readonly today: boolean;
    readonly active: boolean;
    /** The all-day records on this day, shown with the day's heading */
    readonly allDay: readonly MonthRecord[];
    /** The timed records on this day, clipped to it, with their place */
    readonly records: readonly TimeRecord[];
}

export interface TimeModel {
    readonly heading: string;
    readonly days: readonly TimeDay[];
    /** The label of each of the 24 hour rows */
    readonly hours: readonly string[];
    readonly range: VisibleRange;
}

export interface TimeInput extends MonthInput {
    readonly view: 'week' | 'day';
}

/** The times of a record as a screen reader gets them: `9:30 AM – 10:00 AM`, or just the start for a record with no length */
function timesOf(event: CalendarEvent, locale: string): string {
    const start = formatTime(event.startMinute % MINUTES_PER_DAY, locale);
    if (event.endMinute <= event.startMinute) return start;
    return `${start} – ${formatTime(event.endMinute % MINUTES_PER_DAY, locale)}`;
}

const clippedSegment = (segment: Segment, event: CalendarEvent, day: number): boolean => event.firstDay < day && segment.start === 0;

/**
 * The columns of the week view (the 7 days of the week that holds the focused date) or the day view (the focused date):
 * for each day the all-day records, and the timed records clipped to the day with their start and length in minutes and
 * the column they take beside records that overlap (`layoutOverlaps`). A record that crosses midnight is in both days'
 * columns. The heading is the range of the week or the whole date of the day
 */
export function buildTimeView(input: TimeInput): TimeModel {
    const range = visibleRange(input.view, input.focus, input.firstDay);
    const first = dayOf(range.start) as number;
    const last = dayOf(range.end) as number;
    const heads = weekdayNames(input.locale, 0, 'short');
    const days: TimeDay[] = [];
    for (let day = first; day <= last; day++) {
        const iso = isoOfDay(day);
        const found = eventsOnDay(input.events, day);
        const segments = found.map((event) => segmentOn(event, day)).filter((segment): segment is Segment => segment !== undefined);
        const records: TimeRecord[] = layoutOverlaps(segments).map((placed) => ({
            key: placed.event.key,
            title: placed.event.title,
            time: clippedSegment(placed, placed.event, day) ? '' : formatTime(placed.event.startMinute % MINUTES_PER_DAY, input.locale),
            label: `${placed.event.title}, ${timesOf(placed.event, input.locale)}`,
            start: placed.start,
            span: placed.span,
            column: placed.column,
            columns: placed.columns
        }));
        days.push({
            iso,
            number: formatDayNumber(Number(iso.slice(8)), input.locale),
            weekday: heads[weekdayOfDay(day)] ?? '',
            label: formatLongDate(iso, input.locale),
            today: iso === input.today,
            active: iso === input.focus,
            allDay: found.filter((event) => event.allDay).map((event) => ({ key: event.key, title: event.title, time: '' })),
            records
        });
    }
    return {
        heading: input.view === 'day' ? formatLongDate(input.focus, input.locale) : formatDateRange(range.start, range.end, input.locale),
        days,
        hours: Array.from({ length: 24 }, (_, hour) => formatHour(hour, input.locale)),
        range
    };
}
