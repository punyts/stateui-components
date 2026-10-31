import type { ControllerContext } from '@punyts/stateui';
import { clampSplit, readBounds, splitForDrag, splitForKey } from '../shared/split/split.js';

interface Drag {
    readonly pointer: number;
    readonly startX: number;
    readonly startY: number;
    readonly startSplit: number;
    /** The split the divider shows now; it is written to `split` once, on pointer up */
    live: number;
}

/**
 * Owns the divider. `split` is the start pane's share of the container in percent, kept between `min` and `max`; the
 * runtime `shown` is what the view shows (0 while collapsed) and `collapsed` is the start pane folded away by Enter on a
 * `collapsible` pane (Enter again, an arrow key, Home, End or a drag brings it back at `split`). The arrow keys move
 * by 5 percent, Home and End go to `min` and `max`, and each key that changes the split writes `split` and raises `resize`
 * (`detail`: `{ split, collapsed }`). A drag converts the pointer's movement to percent through the container size that a
 * `ResizeObserver` reports, and while it runs only the custom property `--sui-split` (and `aria-valuenow`) are written, so
 * nothing else re-renders; `split` is written once on pointer up, with one `resize`, and not at all when it did not
 * change. A cancelled drag puts the divider back
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const splitPath = `${basePath}.split`;
    const collapsedPath = `${basePath}.collapsed`;
    const shownPath = `${basePath}.shown`;
    const part = (selector: string): HTMLElement | null => element.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
    const bounds = () => readBounds(read('min'), read('max'));
    const splitNow = (): number => clampSplit(read('split'), bounds());
    const isCollapsed = (): boolean => read('collapsible') === true && read('collapsed') === true;
    const rtl = (): boolean => getComputedStyle(element).direction === 'rtl';

    const refresh = (): void => {
        if (read('collapsed') === true && read('collapsible') !== true) store.set(collapsedPath, false);
        store.set(shownPath, isCollapsed() ? 0 : splitNow());
    };
    const watched = [splitPath, `${basePath}.min`, `${basePath}.max`, `${basePath}.collapsible`, collapsedPath];
    store.on(watched, refresh);
    refresh();

    const raise = (): void => {
        element.dispatchEvent(new CustomEvent('resize', { detail: { split: splitNow(), collapsed: isCollapsed() }, bubbles: true, composed: true }));
    };
    /** Writes the split and brings a collapsed pane back; raises `resize` once when either changed */
    const commit = (split: number): void => {
        const wasCollapsed = isCollapsed();
        if (split === splitNow() && !wasCollapsed) return;
        if (wasCollapsed) store.set(collapsedPath, false);
        if (split !== splitNow()) store.set(splitPath, split);
        raise();
    };
    const toggleCollapsed = (): void => {
        if (read('collapsible') !== true) return;
        store.set(collapsedPath, !isCollapsed());
        raise();
    };

    //the container size comes from the observer, started once the view is drawn
    let width = 0;
    let height = 0;
    let observer: ResizeObserver | undefined;
    let disposed = false;
    const start = (attempts: number): void => {
        if (disposed) return;
        const container = part('.split');
        if (!container) {
            if (attempts > 0) queueMicrotask(() => start(attempts - 1));
            return;
        }
        observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                width = entry.contentRect.width;
                height = entry.contentRect.height;
            }
        });
        observer.observe(container);
    };
    queueMicrotask(() => start(8));

    /** Shows a split without writing it: the custom property of the view and the divider's value */
    const show = (split: number): void => {
        part('.split')?.style.setProperty('--sui-split', String(split));
        part('.divider')?.setAttribute('aria-valuenow', String(split));
    };
    let drag: Drag | undefined;
    const finish = (event: PointerEvent): Drag | undefined => {
        const ended = drag;
        if (!ended || event.pointerId !== ended.pointer) return undefined;
        drag = undefined;
        const divider = event.currentTarget as HTMLElement | null;
        if (divider?.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
        return ended;
    };

    return {
        onKeyDown: (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                if (read('collapsible') !== true) return;
                event.preventDefault();
                toggleCollapsed();
                return;
            }
            const next = splitForKey(event.key, splitNow(), bounds(), rtl());
            if (next === undefined) return;
            event.preventDefault();
            commit(next);
        },
        onPointerDown: (event: PointerEvent) => {
            const divider = event.currentTarget as HTMLElement | null;
            if (!divider || event.button !== 0) return;
            event.preventDefault();
            divider.focus();
            divider.setPointerCapture(event.pointerId);
            const startSplit = isCollapsed() ? 0 : splitNow();
            drag = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, startSplit, live: startSplit };
        },
        onPointerMove: (event: PointerEvent) => {
            if (!drag || event.pointerId !== drag.pointer) return;
            const vertical = read('orientation') === 'vertical';
            const delta = vertical ? event.clientY - drag.startY : (event.clientX - drag.startX) * (rtl() ? -1 : 1);
            const split = splitForDrag(drag.startSplit, delta, vertical ? height : width, bounds());
            drag.live = split;
            show(split);
        },
        onPointerUp: (event: PointerEvent) => {
            const ended = finish(event);
            if (!ended) return;
            const moved = ended.live !== ended.startSplit;
            if (moved) commit(ended.live);
            show(isCollapsed() ? 0 : splitNow());
        },
        onPointerCancel: (event: PointerEvent) => {
            if (finish(event)) show(isCollapsed() ? 0 : splitNow());
        },
        dispose: () => {
            disposed = true;
            observer?.disconnect();
            store.off(watched, refresh);
        }
    };
}
