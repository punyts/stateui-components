import { timesOf, visibleRange } from './calendarModel.js';
import type { VisibleRange } from './calendarModel.js';
import { eventsOnDay, layoutOverlaps, segmentOn } from './events.js';
import type { CalendarEvent, Segment } from './events.js';
import { MINUTES_PER_DAY, dayOf, isoOfDay } from './isoDate.js';
import { formatHour, formatLongDate, formatMonthYear, formatTime } from './localeDates.js';

/** A record in a day of the agenda */
export interface AgendaRecord {
    readonly key: string;
    readonly title: string;
    /** The times as the locale writes them (`9:30 AM – 10:00 AM`), or empty for an all-day record */
    readonly time: string;
    /** The name of the record for a screen reader: the title and its times */
    readonly label: string;
}

/** A day of the agenda that has records */
export interface AgendaDay {
    readonly iso: string;
    readonly label: string;
    readonly today: boolean;
    readonly active: boolean;
    readonly records: readonly AgendaRecord[];
}

export interface AgendaModel {
    readonly heading: string;
    /** The days of the month that have records, in order; a day with none is left out */
    readonly days: readonly AgendaDay[];
    readonly range: VisibleRange;
}

export interface AgendaInput {
    readonly focus: string;
    readonly events: readonly CalendarEvent[];
    readonly locale: string;
    readonly today: string;
}

/**
 * The agenda of the month that holds the focused date: each day that has records, with them in the order of the day
 * (all-day records first, then by start). A record that spans days is listed on each of them; on a day after its first
 * its time is left out, as the week view does
 */
export function buildAgenda(input: AgendaInput): AgendaModel {
    const range = visibleRange('agenda', input.focus, 0);
    const first = dayOf(range.start) as number;
    const last = dayOf(range.end) as number;
    const days: AgendaDay[] = [];
    for (let day = first; day <= last; day++) {
        const found = eventsOnDay(input.events, day);
        if (found.length === 0) continue;
        const iso = isoOfDay(day);
        days.push({
            iso,
            label: formatLongDate(iso, input.locale),
            today: iso === input.today,
            active: iso === input.focus,
            records: found.map((event) => {
                const time = event.allDay || event.firstDay !== day ? '' : timesOf(event, input.locale);
                return { key: event.key, title: event.title, time, label: time === '' ? event.title : `${event.title}, ${time}` };
            })
        });
    }
    return { heading: formatMonthYear(input.focus, input.locale), days, range };
}

/** A resource row of the timeline: a room, a person */
export interface TimelineResource {
    readonly key: string;
    readonly label: string;
}

/** A record placed in a timeline row */
export interface TimelineRecord {
    readonly key: string;
    readonly title: string;
    /** The start time as the locale writes it, empty for a record that began on an earlier day */
    readonly time: string;
    readonly label: string;
    /** Minutes from the start of the day to the start, `--sui-start`, and the length on this day, `--sui-span` */
    readonly start: number;
    readonly span: number;
    /** The lane among records of the row that overlap, from 0, and how many lanes the group has */
    readonly lane: number;
    readonly lanes: number;
}

export interface TimelineRow {
    readonly key: string;
    readonly label: string;
    readonly records: readonly TimelineRecord[];
    /** The all-day records of the row, shown with its label */
    readonly allDay: readonly { readonly key: string; readonly title: string }[];
}

export interface TimelineModel {
    readonly heading: string;
    readonly rows: readonly TimelineRow[];
    /** The label of each of the 24 hour columns */
    readonly hours: readonly string[];
    readonly range: VisibleRange;
}

export interface TimelineInput extends AgendaInput {
    /**
     * The rows in order. Empty, the rows are the resources the day's records name, in the order they first appear; a
     * record whose resource is not a row is not shown
     */
    readonly resources: readonly TimelineResource[];
}

/**
 * The timeline of the focused day: a row per resource with time running across. A timed record is clipped to the day and
 * placed by minutes; records of a row that overlap take lanes (`layoutOverlaps`), so the row grows instead of hiding one
 */
export function buildTimeline(input: TimelineInput): TimelineModel {
    const day = dayOf(input.focus) as number;
    const found = eventsOnDay(input.events, day);
    const resources: TimelineResource[] =
        input.resources.length > 0
            ? [...input.resources]
            : [...new Set(found.map((event) => event.resource).filter((resource) => resource !== ''))].map((key) => ({ key, label: key }));
    const rows: TimelineRow[] = resources.map((resource) => {
        const own = found.filter((event) => event.resource === resource.key);
        const segments = own.map((event) => segmentOn(event, day)).filter((segment): segment is Segment => segment !== undefined);
        const records: TimelineRecord[] = layoutOverlaps(segments).map((placed) => ({
            key: placed.event.key,
            title: placed.event.title,
            time: placed.event.firstDay < day && placed.start === 0 ? '' : formatTime(placed.event.startMinute % MINUTES_PER_DAY, input.locale),
            label: `${placed.event.title}, ${resource.label}, ${timesOf(placed.event, input.locale)}`,
            start: placed.start,
            span: placed.span,
            lane: placed.column,
            lanes: placed.columns
        }));
        return { key: resource.key, label: resource.label, records, allDay: own.filter((event) => event.allDay).map((event) => ({ key: event.key, title: event.title })) };
    });
    return {
        heading: formatLongDate(input.focus, input.locale),
        rows,
        hours: Array.from({ length: 24 }, (_, hour) => formatHour(hour, input.locale)),
        range: { start: input.focus, end: input.focus }
    };
}
