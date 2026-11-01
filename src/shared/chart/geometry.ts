import { createBandScale, createLinearScale, extentOf, niceTicks, stack, stackExtent } from './scale.js';
import type { Extent, StackedValue } from './scale.js';
import { attrs, emptyScene, markAttrs, px, seriesClass } from './scene.js';
import type { ChartInput, Point, Primitive, Scene, SeriesInput, TipRow } from './scene.js';

export { SERIES_COLORS, seriesClass } from './scene.js';

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
const POINT_RADIUS = 3;

/** A series that is shown, with the colour position it has among all the series, hidden ones included, so hiding one does not recolour the rest */
interface Shown extends SeriesInput {
    readonly position: number;
}

function linePath(points: readonly (readonly [number, number])[]): string {
    return points.map(([x, y], at) => `${at === 0 ? 'M' : 'L'}${px(x)} ${px(y)}`).join(' ');
}

function areaPath(upper: readonly (readonly [number, number])[], lower: readonly (readonly [number, number])[]): string {
    if (upper.length === 0) return '';
    return `${linePath(upper)} ${[...lower].reverse().map(([x, y]) => `L${px(x)} ${px(y)}`).join(' ')} Z`;
}

/** The values the value axis has to cover: stacked edges when stacked, every value otherwise; always from zero */
function valueExtent(series: readonly Shown[], stacked: readonly (readonly StackedValue[])[] | undefined): Extent {
    if (stacked !== undefined) return stackExtent(stacked);
    const [low, high] = extentOf(series.flatMap((entry) => entry.values));
    return [Math.min(low, 0), Math.max(high, 0)];
}

/**
 * The marks, axes and gridlines of a bar, line or area chart as a flat list of SVG primitives, from the data and the size.
 * Pure: it reads nothing but its input, so the same input gives the same scene and the controller can draw it by writing
 * only the attributes that differ. Bars sit in a band per category (side by side, or stacked); lines and areas pass
 * through the middle of each band, with a point per value; an area fills down to zero (or to the series below, when
 * stacked). A series the user hid is left out and the others keep their colour. Every bar and point is a `Point` with
 * the tooltip rows of its category, and its mark has a name, `role="img"` and `data-point`
 */
export function buildCartesian(input: ChartInput): Scene {
    const { type, categories, stacked, width, height, format } = input;
    const series: Shown[] = input.series.map((entry, position) => ({ ...entry, position })).filter((entry) => !input.hidden.has(entry.key));
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
    const points: Point[] = [];

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
    primitives.push({ id: 'baseline', layer: 'axes', tag: 'line', className: 'baseline', attrs: attrs({ x1: plot.left, x2: plot.right, y1: zero, y2: zero }) });

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

    /** The tooltip rows of a category: every shown series, the one under the pointer marked */
    const rowsAt = (at: number, current: number): TipRow[] =>
        series.map((entry, shown) => ({ label: entry.label, value: format(entry.values[at] ?? 0), colour: seriesClass(entry.position), current: shown === current }));

    series.forEach((entry, shown) => {
        const colour = seriesClass(entry.position);
        const edges = (at: number): StackedValue => stacks?.[shown]?.[at] ?? { lower: Math.min(0, entry.values[at] ?? 0), upper: Math.max(0, entry.values[at] ?? 0) };
        const point = (id: string, at: number, x: number, top: number): Record<string, string> => {
            const label = `${entry.label}, ${categories[at] ?? ''}: ${format(entry.values[at] ?? 0)}`;
            points.push({ id, series: shown, index: at, x, y: top, title: categories[at] ?? '', rows: rowsAt(at, shown), label });
            return markAttrs(id, label);
        };
        if (type === 'bar') {
            const share = stacked ? 1 : series.length;
            const barWidth = bands.bandwidth / share;
            categories.forEach((_label, at) => {
                const { lower, upper } = edges(at);
                const top = y.scale(upper);
                const bottom = y.scale(lower);
                const x = (bands.scale(String(at)) as number) + (stacked ? 0 : shown * barWidth);
                const id = `bar:${entry.key}:${at}`;
                primitives.push({
                    id,
                    layer: 'marks',
                    tag: 'rect',
                    className: `bar ${colour}`,
                    attrs: {
                        ...attrs({ x, y: top, width: barWidth, height: Math.max(0, bottom - top) }),
                        'data-series': entry.key,
                        'data-index': String(at),
                        ...point(id, at, x + barWidth / 2, top)
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
            upper.push([centre, y.scale(stacked ? value : (entry.values[at] ?? 0))]);
            lower.push([centre, y.scale(stacked ? base : 0)]);
        });
        if (type === 'area') {
            primitives.push({ id: `area:${entry.key}`, layer: 'marks', tag: 'path', className: `area ${colour}`, attrs: { d: areaPath(upper, lower), 'data-series': entry.key } });
        }
        primitives.push({ id: `line:${entry.key}`, layer: 'marks', tag: 'path', className: `line ${colour}`, attrs: { d: linePath(upper), 'data-series': entry.key } });
        upper.forEach(([cx, cy], at) => {
            const id = `dot:${entry.key}:${at}`;
            primitives.push({
                id,
                layer: 'marks',
                tag: 'circle',
                className: `dot ${colour}`,
                attrs: { ...attrs({ cx, cy, r: POINT_RADIUS }), 'data-series': entry.key, 'data-index': String(at), ...point(id, at, cx, cy) }
            });
        });
    });

    return { viewBox: `0 0 ${px(width)} ${px(height)}`, primitives, plot, points };
}
