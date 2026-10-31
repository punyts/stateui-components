import { toNumber } from '../format/format.js';

/** What an arrow key moves the divider by, in percent */
export const KEY_STEP = 5;
/** The split of the start pane when `split` is not a number, in percent */
export const DEFAULT_SPLIT = 40;
const WHOLE = 100;
const DECIMALS = 2;

/** The smallest and largest split of the start pane, in percent of the container */
export interface SplitBounds {
    readonly min: number;
    readonly max: number;
}

const clamp = (value: number, lower: number, upper: number): number => Math.min(Math.max(value, lower), upper);

/** The bounds from the node's `min` (default 20) and `max` (default 80): each inside 0 to 100, and `max` never below `min` */
export function readBounds(min: unknown, max: unknown): SplitBounds {
    const lower = clamp(toNumber(min) ?? 20, 0, WHOLE);
    const upper = clamp(toNumber(max) ?? 80, 0, WHOLE);
    return { min: lower, max: Math.max(lower, upper) };
}

/** The split inside the bounds, to two decimals; a split that is not a number is the default of 40 */
export function clampSplit(split: unknown, bounds: SplitBounds): number {
    return Number(clamp(toNumber(split) ?? DEFAULT_SPLIT, bounds.min, bounds.max).toFixed(DECIMALS));
}

/**
 * The split a key moves the divider to, or `undefined` for a key that does nothing. Right and Down grow the start pane by
 * 5 and Left and Up shrink it (Left grows it and Right shrinks it in right-to-left text, where the start pane is on
 * the right of a horizontal split); Home and End go to the bounds
 */
export function splitForKey(key: string, split: number, bounds: SplitBounds, rtl: boolean): number | undefined {
    if (key === 'Home') return bounds.min;
    if (key === 'End') return bounds.max;
    const grow = rtl ? ['ArrowLeft', 'ArrowDown'] : ['ArrowRight', 'ArrowDown'];
    const shrink = rtl ? ['ArrowRight', 'ArrowUp'] : ['ArrowLeft', 'ArrowUp'];
    if (grow.includes(key)) return clampSplit(split + KEY_STEP, bounds);
    if (shrink.includes(key)) return clampSplit(split - KEY_STEP, bounds);
    return undefined;
}

/** The split after the pointer moved `delta` pixels along a container of `container` pixels, from a divider that began at `start` percent */
export function splitForDrag(start: number, delta: number, container: number, bounds: SplitBounds): number {
    if (!(container > 0)) return clampSplit(start, bounds);
    return clampSplit(start + (delta / container) * WHOLE, bounds);
}
