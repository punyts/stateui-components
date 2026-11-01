/**
 * The pure scale and tick code every chart type uses: linear and band scales, `niceTicks` and `stack`. Nothing here reads
 * the DOM, a locale or the clock; tick labels go through a formatter the caller passes in, which is how a chart brings
 * the shared formatter for `$.locale` (`formatValue`) without this module knowing about locales.
 */

/** A pair of numbers: the two ends of a domain or a range */
export type Extent = readonly [number, number];

/** A linear map from a numeric domain to a numeric range (pixels), with its inverse */
export interface LinearScale {
    readonly domain: Extent;
    readonly range: Extent;
    /** The range value of a domain value; a domain of no span maps every value to the start of the range */
    scale(value: number): number;
    /** The domain value of a range value; the inverse of `scale` */
    invert(position: number): number;
}

/** A map from a list of categories to bands along a range, with its inverse */
export interface BandScale {
    readonly domain: readonly string[];
    readonly range: Extent;
    /** The distance between the starts of two neighbouring bands */
    readonly step: number;
    /** The width of one band: the step less the padding between bands */
    readonly bandwidth: number;
    /** The start of the band of a category, or `undefined` for a category the domain does not hold */
    scale(category: string): number | undefined;
    /** The category whose band is nearest a range value, or `undefined` when the value is outside the range or the domain is empty */
    invert(position: number): string | undefined;
}

export interface BandOptions {
    /** The share of a step left empty between two bands, 0 to 1 (default 0.2) */
    readonly padding?: number;
    /** The share of a step left empty before the first and after the last band, 0 to 1 (default: the same as `padding`) */
    readonly outerPadding?: number;
}

/** The ticks of a range: the rounded ends the axis shows, the step, the tick values and their labels */
export interface NiceTicks {
    /** The first tick: the axis starts here, never above the smallest value */
    readonly min: number;
    /** The last tick: the axis ends here, never below the largest value */
    readonly max: number;
    readonly step: number;
    readonly values: readonly number[];
    readonly labels: readonly string[];
}

/** One value of a stacked series: where its segment starts and ends along the value axis */
export interface StackedValue {
    readonly lower: number;
    readonly upper: number;
}

/** Formats a tick value for display; the caller supplies the locale-aware one */
export type TickFormatter = (value: number) => string;

