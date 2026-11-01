/**
 * The pure parts of moving a card between and within lists, by pointer and by keyboard (`board`). Nothing here reads the
 * DOM or the clock: the controller gives it numbers and gets numbers back, so the same code serves any component that
 * drags a record between positions.
 */

/** How far the pointer must move, in pixels, before a press becomes a drag (a smaller move is still a click) */
export const DRAG_THRESHOLD = 4;

/** Where a card is or would land: a column (by key) and the place it takes in it, from 0 */
export interface Place {
    readonly column: string;
    readonly index: number;
}

/** The part of the screen one column takes, read once when a drag starts */
export interface ColumnBox {
    readonly key: string;
    readonly left: number;
    readonly right: number;
    readonly top: number;
    /** How far the column body is scrolled, in pixels */
    readonly scroll: number;
    /** The cards the column holds now (the dragged one included, when it is in this column) */
    readonly size: number;
}

/** Whether a pointer that went down at (`x0`, `y0`) and is now at (`x`, `y`) has moved far enough to be a drag */
export function passedThreshold(x0: number, y0: number, x: number, y: number, threshold: number = DRAG_THRESHOLD): boolean {
    return Math.hypot(x - x0, y - y0) >= threshold;
}

/** The column the pointer is over by its horizontal position, or the nearest one when it is outside all of them; `undefined` for no columns */
export function columnAt(x: number, boxes: readonly ColumnBox[]): ColumnBox | undefined {
    let nearest: ColumnBox | undefined;
    let distance = Infinity;
    for (const box of boxes) {
        const gap = x < box.left ? box.left - x : x > box.right ? x - box.right : 0;
        if (gap < distance) {
            distance = gap;
            nearest = box;
        }
    }
    return nearest;
}

/**
 * The place a drop at a pointer height lands: the index of the card the pointer is over in the column's list, which is the
 * index the dragged card has after the drop. It is computed from the pointer, the top and scroll of the column body and the
 * card height, which the caller measured once, never from the cards themselves. A pointer past the last card gives the end
 * of the list: `size` for another column, where the card is added, and `size - 1` for the card's own column, which keeps
 * its size
 */
export function dropIndex(pointerY: number, box: ColumnBox, cardHeight: number, own: boolean): number {
    const last = own ? Math.max(0, box.size - 1) : box.size;
    if (!(cardHeight > 0)) return last;
    const raw = Math.floor((pointerY - box.top + box.scroll) / cardHeight);
    return Math.min(Math.max(0, Number.isFinite(raw) ? raw : 0), last);
}

export type MoveKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

export const MOVE_KEYS: readonly string[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

/** One column as the keyboard sees it: its key and how many cards it holds, the picked card included when it is in it */
export interface ColumnSize {
    readonly key: string;
    readonly size: number;
}

/**
 * The place a key moves a picked card to, or `undefined` when the key does not move it (an edge, or Up and Down in a board
 * that cannot reorder inside a column). Up and Down move one place inside the column; Left and Right move to the previous
 * and next column (swapped in right-to-left text), keeping the index and stopping at the end of the list, which for a column
 * other than the card's own is one past its last card. `home` is the column the card was picked from
 */
export function placeAfterKey(place: Place, key: string, columns: readonly ColumnSize[], home: string, options: { rtl?: boolean; reorder?: boolean } = {}): Place | undefined {
    const at = columns.findIndex((column) => column.key === place.column);
    const current = columns[at];
    if (current === undefined) return undefined;
    const sideways = options.rtl === true ? { ArrowLeft: 1, ArrowRight: -1 } : { ArrowLeft: -1, ArrowRight: 1 };
    if (key === 'ArrowUp' || key === 'ArrowDown') {
        if (options.reorder === false && place.column === home) return undefined;
        const last = place.column === home ? Math.max(0, current.size - 1) : current.size;
        const index = Math.min(Math.max(0, place.index + (key === 'ArrowDown' ? 1 : -1)), last);
        return index === place.index ? undefined : { column: place.column, index };
    }
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return undefined;
    const target = columns[at + sideways[key]];
    if (target === undefined) return undefined;
    const last = target.key === home ? Math.max(0, target.size - 1) : target.size;
    return { column: target.key, index: Math.min(place.index, last) };
}

/** Fills the `{name}` style fields of an announcement template; a field with no value is left out, and a template that is not text gives an empty string */
export function announce(template: unknown, fields: Readonly<Record<string, string | number>>): string {
    if (typeof template !== 'string') return '';
    return template.replace(/\{([A-Za-z]+)\}/g, (_match, name: string) => (Object.hasOwn(fields, name) ? String(fields[name]) : ''));
}
