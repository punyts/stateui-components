import { MINUTES_PER_DAY, parseMoment } from './isoDate.js';
import type { Moment } from './isoDate.js';

/** The fields of a record a calendar reads */
export interface EventFields {
    /** The field of an array record that holds its key (a keyed map is keyed by its own keys) */
    readonly key: string;
    readonly startField: string;
    /** Empty, or a record with no valid end, is a record that lasts as long as its start (a day, or an instant) */
    readonly endField: string;
    readonly titleField: string;
}

/** A record as a calendar shows it: its key, title and the days and minutes it covers */
export interface CalendarEvent {
    readonly key: string;
    readonly title: string;
    /** The position of the record in the data, which orders records that start together */
    readonly position: number;
    /** The first day, as a day number (`dayNumber`) */
    readonly firstDay: number;
    /** The last day, inclusive */
    readonly lastDay: number;
    /** True for a record whose start is a date with no time: it fills whole days */
    readonly allDay: boolean;
    /** The start as minutes since the start of `firstDay` (0 for an all-day record) */
    readonly startMinute: number;
    /** The end as minutes since the start of `firstDay`, exclusive (the end of `lastDay` for an all-day record) */
    readonly endMinute: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const keyText = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value === '' ? undefined : value;
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
};

/** Minutes from the start of `origin` to a moment; a date with no time is the start of its day */
const minutesFrom = (origin: number, moment: Moment): number => (moment.day - origin) * MINUTES_PER_DAY + (moment.minute ?? 0);

/**
 * Turns one record into the span it covers. A start that is a date only makes an all-day record: it covers its days from
 * the start day to the end day, both included (no end is one day). A start with a time covers the minutes from the start to
 * the end, the end not included, so a record that ends at midnight does not show on the next day. An end before the start,
 * an end that cannot be read, or no end, makes the record last as long as its start (a day, or a quarter of an hour in
 * the day views). A record with no readable start is `undefined`
 */
export function toEvent(key: string, record: Record<string, unknown>, fields: EventFields, position: number): CalendarEvent | undefined {
    const start = parseMoment(record[fields.startField]);
    if (start === undefined) return undefined;
    const end = fields.endField === '' ? undefined : parseMoment(record[fields.endField]);
    const title = record[fields.titleField];
    const text = typeof title === 'string' ? title : typeof title === 'number' && Number.isFinite(title) ? String(title) : '';
    const allDay = start.minute === undefined;
    if (allDay) {
        const lastDay = end !== undefined && end.day > start.day ? end.day : start.day;
        return { key, title: text, position, firstDay: start.day, lastDay, allDay, startMinute: 0, endMinute: (lastDay - start.day + 1) * MINUTES_PER_DAY };
    }
    const begin = start.minute ?? 0;
    const endMinute = end !== undefined && minutesFrom(start.day, end) > begin ? minutesFrom(start.day, end) : begin;
    const lastDay = start.day + Math.floor(Math.max(endMinute - 1, begin) / MINUTES_PER_DAY);
    return { key, title: text, position, firstDay: start.day, lastDay, allDay, startMinute: begin, endMinute };
}

/** The records a calendar shows, in data order; records are an array keyed by the `key` field, or a keyed map. A record with no readable start is left out */
export function readEvents(records: unknown, fields: EventFields): CalendarEvent[] {
    const found: CalendarEvent[] = [];
    const add = (key: string | undefined, record: unknown): void => {
        if (key === undefined || !isRecord(record)) return;
        const event = toEvent(key, record, fields, found.length);
        if (event !== undefined) found.push(event);
    };
    if (Array.isArray(records)) {
        for (const record of records as unknown[]) add(isRecord(record) ? keyText(record[fields.key]) : undefined, record);
    } else if (isRecord(records)) {
        for (const [key, record] of Object.entries(records)) add(key, record);
    }
    return found;
}

/** The records that fall on a day (a day number): all-day records first, then by start, then in data order */
export function eventsOnDay(events: readonly CalendarEvent[], day: number): CalendarEvent[] {
    return events
        .filter((event) => event.firstDay <= day && event.lastDay >= day)
        .sort((a, b) => Number(b.allDay) - Number(a.allDay) || startOn(a, day) - startOn(b, day) || a.position - b.position);
}

/** Where a record starts on a day: minutes into that day, 0 when it began on an earlier day */
const startOn = (event: CalendarEvent, day: number): number => Math.max(0, event.startMinute - (day - event.firstDay) * MINUTES_PER_DAY);

/** The part of a timed record that is on one day: minutes from the start of the day, and how many; the record is clipped to the day */
export interface Segment {
    readonly event: CalendarEvent;
    readonly start: number;
    readonly span: number;
}

/** The shortest a record is drawn, in minutes, so an instant or a short record can be seen and pressed */
export const MIN_SPAN = 15;

/** The part of a timed record on `day`, or `undefined` when it is all-day or not on that day */
export function segmentOn(event: CalendarEvent, day: number): Segment | undefined {
    if (event.allDay || event.firstDay > day || event.lastDay < day) return undefined;
    const offset = (day - event.firstDay) * MINUTES_PER_DAY;
    const start = Math.max(0, event.startMinute - offset);
    const end = Math.min(MINUTES_PER_DAY, event.endMinute - offset);
    return { event, start, span: Math.max(0, end - start) };
}

/** A segment with the column it sits in and the number of columns it shares the width with */
export interface Placed extends Segment {
    readonly column: number;
    readonly columns: number;
}

/**
 * Lays out the segments of one day so records that overlap in time sit side by side. A group is a run of records that
 * overlap, one after another; inside it each record takes the first column that is free when it starts, and every record
 * of the group shares the group's column count. Records are judged by the time they are drawn for, so a record shorter
 * than `MIN_SPAN` counts as `MIN_SPAN` long
 */
export function layoutOverlaps(segments: readonly Segment[]): Placed[] {
    const sorted = [...segments].sort((a, b) => a.start - b.start || b.span - a.span || a.event.position - b.event.position);
    const placed: Placed[] = [];
    let group: { segment: Segment; column: number }[] = [];
    let columnEnds: number[] = [];
    let groupEnd = -1;
    const close = (): void => {
        for (const entry of group) placed.push({ ...entry.segment, column: entry.column, columns: columnEnds.length });
        group = [];
        columnEnds = [];
    };
    for (const segment of sorted) {
        if (group.length > 0 && segment.start >= groupEnd) close();
        const end = segment.start + Math.max(segment.span, MIN_SPAN);
        let column = columnEnds.findIndex((columnEnd) => columnEnd <= segment.start);
        if (column < 0) column = columnEnds.length;
        columnEnds[column] = end;
        group.push({ segment, column });
        groupEnd = group.length === 1 ? end : Math.max(groupEnd, end);
    }
    close();
    return placed;
}
