import type { ControllerContext } from '@punyts/stateui';
import { dateForKey, weekdayHeads } from '../shared/dates/calendarModel.js';
import { addMonths, isIsoDate, todayIso } from '../shared/dates/isoDate.js';
import { formatDate, parseDate } from '../shared/dates/localeDates.js';
import { buildPicker, firstOfMonth, monthsFor } from '../shared/dates/picker.js';
import type { PickerMonth } from '../shared/dates/picker.js';
import { failingRangeRule, pickDay, readRange } from '../shared/dates/range.js';
import type { RangeSettings, RangeValue } from '../shared/dates/range.js';
import { firstDayOf } from '../shared/dates/weekStart.js';
import { createField } from '../shared/field/field.js';
import { createPopover } from '../shared/popover/popover.js';
import type { PopoverHandle } from '../shared/popover/popover.js';

type Side = 'start' | 'end';
const SIDES: readonly Side[] = ['start', 'end'];
/** The rule of text that is not a date; the field's own, so the shared rules never name it */
const FORMAT_RULE = 'format';
const NAVIGATION_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;

/**
 * A date range field on the field base. `value` is `{ start, end }`, two ISO dates, each empty when not set. The two inputs
 * show the dates in the form `$.locale` writes them (`03/14/2026` for `en`, `14.03.2026` for `de`); typing a date that parses
 * with the locale (`src/shared/dates/`, any digits and separators, a four-digit year) writes that side of `value` at once,
 * empty text empties it, and text that does not parse is kept as typed, writes nothing and fails the field's own rule
 * `format`. When an input is committed (Enter or leaving it) the dates are shown in the locale's form; a typed end before the
 * start is kept as typed and fails the rule `order` (it is never swapped, so the user sees what they typed and fixes it). The runtime `startText` and `endText` are what the inputs show; they are never
 * rewritten while the user types a date that means the same as `value`.
 *
 * The button, and the Down arrow in an input, open a popup in the top layer (the shared popover code) with two months side by
 * side (`buildPicker`, 6 × 7 days each, days of the neighbouring months blank so a date is never shown twice). The first press
 * on a day makes it the start and waits (`picking`: nothing is written yet), the second makes it the end and writes the
 * finished range (a second press before the first swaps them), then closes the popup and returns the focus to the start
 * input; the days from the start to the end are highlighted. Days outside `min` and `max` can be seen but not picked. The
 * keyboard is on one day (the one tab stop): the arrow keys, Home and End, Page Up and Page Down (a year with Shift) move
 * it and show other months when it leaves them, Enter and Space press it, Escape closes the popup. The previous and next
 * buttons move both months.
 *
 * The field's rules are its own (`exclusive`), checked in this order: `format`, `required` (both dates), `min` and `max`
 * (either date outside them), `minDays` and `maxDays` (the number of days in the range, both ends counted, so
 * 1 March to 3 March is 3). `change` carries `{ value: { start, end } }`
 */
