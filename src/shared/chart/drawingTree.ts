import type { JsonValue } from '@punyts/stateui-app/core';
import type { ShapeKind, ShapeTree } from '../drawing/tree.js';
import { SERIES_COLORS } from './scene.js';
import type { Point, Primitive, Scene } from './scene.js';

/** The layers of a chart in drawing order; each becomes a `drawGroup` of that name */
export const CHART_LAYERS = ['grid', 'axes', 'marks'] as const;

/** The shape each primitive tag becomes */
const KINDS: Readonly<Record<Primitive['tag'], ShapeKind>> = { line: 'line', text: 'drawText', rect: 'rect', path: 'path', circle: 'circle' };

/** The geometry attributes of a primitive that become numeric properties of its shape; `x1 y1 x2 y2` become `points` */
const NUMERIC = ['x', 'y', 'width', 'height', 'cx', 'cy', 'r'] as const;
const LINE_ENDS = ['x1', 'y1', 'x2', 'y2'] as const;

/** The text offsets the scene writes as `dy`, as the `baseline` of `drawText` (written as `dominant-baseline`) */
const BASELINES: Readonly<Record<string, string>> = { '0.32em': 'middle', '1em': 'hanging' };

/** The colour class of a series (`s1` to `s8`, see `seriesClass`) */
const SERIES_CLASS = /^s(\d+)$/;

/** The thin and thick border widths of the theme (`border.width.thin`, `border.width.thick`) as stroke widths */
const THIN = 1;
const THICK = 2;
const AREA_OPACITY = 0.2;

/** The series colour token of a colour class number (1 to 8; a higher one starts again, as `seriesClass` does) */
export const seriesToken = (n: number): string => `{color.data.categorical.${((n - 1) % SERIES_COLORS) + 1}}`;

/**
 * The paint of a mark by its kind (the first word of its class), as `chart.view.css` gave it: bars and slices fill,
 * lines stroke, areas fill at 0.2 opacity with no stroke, points (`dot`) and slices have a surface-coloured stroke
 */
function markPaint(kind: string, colour: string): Record<string, JsonValue> {
    switch (kind) {
        case 'bar':
            return { fill: colour };
        case 'line':
            // The vocabulary has no `none` colour; `transparent` paints nothing, and an unset fill would take the group's
            return { fill: 'transparent', stroke: colour, strokeWidth: THICK, cap: 'round', join: 'round' };
        case 'area':
            return { fill: colour, opacity: AREA_OPACITY };
        case 'dot':
        case 'slice':
            return { fill: colour, stroke: '{color.surface.base}', strokeWidth: THIN };
        default:
            return { fill: colour };
    }
}

/**
 * The paint and text anchor of the parts that are not marks, as `chart.view.css` gives them. In SVG the stylesheet
 * rules for these stay and win over the attributes; a renderer without the stylesheet (canvas) needs them in the tree
 */
const PART_STYLE: Readonly<Record<string, Readonly<Record<string, JsonValue>>>> = {
    gridline: { stroke: '{color.border.base}', strokeWidth: THIN },
    baseline: { stroke: '{color.border.strong}', strokeWidth: THIN },
    'tick y': { fill: '{color.text.muted}', anchor: 'end' },
    'tick x': { fill: '{color.text.muted}', anchor: 'middle' },
    total: { fill: '{color.text.base}', anchor: 'middle' },
    'total-label': { fill: '{color.text.muted}', anchor: 'middle' }
};

export interface SceneToTreeOptions {
    /**
     * The path the shape paths start with (`<path>.marks.<id>`); none by default, so a mark's path is `marks.<id>`.
     * A shape's path is its id for the renderer (`elementOf`, `boundsOf`, `hit`)
     */
    readonly path?: string;
}

/** What `sceneToTree` gives: the shapes to draw, and the data of each mark beside them */
export interface ChartTree {
    /** One `drawGroup` per layer (`grid`, `axes`, `marks`, always all three, in that order), the shapes of the layer in it */
    readonly shapes: readonly ShapeTree[];
    /**
     * The `Point` of each mark (bar, line or area point, slice), keyed by the path of its shape, for the tooltip,
     * keyboard navigation and events. It is not an attribute and not a property of a shape
     */
    readonly data: Readonly<Record<string, Point>>;
}

/** The path of the group of a layer */
export const layerPath = (layer: Primitive['layer'], options: SceneToTreeOptions = {}): string =>
    options.path === undefined || options.path === '' ? layer : `${options.path}.${layer}`;

/** The path of the shape of a primitive: its layer's path and its id, which is stable between scenes */
export const primitivePath = (primitive: Pick<Primitive, 'id' | 'layer'>, options: SceneToTreeOptions = {}): string =>
    `${layerPath(primitive.layer, options)}.${primitive.id}`;

