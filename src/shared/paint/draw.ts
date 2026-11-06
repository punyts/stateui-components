import type { ReadCustomProperty } from '../drawing/paint.js';
import { addPoint, createPaintLog, isPaintTool, strokeColor, UNDO_LIMIT } from './strokes.js';
import type { PaintEntry, PaintPoint, PaintTool, Stroke } from './strokes.js';
import { clampBrushSize, clampDimension } from './size.js';

/**
 * The part of a 2D context the engine draws with. A `CanvasRenderingContext2D` and an
 * `OffscreenCanvasRenderingContext2D` are one; `Image` is what `drawImage` takes (a canvas), so a test can bring a
 * fake context with fake images
 */
export interface PaintContext2D<Image = CanvasImageSource> {
    globalCompositeOperation: GlobalCompositeOperation;
    strokeStyle: string | CanvasGradient | CanvasPattern;
    fillStyle: string | CanvasGradient | CanvasPattern;
    lineWidth: number;
    lineCap: CanvasLineCap;
    lineJoin: CanvasLineJoin;
    save(): void;
    restore(): void;
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
    arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
    stroke(): void;
    fill(): void;
    clearRect(x: number, y: number, width: number, height: number): void;
    drawImage(image: Image, dx: number, dy: number): void;
}

/** A bitmap the engine keeps off screen: its context, and itself as an image to draw onto another */
export interface PaintSurface<Image = CanvasImageSource> {
    readonly image: Image;
    readonly context: PaintContext2D<Image>;
}

/** One step of a smoothed stroke path, in canvas pixels */
export type PathStep =
    | { readonly kind: 'move'; readonly x: number; readonly y: number }
    | { readonly kind: 'line'; readonly x: number; readonly y: number }
    | { readonly kind: 'quad'; readonly cx: number; readonly cy: number; readonly x: number; readonly y: number };

/**
 * The smoothed path of a stroke's points: from the first point, a quadratic curve through each middle point (as its
 * control point) to the midpoint of it and the next, then a line to the last point. Every coordinate is a point or the
 * midpoint of two, so a path of points inside the canvas stays inside it. One point is a `move` alone (a dot)
 */
export function smoothPath(points: readonly PaintPoint[]): PathStep[] {
    if (points.length === 0) return [];
    const steps: PathStep[] = [{ kind: 'move', x: points[0].x, y: points[0].y }];
    if (points.length === 1) return steps;
    for (let i = 1; i < points.length - 1; i++) {
        const point = points[i];
        const next = points[i + 1];
        steps.push({ kind: 'quad', cx: point.x, cy: point.y, x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 });
    }
    const last = points[points.length - 1];
    steps.push({ kind: 'line', x: last.x, y: last.y });
    return steps;
}

/** How a tool composites: the brush paints over, the eraser takes away (`destination-out`) down to transparent */
export function compositeOf(tool: PaintTool): GlobalCompositeOperation {
    return tool === 'eraser' ? 'destination-out' : 'source-over';
}

/**
 * Draws one stroke: a smoothed line with round caps and joins, `size` pixels wide, as one path (so a translucent colour
 * does not darken where the stroke crosses itself); a single point is a round dot of the same size. The eraser draws
 * with `destination-out`, so it clears the painting layer down to transparent and whatever lies under the canvas (the
 * field's background) shows through
 */
export function drawStroke<Image>(context: PaintContext2D<Image>, stroke: Stroke): void {
    const steps = smoothPath(stroke.points);
    if (steps.length === 0) return;
    const color = stroke.tool === 'eraser' ? '#000' : stroke.color;
    context.save();
    context.globalCompositeOperation = compositeOf(stroke.tool);
    context.beginPath();
    if (steps.length === 1) {
        context.fillStyle = color;
        context.arc(steps[0].x, steps[0].y, stroke.size / 2, 0, Math.PI * 2);
        context.fill();
    } else {
        context.strokeStyle = color;
        context.lineWidth = stroke.size;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        for (const step of steps) {
            if (step.kind === 'move') context.moveTo(step.x, step.y);
            else if (step.kind === 'line') context.lineTo(step.x, step.y);
            else context.quadraticCurveTo(step.cx, step.cy, step.x, step.y);
        }
        context.stroke();
    }
    context.restore();
}

