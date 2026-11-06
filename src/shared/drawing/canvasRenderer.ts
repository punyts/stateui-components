import { IDENTITY, boundsAt, fitViewBox, hitTest, localBounds, multiply, readFit, readViewBox, toDrawing, transformBounds, transformOf } from './geometry.js';
import type { Bounds, Matrix, ViewBox, Viewport } from './geometry.js';
import { buildPath } from './canvasPath.js';
import { createShapeDrag, dragAxes } from './drag.js';
import { createPaintResolver, placeGradient } from './paint.js';
import type { Paint, PaintResolver } from './paint.js';
import { registerDrawingRenderer } from './render.js';
import type { DrawingIssue, DrawingRenderer, DrawingRendererOptions, ShapeEventName } from './render.js';
import { ANCHORS, BASELINES, CAPS, JOINS, ShapeReader, Unusable, contentBox } from './shapeReader.js';
import type { ShapeTree } from './tree.js';

/** The highest pixel ratio the bitmap is drawn at; a denser screen scales it up */
export const MAX_PIXEL_RATIO = 2;

/** The canvas `textAlign` of each `anchor` (left to right, as SVG's `text-anchor` in a left-to-right page) */
const ALIGN: Readonly<Record<(typeof ANCHORS)[number], CanvasTextAlign>> = { start: 'left', middle: 'center', end: 'right' };

/** What a shape paints with after its own values and those it inherits from its groups, as SVG inherits them */
interface Style {
    /** The fill; `current` is the text colour, which a shape with no fill anywhere up its groups gets (SVG's `currentColor`) */
    readonly fill: Paint | 'current';
    readonly stroke: Paint;
    readonly strokeWidth: number;
    readonly dash: readonly number[];
    readonly cap: CanvasLineCap;
    readonly join: CanvasLineJoin;
    /** The product of the `opacity` of the shape and its groups */
    readonly opacity: number;
}

const ROOT_STYLE: Style = { fill: 'current', stroke: { kind: 'none' }, strokeWidth: 1, dash: [], cap: 'butt', join: 'miter', opacity: 1 };

/** What one draw reads from the canvas's computed style, once */
interface DrawContext {
    readonly ctx: CanvasRenderingContext2D;
    /** The text colour (`currentColor`) */
    readonly color: string;
    /** The page font, for a `drawText` with no `font` or one that does not resolve */
    readonly fontFamily: string;
    readonly fontSize: number;
    /** Reads a custom property, cached for the draw */
    readonly read: (name: string) => string | undefined;
}

/** A canvas renderer can also draw at once, for a test that times a draw */
export interface CanvasDrawingRenderer extends DrawingRenderer {
    /** The canvas it draws into */
    readonly canvas: HTMLCanvasElement;
    /** Draws now when an update or a resize is waiting, instead of in the next frame */
    paint(): void;
}

/**
 * One `requestAnimationFrame` per window draws every canvas drawing that changed since the last frame: an update marks
 * its renderer dirty and asks for the frame only when none is asked for yet, so any number of state changes in one
 * frame draw once, and a drawing that did not change does not draw
 */
const frames = new WeakMap<Window, { dirty: Set<() => void>; requested: boolean }>();

function schedule(view: Window, paint: () => void): void {
    let frame = frames.get(view);
    if (frame === undefined) {
        frame = { dirty: new Set(), requested: false };
        frames.set(view, frame);
    }
    frame.dirty.add(paint);
    if (frame.requested) return;
    frame.requested = true;
    const pending = frame;
    view.requestAnimationFrame(() => {
        pending.requested = false;
        const due = [...pending.dirty];
        pending.dirty.clear();
        for (const run of due) run();
    });
}

function unschedule(view: Window | null, paint: () => void): void {
    if (view !== null) frames.get(view)?.dirty.delete(paint);
}

/** True for a shape attribute a proxy carries: `role`, `tabindex` and `data-*` (not the renderer's own `data-shape-*`) */
const isProxyAttr = (name: string): boolean => name === 'role' || name === 'tabindex' || (name.startsWith('data-') && !name.startsWith('data-shape-'));

/**
 * Writes the proxy attributes of a shape's `attrs` (G2.3: the chart's marks keep `role`, the roving `tabindex` and
 * their `data-*` on canvas) to its proxy, only those that changed since the last write, as the SVG renderer writes
 * `attrs`, so a value the feeder set on the element itself (the chart's tab stop) stays until the tree changes it.
 * Gives back what was written
 */
