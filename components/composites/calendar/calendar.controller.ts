import type { ControllerContext } from '@punyts/stateui';
import { CALENDAR_VIEWS, buildMonth, buildTimeView, dateForKey, stepDate } from '../shared/dates/calendarModel.js';
import type { CalendarView, MonthCell, TimeDay, VisibleRange } from '../shared/dates/calendarModel.js';
import { readEvents } from '../shared/dates/events.js';
import type { CalendarEvent } from '../shared/dates/events.js';
import { isIsoDate, todayIso } from '../shared/dates/isoDate.js';
import { firstDayOf } from '../shared/dates/weekStart.js';

const FIELD_NAMES = ['key', 'startField', 'endField', 'titleField'] as const;
const NAVIGATION_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

const fill = (template: unknown, count: number | string): string => (typeof template === 'string' ? template : '').replace('{count}', String(count));

/**
 * A calendar drawn from state: the controller turns `date`, `view`, the records and `$.locale` into the runtime properties
 * `heading`, `visible` and, for the month view, `weekdays` and `weeks`, or for the week and day views `days`, `hours` and
 * `dayCount`, and the view only draws them. Nothing is read from the layout.
 *
 * `date` is the focused date (empty means today, until the user moves it) and the month it is in is the month shown. The
 * grid is the 6 × 7 days of `src/shared/dates/` with the first day of the week from `$.locale`; a record with a readable
 * `startField` is on every day it covers (an all-day record with a date-only `endField` covers both ends), at most three
 * to a day and the rest as one `+n` entry that raises `select` for the day.
 *
 * `view` `week` and `day` draw one column per day (the 7 days of the week that holds `date`, or `date`) beside 24 hour rows.
 * A timed record is placed in its column by the custom properties `--sui-start` and `--sui-span` (minutes from the start of the
 * day, and how many; a record that crosses midnight has a part in each day, clipped to it), and records that overlap sit side by
 * side through `--sui-column` and `--sui-columns`; all-day records stand under the day's heading. Switching `view` keeps `date`
 * and raises `range` for the new range. In these views Left and Right move a day, Home and End (week) go to the ends of the week,
 * Page Up and Page Down move a week (a day in the day view).
 *
 * The grid is `role="grid"` with one tab stop, the cell of the focused date. Left and Right move a day (swapped in
 * right-to-left text), Up and Down a week, Home and End to the first and last day of the week, Page Up and Page Down a
 * month (a year with Shift), Enter and Space raise `select`; every move writes `date`. A press on a day writes `date` and
 * raises `select` with the ISO date, a press on a record raises `open` with its key. `range` (`{ start, end }`, the first
 * and last day of the grid) is raised once whenever the visible range changes, however `date` or `view` changed, and not at
 * load: `visible` holds the current range for a data provider that needs it at the start
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const path = (name: string): string => `${basePath}.${name}`;
    const read = (name: string): unknown => store.get<unknown>(path(name));
    const text = (name: string, fallback: string): string => {
        const value = read(name);
        return typeof value === 'string' && value !== '' ? value : fallback;
    };
    const locale = (): string => {
        const value = store.get<unknown>('$.locale');
        return typeof value === 'string' && value !== '' ? value : 'en';
    };
    const view = (): CalendarView => {
        const value = read('view');
        return typeof value === 'string' && (CALENDAR_VIEWS as readonly string[]).includes(value) ? (value as CalendarView) : 'month';
    };
    /** The focused date: `date` when it is an ISO date, otherwise today */
    const focus = (): string => {
        const value = read('date');
        return isIsoDate(value) ? value : todayIso();
    };
    const raise = (name: string, detail: unknown): void => {
        element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
    };
    const rtl = (): boolean => getComputedStyle(element).direction === 'rtl';
    const part = (selector: string): HTMLElement | null => element.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;

    let disposed = false;
    let scheduled = false;
    let events: CalendarEvent[] | undefined;
    let announced = '';

    const loadEvents = (): CalendarEvent[] => {
        events ??= readEvents(read('records'), { key: text('key', 'id'), startField: text('startField', 'start'), endField: text('endField', ''), titleField: text('titleField', 'title') });
        return events;
    };

    /** The cell as the view draws it: the model's fields plus the texts that come from content and the tab stop */
    const cellState = (cell: MonthCell): Record<string, unknown> => {
        const records: Record<string, unknown> = {};
        cell.records.forEach((record, index) => {
            records[`e${index}`] = { key: record.key, title: record.title, time: record.time, label: record.time === '' ? record.title : `${record.title}, ${record.time}` };
        });
        return {
            iso: cell.iso,
            number: cell.number,
            label: cell.label,
            today: cell.today,
            outside: cell.outside,
            active: cell.active,
            tab: cell.active ? 0 : -1,
            records,
            more: cell.more,
            moreText: fill(read('_more'), cell.more),
            moreLabel: fill(read('_moreLabel'), cell.more)
        };
    };

    /** A day column of the week and day views as the view draws it */
    const dayState = (day: TimeDay): Record<string, unknown> => {
        const allDay: Record<string, unknown> = {};
        day.allDay.forEach((record, index) => {
            allDay[`e${index}`] = { key: record.key, title: record.title };
        });
        const records: Record<string, unknown> = {};
        day.records.forEach((record, index) => {
            records[`r${index}`] = { key: record.key, title: record.title, time: record.time, label: record.label, start: record.start, span: record.span, column: record.column, columns: record.columns };
        });
        return { iso: day.iso, number: day.number, weekday: day.weekday, label: day.label, today: day.today, active: day.active, tab: day.active ? 0 : -1, allDay, records };
    };

    const drawMonth = (firstDay: number): VisibleRange => {
        const model = buildMonth({ focus: focus(), events: loadEvents(), locale: locale(), firstDay, today: todayIso() });
        const weekdays: Record<string, unknown> = {};
        model.weekdays.forEach((head, index) => {
            weekdays[`w${index}`] = { short: head.short, long: head.long };
        });
        const weeks: Record<string, unknown> = {};
        model.weeks.forEach((week, row) => {
            const days: Record<string, unknown> = {};
            week.forEach((cell, column) => {
                days[`c${column}`] = cellState(cell);
            });
            weeks[`r${row}`] = { days };
        });
        store.set(path('heading'), model.heading);
        store.set(path('days'), {});
        store.set(path('hours'), {});
        store.set(path('weekdays'), weekdays);
        store.set(path('weeks'), weeks);
        return model.range;
    };

    const drawTime = (current: 'week' | 'day', firstDay: number): VisibleRange => {
        const model = buildTimeView({ view: current, focus: focus(), events: loadEvents(), locale: locale(), firstDay, today: todayIso() });
        const days: Record<string, unknown> = {};
        model.days.forEach((day, index) => {
            days[`d${index}`] = dayState(day);
        });
        const hours: Record<string, unknown> = {};
        model.hours.forEach((label, index) => {
            hours[`h${index}`] = { label };
        });
        store.set(path('heading'), model.heading);
        store.set(path('weekdays'), {});
        store.set(path('weeks'), {});
        store.set(path('dayCount'), model.days.length);
        store.set(path('hours'), hours);
        store.set(path('days'), days);
        return model.range;
    };

    const draw = (): void => {
        const current = view();
        const firstDay = firstDayOf(locale());
        const range = current === 'month' ? drawMonth(firstDay) : drawTime(current, firstDay);
        store.set(path('visible'), { start: range.start, end: range.end });
        announceRange(range);
    };

    /** `range` is raised when the visible range differs from the one last drawn; the first drawing only records it */
    const announceRange = (range: VisibleRange): void => {
        const signature = `${range.start}/${range.end}`;
        const first = announced === '';
        if (signature === announced) return;
        announced = signature;
        if (!first) raise('range', { start: range.start, end: range.end });
    };

    const refresh = (): void => {
        scheduled = false;
        if (!disposed) draw();
    };
    const schedule = (): void => {
        if (scheduled || disposed) return;
        scheduled = true;
        queueMicrotask(refresh);
    };
    const onRecords = (): void => {
        events = undefined;
        schedule();
    };

    const recordPaths = (): string[] => {
        const base = path('records');
        const fields = FIELD_NAMES.map((name) => text(name, '')).filter((name) => name !== '');
        return [base, `${base}.$every`, ...fields.map((name) => `${base}.$every.${name}`)];
    };
    let watchedRecords = recordPaths();
    const onFields = (): void => {
        store.off(watchedRecords, onRecords);
        watchedRecords = recordPaths();
        store.on(watchedRecords, onRecords);
        onRecords();
    };
    const fieldPaths = FIELD_NAMES.map(path);
    const settingPaths = [path('date'), path('view'), path('_more'), path('_moreLabel'), '$.locale'];
    store.on(watchedRecords, onRecords);
    store.on(fieldPaths, onFields);
    store.on(settingPaths, schedule);
    draw();

    /** Moves the focused date by writing `date`; with `toCell` the focus follows into the new cell once it is drawn */
    const moveTo = (iso: string, toCell: boolean): void => {
        if (iso === read('date')) return;
        store.set(path('date'), iso);
        if (toCell) queueMicrotask(() => part(`[data-date="${iso}"]`)?.focus());
    };
    const select = (iso: string): void => raise('select', iso);

    /** The element in the event's path that has the data attribute, and its value */
    const marked = (event: Event, name: string): { node: HTMLElement; value: string } | undefined => {
        for (const node of event.composedPath()) {
            if (node === element) break;
            if (node instanceof HTMLElement && node.dataset[name] !== undefined) return { node, value: node.dataset[name] ?? '' };
        }
        return undefined;
    };

    return {
        onPrevious: () => moveTo(stepDate(view(), focus(), -1), false),
        onNext: () => moveTo(stepDate(view(), focus(), 1), false),
        onToday: () => moveTo(todayIso(), false),
        onClick: (event: Event) => {
            const record = marked(event, 'record');
            if (record !== undefined) {
                raise('open', record.value);
                return;
            }
            const more = marked(event, 'more');
            const day = more ?? marked(event, 'date');
            const iso = more === undefined ? day?.value : more.value;
            if (iso === undefined || !isIsoDate(iso)) return;
            moveTo(iso, true);
            select(iso);
        },
        onKeyDown: (event: KeyboardEvent) => {
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            const origin = event.composedPath()[0];
            if (!(origin instanceof HTMLElement) || origin.dataset['date'] === undefined) return;
            const current = origin.dataset['date'];
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                select(current);
                return;
            }
            if (!NAVIGATION_KEYS.has(event.key)) return;
            const next = dateForKey(event.key, current, { view: view(), firstDay: firstDayOf(locale()), rtl: rtl(), shift: event.shiftKey });
            if (next === undefined) return;
            event.preventDefault();
            moveTo(next, true);
        },
        dispose: () => {
            disposed = true;
            store.off(watchedRecords, onRecords);
            store.off(fieldPaths, onFields);
            store.off(settingPaths, schedule);
        }
    };
}
