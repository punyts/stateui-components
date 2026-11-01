import { attrs, emptyScene, markAttrs, px, seriesClass } from './scene.js';
import type { ChartInput, Point, Primitive, Scene } from './scene.js';

const MARGIN = 8;
const MIN_RADIUS = 10;
/** The hole of the ring as a share of its outer radius */
const HOLE = 0.6;
const FULL_TURN = Math.PI * 2;
/** A turn this close to a whole one is drawn as a ring, because an arc cannot start and end at the same point */
const WHOLE_EPSILON = 1e-4;
const TOTAL_LIFT = 0.1;
const LABEL_DROP = 1.1;

const polar = (cx: number, cy: number, radius: number, angle: number): [number, number] => [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];

/** The path of a ring sector from `from` to `to` (radians, clockwise from the right), between two radii */
function sectorPath(cx: number, cy: number, outer: number, inner: number, from: number, to: number): string {
    if (to - from >= FULL_TURN - WHOLE_EPSILON) {
        const middle = from + Math.PI;
        const [ox0, oy0] = polar(cx, cy, outer, from);
        const [ox1, oy1] = polar(cx, cy, outer, middle);
        const [ix0, iy0] = polar(cx, cy, inner, from);
        const [ix1, iy1] = polar(cx, cy, inner, middle);
        return `M${px(ox0)} ${px(oy0)} A${px(outer)} ${px(outer)} 0 1 1 ${px(ox1)} ${px(oy1)} A${px(outer)} ${px(outer)} 0 1 1 ${px(ox0)} ${px(oy0)} M${px(ix0)} ${px(iy0)} A${px(inner)} ${px(inner)} 0 1 0 ${px(ix1)} ${px(iy1)} A${px(inner)} ${px(inner)} 0 1 0 ${px(ix0)} ${px(iy0)} Z`;
    }
    const large = to - from > Math.PI ? 1 : 0;
    const [ox0, oy0] = polar(cx, cy, outer, from);
    const [ox1, oy1] = polar(cx, cy, outer, to);
    const [ix1, iy1] = polar(cx, cy, inner, to);
    const [ix0, iy0] = polar(cx, cy, inner, from);
    return `M${px(ox0)} ${px(oy0)} A${px(outer)} ${px(outer)} 0 ${large} 1 ${px(ox1)} ${px(oy1)} L${px(ix1)} ${px(iy1)} A${px(inner)} ${px(inner)} 0 ${large} 0 ${px(ix0)} ${px(iy0)} Z`;
}

/**
 * A donut: the first series as one arc per record, clockwise from the top in record order, with the total of the shown arcs
 * in the centre. A record the user hid (its label is in `hidden`) is left out and the others keep their colour; a value that
 * is zero or below draws no arc. Each arc is a `Point` whose tooltip gives the value and its share of the shown total
 */
export function buildDonut(input: ChartInput): Scene {
    const { categories, width, height, format, percent, texts } = input;
    const outer = Math.min(width, height) / 2 - MARGIN;
    if (!(width > 0) || !(height > 0) || outer < MIN_RADIUS) return emptyScene(width, height);
    const entry = input.series[0];
    const values = categories.map((_label, at) => Math.max(0, entry?.values[at] ?? 0));
    const shown = categories.map((label, at) => ({ label, at, value: values[at] as number })).filter((slice) => !input.hidden.has(slice.label));
    const total = shown.reduce((sum, slice) => sum + slice.value, 0);
    const cx = width / 2;
    const cy = height / 2;
    const inner = outer * HOLE;
    const primitives: Primitive[] = [];
    const points: Point[] = [];
    const seriesLabel = entry?.label ?? '';

    let angle = -Math.PI / 2;
    let place = 0;
    for (const slice of shown) {
        if (!(slice.value > 0) || !(total > 0)) continue;
        const sweep = (slice.value / total) * FULL_TURN;
        const [tipX, tipY] = polar(cx, cy, outer, angle + sweep / 2);
        const id = `slice:${slice.at}`;
        const colour = seriesClass(slice.at);
        const share = slice.value / total;
        const label = `${slice.label}: ${format(slice.value)} (${percent(share)})`;
        primitives.push({
            id,
            layer: 'marks',
            tag: 'path',
            className: `slice ${colour}`,
            attrs: { d: sectorPath(cx, cy, outer, inner, angle, angle + sweep), 'data-series': entry?.key ?? '', 'data-index': String(slice.at), ...markAttrs(id, label) }
        });
        points.push({
            id,
            series: 0,
            index: place,
            x: tipX,
            y: tipY,
            title: slice.label,
            rows: [
                { label: seriesLabel, value: format(slice.value), colour, current: true },
                { label: texts.share, value: percent(share), colour: '', current: false }
            ],
            label
        });
        place += 1;
        angle += sweep;
    }
    primitives.push({ id: 'total', layer: 'axes', tag: 'text', className: 'total', attrs: attrs({ x: cx, y: cy - inner * TOTAL_LIFT }), text: format(total) });
    primitives.push({ id: 'total-label', layer: 'axes', tag: 'text', className: 'total-label', attrs: attrs({ x: cx, y: cy + inner * TOTAL_LIFT * LABEL_DROP, dy: '1em' }), text: texts.total });
    return { viewBox: `0 0 ${px(width)} ${px(height)}`, primitives, plot: { left: cx - outer, top: cy - outer, right: cx + outer, bottom: cy + outer }, points };
}
