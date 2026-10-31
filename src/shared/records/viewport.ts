import type { RecordWindow } from './window.js';

/** What a viewport observer watches and where it reports */
export interface ViewportOptions {
    /** The scrolling element: its content height is the viewport and its `scrollTop` the offset */
    scroller: Element;
    /** An element whose block size is the row height (`block-size: var(--sui-row-h)`), so a token or density change resizes it */
    probe: Element;
    /** Called with the rows now in view; only when `first` or `count` differ from the last call */
    onWindow: (window: RecordWindow) => void;
}

/** The observer of a record view's viewport */
export interface ViewportObserver {
    /** Reads the scroll offset now and reports the window; for the case where the sizes are already known */
    measure(): void;
    /** Removes the scroll listener, the resize observer and any pending frame */
    dispose(): void;
}

/** The first row in view and how many rows reach into the viewport, for a scroll offset, a viewport height and a row height */
export function windowFor(scrollTop: number, viewport: number, rowHeight: number): RecordWindow {
    if (!(rowHeight > 0) || !(viewport > 0)) return { first: 0, count: 0 };
    const top = Math.max(0, scrollTop);
    const first = Math.floor(top / rowHeight);
    return { first, count: Math.max(1, Math.ceil((top + viewport) / rowHeight) - first) };
}

/**
 * Follows the scrollbar of a record view. This is the one place a record view reads layout: one passive scroll
 * listener asks for an animation frame and reads `scrollTop` once in it, however many scroll events came before, and a
 * `ResizeObserver` reports the viewport height and the row height from the resize entries, which are not layout reads
 * of their own. Every change is reported as a window
 */
export function createViewportObserver(options: ViewportOptions): ViewportObserver {
    const { scroller, probe, onWindow } = options;
    let viewport = 0;
    let rowHeight = 0;
    let frame = 0;
    let lastFirst = -1;
    let lastCount = -1;
    let disposed = false;

    const measure = (): void => {
        if (disposed) return;
        const next = windowFor(scroller.scrollTop, viewport, rowHeight);
        if (next.first === lastFirst && next.count === lastCount) return;
        lastFirst = next.first;
        lastCount = next.count;
        onWindow(next);
    };
    const onScroll = (): void => {
        if (frame !== 0 || disposed) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            measure();
        });
    };
    const resize = new ResizeObserver((entries) => {
        for (const entry of entries) {
            if (entry.target === scroller) viewport = entry.contentRect.height;
            else if (entry.target === probe) rowHeight = entry.contentRect.height;
        }
        measure();
    });
    scroller.addEventListener('scroll', onScroll, { passive: true });
    resize.observe(scroller);
    resize.observe(probe);

    return {
        measure,
        dispose() {
            if (disposed) return;
            disposed = true;
            scroller.removeEventListener('scroll', onScroll);
            resize.disconnect();
            if (frame !== 0) cancelAnimationFrame(frame);
            frame = 0;
        }
    };
}
