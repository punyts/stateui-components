/** The most slot nodes a record view holds, whatever the viewport and the overscan */
export const MAX_SLOTS = 200;

/** The rows the viewport shows: `first` is the position of the first one, `count` how many fit */
export interface RecordWindow {
    first: number;
    count: number;
}

const wholeNumber = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** Reads a window from what the store holds: anything that is not a positive number counts as 0 */
export function readWindow(value: unknown): RecordWindow {
    if (value === null || typeof value !== 'object') return { first: 0, count: 0 };
    const source = value as Record<string, unknown>;
    return { first: wholeNumber(source['first']), count: wholeNumber(source['count']) };
}

/**
 * The number of slots for a viewport of `count` rows: the visible rows plus the overscan on both sides, at most `cap`.
 * The cap takes from the overscan first, so a tall viewport never loses a visible row
 */
export function poolSize(count: number, overscan: number, cap: number = MAX_SLOTS): number {
    const visible = Math.min(Math.max(0, Math.floor(count)), cap);
    const spare = Math.floor((cap - visible) / 2);
    return visible + 2 * Math.min(Math.max(0, Math.floor(overscan)), spare);
}

/**
 * The position the pool starts at: `overscan` rows above the first visible one, moved up near the end so the pool
 * never reaches past the last of `total` positions while it can still be filled
 */
export function poolStart(first: number, total: number, size: number, overscan: number): number {
    const wanted = Math.max(0, first - Math.max(0, Math.floor(overscan)));
    return Math.min(wanted, Math.max(0, total - size));
}
