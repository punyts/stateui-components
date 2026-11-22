import { createLinearScale, extentOf, niceTicks } from './scale.js';
import { attrs, emptyScene, markAttrs, px, seriesClass } from './scene.js';
import type { ChartInput, Point, Primitive, Scene, SeriesInput, TipRow } from './scene.js';

const MARGIN = 8;
const MARGIN_TOP = 8;
const MARGIN_RIGHT = 12;
const MARGIN_BOTTOM = 24;
const MARGIN_LEFT_MIN = 24;
const LABEL_GAP = 8;
const GLYPH_WIDTH = 7;
const LABEL_ROOM = 6;
const TICK_SPACING = 40;
const MAX_TICKS = 8;
const RADAR_TICKS = 4;
const RADAR_LABEL_ROOM = 28;
const MIN_RADIUS = 16;
const POINT_RADIUS = 3;
const SCATTER_RADIUS = 4;
/** The faintest and the strongest a heatmap cell is drawn, as an opacity of the first data colour */
const HEAT_FLOOR = 0.12;
const HEAT_SPAN = 0.88;
const FULL_TURN = Math.PI * 2;

/** A series that is shown, with the colour position it has among all the series */
interface Shown extends SeriesInput {
    readonly position: number;
}

const shownSeries = (input: ChartInput): Shown[] => input.series.map((entry, position) => ({ ...entry, position })).filter((entry) => !input.hidden.has(entry.key));

const viewBoxOf = (width: number, height: number): string => `0 0 ${px(width)} ${px(height)}`;

const linePath = (points: readonly (readonly [number, number])[], close = false): string =>
    points.map(([x, y], at) => `${at === 0 ? 'M' : 'L'}${px(x)} ${px(y)}`).join(' ') + (close && points.length > 0 ? ' Z' : '');

/** The width of a value axis's labels, so the plot starts after them; the controller reads no layout */
const labelRoom = (labels: readonly string[]): number => Math.max(MARGIN_LEFT_MIN, labels.reduce((most, label) => Math.max(most, label.length), 0) * GLYPH_WIDTH + LABEL_GAP + LABEL_ROOM);

/** Gridlines and labels of a value axis, as the cartesian charts draw them */
function valueAxis(primitives: Primitive[], values: readonly number[], labels: readonly string[], scale: (value: number) => number, plot: Scene['plot'], axis: 'x' | 'y'): void {
    values.forEach((value, at) => {
        const position = scale(value);
        if (axis === 'y') {
            primitives.push({ id: `grid:${at}`, layer: 'grid', tag: 'line', className: value === 0 ? 'gridline zero' : 'gridline', attrs: attrs({ x1: plot.left, x2: plot.right, y1: position, y2: position }) });
            primitives.push({ id: `ytick:${at}`, layer: 'axes', tag: 'text', className: 'tick y', attrs: attrs({ x: plot.left - LABEL_GAP, y: position, dy: '0.32em' }), text: labels[at] as string });
        } else {
            primitives.push({ id: `xgrid:${at}`, layer: 'grid', tag: 'line', className: 'gridline', attrs: attrs({ x1: position, x2: position, y1: plot.top, y2: plot.bottom }) });
            primitives.push({ id: `xtick:${at}`, layer: 'axes', tag: 'text', className: 'tick x', attrs: attrs({ x: position, y: plot.bottom + MARGIN_BOTTOM - LABEL_ROOM }), text: labels[at] as string });
        }
    });
}

/**
 * A scatter chart: each record is a point at its `x` (read as a number) and each series' value, one colour per series.
 * A record whose `x` is not a number is left out. Both axes are linear with round ticks; the x ticks use `formatX` (a
 * plain number in the chart's locale), the y ticks and every value use `format`. A point's tooltip gives its series' value
 * and the `x`
 */
