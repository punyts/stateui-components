import { createBandScale, createLinearScale, extentOf, niceTicks, stack, stackExtent } from './scale.js';
import type { Extent, StackedValue, TickFormatter } from './scale.js';

/** The chart types `chart` draws here; `donut` has its own layout */
export const CARTESIAN_TYPES = ['bar', 'line', 'area'] as const;

export type CartesianType = (typeof CARTESIAN_TYPES)[number];

/** How many categorical data colours the theme has: series past the eighth start again at the first */
export const SERIES_COLORS = 8;

/** The room around the plot in pixels, and the width of one character of a tick label; the controller reads no layout, so the margins are estimated from the label text */
const MARGIN_TOP = 8;
const MARGIN_RIGHT = 12;
const MARGIN_BOTTOM = 24;
const MARGIN_LEFT_MIN = 24;
const LABEL_GAP = 8;
const GLYPH_WIDTH = 7;
const TICK_SPACING = 40;
const MAX_TICKS = 8;
const LABEL_ROOM = 6;
const DECIMALS = 2;

export interface SeriesInput {
    /** The key of the series in the `series` map; it picks the colour by position */
    readonly key: string;
    readonly values: readonly number[];
}

export interface ChartInput {
    readonly type: CartesianType;
    readonly categories: readonly string[];
    readonly series: readonly SeriesInput[];
    readonly stacked: boolean;
    readonly width: number;
    readonly height: number;
    /** Formats a tick value; the chart passes the shared formatter for `$.locale` */
    readonly format: TickFormatter;
}

/** One SVG element of a chart: where it lives, what it is and what it looks like. `id` is stable between draws, so a redraw writes only what changed */
export interface Primitive {
    readonly id: string;
    readonly layer: 'grid' | 'axes' | 'marks';
    readonly tag: 'line' | 'text' | 'rect' | 'path' | 'circle';
    readonly className: string;
    readonly attrs: Readonly<Record<string, string>>;
    readonly text?: string;
}

export interface Scene {
    readonly viewBox: string;
    readonly primitives: readonly Primitive[];
    /** The plot area in pixels: where the axes meet the marks */
    readonly plot: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
}

/** The colour class of a series: `s1` to `s8` in key order, starting again after the eighth */
export const seriesClass = (position: number): string => `s${(position % SERIES_COLORS) + 1}`;

const px = (value: number): string => String(Number(value.toFixed(DECIMALS)));

const attrs = (values: Record<string, number | string>): Record<string, string> =>
    Object.fromEntries(Object.entries(values).map(([name, value]) => [name, typeof value === 'number' ? px(value) : value]));

function linePath(points: readonly (readonly [number, number])[]): string {
    return points.map(([x, y], at) => `${at === 0 ? 'M' : 'L'}${px(x)} ${px(y)}`).join(' ');
}

function areaPath(upper: readonly (readonly [number, number])[], lower: readonly (readonly [number, number])[]): string {
    if (upper.length === 0) return '';
    return `${linePath(upper)} ${[...lower].reverse().map(([x, y]) => `L${px(x)} ${px(y)}`).join(' ')} Z`;
}

const emptyScene = (width: number, height: number): Scene => ({
    viewBox: `0 0 ${px(Math.max(width, 0))} ${px(Math.max(height, 0))}`,
    primitives: [],
    plot: { left: 0, top: 0, right: 0, bottom: 0 }
});

/** The values the value axis has to cover: stacked edges when stacked, every value otherwise; always from zero */
function valueExtent(series: readonly SeriesInput[], stacked: readonly (readonly StackedValue[])[] | undefined): Extent {
    if (stacked !== undefined) return stackExtent(stacked);
    const [low, high] = extentOf(series.flatMap((entry) => entry.values));
    return [Math.min(low, 0), Math.max(high, 0)];
}

/**
 * The marks, axes and gridlines of a bar, line or area chart as a flat list of SVG primitives, from the data and the size.
 * Pure: it reads nothing but its input, so the same input gives the same scene and the controller can draw it by writing
 * only the attributes that differ. Bars sit in a band per category (side by side, or stacked); lines and areas pass
 * through the middle of each band, with a point per value; an area fills down to zero (or to the series below, when stacked)
 */
