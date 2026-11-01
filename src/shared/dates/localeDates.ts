import { dayNumber, fromDayNumber, parseIsoDate, toIso } from './isoDate.js';
import type { DateParts } from './isoDate.js';

/** How wide a month or weekday name is written */
export type NameWidth = 'long' | 'short' | 'narrow';

const FALLBACK_LOCALE = 'en';
const DAYS_PER_WEEK = 7;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** A formatter for a locale; always in UTC and the Gregorian calendar, because the dates here are calendar days, not instants. A tag `Intl` refuses is read as `en` */
function formatterFor(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const signature = `${locale}|${JSON.stringify(options)}`;
    const cached = formatters.get(signature);
    if (cached) return cached;
    let formatter: Intl.DateTimeFormat;
    try {
        formatter = new Intl.DateTimeFormat(locale === '' ? FALLBACK_LOCALE : locale, { ...options, timeZone: 'UTC', calendar: 'gregory' });
    } catch {
        formatter = new Intl.DateTimeFormat(FALLBACK_LOCALE, { ...options, timeZone: 'UTC', calendar: 'gregory' });
    }
    formatters.set(signature, formatter);
    return formatter;
}

/** The `Date` that stands for a day at a minute, in UTC, so a formatter in UTC writes the same calendar day whatever the machine's zone */
function utc(parts: DateParts, minute = 0): Date {
    const date = new Date(Date.UTC(2000, parts.month - 1, parts.day, Math.floor(minute / 60), minute % 60));
    date.setUTCFullYear(parts.year);
    return date;
}

const partsOf = (iso: string): DateParts | undefined => parseIsoDate(iso);

/** The seven weekday names for a locale, starting with the weekday a week starts on (`firstDay`, 0 is Sunday) */
export function weekdayNames(locale: string, firstDay: number, width: NameWidth = 'short'): string[] {
    const formatter = formatterFor(locale, { weekday: width });
    //1970-01-04 was a Sunday
    const sunday = dayNumber({ year: 1970, month: 1, day: 4 });
    const names: string[] = [];
    for (let index = 0; index < DAYS_PER_WEEK; index++) {
        names.push(formatter.format(utc(fromDayNumber(sunday + ((firstDay + index) % DAYS_PER_WEEK)))));
    }
    return names;
}

/** The twelve month names for a locale, January first */
export function monthNames(locale: string, width: NameWidth = 'long'): string[] {
    const formatter = formatterFor(locale, { month: width });
    return Array.from({ length: 12 }, (_, index) => formatter.format(utc({ year: 2000, month: index + 1, day: 1 })));
}

/** A month and year, such as `March 2026` or `März 2026` */
export function formatMonthYear(iso: string, locale: string): string {
    const parts = partsOf(iso);
    return parts === undefined ? '' : formatterFor(locale, { month: 'long', year: 'numeric' }).format(utc(parts));
}

/** A whole date with the weekday and the month in words, such as `Saturday, March 14, 2026` */
export function formatLongDate(iso: string, locale: string): string {
    const parts = partsOf(iso);
    return parts === undefined ? '' : formatterFor(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(utc(parts));
}

/** Two dates as one range, such as `Mar 8 – 14, 2026` or `8.–14. März 2026` */
export function formatDateRange(startIso: string, endIso: string, locale: string): string {
    const start = partsOf(startIso);
    const end = partsOf(endIso);
    if (start === undefined || end === undefined) return '';
    return formatterFor(locale, { year: 'numeric', month: 'short', day: 'numeric' }).formatRange(utc(start), utc(end));
}

/** The day of the month as the locale writes digits */
export function formatDayNumber(day: number, locale: string): string {
    return formatterFor(locale, { day: 'numeric' }).format(utc({ year: 2000, month: 1, day }));
}

/** A time of day from the minute of the day (`570` is 9:30), in the locale's clock, such as `9:30 AM` or `09:30` */
export function formatTime(minute: number, locale: string): string {
    return formatterFor(locale, { hour: 'numeric', minute: '2-digit' }).format(utc({ year: 2000, month: 1, day: 1 }, minute));
}

/** The hour of the day alone, such as `9 AM` or `09 Uhr`, for the label of an hour row */
export function formatHour(hour: number, locale: string): string {
    return formatterFor(locale, { hour: 'numeric' }).format(utc({ year: 2000, month: 1, day: 1 }, hour * 60));
}

const NUMERIC_DATE: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };

/** A date as the locale writes it with numbers: `03/14/2026` for `en`, `14.03.2026` for `de`. This is what a date field shows and parses */
export function formatDate(iso: string, locale: string): string {
    const parts = partsOf(iso);
    return parts === undefined ? '' : formatterFor(locale, NUMERIC_DATE).format(utc(parts));
}

type DatePart = 'day' | 'month' | 'year';

const orders = new Map<string, readonly DatePart[]>();

/** The order a locale writes day, month and year in numeric dates, read from `formatToParts` */
export function dateOrder(locale: string): readonly DatePart[] {
    const cached = orders.get(locale);
    if (cached) return cached;
    const order = formatterFor(locale, NUMERIC_DATE)
        .formatToParts(utc({ year: 2006, month: 11, day: 22 }))
        .map((part) => part.type)
        .filter((type): type is DatePart => type === 'day' || type === 'month' || type === 'year');
    orders.set(locale, order);
    return order;
}

const digitTables = new Map<string, ReadonlyMap<string, string>>();

/** The digits a locale writes (`٠` to `٩` for Arabic numbering) mapped to `0` to `9` */
function digitsOf(locale: string): ReadonlyMap<string, string> {
    const cached = digitTables.get(locale);
    if (cached) return cached;
    const table = new Map<string, string>();
    try {
        const numbers = new Intl.NumberFormat(locale === '' ? FALLBACK_LOCALE : locale, { useGrouping: false });
        for (let digit = 0; digit <= 9; digit++) table.set(numbers.format(digit), String(digit));
    } catch {
        //an unusable tag has no digits of its own
    }
    digitTables.set(locale, table);
    return table;
}

/**
 * The ISO date a typed date stands for, or `undefined`. It reads an ISO date (`2026-03-14`) in any locale, and otherwise
 * three numbers in the order the locale writes them (`3/14/2026` for `en`, `14.3.2026` for `de`), separated by anything that
 * is not a digit. The year has four digits and the date must exist. Digits of the locale's own numbering are accepted
 */
export function parseDate(text: string, locale: string): string | undefined {
    const digits = digitsOf(locale);
    const ascii = Array.from(text.trim())
        .map((character) => digits.get(character) ?? character)
        .join('');
    const iso = parseIsoDate(ascii);
    if (iso !== undefined) return toIso(iso);
    const numbers = ascii.split(/\D+/u).filter((piece) => piece !== '');
    if (numbers.length !== 3) return undefined;
    const found: Partial<Record<DatePart, string>> = {};
    dateOrder(locale).forEach((part, index) => {
        found[part] = numbers[index];
    });
    if (found.year === undefined || found.year.length !== 4) return undefined;
    const parts = { year: Number(found.year), month: Number(found.month), day: Number(found.day) };
    const checked = parseIsoDate(toIso(parts));
    return checked !== undefined && checked.month === parts.month && checked.day === parts.day ? toIso(checked) : undefined;
}