export function buildScatter(input: ChartInput): Scene {
    const { categories, width, height, format } = input;
    const formatX = input.formatX ?? String;
    const series = shownSeries(input);
    if (!(width > 0) || !(height > 0)) return emptyScene(width, height);
    const xs = categories.map((category) => (category.trim() === '' ? Number.NaN : Number(category)));
    const kept = xs.map((x, at) => ({ x, at })).filter((entry) => Number.isFinite(entry.x));
    const [xLow, xHigh] = extentOf(kept.map((entry) => entry.x));
    const [yLow, yHigh] = extentOf(series.flatMap((entry) => kept.map(({ at }) => entry.values[at] ?? 0)));
    const count = Math.min(MAX_TICKS, Math.max(2, Math.floor(height / TICK_SPACING) + 1));
    const yTicks = niceTicks(Math.min(yLow, 0), Math.max(yHigh, 0), count, format);
    const left = labelRoom(yTicks.labels);
    const plot = { left, top: MARGIN_TOP, right: width - MARGIN_RIGHT, bottom: height - MARGIN_BOTTOM };
    if (plot.right - plot.left <= 0 || plot.bottom - plot.top <= 0) return emptyScene(width, height);
    const xCount = Math.min(MAX_TICKS, Math.max(2, Math.floor((plot.right - plot.left) / (TICK_SPACING * 2)) + 1));
    const xTicks = niceTicks(xLow, xHigh, xCount, formatX);
    const x = createLinearScale([xTicks.min, xTicks.max], [plot.left, plot.right]);
    const y = createLinearScale([yTicks.min, yTicks.max], [plot.bottom, plot.top]);
    const primitives: Primitive[] = [];
    const points: Point[] = [];
    valueAxis(primitives, yTicks.values, yTicks.labels, y.scale, plot, 'y');
    valueAxis(primitives, xTicks.values, xTicks.labels, x.scale, plot, 'x');
    primitives.push({ id: 'baseline', layer: 'axes', tag: 'line', className: 'baseline', attrs: attrs({ x1: plot.left, x2: plot.right, y1: plot.bottom, y2: plot.bottom }) });

    series.forEach((entry, shown) => {
        const colour = seriesClass(entry.position);
        kept.forEach(({ x: value, at }, index) => {
            const amount = entry.values[at] ?? 0;
            const cx = x.scale(value);
            const cy = y.scale(amount);
            const id = `dot:${entry.key}:${at}`;
            const label = `${entry.label}, ${formatX(value)}: ${format(amount)}`;
            const rows: TipRow[] = [{ label: entry.label, value: format(amount), colour, current: true }];
            points.push({ id, series: shown, index, x: cx, y: cy, title: formatX(value), rows, label });
            primitives.push({
                id,
                layer: 'marks',
                tag: 'circle',
                className: `dot ${colour}`,
                attrs: { ...attrs({ cx, cy, r: SCATTER_RADIUS }), 'data-series': entry.key, 'data-index': String(at), ...markAttrs(id, label) }
            });
        });
    });
    return { viewBox: viewBoxOf(width, height), primitives, plot, points };
}

/**
 * A radar chart: a spoke per category clockwise from the top, a ring per value tick, and per series a filled outline
 * through its values with a point on each spoke. It needs at least three categories; with fewer it draws nothing. The
 * value scale starts at zero (a negative value sits at the centre). Every point carries the tooltip rows of its category
 */
export function buildRadar(input: ChartInput): Scene {
    const { categories, width, height, format } = input;
    const series = shownSeries(input);
    const outer = Math.min(width, height) / 2 - MARGIN - RADAR_LABEL_ROOM;
    if (!(width > 0) || !(height > 0) || categories.length < 3 || outer < MIN_RADIUS) return emptyScene(width, height);
    const [, high] = extentOf(series.flatMap((entry) => entry.values));
    const ticks = niceTicks(0, Math.max(high, 0), RADAR_TICKS, format);
    const radius = createLinearScale([0, ticks.max], [0, outer]);
    const cx = width / 2;
    const cy = height / 2;
    const angle = (at: number): number => -Math.PI / 2 + (at / categories.length) * FULL_TURN;
    const at = (index: number, distance: number): [number, number] => [cx + distance * Math.cos(angle(index)), cy + distance * Math.sin(angle(index))];
    const primitives: Primitive[] = [];
    const points: Point[] = [];

    ticks.values.forEach((value, tick) => {
        if (value <= 0) return;
        const ring = categories.map((_label, index) => at(index, radius.scale(value)));
        primitives.push({ id: `web:${tick}`, layer: 'grid', tag: 'path', className: 'web', attrs: { d: linePath(ring, true) } });
        const [lx, ly] = at(0, radius.scale(value));
        primitives.push({ id: `ytick:${tick}`, layer: 'axes', tag: 'text', className: 'tick y', attrs: attrs({ x: lx - LABEL_GAP / 2, y: ly, dy: '0.32em' }), text: ticks.labels[tick] as string });
    });
    categories.forEach((label, index) => {
        const [x2, y2] = at(index, outer);
        primitives.push({ id: `spoke:${index}`, layer: 'grid', tag: 'line', className: 'gridline', attrs: attrs({ x1: cx, y1: cy, x2, y2 }) });
        const [lx, ly] = at(index, outer + RADAR_LABEL_ROOM / 2);
        primitives.push({ id: `xtick:${index}`, layer: 'axes', tag: 'text', className: 'tick x', attrs: attrs({ x: lx, y: ly, dy: '0.32em' }), text: label });
    });

    const rowsAt = (index: number, current: number): TipRow[] =>
        series.map((entry, shown) => ({ label: entry.label, value: format(entry.values[index] ?? 0), colour: seriesClass(entry.position), current: shown === current }));
    series.forEach((entry, shown) => {
        const colour = seriesClass(entry.position);
        const outline = categories.map((_label, index) => at(index, radius.scale(Math.max(0, entry.values[index] ?? 0))));
        primitives.push({ id: `area:${entry.key}`, layer: 'marks', tag: 'path', className: `area ${colour}`, attrs: { d: linePath(outline, true), 'data-series': entry.key } });
        primitives.push({ id: `line:${entry.key}`, layer: 'marks', tag: 'path', className: `line ${colour}`, attrs: { d: linePath(outline, true), 'data-series': entry.key } });
        outline.forEach(([px0, py0], index) => {
            const id = `dot:${entry.key}:${index}`;
            const label = `${entry.label}, ${categories[index] ?? ''}: ${format(entry.values[index] ?? 0)}`;
            points.push({ id, series: shown, index, x: px0, y: py0, title: categories[index] ?? '', rows: rowsAt(index, shown), label });
            primitives.push({
                id,
                layer: 'marks',
                tag: 'circle',
                className: `dot ${colour}`,
                attrs: { ...attrs({ cx: px0, cy: py0, r: POINT_RADIUS }), 'data-series': entry.key, 'data-index': String(index), ...markAttrs(id, label) }
            });
        });
    });
    return { viewBox: viewBoxOf(width, height), primitives, plot: { left: cx - outer, top: cy - outer, right: cx + outer, bottom: cy + outer }, points };
}

