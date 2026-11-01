import type { RecordWindow } from './window.js';

/** What a row layout reads: the number of positions and the key of each, and where a key is */
export interface RowLayoutSource {
    total(): number;
    keyAt(position: number): string | undefined;
    positionOf(key: string): number | undefined;
}

/**
 * The vertical layout of a record grid whose items differ in height. Each measured height is kept by record key, so it follows
 * its record when the array reorders; a record that is not measured counts as the estimate. The height of a row is the tallest
 * of its items, a row's offset is the sum of the rows above it, and the total is the sum of every row. Nothing here reads layout:
 * `measure` is given the heights a `ResizeObserver` reported.
 */
export interface RowLayout {
    /** Takes the columns and the estimate; a change of either makes every row be worked out again */
    configure(columns: number, estimate: number): void;
    /** Says that the keys at the positions changed (an insert, a delete, a reorder or a new `order`) */
    invalidate(): void;
    /**
     * Keeps the measured height of the record with that key. Returns whether the height differs from the one kept; a height that
     * is not a positive number is ignored
     */
    measure(key: string, height: number): boolean;
    /** The measured height of the record with that key */
    measured(key: string): number | undefined;
    /** The number of rows */
    rows(): number;
    /** The row of a position */
    rowOf(position: number): number;
    /** The offset of the top of a row; for a row past the last one, the total height */
    offsetOfRow(row: number): number;
    /** The height of a row */
    heightOfRow(row: number): number;
    /** The offset of the top of the row that holds a position */
    offsetOf(position: number): number;
    /** The sum of every row */
    height(): number;
    /** The row that reaches over an offset: the last one whose top is at or above it, so 0 for a negative offset */
    rowAt(offset: number): number;
    /** The number of heights kept */
    size(): number;
}

/** The window of a grid whose rows differ in height: the whole rows that reach into the viewport, as item positions (row-major) */
export function layoutWindow(layout: RowLayout, scrollTop: number, viewport: number, columns: number): RecordWindow {
    const rows = layout.rows();
    if (rows === 0 || !(viewport > 0) || !(columns > 0) || !(layout.height() > 0)) return { first: 0, count: 0 };
    const top = Math.max(0, scrollTop);
    const firstRow = layout.rowAt(top);
    const lastRow = Math.max(firstRow, layout.rowAt(top + viewport - 1));
    return { first: firstRow * columns, count: (lastRow - firstRow + 1) * columns };
}

const SAME = 0.01;

/** Creates the layout of a grid over a source of keys */
export function createRowLayout(source: RowLayoutSource): RowLayout {
    const heights = new Map<string, number>();
    let columns = 1;
    let estimate = 0;
    let rowHeights: number[] = [];
    let tops: number[] = [0];
    let shownTotal = -1;
    let rebuild = true;
    let dirtyFrom = Number.POSITIVE_INFINITY;
    const dirtyRows = new Set<number>();

    const heightOf = (row: number): number => {
        let tallest = 0;
        const first = row * columns;
        for (let position = first; position < first + columns && position < shownTotal; position++) {
            const key = source.keyAt(position);
            const height = key === undefined ? undefined : heights.get(key);
            tallest = Math.max(tallest, height ?? estimate);
        }
        return tallest;
    };

    const prune = (): void => {
        if (heights.size <= shownTotal + 32) return;
        for (const key of [...heights.keys()]) {
            if (source.positionOf(key) === undefined) heights.delete(key);
        }
    };

    const sync = (): void => {
        const total = source.total();
        if (rebuild || total !== shownTotal) {
            shownTotal = total;
            const rows = columns > 0 ? Math.ceil(total / columns) : 0;
            prune();
            rowHeights = new Array<number>(rows);
            tops = new Array<number>(rows + 1);
            for (let row = 0; row < rows; row++) rowHeights[row] = heightOf(row);
            dirtyFrom = 0;
            rebuild = false;
            dirtyRows.clear();
        } else if (dirtyRows.size > 0) {
            for (const row of dirtyRows) {
                if (row >= rowHeights.length) continue;
                rowHeights[row] = heightOf(row);
                dirtyFrom = Math.min(dirtyFrom, row);
            }
            dirtyRows.clear();
        }
        if (dirtyFrom === Number.POSITIVE_INFINITY) return;
        let top = dirtyFrom === 0 ? 0 : (tops[dirtyFrom] as number);
        for (let row = dirtyFrom; row < rowHeights.length; row++) {
            tops[row] = top;
            top += rowHeights[row] as number;
        }
        tops[rowHeights.length] = top;
        dirtyFrom = Number.POSITIVE_INFINITY;
    };

    return {
        configure(nextColumns, nextEstimate) {
            const safeColumns = nextColumns > 0 ? Math.floor(nextColumns) : 1;
            if (safeColumns === columns && nextEstimate === estimate) return;
            columns = safeColumns;
            estimate = nextEstimate;
            rebuild = true;
        },
        invalidate() {
            rebuild = true;
        },
        measure(key, height) {
            if (!(height > 0)) return false;
            const previous = heights.get(key);
            if (previous !== undefined && Math.abs(previous - height) < SAME) return false;
            heights.set(key, height);
            const position = source.positionOf(key);
            if (position !== undefined && !rebuild) dirtyRows.add(Math.floor(position / columns));
            return true;
        },
        measured: (key) => heights.get(key),
        rows() {
            sync();
            return rowHeights.length;
        },
        rowOf: (position) => Math.floor(Math.max(0, position) / columns),
        offsetOfRow(row) {
            sync();
            const at = Math.min(Math.max(0, Math.floor(row)), rowHeights.length);
            return (tops[at] as number | undefined) ?? 0;
        },
        heightOfRow(row) {
            sync();
            return rowHeights[Math.floor(row)] ?? 0;
        },
        offsetOf(position) {
            sync();
            const row = Math.min(Math.floor(Math.max(0, position) / columns), rowHeights.length);
            return (tops[row] as number | undefined) ?? 0;
        },
        height() {
            sync();
            return (tops[rowHeights.length] as number | undefined) ?? 0;
        },
        rowAt(offset) {
            sync();
            const rows = rowHeights.length;
            if (rows === 0) return 0;
            let low = 0;
            let high = rows - 1;
            while (low < high) {
                const middle = (low + high + 1) >> 1;
                if ((tops[middle] as number) <= offset) low = middle;
                else high = middle - 1;
            }
            return low;
        },
        size: () => heights.size
    };
}