const toNumber = (value: string | undefined): number | undefined => {
    if (value === undefined) return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
};

/** One primitive as a shape: geometry as properties, the series class as paint, the rest of the class and the other attributes as `attrs` */
function primitiveShape(primitive: Primitive, options: SceneToTreeOptions): ShapeTree {
    const kind = KINDS[primitive.tag];
    const properties: Record<string, JsonValue> = {};
    const attrs: Record<string, string> = {};

    const words = primitive.className.split(/\s+/).filter((word) => word !== '');
    const series = words.map((word) => SERIES_CLASS.exec(word)).find((match) => match !== null);
    const rest = words.filter((word) => !SERIES_CLASS.test(word));
    if (series) Object.assign(properties, markPaint(rest[0] ?? '', seriesToken(Number(series[1]))));
    else Object.assign(properties, PART_STYLE[rest.join(' ')] ?? {});
    if (rest.length > 0) attrs.class = rest.join(' ');

    for (const [name, value] of Object.entries(primitive.attrs)) {
        if ((NUMERIC as readonly string[]).includes(name)) {
            const number = toNumber(value);
            if (number !== undefined) properties[name] = number;
        } else if ((LINE_ENDS as readonly string[]).includes(name)) {
            // Read together below
        } else if (name === 'd') {
            properties.d = value;
        } else if (name === 'dy') {
            const baseline = BASELINES[value];
            if (baseline !== undefined) properties.baseline = baseline;
        } else {
            attrs[name] = value;
        }
    }
    if (kind === 'line') {
        const [x1, y1, x2, y2] = LINE_ENDS.map((name) => toNumber(primitive.attrs[name]) ?? 0);
        properties.points = [
            [x1 as number, y1 as number],
            [x2 as number, y2 as number]
        ];
    }
    if (kind === 'drawText') properties._text = primitive.text ?? '';

    const shape: { -readonly [K in keyof ShapeTree]: ShapeTree[K] } = { kind, key: primitive.id, path: primitivePath(primitive, options), properties, children: [] };
    if (Object.keys(attrs).length > 0) shape.attrs = attrs;
    return shape;
}

/**
 * Turns a chart scene (`buildScene`) into the drawing shape tree the renderers of the drawing model take (G2.1 of the
 * graphics epic 2). Each primitive becomes a shape (`line` with two `points`, `drawText`, `rect`, `path`, `circle`)
 * with its geometry as properties, inside a `drawGroup` per layer (`grid`, `axes`, `marks`, class `layer <name>` as
 * the old SVG scene had). The `s1`..`s8` class becomes a `{color.data.categorical.N}` fill or stroke by the mark kind;
 * the rest of the class goes to `attrs.class` and the other attributes (`data-*`, `role`, `aria-label`, `tabindex`) to
 * `attrs` as given, because the chart's tests and stylesheet use them. A text's `dy` becomes its `baseline`. Paths
 * come from the primitive ids, so they are stable between calls and the renderer writes only what changed. Pure: it
 * writes nothing, and the tree is a plain object, never state
 */
export function sceneToTree(scene: Scene, options: SceneToTreeOptions = {}): ChartTree {
    const layers = new Map<Primitive['layer'], ShapeTree[]>(CHART_LAYERS.map((layer) => [layer, []]));
    const paths = new Map<string, string>();
    for (const primitive of scene.primitives) {
        const shape = primitiveShape(primitive, options);
        (layers.get(primitive.layer) as ShapeTree[]).push(shape);
        paths.set(primitive.id, shape.path);
    }
    const shapes: ShapeTree[] = CHART_LAYERS.map((layer) => ({
        kind: 'drawGroup',
        key: layer,
        path: layerPath(layer, options),
        properties: {},
        children: layers.get(layer) as ShapeTree[],
        attrs: { class: `layer ${layer}` }
    }));
    const data: Record<string, Point> = {};
    for (const point of scene.points) data[paths.get(point.id) ?? primitivePath({ id: point.id, layer: 'marks' }, options)] = point;
    return { shapes, data };
}

/**
 * The tree for the canvas renderer (G2.3 of the graphics epic 2): each mark (a shape with `data-point`) becomes
 * `interactive` and is named by its `aria-label` (`_label`), so the canvas renderer gives it a proxy button (which
 * carries its `role`, `tabindex` and `data-*`) and `hit()` finds it. The other shapes are kept as they are. Pure
 */
export function interactiveMarks(shapes: readonly ShapeTree[]): ShapeTree[] {
    return shapes.map((shape) => {
        const attrs = shape.attrs;
        if (attrs?.['data-point'] !== undefined) return { ...shape, properties: { ...shape.properties, interactive: true, _label: attrs['aria-label'] ?? '' } };
        return shape.children.length === 0 ? shape : { ...shape, children: interactiveMarks(shape.children) };
    });
}