export function buildScene(input: ChartInput): Scene {
    const { type, categories, series, stacked, width, height, format } = input;
    if (!(width > 0) || !(height > 0)) return emptyScene(width, height);
    const stacks = stacked ? stack(series.map((entry) => entry.values)) : undefined;
    const [low, high] = valueExtent(series, stacks);
    const count = Math.min(MAX_TICKS, Math.max(2, Math.floor(height / TICK_SPACING) + 1));
    const ticks = niceTicks(low, high, count, format);
    const longest = ticks.labels.reduce((most, label) => Math.max(most, label.length), 0);
    const left = Math.max(MARGIN_LEFT_MIN, longest * GLYPH_WIDTH + LABEL_GAP + LABEL_ROOM);
    const plot = { left, top: MARGIN_TOP, right: width - MARGIN_RIGHT, bottom: height - MARGIN_BOTTOM };
    if (plot.right - plot.left <= 0 || plot.bottom - plot.top <= 0) return emptyScene(width, height);

    const y = createLinearScale([ticks.min, ticks.max], [plot.bottom, plot.top]);
    const bands = createBandScale(categories.map((_category, at) => String(at)), [plot.left, plot.right], { padding: type === 'bar' ? 0.2 : 0 });
    const zero = y.scale(0);
    const primitives: Primitive[] = [];

    ticks.values.forEach((value, at) => {
        const position = y.scale(value);
        primitives.push({
            id: `grid:${at}`,
            layer: 'grid',
            tag: 'line',
            className: value === 0 ? 'gridline zero' : 'gridline',
            attrs: attrs({ x1: plot.left, x2: plot.right, y1: position, y2: position })
        });
        primitives.push({
            id: `ytick:${at}`,
            layer: 'axes',
            tag: 'text',
            className: 'tick y',
            attrs: attrs({ x: plot.left - LABEL_GAP, y: position, dy: '0.32em' }),
            text: ticks.labels[at] as string
        });
    });
    primitives.push({
        id: 'baseline',
        layer: 'axes',
        tag: 'line',
        className: 'baseline',
        attrs: attrs({ x1: plot.left, x2: plot.right, y1: zero, y2: zero })
    });

    const widest = categories.reduce((most, label) => Math.max(most, label.length), 0);
    const stride = Math.max(1, Math.ceil((widest * GLYPH_WIDTH + LABEL_ROOM) / (bands.step || 1)));
    categories.forEach((label, at) => {
        if (at % stride !== 0) return;
        const start = bands.scale(String(at)) as number;
        primitives.push({
            id: `xtick:${at}`,
            layer: 'axes',
            tag: 'text',
            className: 'tick x',
            attrs: attrs({ x: start + bands.bandwidth / 2, y: plot.bottom + MARGIN_BOTTOM - LABEL_ROOM }),
            text: label
        });
    });

    series.forEach((entry, position) => {
        const colour = seriesClass(position);
        const edges = (at: number): StackedValue => (stacks?.[position]?.[at] ?? { lower: Math.min(0, entry.values[at] ?? 0), upper: Math.max(0, entry.values[at] ?? 0) });
        if (type === 'bar') {
            const share = stacked ? 1 : series.length;
            const barWidth = bands.bandwidth / share;
            categories.forEach((_label, at) => {
                const { lower, upper } = edges(at);
                const top = y.scale(upper);
                const bottom = y.scale(lower);
                primitives.push({
                    id: `bar:${entry.key}:${at}`,
                    layer: 'marks',
                    tag: 'rect',
                    className: `bar ${colour}`,
                    attrs: {
                        ...attrs({
                            x: (bands.scale(String(at)) as number) + (stacked ? 0 : position * barWidth),
                            y: top,
                            width: barWidth,
                            height: Math.max(0, bottom - top)
                        }),
                        'data-series': entry.key,
                        'data-index': String(at)
                    }
                });
            });
            return;
        }
        const upper: [number, number][] = [];
        const lower: [number, number][] = [];
        categories.forEach((_label, at) => {
            const centre = (bands.scale(String(at)) as number) + bands.bandwidth / 2;
            const { lower: base, upper: value } = edges(at);
            const point = stacked ? value : (entry.values[at] ?? 0);
            upper.push([centre, y.scale(point)]);
            lower.push([centre, y.scale(stacked ? base : 0)]);
        });
        if (type === 'area') {
            primitives.push({ id: `area:${entry.key}`, layer: 'marks', tag: 'path', className: `area ${colour}`, attrs: { d: areaPath(upper, lower), 'data-series': entry.key } });
        }
        primitives.push({ id: `line:${entry.key}`, layer: 'marks', tag: 'path', className: `line ${colour}`, attrs: { d: linePath(upper), 'data-series': entry.key } });
        upper.forEach(([cx, cy], at) => {
            primitives.push({
                id: `dot:${entry.key}:${at}`,
                layer: 'marks',
                tag: 'circle',
                className: `dot ${colour}`,
                attrs: { ...attrs({ cx, cy, r: 3 }), 'data-series': entry.key, 'data-index': String(at) }
            });
        });
    });

    return { viewBox: `0 0 ${px(width)} ${px(height)}`, primitives, plot };
}