/** Draws one entry of the log: a stroke, or `clear`, which wipes the whole surface */
export function drawEntry<Image>(context: PaintContext2D<Image>, entry: PaintEntry, width: number, height: number): void {
    if (entry.kind === 'clear') context.clearRect(0, 0, width, height);
    else drawStroke(context, entry.stroke);
}

/** Makes an off-screen surface: an `OffscreenCanvas` where there is one, else a detached `canvas` element */
export function createCanvasSurface(width: number, height: number): PaintSurface {
    if (typeof OffscreenCanvas === 'function') {
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d');
        if (context !== null) return { image: canvas, context };
    }
    if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (context !== null) return { image: canvas, context };
    }
    throw new Error('No 2D canvas context is available for painting');
}

/** What a painter draws on and with */
export interface PainterOptions<Image = CanvasImageSource> {
    /** The context of the visible canvas, `width` by `height` pixels; its bitmap is transparent where nothing is painted */
    readonly context: PaintContext2D<Image>;
    /** The width of the canvas in pixels, clamped to 1..4096 */
    readonly width: number;
    /** The height of the canvas in pixels, clamped to 1..4096 */
    readonly height: number;
    /** Makes the off-screen surfaces (default `createCanvasSurface`); a test passes a fake */
    readonly createSurface?: (width: number, height: number) => PaintSurface<Image>;
    /** Reads a custom property from the field's computed style, so a token colour resolves when a stroke begins */
    readonly read?: ReadCustomProperty;
    /** How many entries undo reaches (default 200) */
    readonly limit?: number;
}

/** What a stroke begins with: the tool, the colour (a literal or a token; the eraser needs none) and the size */
export interface StrokeStart {
    readonly tool: PaintTool;
    readonly color?: unknown;
    readonly size: unknown;
}

/** The painting engine of one canvas: strokes, undo, redo and clear. It keeps no DOM and no store state */
export interface Painter {
    readonly width: number;
    readonly height: number;
    /** Whether a stroke is being drawn */
    readonly drawing: boolean;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    /** Whether nothing is painted (see `PaintLog.blank`) */
    readonly blank: boolean;
    /**
     * Begins a stroke at `point` (a stroke still being drawn is committed first). Gives false, and begins nothing, for
     * an unknown tool, a size that is not a number, a point that is not a number, or a brush colour that does not
     * resolve (`strokeColor`)
     */
    begin(start: StrokeStart, point: { readonly x: unknown; readonly y: unknown }): boolean;
    /** Adds points to the stroke being drawn (coalesced pointer events may bring several) and shows it */
    extend(...points: { readonly x: unknown; readonly y: unknown }[]): void;
    /** Commits the stroke being drawn to the log and gives it; undefined when no stroke was being drawn */
    end(): Stroke | undefined;
    /** Drops the stroke being drawn; the canvas shows what it showed before it began */
    cancel(): void;
    /** Takes back the newest stroke or clear; gives whether anything changed. A stroke being drawn is dropped first */
    undo(): boolean;
    /** Puts back the entry undone last; gives whether anything changed. A stroke being drawn is dropped first */
    redo(): boolean;
    /** Wipes the painting as one undoable entry; gives whether anything changed. A stroke being drawn is dropped first */
    clear(): boolean;
    /** Forgets everything, undo included, and shows an empty canvas (a reset or a new painting) */
    reset(): void;
    /** Draws the painting onto the visible canvas again (after the canvas was resized or lost its bitmap) */
    render(): void;
    /** Lets go of the off-screen surfaces; the painter does nothing after it */
    dispose(): void;
}

/**
 * Makes the painting engine of one canvas. It keeps two off-screen surfaces: the committed painting (the base bitmap
 * and the entries of the log, drawn in order) and, made on the first flatten, the base bitmap itself, which takes the
 * entries that fall off the 200-entry undo stack. A stroke being drawn is shown by copying the committed painting to
 * the visible canvas and drawing the whole stroke over it, so a translucent brush never doubles up; on `end` it is
 * drawn onto the committed painting. Undo rebuilds the committed painting from the base and the log. Pixels never
 * leave the canvases: the caller reads them from its own canvas when it saves
 */
