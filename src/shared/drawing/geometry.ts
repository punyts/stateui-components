import { flattenPath, parsePathData, pathBounds } from '@punyts/stateui-app/core';
import type { FlatSubpath, JsonValue, PathPoint } from '@punyts/stateui-app/core';
import { locateShape } from './tree.js';
import type { ShapeKind, ShapeTree } from './tree.js';

/** An axis-aligned box in drawing units */
export interface Bounds {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** The `viewBox` of a drawing: the part of drawing space that is shown */
export type ViewBox = Bounds;

/** How the `viewBox` fills the drawing's box: whole and centred, covering it and centred, or stretched */
export const FITS = ['contain', 'cover', 'stretch'] as const;

export type Fit = (typeof FITS)[number];

/** Drawing units to pixels of the drawing's box: `px = x * scaleX + offsetX`, `py = y * scaleY + offsetY` */
export interface Viewport {
    readonly scaleX: number;
    readonly scaleY: number;
    readonly offsetX: number;
    readonly offsetY: number;
}

/** An affine transform `[a, b, c, d, e, f]`, as SVG's `matrix()`: `x' = a x + c y + e`, `y' = b x + d y + f` */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** The tolerance in drawing units that curves and arcs of a `path` are flattened to for hit testing */
export const PATH_TOLERANCE = 0.25;

/** The stroke width a shape without a usable `strokeWidth` is hit-tested with */
export const DEFAULT_STROKE_WIDTH = 1;

/** The font size a `drawText` without a usable `size` is measured with */
export const DEFAULT_TEXT_SIZE = 16;

/** The width of one character of `drawText` as a share of its size; nothing reads layout, so text bounds are an estimate */
export const TEXT_ADVANCE = 0.6;

/** The kinds whose `x` and `y` are their own position, not a transform offset */
const POSITIONED: ReadonlySet<ShapeKind> = new Set(['rect', 'drawText', 'drawImage']);

const finite = (value: JsonValue | undefined): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const numberOf = (shape: ShapeTree, name: string, fallback = 0): number => finite(shape.properties[name]) ?? fallback;
const sizeOf = (shape: ShapeTree, name: string): number | undefined => {
    const value = finite(shape.properties[name]);
    return value !== undefined && value >= 0 ? value : undefined;
};

/** The `viewBox` of a value (`{ x, y, width, height }`, a width and height above zero), or undefined */
export function readViewBox(value: JsonValue | undefined): ViewBox | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const x = finite(value.x) ?? 0;
    const y = finite(value.y) ?? 0;
    const width = finite(value.width);
    const height = finite(value.height);
    if (width === undefined || height === undefined || width <= 0 || height <= 0) return undefined;
    return { x, y, width, height };
}

/** The `fit` of a value; `contain` for anything else */
export const readFit = (value: JsonValue | undefined): Fit => ((FITS as readonly unknown[]).includes(value) ? (value as Fit) : 'contain');

/** The SVG `preserveAspectRatio` that draws a `fit` */
export function preserveAspectRatioOf(fit: Fit): string {
    if (fit === 'stretch') return 'none';
    return fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';
}

/** The scale and offset that put a `viewBox` into a box of `width` by `height` pixels by its `fit`, centred (as SVG's `xMidYMid`) */
export function fitViewBox(viewBox: ViewBox, width: number, height: number, fit: Fit): Viewport {
    let scaleX = width / viewBox.width;
    let scaleY = height / viewBox.height;
    if (fit !== 'stretch') {
        scaleX = scaleY = fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
    }
    return {
        scaleX,
        scaleY,
        offsetX: (width - viewBox.width * scaleX) / 2 - viewBox.x * scaleX,
        offsetY: (height - viewBox.height * scaleY) / 2 - viewBox.y * scaleY
    };
}

/** A point of the drawing's box in pixels to drawing units */
export function toDrawing(viewport: Viewport, px: number, py: number): PathPoint {
    return [(px - viewport.offsetX) / viewport.scaleX, (py - viewport.offsetY) / viewport.scaleY];
}

/** The product `m * n`: `n` applies first */
export function multiply(m: Matrix, n: Matrix): Matrix {
    return [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5]
    ];
}

