import type { ControllerContext } from '@punyts/stateui';
import { createField } from '../shared/field/field.js';
import { formatValue } from '../shared/format/format.js';
import { limitsOf, nearestThumb, percentOf, readScale, readThumbs, snapValue, valueAtFraction, valueForKey } from '../shared/slider/slider.js';
import type { Thumb } from '../shared/slider/slider.js';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const isThumb = (value: unknown): value is Thumb => value === 'low' || value === 'high';

interface Drag {
    readonly pointer: number;
    readonly thumb: Thumb;
    readonly startX: number;
    readonly startValue: number;
}

/**
 * A slider on the field base. `value` is a number, or `[low, high]` when `range`; a value that is not one sits at the
 * start (a range at both ends) and nothing is written until the user acts. Each thumb is a `role="slider"` element:
 * the arrows step, Page Up and Page Down move ten steps, Home and End go to the limits, and the thumbs of a range
 * cannot cross. The pointer drags a thumb, or a press on the track moves the nearer thumb there and drags it; the
 * pointer position becomes a value through the track width that a `ResizeObserver` reports, so no layout is read. Every
 * written value is on a `step`. The runtime properties `low`, `high` (the thumbs' numbers), `lowPercent`,
 * `highPercent` (from 0 to 100, the views' `--sui-value`), `lowText`, `highText` and `valueText` (shown with `format`
 * in the language of `$.locale`) are kept in step with `value`, `min`, `max`, `range`, `format` and the language
 */
export default function controller(context: ControllerContext) {
    const { element, store, basePath } = context;
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const valuePath = `${basePath}.value`;
    const field = createField(context);

    const scale = () => readScale(read('min'), read('max'), read('step'));
    const isRange = (): boolean => read('range') === true;
    const thumbs = () => readThumbs(read('value'), isRange(), scale());
    const blocked = (): boolean => read('disabled') === true || read('locked') === true || read('readonly') === true;
    const rtl = (): boolean => getComputedStyle(element).direction === 'rtl';
    const part = (selector: string): HTMLElement | null => element.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;

    const show = (number: number): string => formatValue(number, { format: text(read('format')) || 'number', locale: text(store.get<unknown>('$.locale')) });
    const refresh = (): void => {
        const current = scale();
        const { low, high } = thumbs();
        const lowText = show(low);
        const highText = show(high);
        store.set(`${basePath}.low`, low);
        store.set(`${basePath}.high`, high);
        store.set(`${basePath}.lowPercent`, percentOf(low, current));
        store.set(`${basePath}.highPercent`, percentOf(high, current));
        store.set(`${basePath}.lowText`, lowText);
        store.set(`${basePath}.highText`, highText);
        store.set(`${basePath}.valueText`, isRange() ? `${lowText} – ${highText}` : lowText);
    };
    const watched = [valuePath, `${basePath}.min`, `${basePath}.max`, `${basePath}.range`, `${basePath}.format`, '$.locale'];
    store.on(watched, refresh);
    refresh();

    /** Writes the number a thumb takes, with the other thumb of a range kept */
    const commit = (thumb: Thumb, next: number): void => {
        const current = thumbs();
        const value = isRange() ? (thumb === 'low' ? [next, current.high] : [current.low, next]) : next;
        if (JSON.stringify(read('value')) === JSON.stringify(value)) return;
        store.set(valuePath, value);
    };
    const move = (thumb: Thumb, wanted: number): void => {
        const current = scale();
        commit(thumb, snapValue(wanted, current, limitsOf(thumb, isRange(), thumbs(), current)));
    };
    const focusThumb = (thumb: Thumb): void => part(`[data-thumb="${thumb}"]`)?.focus();

    //the track width comes from the observer, started once the view is drawn
    let width = 0;
    let observer: ResizeObserver | undefined;
    let disposed = false;
    const start = (attempts: number): void => {
        if (disposed) return;
        const track = part('.track');
        if (!track) {
            if (attempts > 0) queueMicrotask(() => start(attempts - 1));
            return;
        }
        observer = new ResizeObserver((entries) => {
            for (const entry of entries) width = entry.contentRect.width;
        });
        observer.observe(track);
    };
    queueMicrotask(() => start(8));

    let drag: Drag | undefined;
    const fractionOf = (pixels: number): number => (rtl() ? 1 - pixels / width : pixels / width);

    return {
        ...field,
        markPercent: (key: unknown, min: unknown, max: unknown): string => {
            const number = Number(key);
            const current = readScale(min, max, 1);
            if (!Number.isFinite(number) || number < current.min || number > current.max) return '';
            return String(percentOf(number, current));
        },
        onKeyDown: (event: KeyboardEvent) => {
            const thumb = (event.currentTarget as HTMLElement | null)?.dataset['thumb'];
            if (!isThumb(thumb) || blocked()) return;
            const current = scale();
            const positions = thumbs();
            const next = valueForKey(event.key, positions[thumb], current, limitsOf(thumb, isRange(), positions, current), rtl());
            if (next === undefined) return;
            event.preventDefault();
            commit(thumb, next);
        },
        onPointerDown: (event: PointerEvent) => {
            const track = event.currentTarget as HTMLElement | null;
            if (!track || event.button !== 0 || blocked() || !(width > 0)) return;
            const target = event.target instanceof Element ? event.target : null;
            const grabbed = target?.closest<HTMLElement>('[data-thumb]')?.dataset['thumb'];
            const positions = thumbs();
            let thumb: Thumb;
            let startValue: number;
            if (isThumb(grabbed)) {
                thumb = grabbed;
                startValue = positions[thumb];
            } else if (target === track) {
                const wanted = valueAtFraction(fractionOf(event.offsetX), scale());
                thumb = isRange() ? nearestThumb(wanted, positions) : 'low';
                move(thumb, wanted);
                startValue = thumbs()[thumb];
            } else {
                return;
            }
            event.preventDefault();
            focusThumb(thumb);
            track.setPointerCapture(event.pointerId);
            drag = { pointer: event.pointerId, thumb, startX: event.clientX, startValue };
        },
        onPointerMove: (event: PointerEvent) => {
            if (!drag || event.pointerId !== drag.pointer || !(width > 0)) return;
            const current = scale();
            const pixels = (event.clientX - drag.startX) * (rtl() ? -1 : 1);
            move(drag.thumb, drag.startValue + (pixels / width) * (current.max - current.min));
        },
        onPointerUp: (event: PointerEvent) => {
            if (!drag || event.pointerId !== drag.pointer) return;
            drag = undefined;
            const track = event.currentTarget as HTMLElement | null;
            if (track?.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
        },
        dispose: () => {
            disposed = true;
            observer?.disconnect();
            store.off(watched, refresh);
            field.dispose();
        }
    };
}