export function createPainter<Image = CanvasImageSource>(options: PainterOptions<Image>): Painter {
    const width = clampDimension(options.width, 1);
    const height = clampDimension(options.height, 1);
    const visible = options.context;
    const createSurface = options.createSurface ?? (createCanvasSurface as unknown as (width: number, height: number) => PaintSurface<Image>);
    let committed: PaintSurface<Image> | undefined = createSurface(width, height);
    let base: PaintSurface<Image> | undefined;
    let live: { tool: PaintTool; color: string; size: number; points: PaintPoint[] } | undefined;
    let disposed = false;

    const log = createPaintLog({
        limit: options.limit ?? UNDO_LIMIT,
        onFlatten: (entry) => {
            if (disposed) return;
            base ??= createSurface(width, height);
            drawEntry(base.context, entry, width, height);
        }
    });

    /** Copies the committed painting to the visible canvas, with the stroke being drawn over it */
    const show = (): void => {
        if (committed === undefined) return;
        visible.save();
        visible.globalCompositeOperation = 'source-over';
        visible.clearRect(0, 0, width, height);
        visible.drawImage(committed.image, 0, 0);
        visible.restore();
        if (live !== undefined) drawStroke(visible, live);
    };

    /** Draws the committed painting again: the base, then every entry of the log */
    const rebuild = (): void => {
        if (committed === undefined) return;
        const context = committed.context;
        context.save();
        context.globalCompositeOperation = 'source-over';
        context.clearRect(0, 0, width, height);
        if (base !== undefined) context.drawImage(base.image, 0, 0);
        context.restore();
        for (const entry of log.entries) drawEntry(context, entry, width, height);
    };

    const dropLive = (): void => {
        if (live === undefined) return;
        live = undefined;
        show();
    };

    const commit = (): Stroke | undefined => {
        if (live === undefined || committed === undefined) return undefined;
        const stroke: Stroke = Object.freeze({ tool: live.tool, color: live.color, size: live.size, points: Object.freeze([...live.points]) });
        live = undefined;
        drawStroke(committed.context, stroke);
        log.push(stroke);
        show();
        return stroke;
    };

    return {
        width,
        height,
        get drawing(): boolean {
            return live !== undefined;
        },
        get canUndo(): boolean {
            return log.canUndo;
        },
        get canRedo(): boolean {
            return log.canRedo;
        },
        get blank(): boolean {
            return log.blank;
        },
        begin(start: StrokeStart, point: { readonly x: unknown; readonly y: unknown }): boolean {
            if (disposed || !isPaintTool(start.tool)) return false;
            const size = clampBrushSize(start.size);
            if (size === undefined) return false;
            const color = start.tool === 'eraser' ? (strokeColor(start.color, options.read) ?? '#000') : strokeColor(start.color, options.read);
            if (color === undefined) return false;
            const points: PaintPoint[] = [];
            if (!addPoint(points, point, width, height)) return false;
            commit();
            live = { tool: start.tool, color, size, points };
            show();
            return true;
        },
        extend(...points: { readonly x: unknown; readonly y: unknown }[]): void {
            if (live === undefined) return;
            let added = false;
            for (const point of points) added = addPoint(live.points, point, width, height) || added;
            if (added) show();
        },
        end(): Stroke | undefined {
            return commit();
        },
        cancel(): void {
            dropLive();
        },
        undo(): boolean {
            if (disposed) return false;
            dropLive();
            if (log.undo() === undefined) return false;
            rebuild();
            show();
            return true;
        },
        redo(): boolean {
            if (disposed || committed === undefined) return false;
            dropLive();
            const entry = log.redo();
            if (entry === undefined) return false;
            drawEntry(committed.context, entry, width, height);
            show();
            return true;
        },
        clear(): boolean {
            if (disposed || committed === undefined) return false;
            dropLive();
            if (!log.clear()) return false;
            committed.context.clearRect(0, 0, width, height);
            show();
            return true;
        },
        reset(): void {
            if (disposed) return;
            live = undefined;
            log.reset();
            base = undefined;
            rebuild();
            show();
        },
        render(): void {
            if (!disposed) show();
        },
        dispose(): void {
            disposed = true;
            live = undefined;
            committed = undefined;
            base = undefined;
        }
    };
}