/** The inverse of a matrix, or undefined when it has none (a scale of 0) */
export function invert(m: Matrix): Matrix | undefined {
    const det = m[0] * m[3] - m[1] * m[2];
    if (det === 0 || !Number.isFinite(det)) return undefined;
    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

export function applyMatrix(m: Matrix, x: number, y: number): PathPoint {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];

/** The `scale` of a shape: a number for both axes or `[sx, sy]`; 1 when unset */
function scaleOf(shape: ShapeTree): [number, number] {
    const value = shape.properties.scale;
    if (Array.isArray(value) && value.length === 2) return [finite(value[0]) ?? 1, finite(value[1]) ?? 1];
    const both = finite(value) ?? 1;
    return [both, both];
}

/**
 * The transform of a shape from its own coordinates to its parent's. In order: the `scale` and then the `rotate`
 * (degrees, clockwise on screen as SVG's `rotate`) about the `origin`, then the `x` and `y` offset. `origin` is
 * `[x, y]` in the shape's own coordinates and defaults to the centre of the shape's own bounds. `rect`, `drawText`
 * and `drawImage` take `x` and `y` as their position, so for them there is no offset
 */
export function transformOf(shape: ShapeTree): Matrix {
    const offset = POSITIONED.has(shape.kind) ? IDENTITY : translate(numberOf(shape, 'x'), numberOf(shape, 'y'));
    const rotate = numberOf(shape, 'rotate');
    const [sx, sy] = scaleOf(shape);
    if (rotate === 0 && sx === 1 && sy === 1) return offset;
    const [ox, oy] = originOf(shape);
    const radians = (rotate * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const turn: Matrix = [cos * sx, sin * sx, -sin * sy, cos * sy, 0, 0];
    return multiply(offset, multiply(translate(ox, oy), multiply(turn, translate(-ox, -oy))));
}

function originOf(shape: ShapeTree): PathPoint {
    const value = shape.properties.origin;
    if (Array.isArray(value) && value.length === 2) {
        const x = finite(value[0]);
        const y = finite(value[1]);
        if (x !== undefined && y !== undefined) return [x, y];
    }
    const own = localBounds(shape);
    return own === undefined ? [0, 0] : [own.x + own.width / 2, own.y + own.height / 2];
}

/** The `points` of a shape as finite `[x, y]` pairs; a pair that is not one is skipped */
export function pointsOf(shape: ShapeTree): PathPoint[] {
    const value = shape.properties.points;
    if (!Array.isArray(value)) return [];
    const points: PathPoint[] = [];
    for (const pair of value) {
        if (!Array.isArray(pair) || pair.length !== 2) continue;
        const x = finite(pair[0]);
        const y = finite(pair[1]);
        if (x !== undefined && y !== undefined) points.push([x, y]);
    }
    return points;
}

const flatCache = new WeakMap<ShapeTree, FlatSubpath[] | null>();

/** The flattened subpaths of a `path` shape's `d` (cached per tree entry), or undefined when `d` does not parse */
export function flatPathOf(shape: ShapeTree): FlatSubpath[] | undefined {
    const cached = flatCache.get(shape);
    if (cached !== undefined) return cached ?? undefined;
    const d = shape.properties.d;
    const parsed = typeof d === 'string' ? parsePathData(d) : undefined;
    const flat = parsed?.ok ? flattenPath(parsed.commands, PATH_TOLERANCE) : null;
    flatCache.set(shape, flat);
    return flat ?? undefined;
}

function boundsOfPoints(points: readonly PathPoint[]): Bounds | undefined {
    if (points.length === 0) return undefined;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of points) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The smallest box holding both; either may be missing */
export function unionBounds(a: Bounds | undefined, b: Bounds | undefined): Bounds | undefined {
    if (a === undefined) return b;
    if (b === undefined) return a;
    return boundsOfPoints([
        [a.x, a.y],
        [a.x + a.width, a.y + a.height],
        [b.x, b.y],
        [b.x + b.width, b.y + b.height]
    ]);
}

function intersectBounds(a: Bounds, b: Bounds): Bounds | undefined {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    return right < x || bottom < y ? undefined : { x, y, width: right - x, height: bottom - y };
}

/** The box of a matrix applied to a box */
export function transformBounds(m: Matrix, box: Bounds): Bounds {
    return boundsOfPoints([
        applyMatrix(m, box.x, box.y),
        applyMatrix(m, box.x + box.width, box.y),
        applyMatrix(m, box.x, box.y + box.height),
        applyMatrix(m, box.x + box.width, box.y + box.height)
    ])!;
}

/** The box of a `drawText`, estimated from its text length, `fontSize`, `anchor` (`start`, `middle`, `end`) and `baseline` */
function textBounds(shape: ShapeTree): Bounds {
    const size = sizeOf(shape, 'fontSize') ?? DEFAULT_TEXT_SIZE;
    const text = shape.properties._text;
    const width = (typeof text === 'string' ? text.length : 0) * size * TEXT_ADVANCE;
    const anchor = shape.properties.anchor;
    const baseline = shape.properties.baseline;
    const x = numberOf(shape, 'x') - (anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0);
    const top = numberOf(shape, 'y') - (baseline === 'hanging' ? 0 : baseline === 'middle' ? size / 2 : size * 0.8);
    return { x, y: top, width, height: size };
}

/**
 * The geometric bounds of a shape in its own coordinates (before its transform), stroke not included; undefined for a
 * shape that draws nothing (a missing size, unparsable path data, an empty group). A group's bounds hold its children's
 * (each through its own transform), cut by its `clip`. A `drawRepeat` has none here: its copies come from the row binder
 */
export function localBounds(shape: ShapeTree): Bounds | undefined {
    switch (shape.kind) {
        case 'rect':
        case 'drawImage': {
            const width = sizeOf(shape, 'width');
            const height = sizeOf(shape, 'height');
            if (width === undefined || height === undefined) return undefined;
            return { x: numberOf(shape, 'x'), y: numberOf(shape, 'y'), width, height };
        }
        case 'circle':
        case 'ellipse': {
            const rx = sizeOf(shape, shape.kind === 'circle' ? 'r' : 'rx');
            const ry = sizeOf(shape, shape.kind === 'circle' ? 'r' : 'ry');
            if (rx === undefined || ry === undefined) return undefined;
            return { x: numberOf(shape, 'cx') - rx, y: numberOf(shape, 'cy') - ry, width: 2 * rx, height: 2 * ry };
        }
        case 'line':
        case 'polyline':
        case 'polygon':
            return boundsOfPoints(pointsOf(shape));
        case 'path': {
            const d = shape.properties.d;
            const parsed = typeof d === 'string' ? parsePathData(d) : undefined;
            return parsed?.ok ? pathBounds(parsed.commands) : undefined;
        }
        case 'drawText':
            return textBounds(shape);
        case 'drawGroup': {
            let box: Bounds | undefined;
            for (const child of shape.children) box = unionBounds(box, shapeBounds(child));
            const clip = shape.clip === undefined ? undefined : shapeBounds(shape.clip);
            return box !== undefined && clip !== undefined ? intersectBounds(box, clip) : box;
        }
        case 'drawRepeat':
            return undefined;
    }
}

/** The bounds of a shape in its parent's coordinates: its own bounds through its transform */
export function shapeBounds(shape: ShapeTree): Bounds | undefined {
    const own = localBounds(shape);
    return own === undefined ? undefined : transformBounds(transformOf(shape), own);
}

/** The bounds of a whole tree in drawing units: what a drawing with no `viewBox` fits */
export function treeBounds(shapes: readonly ShapeTree[]): Bounds | undefined {
    let box: Bounds | undefined;
    for (const shape of shapes) box = unionBounds(box, shapeBounds(shape));
    return box;
}

/** The bounds in drawing units of the shape at a state path (through every ancestor's transform), or undefined */
export function boundsAt(shapes: readonly ShapeTree[], path: string): Bounds | undefined {
    const chain = locateShape(shapes, path);
    if (chain === undefined) return undefined;
    const own = localBounds(chain[chain.length - 1]);
    if (own === undefined) return undefined;
    let matrix = IDENTITY;
    for (const shape of chain) matrix = multiply(matrix, transformOf(shape));
    return transformBounds(matrix, own);
}

/** Half the stroke width a shape is hit-tested with */
const halfStroke = (shape: ShapeTree): number => (sizeOf(shape, 'strokeWidth') ?? DEFAULT_STROKE_WIDTH) / 2;

/** The distance from a point to the segment `a`–`b` */
function segmentDistance(x: number, y: number, a: PathPoint, b: PathPoint): number {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / length));
    return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

/** True when the point is within `reach` of the line through the points (closed back to the first one when `closed`) */
function nearOutline(x: number, y: number, points: readonly PathPoint[], closed: boolean, reach: number): boolean {
    if (points.length === 1) return Math.hypot(x - points[0][0], y - points[0][1]) <= reach;
    for (let i = 1; i < points.length; i++) {
        if (segmentDistance(x, y, points[i - 1], points[i]) <= reach) return true;
    }
    return closed && points.length > 2 && segmentDistance(x, y, points[points.length - 1], points[0]) <= reach;
}

/** The winding number of the closed outlines around a point; not zero means inside (the `nonzero` fill rule, SVG's default) */
function winding(x: number, y: number, outlines: readonly (readonly PathPoint[])[]): number {
    let total = 0;
    for (const points of outlines) {
        for (let i = 0; i < points.length; i++) {
            const a = points[i];
            const b = points[(i + 1) % points.length];
            if (a[1] <= y) {
                if (b[1] > y && (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]) > 0) total++;
            } else if (b[1] <= y && (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]) < 0) {
                total--;
            }
        }
    }
    return total;
}

