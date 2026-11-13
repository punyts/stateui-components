import type { ControllerContext } from '@punyts/stateui';
import { isReducedMotion } from '../shared/drawing/scheduler.js';

interface CommandHost {
    commands?: Record<string, (value?: unknown) => void>;
}

/** What the view needs of one slide: its accessible name (`n of m`) and the name of its dot */
interface Slide {
    readonly label: string;
    readonly dot: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const EDITABLE = new Set(['input', 'textarea', 'select']);

/**
 * Shows one child at a time, as a slide of the WAI-ARIA carousel pattern: the region is named by `_label` with
 * `aria-roledescription="carousel"`, each slide is a group with `aria-roledescription="slide"` named by `_slideLabel`
 * (`{index}`, `{count}`), and slides that are not shown are hidden, never removed, so their state survives. `active` is
 * the author's choice; the first key stands in while it is empty or names no child, and the runtime `shown` holds the
 * result. Every change of `shown` after mount, whoever wrote `active`, raises `change` with the new key. The previous
 * and next buttons, the dots (named by a child's placement `_slide` or else `_goTo`) and the commands `select`, `next`
 * and `previous` write `active`; without `loop` there is nothing before the first slide or after the last, and the
 * buttons are disabled there. With focus inside, the arrow keys (swapped in right-to-left text), Home and End move,
 * except in a text field of a slide. `autoplay` (seconds) moves on by itself, round to the first slide after the last,
 * and pauses while the pointer is over the carousel, while focus is inside it and while motion is reduced (the theme's
 * motion overlay or the system setting); the rotation button stops and starts it (`stopped`). While it plays the
 * slides are not a live region, otherwise they are polite
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as Element & CommandHost;
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const activePath = `${basePath}.active`;
    const childrenPath = `${basePath}.children`;
    const shownPath = `${basePath}.shown`;
    const keys = (): string[] => {
        const children = read('children');
        return children !== null && typeof children === 'object' ? Object.keys(children) : [];
    };
    const resolve = (): string => {
        const all = keys();
        const active = read('active');
        return typeof active === 'string' && all.includes(active) ? active : (all[0] ?? '');
    };

    const describe = (): void => {
        const all = keys();
        const shown = text(read('shown'));
        const slides: Record<string, Slide> = {};
        all.forEach((key, index) => {
            const fill = (template: unknown): string => text(template).replaceAll('{index}', String(index + 1)).replaceAll('{count}', String(all.length));
            const own = text(store.get<unknown>(`${childrenPath}.${key}.placement._slide`));
            slides[key] = { label: fill(read('_slideLabel')), dot: own !== '' ? own : fill(read('_goTo')) };
        });
        store.set(`${basePath}.slides`, slides);
        const index = all.indexOf(shown);
        const loop = read('loop') === true;
        store.set(`${basePath}.atStart`, !loop && index <= 0);
        store.set(`${basePath}.atEnd`, !loop && index >= all.length - 1);
    };

    let last = resolve();
    store.set(shownPath, last);
    describe();

    let hovered = false;
    let focused = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const media = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
    const reduced = (): boolean => {
        if (media?.matches === true) return true;
        return isReducedMotion((name) => getComputedStyle(element).getPropertyValue(name).trim() || undefined);
    };
    const seconds = (): number => {
        const value = read('autoplay');
        return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
    };

    const select = (key: string): void => {
        if (!keys().includes(key)) return;
        store.set(activePath, key);
    };
    /** Moves `step` slides on; `wrap` goes round past either end even without `loop` (autoplay does) */
    const move = (step: number, wrap = false): void => {
        const all = keys();
        if (all.length === 0) return;
        const index = all.indexOf(text(read('shown')));
        let next = index + step;
        if (read('loop') === true || wrap) next = (next + all.length) % all.length;
        else next = Math.min(Math.max(next, 0), all.length - 1);
        select(all[next] as string);
    };

    /** Starts the timer for the shown slide when autoplay may run, or stops it; `playing` says which */
    const schedule = (): void => {
        clearTimeout(timer);
        timer = undefined;
        const delay = seconds();
        const playing = !disposed && delay > 0 && read('stopped') !== true && keys().length > 1 && !hovered && !focused && !reduced();
        store.set(`${basePath}.playing`, playing);
        if (!playing) return;
        timer = setTimeout(() => {
            timer = undefined;
            if (!disposed) move(1, true);
        }, delay * 1000);
    };

    const sync = (): void => {
        const shown = resolve();
        store.set(shownPath, shown);
        describe();
        if (shown !== last) {
            last = shown;
            element.dispatchEvent(new CustomEvent('change', { detail: shown, bubbles: true, composed: true }));
        }
        schedule();
    };
    const watched = [activePath, childrenPath, `${childrenPath}.$all`, `${basePath}.loop`, `${basePath}._slideLabel`, `${basePath}._goTo`];
    store.on(watched, sync);
    const timing = [`${basePath}.autoplay`, `${basePath}.stopped`, '$.theme.active', '$.theme.active.$all'];
    store.on(timing, schedule);
    media?.addEventListener('change', schedule);
    schedule();

    host.commands = {
        select: (value?: unknown) => {
            if (typeof value === 'string' || typeof value === 'number') select(String(value));
        },
        next: () => move(1),
        previous: () => move(-1)
    };

    const focusDot = (): void => {
        element.shadowRoot?.querySelector<HTMLElement>(`.dot[data-key="${CSS.escape(text(read('shown')))}"]`)?.focus();
    };

    return {
        labelOf: (slides: unknown, key: unknown): string => {
            const slide = typeof slides === 'object' && slides !== null && typeof key === 'string' ? (slides as Record<string, Slide | undefined>)[key] : undefined;
            return slide?.label ?? '';
        },
        hasMany: (slides: unknown): boolean => typeof slides === 'object' && slides !== null && Object.keys(slides).length > 1,
        onPrevious: () => move(-1),
        onNext: () => move(1),
        onDot: (event: Event) => {
            const key = (event.currentTarget as HTMLElement | null)?.dataset['key'];
            if (key !== undefined) select(key);
        },
        onRotate: () => {
            store.set(`${basePath}.stopped`, read('stopped') !== true);
        },
        onKeyDown: (event: KeyboardEvent) => {
            if (event.defaultPrevented) return;
            const origin = event.composedPath()[0];
            if (origin instanceof HTMLElement && (EDITABLE.has(origin.localName) || origin.isContentEditable)) return;
            const rtl = getComputedStyle(element).direction === 'rtl';
            const all = keys();
            if (event.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) move(1);
            else if (event.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) move(-1);
            else if (event.key === 'Home' && all[0] !== undefined) select(all[0]);
            else if (event.key === 'End' && all.length > 0) select(all[all.length - 1] as string);
            else return;
            event.preventDefault();
            if (origin instanceof HTMLElement && origin.classList.contains('dot')) focusDot();
        },
        onPointerEnter: () => {
            hovered = true;
            schedule();
        },
        onPointerLeave: () => {
            hovered = false;
            schedule();
        },
        onFocusIn: () => {
            focused = true;
            schedule();
        },
        onFocusOut: (event: FocusEvent) => {
            const next = event.relatedTarget as Node | null;
            if (next !== null && (event.currentTarget as Node | null)?.contains(next)) return;
            focused = false;
            schedule();
        },
        dispose: () => {
            disposed = true;
            clearTimeout(timer);
            store.off(watched, sync);
            store.off(timing, schedule);
            media?.removeEventListener('change', schedule);
            delete host.commands;
        }
    };
}