function writeProxyAttrs(element: Element, written: Readonly<Record<string, string>>, attrs: Readonly<Record<string, string>> | undefined): Readonly<Record<string, string>> {
    const next: Record<string, string> = {};
    for (const [name, value] of Object.entries(attrs ?? {})) {
        if (!isProxyAttr(name)) continue;
        next[name] = value;
        if (written[name] !== value) element.setAttribute(name, value);
    }
    for (const name of Object.keys(written)) if (!(name in next)) element.removeAttribute(name);
    return next;
}

/** True when a shape of the tree (inside groups and repeats too) can be dragged (G1.7b) */
const hasDraggable = (shapes: readonly ShapeTree[]): boolean => shapes.some((shape) => dragAxes(shape).length > 0 || hasDraggable(shape.children));

const isIdentity = (m: Matrix): boolean => m.every((value, index) => Math.abs(value - IDENTITY[index]!) < 1e-12);

/** The geometry of one leaf shape, read and checked */
type Geometry =
    | { readonly kind: 'path'; readonly path: Path2D | undefined; readonly closed: boolean }
    | { readonly kind: 'text'; readonly text: string; readonly x: number; readonly y: number; readonly align: CanvasTextAlign; readonly baseline: CanvasTextBaseline; readonly fontProperty?: string; readonly fontSize?: number };

/**
 * The canvas renderer (G1.6 of the graphics epic 1). It draws the same shape tree as the SVG renderer into a `canvas`
 * it adds to `target` (class `canvas`), with the 2D context: every shape kind but `drawImage` (G1.9b), paint (colours,
 * tokens, the linear and radial gradients of `paints`), `strokeWidth`, `dash`, `cap`, `join`, `opacity`, a group's
 * `clip`, the transforms of `geometry.ts` and the `anchor` and `baseline` of text. A `path` is a `Path2D` built from the
 * parsed command list (`buildPath`), never from the raw string. A group's paint reaches its shapes as in SVG, and a
 * shape with no fill anywhere is drawn in the text colour. A `drawRepeat` draws its copies (its `children` as
 * `expandRepeats` binds them, capped at 20,000) directly, with no element or store entry per record.
 *
 * The bitmap is sized from the canvas's own `ResizeObserver` entry (never from a layout read) at `devicePixelRatio`,
 * at most 2, and a resize draws again at once. Token colours and fonts are read from the canvas's computed style once
 * per draw, so the redraw the feeder asks for on a theme or mode switch recolours the bitmap. `update` draws in the next
 * animation frame, shared by every canvas drawing of the page, so many updates in one frame draw once. A shape with a
 * value it cannot draw is left out and reported once (`SUI-RUN-DRAW`) as in SVG, and so is a canvas that gives no 2D
 * context (reported once under the feeder's `path`). `hit` and `boundsOf` answer from
 * `geometry.ts`, as the SVG renderer does.
 *
 * Events (G1.7c): each interactive shape (not hidden) gets a proxy `button` in a layer the renderer adds before the
 * canvas (class `proxies`), in drawing order, with `data-shape-path`, `data-shape-kind` and `aria-label` from `_label`,
 * kept in step with the tree (added, removed and moved, never recreated). A proxy also carries the shape's `role`,
 * `tabindex` and `data-*` `attrs` (written when they change, as SVG writes them), so a feeder's marks keep their role,
 * roving tab stop and data on canvas (G2.3, the chart); its other `attrs` are ignored. Each is placed over the shape's bounds in CSS
 * pixels (cut to the canvas) with `opacity: 0` and `pointer-events: none`, so it has a real box that `ui_interact`
 * measures, a screen reader and the tab order reach it, and `elementOf` gives it. A click on a proxy (`element.click()`)
 * or Enter or Space on a focused one is `press` at the shape's centre (held keys do not repeat it). A pointer click on
 * the canvas is `press` for the shape `hit()` finds there, which passes through shapes that are not interactive as the
 * SVG renderer does; the pointer entering an interactive shape is `hover`, once per entry. A shape left out of the last draw
 * raises nothing and its proxy is hidden. Every value is set through the CSSOM, never a `style` attribute.
 *
 * Drag (G1.7b, `createShapeDrag` of `drag.ts`, as in SVG): a press on a draggable interactive shape captures the
 * pointer on the canvas; the shape (and its proxy) is drawn where the pointer takes it in the next frame, nothing is
 * written, and the release hands the new `x` and `y` to `onMove` and raises `dragEnd`. Escape or a pointer cancel puts
 * it back; the arrow keys move a focused proxy's shape by `step` (Shift ten)
 */