/** True when a point in a rectangle's own coordinates is inside it grown by `grow`, with corners of `radius` */
function inRoundedRect(x: number, y: number, box: Bounds, radius: number, grow: number): boolean {
    const left = box.x - grow;
    const top = box.y - grow;
    const right = box.x + box.width + grow;
    const bottom = box.y + box.height + grow;
    if (x < left || x > right || y < top || y > bottom) return false;
    const r = radius > 0 ? Math.min(radius, box.width / 2, box.height / 2) + grow : 0;
    if (r <= 0) return true;
    const cx = Math.min(Math.max(x, left + r), right - r);
    const cy = Math.min(Math.max(y, top + r), bottom - r);
    return Math.hypot(x - cx, y - cy) <= r;
}

/**
 * True when a point in a shape's own coordinates (after its transform is undone) is on the shape: inside a closed
 * shape or within half its `strokeWidth` (default 1) of its outline; for `line` and `polyline` only the latter. A
 * group is hit through its children (and its `clip`), see `hitTest`
 */
export function hitLocal(shape: ShapeTree, x: number, y: number): boolean {
    const half = halfStroke(shape);
    switch (shape.kind) {
        case 'rect':
        case 'drawImage': {
            const box = localBounds(shape);
            return box !== undefined && inRoundedRect(x, y, box, shape.kind === 'rect' ? numberOf(shape, 'radius') : 0, shape.kind === 'rect' ? half : 0);
        }
        case 'drawText': {
            const box = localBounds(shape);
            return box !== undefined && inRoundedRect(x, y, box, 0, 0);
        }
        case 'circle':
        case 'ellipse': {
            const rx = sizeOf(shape, shape.kind === 'circle' ? 'r' : 'rx');
            const ry = sizeOf(shape, shape.kind === 'circle' ? 'r' : 'ry');
            if (rx === undefined || ry === undefined) return false;
            const dx = (x - numberOf(shape, 'cx')) / (rx + half);
            const dy = (y - numberOf(shape, 'cy')) / (ry + half);
            return dx * dx + dy * dy <= 1;
        }
        case 'line':
        case 'polyline':
            return nearOutline(x, y, pointsOf(shape), false, half);
        case 'polygon': {
            const points = pointsOf(shape);
            return winding(x, y, [points]) !== 0 || nearOutline(x, y, points, true, half);
        }
        case 'path': {
            const flat = flatPathOf(shape);
            if (flat === undefined) return false;
            // Every subpath fills as if closed, as SVG fills an open one; only a closed one strokes its closing segment
            if (winding(x, y, flat.map((sub) => sub.points)) !== 0) return true;
            return flat.some((sub) => nearOutline(x, y, sub.points, sub.closed, half));
        }
        case 'drawGroup':
        case 'drawRepeat':
            return false;
    }
}

