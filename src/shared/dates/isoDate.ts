/** The parts of a calendar date. `month` is 1 to 12 */
export interface DateParts {
    readonly year: number;
    readonly month: number;
    readonly day: number;
}

/** One day of a month grid: its ISO date and whether it belongs to the month the grid is drawn for */
export interface GridDay {
    readonly iso: string;
    readonly inMonth: boolean;
}

/** A point in time as a calendar reader sees it: a day, and the minute of that day (`undefined` for a date with no time) */
export interface Moment {
    /** The day as a number of days since 1970-01-01 (see `dayNumber`) */
    readonly day: number;
    /** Minutes after midnight, 0 to 1439, or `undefined` when the value is a date only */
    readonly minute: number | undefined;
}

export const MINUTES_PER_DAY = 1440;
const DAYS_PER_WEEK = 7;
const GRID_WEEKS = 6;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MOMENT = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/;

const isLeap = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** The number of days in a month of the proleptic Gregorian calendar; `month` is 1 to 12 */
export function daysInMonth(year: number, month: number): number {
    return month === 2 && isLeap(year) ? 29 : (MONTH_LENGTHS[month - 1] ?? 30);
}

const pad = (value: number, length: number): string => String(value).padStart(length, '0');

/** `YYYY-MM-DD` for the parts */
export function toIso(parts: DateParts): string {
    return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
}

/** True when the parts name a real day (year 1 to 9999) */
function isReal(year: number, month: number, day: number): boolean {
    return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** The parts of an ISO date `YYYY-MM-DD`; `undefined` for anything else, including a day the month does not have (`2026-02-30`) */
export function parseIsoDate(value: unknown): DateParts | undefined {
    if (typeof value !== 'string') return undefined;
    const found = ISO_DATE.exec(value);
    if (!found) return undefined;
    const parts = { year: Number(found[1]), month: Number(found[2]), day: Number(found[3]) };
    return isReal(parts.year, parts.month, parts.day) ? parts : undefined;
}

/** True when the value is an ISO date naming a real day */
export const isIsoDate = (value: unknown): value is string => parseIsoDate(value) !== undefined;

/**
 * The day as a number of days since 1970-01-01. Plain integer arithmetic on the calendar, with no `Date` and so no time
 * zone and no daylight saving: a day is always one number after the day before it
 */
export function dayNumber(parts: DateParts): number {
    const year = parts.month <= 2 ? parts.year - 1 : parts.year;
    const era = Math.floor(year / 400);
    const yearOfEra = year - era * 400;
    const monthIndex = (parts.month + 9) % 12;
    const dayOfYear = Math.floor((153 * monthIndex + 2) / 5) + parts.day - 1;
    const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
    return era * 146097 + dayOfEra - 719468;
}

/** The parts of a day number (the inverse of `dayNumber`) */
export function fromDayNumber(days: number): DateParts {
    const shifted = days + 719468;
    const era = Math.floor(shifted / 146097);
    const dayOfEra = shifted - era * 146097;
    const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
    const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
    const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
    const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
    const month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9;
    const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
    return { year, month, day };
}

/** The ISO date of a day number */
export const isoOfDay = (days: number): string => toIso(fromDayNumber(days));

/** The day number of an ISO date; `undefined` when it is not one */
export function dayOf(iso: unknown): number | undefined {
    const parts = parseIsoDate(iso);
    return parts === undefined ? undefined : dayNumber(parts);
}

/** The day of the week of a day number: 0 is Sunday, 6 is Saturday */
export const weekdayOfDay = (days: number): number => (((days + 4) % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK;

/** The ISO date `count` days after `iso` (before it when negative) */
export function addDays(iso: string, count: number): string {
    const days = dayOf(iso);
    return days === undefined ? iso : isoOfDay(days + count);
}

/** The ISO date `count` months after `iso`; a day the new month does not have becomes its last day (`2026-01-31` plus one month is `2026-02-28`) */
export function addMonths(iso: string, count: number): string {
    const parts = parseIsoDate(iso);
    if (parts === undefined) return iso;
    const index = parts.year * 12 + (parts.month - 1) + count;
    const year = Math.floor(index / 12);
    const month = (((index % 12) + 12) % 12) + 1;
    return toIso({ year, month, day: Math.min(parts.day, daysInMonth(year, month)) });
}

/** The first day of the week that holds `days`; `firstDay` is the weekday a week starts on (0 is Sunday) */
export function startOfWeekDay(days: number, firstDay: number): number {
    return days - ((weekdayOfDay(days) - firstDay + DAYS_PER_WEEK) % DAYS_PER_WEEK);
}

/**
 * The 42 days (6 weeks of 7) a month is drawn on: the weeks from the one that holds the 1st, so the grid always has the
 * same size. Days of the neighbouring months fill the first and last rows and are marked `inMonth: false`. `firstDay` is
 * the weekday a row starts on (0 is Sunday). The rows are consecutive day numbers, so a daylight saving change cannot
 * repeat or skip a day
 */
export function monthGrid(year: number, month: number, firstDay: number): GridDay[] {
    const first = dayNumber({ year, month, day: 1 });
    const start = startOfWeekDay(first, firstDay);
    const last = first + daysInMonth(year, month) - 1;
    const grid: GridDay[] = [];
    for (let index = 0; index < GRID_WEEKS * DAYS_PER_WEEK; index++) {
        const days = start + index;
        grid.push({ iso: isoOfDay(days), inMonth: days >= first && days <= last });
    }
    return grid;
}

/** Today's date in the user's time zone, as an ISO date */
export function todayIso(now: Date = new Date()): string {
    return toIso({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

/**
 * A date or a date and time as a calendar reads it. A date only (`2026-03-14`) has no minute. A date and time
 * (`2026-03-14T09:30`, with seconds and a fraction allowed) is read as the wall-clock time it shows, with no time zone;
 * with a zone (`Z` or `+02:00`) it is the instant, shown at the viewer's local wall-clock time. Anything else is `undefined`
 */
export function parseMoment(value: unknown): Moment | undefined {
    if (typeof value !== 'string') return undefined;
    const found = ISO_MOMENT.exec(value.trim());
    if (!found) return undefined;
    const year = Number(found[1]);
    const month = Number(found[2]);
    const day = Number(found[3]);
    if (!isReal(year, month, day)) return undefined;
    if (found[4] === undefined) return { day: dayNumber({ year, month, day }), minute: undefined };
    const hour = Number(found[4]);
    const minute = Number(found[5]);
    if (hour > 23 || minute > 59 || Number(found[6] ?? '0') > 59) return undefined;
    if (found[7] !== undefined) {
        const instant = new Date(value.trim().replace(' ', 'T'));
        if (Number.isNaN(instant.getTime())) return undefined;
        return { day: dayNumber({ year: instant.getFullYear(), month: instant.getMonth() + 1, day: instant.getDate() }), minute: instant.getHours() * 60 + instant.getMinutes() };
    }
    return { day: dayNumber({ year, month, day }), minute: hour * 60 + minute };
}