export function createCanvasRenderer(target: Element, options: DrawingRendererOptions): CanvasDrawingRenderer {
    const document = target.ownerDocument;
    const view = document.defaultView;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('class', 'canvas');
    // The proxies sit in a layer of no height right before the canvas, so a proxy's offset is from the canvas's corner
    const layer = document.createElement('div');
    layer.setAttribute('class', 'proxies');
    layer.style.position = 'relative';
    layer.style.blockSize = '0';
    layer.style.margin = '0';
    target.append(layer, canvas);

    const reported = new Set<string>();
    let tree: readonly ShapeTree[] = [];
    let disposed = false;
    let dirty = false;
    /** The canvas's size in CSS pixels from its last `ResizeObserver` entry; undefined until the first one */
    let size: { width: number; height: number } | undefined;
    /** Frames that passed with an update waiting and no size yet */
    let unsizedFrames = 0;
    /** The `drawn()` promises waiting for the next draw */
    let waiters: (() => void)[] = [];
    /** The proxy button of each interactive shape of the last update, by path, and what was written to it */
    const proxies = new Map<string, { element: HTMLButtonElement; label: string; box: string; hidden: boolean; attrs: Readonly<Record<string, string>> }>();
    const proxyPaths = new WeakMap<Element, string>();
    /** The interactive shapes the last draw drew, by path: the only ones that raise events */
    let shown = new Set<string>();
    /** The path of the interactive shape the pointer is in, so `hover` fires once per entry */
    let hovered: string | undefined;

    const issue = (problem: DrawingIssue): void => {
        const key = 'reason' in problem ? `${problem.path}\u0000${problem.reason}` : `${problem.code}\u0000${problem.path}\u0000${problem.value}`;
        if (reported.has(key)) return;
        reported.add(key);
        try {
            options.onIssue?.(problem);
        } catch {
            // A failing reporter must not stop a drawing
        }
    };

    const paintsPath = options.path === undefined ? 'paints' : `${options.path}.paints`;
    const resolver: PaintResolver = createPaintResolver({ paints: options.readProperty('paints'), paintsPath, onIssue: issue });

    const settle = (): void => {
        const done = waiters;
        waiters = [];
        for (const resolve of done) resolve();
    };

    /** Sets the paint of a shape as the fill or stroke style; false when there is nothing to paint */
    const usePaint = (draw: DrawContext, paint: Paint | 'current', bounds: Bounds | undefined, as: 'fillStyle' | 'strokeStyle'): boolean | 'radial' => {
        const { ctx } = draw;
        if (paint === 'current') {
            ctx[as] = draw.color;
            return true;
        }
        if (paint.kind === 'none') return false;
        if (paint.kind === 'color') {
            if (paint.computed === undefined) return false;
            ctx[as] = paint.computed;
            return true;
        }
        if (bounds === undefined || bounds.width <= 0 || bounds.height <= 0) return false;
        const placed = placeGradient(paint.gradient, bounds);
        let gradient: CanvasGradient;
        if (placed.kind === 'linear') gradient = ctx.createLinearGradient(placed.x1, placed.y1, placed.x2, placed.y2);
        else if (placed.rx === placed.ry || as === 'strokeStyle') {
            const r = Math.max(placed.rx, placed.ry);
            gradient = ctx.createRadialGradient(placed.cx, placed.cy, 0, placed.cx, placed.cy, r);
        } else {
            // An elliptical gradient: the caller fills through a clip in the scaled space (see `fillRadial`)
            return 'radial';
        }
        for (const stop of paint.gradient.stops) if (stop.color.computed !== undefined) gradient.addColorStop(stop.offset, stop.color.computed);
        ctx[as] = gradient;
        return true;
    };

    /** Fills `path` with an elliptical radial gradient: clipped to the path, the gradient drawn in a space scaled to its radii */
    const fillRadial = (draw: DrawContext, paint: Paint, path: Path2D, bounds: Bounds): void => {
        if (paint.kind !== 'gradient') return;
        const placed = placeGradient(paint.gradient, bounds);
        if (placed.kind !== 'radial' || placed.rx <= 0 || placed.ry <= 0) return;
        const { ctx } = draw;
        ctx.save();
        ctx.clip(path);
        ctx.transform(placed.rx, 0, 0, placed.ry, placed.cx, placed.cy);
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        for (const stop of paint.gradient.stops) if (stop.color.computed !== undefined) gradient.addColorStop(stop.offset, stop.color.computed);
        ctx.fillStyle = gradient;
        ctx.fillRect((bounds.x - placed.cx) / placed.rx, (bounds.y - placed.cy) / placed.ry, bounds.width / placed.rx, bounds.height / placed.ry);
        ctx.restore();
    };

    /** The style of a shape: its own paint values over the inherited ones; throws `Unusable` for a value it cannot draw */
    const styleOf = (shape: ShapeTree, read: ShapeReader, inherited: Style): Style => {
        let { fill, stroke } = inherited;
        const ownFill = shape.properties.fill;
        if (ownFill !== undefined && ownFill !== null && ownFill !== '') fill = resolver.resolve(ownFill, shape.path, 'fill');
        const ownStroke = shape.properties.stroke;
        if (ownStroke !== undefined && ownStroke !== null && ownStroke !== '') stroke = resolver.resolve(ownStroke, shape.path, 'stroke');
        const strokeWidth = read.number('strokeWidth', 0) ?? inherited.strokeWidth;
        const opacity = Math.min(1, read.number('opacity', 0) ?? 1) * inherited.opacity;
        const dash = read.numbers('dash') ?? (shape.properties.dash === undefined || shape.properties.dash === null ? inherited.dash : []);
        const cap = read.word('cap', CAPS) ?? inherited.cap;
        const join = read.word('join', JOINS) ?? inherited.join;
        return { fill, stroke, strokeWidth, dash, cap, join, opacity };
    };

    /**
     * The outline of a shape in its own coordinates as a `Path2D` (a group's is its children's, each through its own
     * transform), or undefined when it draws nothing; throws `Unusable` for a value it cannot draw. Text has no outline
     */
    const outlineOf = (shape: ShapeTree, read: ShapeReader): { path: Path2D | undefined; closed: boolean } => {
        const path = new Path2D();
        switch (shape.kind) {
            case 'rect': {
                const x = read.number('x') ?? 0;
                const y = read.number('y') ?? 0;
                const width = read.number('width', 0);
                const height = read.number('height', 0);
                const radius = read.number('radius', 0) ?? 0;
                if (width === undefined || height === undefined || width === 0 || height === 0) return { path: undefined, closed: true };
                const r = Math.min(radius, width / 2, height / 2);
                if (r > 0) path.roundRect(x, y, width, height, r);
                else path.rect(x, y, width, height);
                return { path, closed: true };
            }
            case 'circle':
            case 'ellipse': {
                const cx = read.number('cx') ?? 0;
                const cy = read.number('cy') ?? 0;
                const rx = read.number(shape.kind === 'circle' ? 'r' : 'rx', 0);
                const ry = shape.kind === 'circle' ? rx : read.number('ry', 0);
                if (rx === undefined || ry === undefined || rx === 0 || ry === 0) return { path: undefined, closed: true };
                path.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
                return { path, closed: true };
            }
            case 'line':
            case 'polyline':
            case 'polygon': {
                const points = read.points('points', shape.kind === 'line' ? 2 : undefined);
                if (points === undefined || points.length === 0) return { path: undefined, closed: false };
                points.forEach(([x, y], index) => (index === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
                if (shape.kind === 'polygon') path.closePath();
                return { path, closed: shape.kind === 'polygon' };
            }
            case 'path': {
                const commands = read.pathCommands('d');
                if (commands === undefined) return { path: undefined, closed: false };
                buildPath(commands, path);
                return { path, closed: false };
            }
            case 'drawGroup':
            case 'drawRepeat': {
                let any = false;
                for (const child of shape.children) {
                    if (child.properties.hidden === true || child.kind === 'drawImage' || child.kind === 'drawText') continue;
                    const inner = outlineOf(child, new ShapeReader(child));
                    if (inner.path === undefined) continue;
                    const m = transformOf(child);
                    path.addPath(inner.path, new DOMMatrix([m[0], m[1], m[2], m[3], m[4], m[5]]));
                    any = true;
                }
                return { path: any ? path : undefined, closed: true };
            }
            case 'drawText':
            case 'drawImage':
                return { path: undefined, closed: false };
        }
    };

    /** The geometry of a leaf shape; throws `Unusable` */
    const geometryOf = (shape: ShapeTree, read: ShapeReader): Geometry => {
        read.transform();
        if (shape.kind !== 'drawText') {
            const { path, closed } = outlineOf(shape, read);
            return { kind: 'path', path, closed };
        }
        const text = read.text('_text');
        const align = ALIGN[read.word('anchor', ANCHORS) ?? 'start'];
        const baseline = read.word('baseline', BASELINES) ?? 'alphabetic';
        const fontProperty = read.fontProperty('font');
        const fontSize = read.number('fontSize', 0);
        return { kind: 'text', text, x: read.number('x') ?? 0, y: read.number('y') ?? 0, align, baseline, fontProperty, fontSize };
    };

    /** Draws a leaf shape in its own coordinates (its transform already applied) */
    const drawLeaf = (draw: DrawContext, shape: ShapeTree, geometry: Geometry, style: Style): void => {
        const { ctx } = draw;
        if (style.opacity <= 0) return;
        ctx.globalAlpha = style.opacity;
        const bounds = localBounds(shape);
        const stroking = style.stroke.kind !== 'none' && style.strokeWidth > 0;
        if (stroking) {
            ctx.lineWidth = style.strokeWidth;
            ctx.setLineDash(style.dash as number[]);
            ctx.lineCap = style.cap;
            ctx.lineJoin = style.join;
        }
        if (geometry.kind === 'text') {
            if (geometry.text === '') return;
            const family = (geometry.fontProperty === undefined ? undefined : draw.read(geometry.fontProperty)) || draw.fontFamily;
            ctx.font = `${geometry.fontSize ?? draw.fontSize}px ${family}`;
            ctx.textAlign = geometry.align;
            ctx.textBaseline = geometry.baseline;
            if (usePaint(draw, style.fill, bounds, 'fillStyle') === true) ctx.fillText(geometry.text, geometry.x, geometry.y);
            if (stroking && usePaint(draw, style.stroke, bounds, 'strokeStyle') === true) ctx.strokeText(geometry.text, geometry.x, geometry.y);
            return;
        }
        const { path } = geometry;
        if (path === undefined) return;
        const fill = usePaint(draw, style.fill, bounds, 'fillStyle');
        if (fill === true) ctx.fill(path);
        else if (fill === 'radial' && bounds !== undefined && style.fill !== 'current') fillRadial(draw, style.fill, path, bounds);
        if (stroking && usePaint(draw, style.stroke, bounds, 'strokeStyle') === true) ctx.stroke(path);
    };

    /** Draws shapes in order, each through its transform; a group's or repeat's children inherit its paint */
    const drawShapes = (draw: DrawContext, shapes: readonly ShapeTree[], inherited: Style): void => {
        const { ctx } = draw;
        for (const shape of shapes) {
            // A hidden shape (the shared `hidden`) is left out like a removed one; drawImage is drawn by G1.9b
            if (shape.kind === 'drawImage' || shape.properties.hidden === true) continue;
            const read = new ShapeReader(shape);
            let style: Style;
            let geometry: Geometry | undefined;
            try {
                if (shape.kind === 'drawGroup' || shape.kind === 'drawRepeat') read.transform();
                else geometry = geometryOf(shape, read);
                style = styleOf(shape, read, inherited);
            } catch (error) {
                if (!(error instanceof Unusable)) throw error;
                issue({ code: 'SUI-RUN-DRAW', path: shape.path, reason: `${error.message}, so the shape is not drawn` });
                continue;
            }
            if (shape.properties.interactive === true) shown.add(shape.path);
            const matrix = transformOf(shape);
            const moved = !isIdentity(matrix);
            ctx.save();
            if (moved) ctx.transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
            if (geometry !== undefined) drawLeaf(draw, shape, geometry, style);
            else {
                if (shape.clip !== undefined) clipTo(draw, shape.clip);
                drawShapes(draw, shape.children, style);
            }
            ctx.restore();
        }
    };

    /** Clips to a group's clip shape (through its own transform); a clip that cannot be drawn is reported and does not clip, as in SVG */
    const clipTo = (draw: DrawContext, clip: ShapeTree): void => {
        if (clip.properties.hidden === true || clip.kind === 'drawImage' || clip.kind === 'drawText') return;
        const read = new ShapeReader(clip);
        let outline: Path2D | undefined;
        try {
            read.transform();
            outline = outlineOf(clip, read).path;
            styleOf(clip, read, ROOT_STYLE);
        } catch (error) {
            if (!(error instanceof Unusable)) throw error;
            issue({ code: 'SUI-RUN-DRAW', path: clip.path, reason: `${error.message}, so the shape is not drawn` });
            return;
        }
        const m = transformOf(clip);
        const path = new Path2D();
        if (outline !== undefined) path.addPath(outline, new DOMMatrix([m[0], m[1], m[2], m[3], m[4], m[5]]));
        // An empty clip shape hides the whole group, as an empty clipPath does
        draw.ctx.clip(path);
    };

    /** The drawing units to CSS pixels: the caller's `viewBox`, the `viewBox` property, or the tree's bounds, by `fit` */
    const viewportOf = (width: number, height: number): Viewport => {
        const box: ViewBox | undefined = options.viewBox ?? readViewBox(options.readProperty('viewBox')) ?? contentBox(tree);
        if (box === undefined) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
        return fitViewBox(box, width, height, readFit(options.readProperty('fit')));
    };

    /** Draws the tree now at the canvas's size and pixel ratio, and resolves what waits for it */
    const draw = (): void => {
        if (disposed || size === undefined) return;
        dirty = false;
        unsizedFrames = 0;
        const ratio = Math.min(view?.devicePixelRatio || 1, MAX_PIXEL_RATIO);
        const width = Math.max(0, Math.round(size.width * ratio));
        const height = Math.max(0, Math.round(size.height * ratio));
        // Setting a size clears the bitmap, so it is set only when it changes
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx === null) {
            // Without a context nothing can be drawn; said once, so the feeder reports it instead of showing a silent blank
            issue({ code: 'SUI-RUN-DRAW', path: options.path ?? '', reason: 'the browser gives no 2D canvas context, so nothing is drawn' });
            settle();
            return;
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, width, height);
        const style = view?.getComputedStyle(canvas);
        const tokens = new Map<string, string | undefined>();
        const read = (name: string): string | undefined => {
            if (tokens.has(name)) return tokens.get(name);
            const value = style?.getPropertyValue(name).trim() || undefined;
            tokens.set(name, value);
            return value;
        };
        resolver.update({ paints: options.readProperty('paints'), paintsPath, read });
        shown = new Set();
        if (width > 0 && height > 0) {
            const viewport = viewportOf(size.width, size.height);
            ctx.setTransform(viewport.scaleX * ratio, 0, 0, viewport.scaleY * ratio, viewport.offsetX * ratio, viewport.offsetY * ratio);
            const fontSize = Number.parseFloat(style?.fontSize ?? '');
            drawShapes(
                {
                    ctx,
                    color: style?.color || '#000',
                    fontFamily: style?.fontFamily || 'sans-serif',
                    fontSize: Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 16,
                    read
                },
                tree,
                ROOT_STYLE
            );
        }
        placeProxies();
        settle();
    };

    /**
     * Makes, removes and orders the proxy buttons to follow the interactive shapes of the tree (not hidden, not
     * `drawImage`, which is not drawn yet), in drawing order: a group before the shapes inside it
     */
    const syncProxies = (): void => {
        const wanted: ShapeTree[] = [];
        const collect = (shapes: readonly ShapeTree[]): void => {
            for (const shape of shapes) {
                if (shape.properties.hidden === true || shape.kind === 'drawImage') continue;
                if (shape.properties.interactive === true) wanted.push(shape);
                collect(shape.children);
            }
        };
        collect(tree);
        const paths = new Set(wanted.map((shape) => shape.path));
        for (const [path, proxy] of proxies) {
            if (paths.has(path)) continue;
            proxy.element.remove();
            proxies.delete(path);
        }
        let previous: ChildNode | null = null;
        for (const shape of wanted) {
            let proxy = proxies.get(shape.path);
            if (proxy === undefined) {
                const element = document.createElement('button');
                element.type = 'button';
                const style = element.style;
                style.position = 'absolute';
                style.margin = '0';
                style.padding = '0';
                style.border = '0';
                style.boxSizing = 'border-box';
                style.opacity = '0';
                style.pointerEvents = 'none';
                element.setAttribute('data-shape-path', shape.path);
                proxyPaths.set(element, shape.path);
                proxy = { element, label: '', box: '', hidden: false, attrs: {} };
                proxies.set(shape.path, proxy);
            }
            const { element } = proxy;
            proxy.attrs = writeProxyAttrs(element, proxy.attrs, shape.attrs);
            if (element.getAttribute('data-shape-kind') !== shape.kind) element.setAttribute('data-shape-kind', shape.kind);
            const label = typeof shape.properties._label === 'string' ? shape.properties._label : '';
            if (proxy.label !== label) {
                if (label === '') element.removeAttribute('aria-label');
                else element.setAttribute('aria-label', label);
                proxy.label = label;
            }
            const expected: ChildNode | null = previous === null ? layer.firstChild : previous.nextSibling;
            if (expected !== element) layer.insertBefore(element, expected);
            previous = element;
        }
    };

    /** Puts each proxy over its shape's bounds in CSS pixels (cut to the canvas), and hides one whose shape was not drawn */
    const placeProxies = (): void => {
        if (proxies.size === 0 || size === undefined) return;
        const viewport = viewportOf(size.width, size.height);
        const { width, height } = size;
        const clampX = (x: number): number => Math.min(width, Math.max(0, x * viewport.scaleX + viewport.offsetX));
        const clampY = (y: number): number => Math.min(height, Math.max(0, y * viewport.scaleY + viewport.offsetY));
        const walk = (shapes: readonly ShapeTree[], matrix: Matrix): void => {
            for (const shape of shapes) {
                if (shape.properties.hidden === true) continue;
                const own = multiply(matrix, transformOf(shape));
                const proxy = proxies.get(shape.path);
                if (proxy !== undefined) {
                    const local = localBounds(shape);
                    const bounds = local === undefined ? undefined : transformBounds(own, local);
                    const hidden = bounds === undefined || !shown.has(shape.path);
                    if (proxy.hidden !== hidden) {
                        proxy.element.hidden = hidden;
                        proxy.hidden = hidden;
                    }
                    if (bounds !== undefined) {
                        const left = clampX(bounds.x);
                        const top = clampY(bounds.y);
                        const right = clampX(bounds.x + bounds.width);
                        const bottom = clampY(bounds.y + bounds.height);
                        const box = `${left} ${top} ${right} ${bottom}`;
                        if (proxy.box !== box) {
                            const style = proxy.element.style;
                            style.left = `${left}px`;
                            style.top = `${top}px`;
                            style.width = `${right - left}px`;
                            style.height = `${bottom - top}px`;
                            proxy.box = box;
                        }
                    }
                }
                walk(shape.children, own);
            }
        };
        walk(tree, IDENTITY);
    };

    /** The shape at a path in the current tree */
    const locate = (path: string): ShapeTree | undefined => {
        let shapes = tree;
        for (;;) {
            const next = shapes.find((shape) => shape.path === path || path.startsWith(`${shape.path}.`));
            if (next === undefined || next.path === path) return next;
            shapes = next.children;
        }
    };

    /** The centre of a shape in drawing units, the position of a press on its proxy */
    const centreOf = (path: string): { x: number; y: number } => {
        const box = boundsAt(tree, path);
        return box === undefined ? { x: 0, y: 0 } : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };

    const raise = (name: ShapeEventName, shape: ShapeTree, at: { x: number; y: number }): void => {
        options.onEvent({ name, shape: shape.path, key: shape.key, x: at.x, y: at.y });
    };

    /** The interactive shape under the pointer (as `hit` finds it, drawn in the last draw) and the point in drawing units */
    const atPointer = (event: MouseEvent): { shape: ShapeTree; x: number; y: number } | undefined => {
        if (disposed || size === undefined) return undefined;
        const rect = canvas.getBoundingClientRect();
        const [x, y] = toDrawing(viewportOf(size.width, size.height), event.clientX - rect.left, event.clientY - rect.top);
        const shape = hitTest(tree, x, y, { interactive: true });
        return shape === undefined || !shown.has(shape.path) ? undefined : { shape, x, y };
    };

    /** Drags (G1.7b): the tree with the dragged shape moved is drawn in the next frame, its proxy placed with it */
    const drag = createShapeDrag({
        options,
        toDrawing(event) {
            if (size === undefined) return { x: 0, y: 0 };
            const rect = canvas.getBoundingClientRect();
            const [x, y] = toDrawing(viewportOf(size.width, size.height), event.clientX - rect.left, event.clientY - rect.top);
            return { x, y };
        },
        show(next) {
            if (disposed) return;
            tree = next;
            dirty = true;
            if (view !== null) schedule(view, onFrame);
        }
    });

    /** A press on a draggable interactive shape under the pointer may start a drag (the pointer is captured on the canvas) */
    const onDown = (event: PointerEvent): void => {
        const found = atPointer(event);
        if (found !== undefined) drag.pointerDown(event, found.shape, canvas, canvas);
    };

    /** A pointer click on the canvas is a press of the interactive shape under it; nothing on empty space */
    const onCanvasClick = (event: MouseEvent): void => {
        if (drag.swallowClick()) return;
        const found = atPointer(event);
        if (found !== undefined) raise('press', found.shape, found);
    };

    /** The pointer moved: `hover` when that puts it in an interactive shape it was not in */
    const onMove = (event: PointerEvent): void => {
        const found = atPointer(event);
        canvas.style.cursor = found === undefined ? '' : options.onMove !== undefined && dragAxes(found.shape).length > 0 ? 'move' : 'pointer';
        if (found?.shape.path === hovered) return;
        hovered = found?.shape.path;
        if (found !== undefined) raise('hover', found.shape, found);
    };

    const onLeave = (): void => {
        hovered = undefined;
        canvas.style.cursor = '';
    };

    /** The shape of the proxy an event came from, when it is an interactive shape the last draw drew */
    const proxyShape = (event: Event): ShapeTree | undefined => {
        const path = event.target instanceof Element ? proxyPaths.get(event.target) : undefined;
        if (disposed || path === undefined || !proxies.has(path) || !shown.has(path)) return undefined;
        return locate(path);
    };

    /** A click on a proxy (an element-level click, since a proxy takes no pointer events) is a press at the shape's centre */
    const onProxyClick = (event: MouseEvent): void => {
        const shape = proxyShape(event);
        if (shape !== undefined) raise('press', shape, centreOf(shape.path));
    };

    /** Enter and Space on a focused proxy are a press, once per key press (held keys do not repeat it) */
    const onProxyKey = (event: KeyboardEvent): void => {
        const shape = proxyShape(event);
        if (shape === undefined) return;
        // The arrow keys move a draggable shape
        if (drag.key(event, shape)) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        // The button's own activation would click it too (and Enter repeats while held), so the key is handled here alone
        event.preventDefault();
        if (!event.repeat) raise('press', shape, centreOf(shape.path));
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('click', onCanvasClick);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    layer.addEventListener('click', onProxyClick);
    layer.addEventListener('keydown', onProxyKey);

    /** The frame of a waiting update: draws when the canvas has a size; with none after two frames (not laid out) it stops waiting */
    const onFrame = (): void => {
        if (disposed || !dirty) return;
        if (size !== undefined) {
            draw();
            return;
        }
        unsizedFrames += 1;
        if (unsizedFrames >= 2) settle();
        else if (view !== null) schedule(view, onFrame);
    };

    const observer =
        view !== null && typeof view.ResizeObserver === 'function'
            ? new view.ResizeObserver((entries) => {
                  const entry = entries[entries.length - 1];
                  const box = entry?.contentBoxSize?.[0];
                  if (entry === undefined || disposed) return;
                  size = box === undefined ? { width: entry.contentRect.width, height: entry.contentRect.height } : { width: box.inlineSize, height: box.blockSize };
                  // ResizeObserver runs after the frame's callbacks and before paint: drawing here shows the new size with no blank frame
                  unschedule(view, onFrame);
                  draw();
              })
            : undefined;
    observer?.observe(canvas);

    return {
        canvas,
        update(next: readonly ShapeTree[]): void {
            if (disposed) return;
            // A drag in progress keeps its shape where the pointer has it
            tree = drag.apply(next);
            dirty = true;
            syncProxies();
            // A touch on a draggable shape drags it rather than scrolling the page
            const touch = options.onMove !== undefined && hasDraggable(tree) ? 'none' : '';
            if (canvas.style.touchAction !== touch) canvas.style.touchAction = touch;
            if (hovered !== undefined && !proxies.has(hovered)) hovered = undefined;
            if (view !== null) schedule(view, onFrame);
        },
        paint(): void {
            if (disposed || !dirty) return;
            unschedule(view, onFrame);
            draw();
        },
        hit(x: number, y: number): ShapeTree | undefined {
            return disposed ? undefined : hitTest(tree, x, y, { interactive: true });
        },
        boundsOf(path: string): Bounds | undefined {
            return disposed ? undefined : boundsAt(tree, path);
        },
        elementOf(id: string): Element | undefined {
            return disposed ? undefined : proxies.get(id)?.element;
        },
        drawn(): Promise<void> {
            if (disposed || !dirty) return Promise.resolve();
            return new Promise<void>((resolve) => waiters.push(resolve));
        },
        dispose(): void {
            if (disposed) return;
            disposed = true;
            observer?.disconnect();
            unschedule(view, onFrame);
            drag.dispose();
            canvas.removeEventListener('pointerdown', onDown);
            canvas.removeEventListener('click', onCanvasClick);
            canvas.removeEventListener('pointermove', onMove);
            canvas.removeEventListener('pointerleave', onLeave);
            layer.removeEventListener('click', onProxyClick);
            layer.removeEventListener('keydown', onProxyKey);
            canvas.remove();
            layer.remove();
            proxies.clear();
            shown = new Set();
            hovered = undefined;
            tree = [];
            settle();
        }
    };
}

registerDrawingRenderer('canvas', createCanvasRenderer);
