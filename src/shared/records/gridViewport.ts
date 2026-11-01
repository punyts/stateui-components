/** What the observer of a grid's viewport has read: the scroll offset, the size of the scrolling element's content and the two token sizes */
export interface GridMeasure {
    /** The scroll offset in pixels */
    scrollTop: number;
    /** The width of the scrolling element's content, without the scrollbar */
    width: number;
    /** The height of the scrolling element's content */
    height: number;
    /** The smallest item width (`recordgrid.itemmin`) */
    itemMin: number;
    /** The item height (`recordgrid.itemheight`): the height of every item, or the estimate of one that is not measured */
    itemHeight: number;
}

/** What a grid viewport observer watches and where it reports */
export interface GridViewportOptions {
    /** The scrolling element */
    scroller: Element;
    /** An element sized `inline-size: var(--sui-item-min); block-size: var(--sui-item-h)`, so a token change resizes it */
    probe: Element;
    /** Called with the new measurement when the offset, a size or a token changed */
    onChange: (measure: GridMeasure) => void;
}

/** The observer of a record grid's viewport */
export interface GridViewport {
    /** The measurement as last reported */
    current(): GridMeasure;
    /** Reads the scroll offset now and reports it if it changed */
    measure(): void;
    /** Scrolls to an offset (a write), reads back where the browser put it and reports it at once */
    scrollTo(offset: number): void;
    /** Removes the scroll listener, the resize observer and any pending frame */
    dispose(): void;
}

/** The columns that fit a width: `floor(width / itemMin)`, at least 1, and 1 while either size is unknown */
export function columnsFor(width: number, itemMin: number): number {
    if (!(width > 0) || !(itemMin > 0)) return 1;
    return Math.max(1, Math.floor(width / itemMin));
}

/** The rows that hold `total` items in `columns` columns */
export function rowsFor(total: number, columns: number): number {
    return columns > 0 ? Math.ceil(Math.max(0, total) / columns) : 0;
}

/**
 * The window of a grid of equal rows, in item positions (row-major): `first` is the first item of the topmost row that reaches into
 * the viewport and `count` the items of the rows that do, whole rows from `first`. Nothing is shown while a size is unknown
 */
export function gridWindow(scrollTop: number, viewport: number, rowHeight: number, columns: number): { first: number; count: number } {
    if (!(rowHeight > 0) || !(viewport > 0) || !(columns > 0)) return { first: 0, count: 0 };
    const top = Math.max(0, scrollTop);
    const firstRow = Math.floor(top / rowHeight);
    const lastRow = Math.max(firstRow, Math.ceil((top + viewport) / rowHeight) - 1);
    return { first: firstRow * columns, count: (lastRow - firstRow + 1) * columns };
}

/** The offset that brings a band (`top`, `height`) into view of a viewport at `scrollTop`, never past the end of `content` */
export function bandOffset(top: number, height: number, scrollTop: number, viewport: number, content: number, align: 'start' | 'nearest'): number {
    let next = scrollTop;
    if (align === 'start' || top < scrollTop) next = top;
    else if (top + height > scrollTop + viewport) next = top + height - viewport;
    return Math.min(Math.max(0, next), Math.max(0, content - viewport));
}

/**
 * Follows the scrollbar and the size of a record grid. As in `createViewportObserver`, this is the one place a grid reads layout: one
 * passive scroll listener asks for an animation frame and reads `scrollTop` once in it, and a `ResizeObserver` reports the content size
 * of the scroller and the size of the probe from its entries
 */
export function createGridViewport(options: GridViewportOptions): GridViewport {
    const { scroller, probe, onChange } = options;
    const state: GridMeasure = { scrollTop: 0, width: 0, height: 0, itemMin: 0, itemHeight: 0 };
    let last = '';
    let frame = 0;
    let disposed = false;

    const report = (): void => {
        const key = `${state.scrollTop}|${state.width}|${state.height}|${state.itemMin}|${state.itemHeight}`;
        if (key === last) return;
        last = key;
        onChange({ ...state });
    };
    const measure = (): void => {
        if (disposed) return;
        state.scrollTop = scroller.scrollTop;
        report();
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
            if (entry.target === scroller) {
                state.width = entry.contentRect.width;
                state.height = entry.contentRect.height;
            } else if (entry.target === probe) {
                state.itemMin = entry.contentRect.width;
                state.itemHeight = entry.contentRect.height;
            }
        }
        state.scrollTop = scroller.scrollTop;
        report();
    });
    scroller.addEventListener('scroll', onScroll, { passive: true });
    resize.observe(scroller);
    resize.observe(probe);

    return {
        current: () => ({ ...state }),
        measure,
        scrollTo(offset) {
            if (disposed) return;
            if (scroller.scrollTop !== offset) scroller.scrollTop = offset;
            measure();
        },
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
