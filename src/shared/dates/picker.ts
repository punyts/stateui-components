import { addMonths, monthGrid, parseIsoDate, toIso } from './isoDate.js';
import { formatDayNumber, formatLongDate, formatMonthYear } from './localeDates.js';
import { weekdayHeads } from './calendarModel.js';
import { isPickable, markDay } from './range.js';
import type { RangeMark, RangeValue } from './range.js';

/** The number of months a range picker shows side by side */
export const PICKER_MONTHS = 2;

/** One day of a month in the picker; a day of a neighbouring month is `blank` (the grid keeps its 6 × 7 shape, and a date is never shown twice) */
export interface PickerDay extends RangeMark {
    readonly iso: string;
    readonly number: string;
    readonly label: string;
    readonly blank: boolean;
    readonly today: boolean;
    /** False for a day outside `min` and `max`: it is shown but cannot be picked */
    readonly pickable: boolean;
    /** True for the day the keyboard is on: the one tab stop of the picker */
    readonly cursor: boolean;
    /** True for the start that waits for its end */
    readonly pending: boolean;
}

export interface PickerMonth {
    readonly heading: string;
    readonly weekdays: readonly { readonly short: string; readonly long: string }[];
    readonly weeks: readonly (readonly PickerDay[])[];
}

export interface PickerInput {
    /** Any date in the first month shown */
    readonly first: string;
    readonly range: RangeValue;
    /** A start waiting for its end */
    readonly pending: string | undefined;
    readonly min: string;
    readonly max: string;
    readonly locale: string;
    readonly firstDay: number;
    readonly today: string;
    /** The date the keyboard is on */
    readonly cursor: string;
}

const COLUMNS = 7;

/** The first of the month of an ISO date, as an ISO date; the date itself when it is not one */
export function firstOfMonth(iso: string): string {
    const parts = parseIsoDate(iso);
    return parts === undefined ? iso : toIso({ year: parts.year, month: parts.month, day: 1 });
}

/** The first month to show so that `cursor` is on screen: `first` when it already is, else the nearest placement (the cursor's month as the first month, or as the last) */
export function monthsFor(first: string, cursor: string): string {
    const start = firstOfMonth(first);
    const month = firstOfMonth(cursor);
    if (month < start) return month;
    const last = addMonths(start, PICKER_MONTHS - 1);
    return month > last ? addMonths(month, -(PICKER_MONTHS - 1)) : start;
}

/** The months of the picker, from `first`: each a heading, weekday names and 6 × 7 days marked with their place in the range, whether they can be picked, and the cursor */
export function buildPicker(input: PickerInput): PickerMonth[] {
    const months: PickerMonth[] = [];
    for (let offset = 0; offset < PICKER_MONTHS; offset++) {
        const shown = addMonths(firstOfMonth(input.first), offset);
        const parts = parseIsoDate(shown) ?? { year: 1970, month: 1, day: 1 };
        const grid = monthGrid(parts.year, parts.month, input.firstDay);
        const days: PickerDay[] = grid.map((day) => {
            const mark = day.inMonth ? markDay(day.iso, input.range, input.pending) : { inRange: false, edge: '' as const };
            return {
                ...mark,
                iso: day.iso,
                number: day.inMonth ? formatDayNumber(Number(day.iso.slice(8)), input.locale) : '',
                label: day.inMonth ? formatLongDate(day.iso, input.locale) : '',
                blank: !day.inMonth,
                today: day.inMonth && day.iso === input.today,
                pickable: day.inMonth && isPickable(day.iso, input.min, input.max),
                cursor: day.inMonth && day.iso === input.cursor,
                pending: day.inMonth && day.iso === input.pending
            };
        });
        const weeks: PickerDay[][] = [];
        for (let row = 0; row < days.length; row += COLUMNS) weeks.push(days.slice(row, row + COLUMNS));
        months.push({ heading: formatMonthYear(shown, input.locale), weekdays: weekdayHeads(input.locale, input.firstDay), weeks });
    }
    return months;
}
