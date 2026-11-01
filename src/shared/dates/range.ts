import { dayOf, isIsoDate } from './isoDate.js';

/** The value of a date range field: two ISO dates, each empty when not set */
export interface RangeValue {
    readonly start: string;
    readonly end: string;
}

/** The rules of a date range, in the order they are checked; `format` (text that is not a date) is the field's own and comes before them */
export const RANGE_RULES = ['required', 'min', 'max', 'minDays', 'maxDays'] as const;

export type RangeRule = (typeof RANGE_RULES)[number];

/** What the rules read from the node: an empty bound or a count of 0 means unset */
export interface RangeSettings {
    readonly required: boolean;
    readonly min: string;
    readonly max: string;
    readonly minDays: number;
    readonly maxDays: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The range a value stands for: each side is an ISO date, or empty when it is not one (so a value of the wrong shape is an empty range) */
export function readRange(value: unknown): RangeValue {
    const source = isRecord(value) ? value : {};
    return { start: isIsoDate(source['start']) ? source['start'] : '', end: isIsoDate(source['end']) ? source['end'] : '' };
}

/** The range with its dates in order: a start after the end swaps the two. A side that is empty stays as it is */
export function orderRange(range: RangeValue): RangeValue {
    if (range.start !== '' && range.end !== '' && range.start > range.end) return { start: range.end, end: range.start };
    return range;
}

/** True when both dates are set */
export const isComplete = (range: RangeValue): boolean => range.start !== '' && range.end !== '';

/** The number of days in a complete range, both ends counted (`2026-03-01` to `2026-03-03` is 3); `undefined` when a side is empty or the end is before the start */
export function rangeDays(range: RangeValue): number | undefined {
    const start = dayOf(range.start);
    const end = dayOf(range.end);
    return start === undefined || end === undefined || end < start ? undefined : end - start + 1;
}

/**
 * The name of the first rule a range fails, or an empty string. `required` needs both dates. The other rules judge what is
 * there: a date before `min` or after `max` (on either side) fails `min` or `max`, and a complete range shorter than
 * `minDays` or longer than `maxDays` days (both ends counted) fails those. An empty range fails only `required`
 */
export function failingRangeRule(range: RangeValue, settings: RangeSettings): RangeRule | '' {
    const dates = [range.start, range.end].filter((date) => date !== '');
    if (dates.length === 0 || !isComplete(range)) {
        if (settings.required) return 'required';
        if (dates.length === 0) return '';
    }
    if (settings.min !== '' && dates.some((date) => date < settings.min)) return 'min';
    if (settings.max !== '' && dates.some((date) => date > settings.max)) return 'max';
    const days = rangeDays(orderRange(range));
    if (days === undefined) return '';
    if (settings.minDays > 0 && days < settings.minDays) return 'minDays';
    if (settings.maxDays > 0 && days > settings.maxDays) return 'maxDays';
    return '';
}

/** True when a day may be picked: it is inside `min` and `max` (an empty bound is no bound) */
export const isPickable = (iso: string, min: string, max: string): boolean => (min === '' || iso >= min) && (max === '' || iso <= max);

/** The result of pressing a day: the start that waits for its end, or the finished range */
export interface Pick {
    /** The start waiting for an end, or `undefined` when the range is finished */
    readonly pending: string | undefined;
    /** The finished range, or `undefined` while a start is waiting */
    readonly range: RangeValue | undefined;
}

/**
 * Pressing a day: the first press (nothing pending) makes it the start and waits, the second makes it the end and finishes
 * the range, and a second press before the first swaps the two so the range is always in order. Pressing the same day twice
 * is a range of one day
 */
export function pickDay(pending: string | undefined, day: string): Pick {
    if (pending === undefined) return { pending: day, range: undefined };
    return { pending: undefined, range: orderRange({ start: pending, end: day }) };
}

/** How a day sits in the range being shown */
export interface RangeMark {
    /** True from the start to the end, both included */
    readonly inRange: boolean;
    readonly edge: 'start' | 'end' | 'both' | '';
}

/** The place of a day in a range; a start that waits for its end (`pending`) is shown as a range of that one day */
export function markDay(iso: string, range: RangeValue, pending: string | undefined): RangeMark {
    const start = pending ?? range.start;
    const end = pending ?? range.end;
    if (start === '' || end === '') return { inRange: iso === start || iso === end, edge: iso === start || iso === end ? 'both' : '' };
    const ordered = orderRange({ start, end });
    if (iso < ordered.start || iso > ordered.end) return { inRange: false, edge: '' };
    if (ordered.start === ordered.end) return { inRange: true, edge: 'both' };
    return { inRange: true, edge: iso === ordered.start ? 'start' : iso === ordered.end ? 'end' : '' };
}