/** The shapes from the top-level one down to the topmost leaf drawn at a point (in the parent's coordinates), or undefined */
function topmost(shapes: readonly ShapeTree[], x: number, y: number): ShapeTree[] | undefined {
    for (let i = shapes.length - 1; i >= 0; i--) {
        const shape = shapes[i];
        const inverse = invert(transformOf(shape));
        if (inverse === undefined) continue;
        const [lx, ly] = applyMatrix(inverse, x, y);
        if (shape.kind === 'drawGroup') {
            if (shape.clip !== undefined && topmost([shape.clip], lx, ly) === undefined) continue;
            const inner = topmost(shape.children, lx, ly);
            if (inner !== undefined) return [shape, ...inner];
        } else if (hitLocal(shape, lx, ly)) {
            return [shape];
        }
    }
    return undefined;
}

export interface HitOptions {
    /**
     * When true, the result is the nearest shape with `interactive: true` from the topmost shape at the point up through
     * its groups, as a pointer event on an SVG element reaches the closest interactive one; a shape on top that is not
     * interactive, and has no interactive group, hides the shapes below it
     */
    readonly interactive?: boolean;
}

/** The topmost shape at a point in drawing units, later shapes on top of earlier ones as they are drawn; undefined when none */
export function hitTest(shapes: readonly ShapeTree[], x: number, y: number, options: HitOptions = {}): ShapeTree | undefined {
    const chain = topmost(shapes, x, y);
    if (chain === undefined) return undefined;
    if (!options.interactive) return chain[chain.length - 1];
    for (let i = chain.length - 1; i >= 0; i--) {
        if (chain[i].properties.interactive === true) return chain[i];
    }
    return undefined;
}