export default function controller(context: ControllerContext) {
    const { element, store, basePath } = context;
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const valuePath = `${basePath}.value`;
    const locale = (): string => {
        const value = store.get<unknown>('$.locale');
        return typeof value === 'string' && value !== '' ? value : 'en';
    };
    const part = <T extends HTMLElement>(selector: string): T | null => element.shadowRoot?.querySelector<T>(selector) ?? null;
    const inputOf = (side: Side): HTMLInputElement | null => part<HTMLInputElement>(side === 'start' ? '#control' : '#end');
    const blocked = (): boolean => read('disabled') === true || read('locked') === true || read('readonly') === true;
    const range = (): RangeValue => readRange(read('value'));
    const bound = (name: string): string => (isIsoDate(read(name)) ? (read(name) as string) : '');
    const settings = (): RangeSettings => ({
        required: read('required') === true,
        min: bound('min'),
        max: bound('max'),
        minDays: isCount(read('minDays')) ? (read('minDays') as number) : 0,
        maxDays: isCount(read('maxDays')) ? (read('maxDays') as number) : 0
    });

    const invalid: Record<Side, boolean> = { start: false, end: false };
    let writing = false;
    const field = createField(context, 'value', {
        exclusive: true,
        empty: () => ({ start: '', end: '' }),
        entryRule: () => (invalid.start || invalid.end ? FORMAT_RULE : failingRangeRule(range(), settings()))
    });

    const writeValue = (next: RangeValue): void => {
        writing = true;
        try {
            store.set(valuePath, { start: next.start, end: next.end });
        } finally {
            writing = false;
        }
    };
    const setText = (side: Side, value: string): void => {
        if (read(`${side}Text`) !== value) store.set(`${basePath}.${side}Text`, value);
        const input = inputOf(side);
        if (input && input.value !== value) input.value = value;
    };
    /**
     * Shows the dates in the inputs. A side whose text already means what `value` says is left as typed, and a side with
     * text that does not parse is left alone, unless `force` (a commit or a new language), which writes the locale's form
     */
    const showTexts = (force: boolean): void => {
        const now = range();
        for (const side of SIDES) {
            const typed = text(read(`${side}Text`));
            const keep = !force && typed !== '' && (invalid[side] || parseDate(typed, locale()) === now[side]);
            if (force) invalid[side] = false;
            if (!keep) setText(side, now[side] === '' ? '' : formatDate(now[side], locale()));
        }
    };

    //---- the popup
    let popover: PopoverHandle | undefined;
    let first = firstOfMonth(todayIso());
    let cursor = todayIso();
    let pending: string | undefined;

    const picker = (): PickerMonth[] =>
        buildPicker({ first, range: range(), pending, min: bound('min'), max: bound('max'), locale: locale(), firstDay: firstDayOf(locale()), today: todayIso(), cursor });
    const drawPicker = (): void => {
        const months: Record<string, unknown> = {};
        const weekdays: Record<string, unknown> = {};
        weekdayHeads(locale(), firstDayOf(locale())).forEach((head, at) => {
            weekdays[`w${at}`] = { short: head.short, long: head.long };
        });
        picker().forEach((month, index, all) => {
            const weeks: Record<string, unknown> = {};
            month.weeks.forEach((week, row) => {
                const days: Record<string, unknown> = {};
                week.forEach((day, column) => {
                    days[`c${column}`] = {
                        iso: day.iso,
                        number: day.number,
                        label: day.label,
                        blank: day.blank,
                        today: day.today,
                        pickable: day.pickable,
                        inRange: day.inRange,
                        edge: day.edge,
                        pending: day.pending,
                        tab: day.cursor ? 0 : -1
                    };
                });
                weeks[`r${row}`] = { days };
            });
            months[`m${index}`] = { heading: month.heading, hidePrevious: index !== 0, hideNext: index !== all.length - 1, weekdays: structuredClone(weekdays), weeks };
        });
        store.set(`${basePath}.months`, months);
        store.set(`${basePath}.picking`, pending !== undefined);
    };
    const isOpen = (): boolean => read('open') === true;
    const focusCursor = (): void => {
        part(`.popup .cell[data-date="${cursor}"]:not([data-blank])`)?.focus();
    };
    /** True while the popup is being closed: the focus that leaves it then is not the user leaving the field */
    let closing = false;
    const closePicker = (focusInput: boolean): void => {
        closing = true;
        try {
            pending = undefined;
            if (isOpen()) store.set(`${basePath}.open`, false);
            store.set(`${basePath}.picking`, false);
            popover?.close();
            if (focusInput) inputOf('start')?.focus();
        } finally {
            closing = false;
        }
    };
    const popoverOf = (): PopoverHandle | undefined => {
        if (popover) return popover;
        const popup = part('#popup');
        if (!popup) return undefined;
        const inside = [part('.box')].filter((node): node is HTMLElement => node !== null);
        popover = createPopover({ element: popup, anchor: '--c', inside, onDismiss: (reason) => closePicker(reason === 'escape') });
        return popover;
    };
    const openPicker = (): void => {
        if (blocked()) return;
        const now = range();
        pending = undefined;
        cursor = now.start !== '' ? now.start : todayIso();
        first = firstOfMonth(cursor);
        drawPicker();
        const handle = popoverOf();
        if (!handle) return;
        store.set(`${basePath}.open`, true);
        handle.open();
        queueMicrotask(focusCursor);
    };
    const moveCursor = (next: string): void => {
        cursor = next;
        first = monthsFor(first, cursor);
        drawPicker();
        queueMicrotask(focusCursor);
    };
    const finish = (finished: RangeValue): void => {
        invalid.start = false;
        invalid.end = false;
        writeValue(finished);
        showTexts(true);
        closePicker(true);
    };
    const pickDate = (day: string): void => {
        const result = pickDay(pending, day);
        if (result.range) {
            finish(result.range);
            return;
        }
        pending = result.pending;
        cursor = day;
        drawPicker();
    };

    //---- keeping up with state written by others
    const onValue = (): void => {
        if (writing) return;
        invalid.start = false;
        invalid.end = false;
        showTexts(false);
        if (isOpen()) drawPicker();
    };
    /** A write to one side (`value.end`) does not reach the field base, which watches `value`; the whole range is written again so `change` and `dirty` follow */
    let sideScheduled = false;
    let disposed = false;
    const onSide = (): void => {
        if (writing || sideScheduled) return;
        sideScheduled = true;
        //an object written whole changes its sides one by one: the range is written again once they have all changed
        queueMicrotask(() => {
            sideScheduled = false;
            if (!writing && !disposed) writeValue(range());
        });
    };
    const onLocale = (): void => {
        showTexts(true);
        if (isOpen()) drawPicker();
    };
    const onSettings = (): void => {
        if (isOpen()) drawPicker();
    };
    const onBlocked = (): void => {
        if (blocked() && isOpen()) closePicker(false);
    };
    const valuePaths = [valuePath, `${valuePath}.start`, `${valuePath}.end`];
    const sidePaths = [`${valuePath}.start`, `${valuePath}.end`];
    const settingPaths = [`${basePath}.min`, `${basePath}.max`];
    const blockedPaths = [`${basePath}.disabled`, `${basePath}.readonly`, `${basePath}.locked`];
    store.on(valuePaths, onValue);
    store.on(sidePaths, onSide);
    store.on(['$.locale'], onLocale);
    store.on(settingPaths, onSettings);
    store.on(blockedPaths, onBlocked);
    showTexts(true);

    const sideOf = (event: Event): Side | undefined => {
        const target = event.currentTarget ?? event.target;
        const side = target instanceof HTMLElement ? target.dataset['side'] : undefined;
        return side === 'start' || side === 'end' ? side : undefined;
    };
    const marked = (event: Event, name: string): HTMLElement | undefined => {
        for (const node of event.composedPath()) {
            if (node === element) break;
            if (node instanceof HTMLElement && node.dataset[name] !== undefined) return node;
        }
        return undefined;
    };

    return {
        ...field,
        // The native input and change events are composed or bubble out of the field; it raises its own `change`
        onInput: (event: Event) => {
            event.stopPropagation();
            const side = sideOf(event);
            const input = side === undefined ? null : inputOf(side);
            if (side === undefined || !input || read('readonly') === true) return;
            store.set(`${basePath}.${side}Text`, input.value);
            if (input.value.trim() === '') {
                invalid[side] = false;
                writeValue({ ...range(), [side]: '' });
                return;
            }
            const parsed = parseDate(input.value, locale());
            if (parsed === undefined) {
                invalid[side] = true;
                return;
            }
            invalid[side] = false;
            if (range()[side] !== parsed) writeValue({ ...range(), [side]: parsed });
            if (isOpen()) drawPicker();
        },
        onCommit: (event: Event) => {
            event.stopPropagation();
            const now = range();
            const bad = invalid.start || invalid.end || failingRangeRule(now, settings()) === 'order';
            for (const side of SIDES) {
                if (invalid[side]) continue;
                setText(side, now[side] === '' ? '' : formatDate(now[side], locale()));
            }
            if (isOpen()) drawPicker();
            if (bad || read('error') === FORMAT_RULE) field.validate();
        },
        onInputKey: (event: KeyboardEvent) => {
            if (event.key !== 'ArrowDown' || event.ctrlKey || event.metaKey || blocked()) return;
            event.preventDefault();
            if (!isOpen()) openPicker();
        },
        onToggle: () => {
            if (isOpen()) closePicker(true);
            else openPicker();
        },
        onFocusOut: (event: FocusEvent) => {
            const next = event.relatedTarget;
            const root = element.shadowRoot;
            if (closing || (next instanceof Node && root?.contains(next))) return;
            if (isOpen()) closePicker(false);
            field.onBlur();
        },
        /**
         * Focus that leaves the popup for nowhere is not always the user leaving: a day that the redraw makes blank is hidden,
         * and the browser drops the focus from it at its next frame. So the field is left only if, a frame later, the focus is
         * still outside it (the keyboard handler has by then put the focus on the day it moved to)
         */
        onPopupFocusOut: (event: FocusEvent) => {
            const next = event.relatedTarget;
            const root = element.shadowRoot;
            if (closing || (next instanceof Node && root?.contains(next))) return;
            requestAnimationFrame(() => {
                if (disposed || closing || !isOpen() || root?.activeElement) return;
                closePicker(false);
                field.onBlur();
            });
        },
        onPopupClick: (event: Event) => {
            const nav = marked(event, 'nav');
            if (nav !== undefined) {
                const step = nav.dataset['nav'] === 'next' ? 1 : -1;
                first = addMonths(first, step);
                cursor = addMonths(cursor, step);
                drawPicker();
                return;
            }
            const cell = marked(event, 'date');
            const day = cell?.dataset['date'];
            if (cell === undefined || day === undefined || cell.hasAttribute('data-blank') || cell.getAttribute('aria-disabled') === 'true') return;
            pickDate(day);
        },
        onPopupKey: (event: KeyboardEvent) => {
            if (event.altKey || event.ctrlKey || event.metaKey || !NAVIGATION_KEYS.has(event.key)) return;
            const origin = event.composedPath()[0];
            if (!(origin instanceof HTMLElement) || origin.dataset['date'] === undefined || origin.hasAttribute('data-blank')) return;
            const next = dateForKey(event.key, origin.dataset['date'], { view: 'month', firstDay: firstDayOf(locale()), rtl: getComputedStyle(element).direction === 'rtl', shift: event.shiftKey });
            if (next === undefined) return;
            event.preventDefault();
            moveCursor(next);
        },
        onPopupDown: (event: Event) => event.preventDefault(),
        dispose: () => {
            disposed = true;
            store.off(valuePaths, onValue);
            store.off(sidePaths, onSide);
            store.off(['$.locale'], onLocale);
            store.off(settingPaths, onSettings);
            store.off(blockedPaths, onBlocked);
            popover?.dispose();
            field.dispose();
        }
    };
}