/**
 * A heatmap: a row per series (labelled on the left) and a column per category (labelled below), each cell the first
 * data colour at an opacity that grows with its value between the smallest and largest shown value. Every cell is a
 * point whose tooltip names its series and category; the arrows move along a row and between rows
 */
export function buildHeatmap(input: ChartInput): Scene {
    const { categories, width, height, format } = input;
    const series = shownSeries(input);
    if (!(width > 0) || !(height > 0) || categories.length === 0 || series.length === 0) return emptyScene(width, height);
    const left = labelRoom(series.map((entry) => entry.label));
    const plot = { left, top: MARGIN_TOP, right: width - MARGIN_RIGHT, bottom: height - MARGIN_BOTTOM };
    if (plot.right - plot.left <= 0 || plot.bottom - plot.top <= 0) return emptyScene(width, height);
    const cellWidth = (plot.right - plot.left) / categories.length;
    const cellHeight = (plot.bottom - plot.top) / series.length;
    const [low, high] = extentOf(series.flatMap((entry) => categories.map((_label, index) => entry.values[index] ?? 0)));
    const strength = (value: number): number => (high > low ? (value - low) / (high - low) : 1);
    const primitives: Primitive[] = [];
    const points: Point[] = [];

    const widest = categories.reduce((most, label) => Math.max(most, label.length), 0);
    const stride = Math.max(1, Math.ceil((widest * GLYPH_WIDTH + LABEL_ROOM) / (cellWidth || 1)));
    categories.forEach((label, index) => {
        if (index % stride !== 0) return;
        primitives.push({ id: `xtick:${index}`, layer: 'axes', tag: 'text', className: 'tick x', attrs: attrs({ x: plot.left + (index + 0.5) * cellWidth, y: plot.bottom + MARGIN_BOTTOM - LABEL_ROOM }), text: label });
    });
    series.forEach((entry, row) => {
        primitives.push({ id: `ytick:${row}`, layer: 'axes', tag: 'text', className: 'tick y', attrs: attrs({ x: plot.left - LABEL_GAP, y: plot.top + (row + 0.5) * cellHeight, dy: '0.32em' }), text: entry.label });
        categories.forEach((category, index) => {
            const value = entry.values[index] ?? 0;
            const x = plot.left + index * cellWidth;
            const y = plot.top + row * cellHeight;
            const id = `cell:${entry.key}:${index}`;
            const label = `${entry.label}, ${category}: ${format(value)}`;
            points.push({ id, series: row, index, x: x + cellWidth / 2, y, title: `${entry.label}, ${category}`, rows: [{ label: entry.label, value: format(value), colour: '', current: true }], label });
            primitives.push({
                id,
                layer: 'marks',
                tag: 'rect',
                className: `cell ${seriesClass(0)}`,
                attrs: {
                    ...attrs({ x, y, width: Math.max(0, cellWidth - 1), height: Math.max(0, cellHeight - 1), opacity: HEAT_FLOOR + HEAT_SPAN * strength(value) }),
                    'data-series': entry.key,
                    'data-index': String(index),
                    ...markAttrs(id, label)
                }
            });
        });
    });
    return { viewBox: viewBoxOf(width, height), primitives, plot, points };
}
