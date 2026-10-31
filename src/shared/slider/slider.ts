import { toNumber } from '../format/format.js';

/** Decimals kept when a step is added to a value, so `0.1 + 0.2` stays `0.3` */
const DECIMALS = 10;
/** A page key moves this many steps */
export const PAGE_STEPS = 10;
const FALLBACK_MAX = 100;

/** The numbers a slider moves on */
export interface SliderScale {
    readonly min: number;
    readonly max: number;
    /** Always above 0 */
    readonly step: number;
}

/** Which thumb: the only one of a single slider, or the lower or upper one of a range */
export type Thumb = 'low' | 'high';

/** The values a thumb may take: held by the other thumb of a range, or by the ends of the scale */
export interface ThumbLimits {
    readonly lower: number;
    readonly upper: number;
}

/** The scale from the node's `min`, `max` and `step`: a bound that is not a number is 0 and 100, `max` is never below `min`, a step that is not above 0 is 1 */
export function readScale(min: unknown, max: unknown, step: unknown): SliderScale {
    const low = toNumber(min) ?? 0;
    const high = toNumber(max) ?? FALLBACK_MAX;
    const size = toNumber(step);
    return { min: low, max: Math.max(low, high), step: size !== undefined && size > 0 ? size : 1 };
}

const clamp = (value: number, lower: number, upper: number): number => Math.min(Math.max(value, lower), upper);

/** The step position nearest to `value`, counted from `min`, kept inside the limits */
export function snapValue(value: number, scale: SliderScale, limits: ThumbLimits = { lower: scale.min, upper: scale.max }): number {
    const steps = Math.round((value - scale.min) / scale.step);
    const snapped = Number((scale.min + steps * scale.step).toFixed(DECIMALS));
    return clamp(snapped, limits.lower, limits.upper);
}

/** The thumb positions a value stands for, both inside the scale. A single slider returns the same number twice; a value that is not a number (or a pair) sits at the start (a range at both ends) */
export function readThumbs(value: unknown, range: boolean, scale: SliderScale): { low: number; high: number } {
    const inside = (candidate: unknown, fallback: number): number => {
        const number = toNumber(candidate);
        return number === undefined ? fallback : clamp(number, scale.min, scale.max);
    };
    if (!range) {
        const only = inside(value, scale.min);
        return { low: only, high: only };
    }
    if (!Array.isArray(value) || value.length < 2) return { low: scale.min, high: scale.max };
    const first = inside(value[0], scale.min);
    const second = inside(value[1], scale.max);
    return { low: Math.min(first, second), high: Math.max(first, second) };
}

/** Where a value sits on the track, from 0 to 100 */
export function percentOf(value: number, scale: SliderScale): number {
    const span = scale.max - scale.min;
    if (!(span > 0)) return 0;
    return Number((((clamp(value, scale.min, scale.max) - scale.min) / span) * 100).toFixed(4));
}

/** The limits of a thumb: a range's thumbs cannot cross, so each is held by the other */
export function limitsOf(thumb: Thumb, range: boolean, current: { low: number; high: number }, scale: SliderScale): ThumbLimits {
    if (!range) return { lower: scale.min, upper: scale.max };
    return thumb === 'low' ? { lower: scale.min, upper: current.high } : { lower: current.low, upper: scale.max };
}

/**
 * The value a key moves a thumb to, or `undefined` for a key the slider does not use. Right and Up add a step, Left and
 * Down take one (Left adds and Right takes one when the text runs right to left), Page Up and Page Down move ten steps,
 * Home and End go to the limits. The result is on a step and inside the limits
 */
export function valueForKey(key: string, current: number, scale: SliderScale, limits: ThumbLimits, rtl: boolean): number | undefined {
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
    const move = (steps: number): number => snapValue(current + steps * scale.step, scale, limits);
    if (key === forward || key === 'ArrowUp') return move(1);
    if (key === backward || key === 'ArrowDown') return move(-1);
    if (key === 'PageUp') return move(PAGE_STEPS);
    if (key === 'PageDown') return move(-PAGE_STEPS);
    if (key === 'Home') return limits.lower;
    if (key === 'End') return limits.upper;
    return undefined;
}

/** The value at a fraction (0 to 1) along the track, before snapping */
export function valueAtFraction(fraction: number, scale: SliderScale): number {
    return scale.min + clamp(fraction, 0, 1) * (scale.max - scale.min);
}

/** The thumb of a range nearer to a value; on a tie the lower one when the value is below it, otherwise the upper one */
export function nearestThumb(value: number, current: { low: number; high: number }): Thumb {
    const toLow = Math.abs(value - current.low);
    const toHigh = Math.abs(value - current.high);
    if (toLow === toHigh) return value < current.low ? 'low' : 'high';
    return toLow < toHigh ? 'low' : 'high';
}