const clamp01 = (value: number | undefined, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : fallback;

/** A finite number, or 0 for anything else (a missing or broken value draws as nothing) */
const finite = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** Builds a linear scale. A non-finite end of either extent is taken as 0 */
export function createLinearScale(domain: Extent, range: Extent): LinearScale {
    const d0 = finite(domain[0]);
    const d1 = finite(domain[1]);
    const r0 = finite(range[0]);
    const r1 = finite(range[1]);
    const span = d1 - d0;
    return {
        domain: [d0, d1],
        range: [r0, r1],
        scale: (value) => (span === 0 ? r0 : r0 + ((value - d0) / span) * (r1 - r0)),
        invert: (position) => (r1 === r0 ? d0 : d0 + ((position - r0) / (r1 - r0)) * span)
    };
}

/** Builds a band scale over `domain` along an ascending `range`; a repeated category keeps the place of its first occurrence */
export function createBandScale(domain: readonly string[], range: Extent, options: BandOptions = {}): BandScale {
    const categories = [...new Set(domain)];
    const r0 = finite(range[0]);
    const r1 = finite(range[1]);
    const inner = clamp01(options.padding, 0.2);
    const outer = clamp01(options.outerPadding, inner);
    const count = categories.length;
    const length = Math.max(0, r1 - r0);
    const step = count === 0 ? 0 : length / Math.max(1, count - inner + outer * 2);
    const bandwidth = step * (1 - inner);
    const start = r0 + outer * step;
    const positions = new Map(categories.map((category, at) => [category, start + at * step]));
    return {
        domain: categories,
        range: [r0, r1],
        step,
        bandwidth,
        scale: (category) => positions.get(category),
        invert: (position) => {
            if (count === 0 || !(position >= r0 && position <= r1)) return undefined;
            const at = Math.round((position - start - bandwidth / 2) / (step || 1));
            return categories[Math.min(Math.max(at, 0), count - 1)];
        }
    };
}

/** The step 1, 2 or 5 times a power of ten that is at least `raw`: the usual "nice" step */
function niceStep(raw: number): number {
    const exponent = Math.floor(Math.log10(raw));
    const base = 10 ** exponent;
    const fraction = raw / base;
    const unit = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    return unit * base;
}

/** Rounds away the binary noise of `step * n` (0.1 * 3 is 0.30000000000000004) */
const tidy = (value: number): number => Number(value.toPrecision(12));

/**
 * Round tick values for a range, about `count` of them (at least 2). The first tick is at or below `min` and the last at or
 * above `max`, so the axis covers every value. A range with no span (`5` to `5`) covers from 0 to the value (0 to 0 covers
 * 0 to 1); ends that are not finite are taken as 0, and ends given the wrong way round are swapped. Labels come from
 * `format` (the caller's locale-aware formatter), or `String` when it is not given
 */
export function niceTicks(min: number, max: number, count: number, format: TickFormatter = String): NiceTicks {
    let low = finite(min);
    let high = finite(max);
    if (low > high) [low, high] = [high, low];
    if (low === high) {
        if (low === 0) high = 1;
        else if (low > 0) low = 0;
        else high = 0;
    }
    const wanted = Math.max(2, Math.floor(finite(count)));
    const step = niceStep((high - low) / (wanted - 1));
    const first = tidy(Math.floor(tidy(low / step)) * step);
    const last = tidy(Math.ceil(tidy(high / step)) * step);
    const values: number[] = [];
    const total = Math.round((last - first) / step);
    for (let at = 0; at <= total; at++) values.push(tidy(first + at * step));
    return { min: first, max: last, step, values, labels: values.map((value) => format(value)) };
}

/**
 * Stacks series along the value axis. `series[s][i]` is the value of series `s` at category `i`; the result has the same
 * shape with the `lower` and `upper` edge of each segment. Positive values stack upwards from 0 and negative values
 * downwards from 0 in series order, so a negative value never sits on a positive one. A value that is not a finite number
 * counts as 0, and a series shorter than the longest one counts as 0 at the missing categories
 */
export function stack(series: readonly (readonly number[])[]): StackedValue[][] {
    const length = series.reduce((longest, values) => Math.max(longest, values.length), 0);
    const positive = new Array<number>(length).fill(0);
    const negative = new Array<number>(length).fill(0);
    return series.map((values) => {
        const stacked: StackedValue[] = [];
        for (let at = 0; at < length; at++) {
            const value = finite(values[at]);
            const up = positive[at] as number;
            const down = negative[at] as number;
            if (value >= 0) {
                stacked.push({ lower: up, upper: up + value });
                positive[at] = up + value;
            } else {
                stacked.push({ lower: down + value, upper: down });
                negative[at] = down + value;
            }
        }
        return stacked;
    });
}

/** The smallest and largest of the values, or `[0, 0]` when there are none; values that are not finite are left out */
export function extentOf(values: Iterable<number>): Extent {
    let low = Infinity;
    let high = -Infinity;
    for (const value of values) {
        if (!Number.isFinite(value)) continue;
        if (value < low) low = value;
        if (value > high) high = value;
    }
    return low > high ? [0, 0] : [low, high];
}

/** The extent of a stack, always including 0 (bars and areas start there) */
export function stackExtent(stacked: readonly (readonly StackedValue[])[]): Extent {
    const [low, high] = extentOf(stacked.flatMap((values) => values.flatMap((value) => [value.lower, value.upper])));
    return [Math.min(low, 0), Math.max(high, 0)];
}
