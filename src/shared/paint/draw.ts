import type { ReadCustomProperty } from '../drawing/paint.js';
import { addPoint, clampPoint, createPaintLog, isPaintTool, isShapeTool, strokeColor, UNDO_LIMIT } from './strokes.js';
import type { PaintEntry, PaintPoint, PaintTool, Stroke } from './strokes.js';
import { clampBrushSize, clampDimension } from './size.js';
import { clampTolerance, createFillSearch, parseRgba } from './fill.js';
import type { FillSearch, PaintPixels } from './fill.js';

/**
 * The part of a 2D context the engine draws with. A `CanvasRenderingContext2D` and an
 * `OffscreenCanvasRenderingContext2D` are one; `Image` is what `drawImage` takes (a canvas), so a test can bring a
 * fake context with fake images. The pixel members (`createImageData`, `getImageData`, `putImageData`) serve the
 * flood fill, `fillRect` the reading of a colour the fill cannot parse
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
    closePath(): void;
    ellipse(x: number, y: number, radiusX: number, radiusY: number, rotation: number, startAngle: number, endAngle: number): void;
    clearRect(x: number, y: number, width: number, height: number): void;
    fillRect(x: number, y: number, width: number, height: number): void;
    drawImage(image: Image, dx: number, dy: number): void;
    createImageData(width: number, height: number): PaintPixels;
    getImageData(x: number, y: number, width: number, height: number): PaintPixels;
    putImageData(pixels: PaintPixels, dx: number, dy: number, dirtyX: number, dirtyY: number, dirtyWidth: number, dirtyHeight: number): void;
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

/** The two points of a shape stroke, or undefined when it has fewer than two or they coincide (a shape of no size) */
export function shapeEnds(points: readonly PaintPoint[]): [PaintPoint, PaintPoint] | undefined {
    const start = points[0];
    const end = points[points.length - 1];
    if (points.length < 2 || start === undefined || end === undefined || (start.x === end.x && start.y === end.y)) return undefined;
    return [start, end];
}

/**
 * Draws a shape stroke: a `line` from its first point to its second with round caps, a `rect` with those points as
 * opposite corners (mitred corners), an `ellipse` inside that box; each outlined `size` pixels wide in the stroke's
 * colour. A shape of no size draws nothing
 */
function drawShape<Image>(context: PaintContext2D<Image>, stroke: Stroke): void {
    const ends = shapeEnds(stroke.points);
    if (ends === undefined) return;
    const [start, end] = ends;
    context.save();
    context.globalCompositeOperation = 'source-over';
    context.strokeStyle = stroke.color;
    context.lineWidth = stroke.size;
    context.lineCap = 'round';
    context.lineJoin = stroke.tool === 'rect' ? 'miter' : 'round';
    context.beginPath();
    if (stroke.tool === 'line') {
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
    } else if (stroke.tool === 'rect') {
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, start.y);
        context.lineTo(end.x, end.y);
        context.lineTo(start.x, end.y);
        context.closePath();
    } else {
        const radiusX = Math.abs(end.x - start.x) / 2;
        const radiusY = Math.abs(end.y - start.y) / 2;
        context.ellipse((start.x + end.x) / 2, (start.y + end.y) / 2, radiusX, radiusY, 0, 0, Math.PI * 2);
        context.closePath();
    }
    context.stroke();
    context.restore();
}

/** How many pixels one read or write of the fill moves at most: a band of rows, so no single call blocks for long */
export const FILL_BAND_PIXELS = 1 << 18;

/** A fill on a surface, in steps: it reads the pixels band by band, searches, then writes back the rows it changed */
export interface FillJob {
    /** Works until `deadline` (a `performance.now()` time); gives whether the fill is done and on the surface */
    step(deadline: number): boolean;
}

const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Makes the job of a `fill` stroke on a `width` by `height` context: its pixels are read in bands of at most
 * `FILL_BAND_PIXELS` into one buffer, filled by `createFillSearch` (`./fill.ts`) from the stroke's seed with its
 * colour and tolerance, and the rows it changed are written back band by band. Undefined when the stroke is not a fill
 * or its colour cannot be read (`parseRgba`)
 */
export function createFillJob<Image>(context: PaintContext2D<Image>, stroke: Stroke, width: number, height: number): FillJob | undefined {
    const seed = stroke.points[0];
    const color = parseRgba(stroke.color);
    if (stroke.tool !== 'fill' || seed === undefined || color === undefined) return undefined;
    const band = Math.max(1, Math.floor(FILL_BAND_PIXELS / width));
    let pixels: PaintPixels | undefined;
    let search: FillSearch | undefined;
    let read = 0;
    let written = -1;
    let done = false;
    return {
        step(deadline: number): boolean {
            while (!done) {
                pixels ??= context.createImageData(width, height);
                if (read < height) {
                    const rows = Math.min(band, height - read);
                    pixels.data.set(context.getImageData(0, read, width, rows).data, read * width * 4);
                    read += rows;
                } else if (search === undefined) {
                    search = createFillSearch(pixels, seed.x, seed.y, color, clampTolerance(stroke.tolerance));
                } else if (!search.done) {
                    search.step(deadline);
                } else {
                    const { count, top, bottom } = search.result;
                    if (written < 0) written = top;
                    if (count === 0 || written > bottom) {
                        done = true;
                        pixels = undefined;
                        break;
                    }
                    const rows = Math.min(band, bottom - written + 1);
                    context.putImageData(pixels, 0, 0, 0, written, width, rows);
                    written += rows;
                }
                if (clock() >= deadline) break;
            }
            return done;
        }
    };
}

/**
 * Draws one stroke. The brush and the eraser draw a smoothed line with round caps and joins, `size` pixels wide, as one
 * path (so a translucent colour does not darken where the stroke crosses itself); a single point is a round dot of the
 * same size. The eraser draws with `destination-out`, so it clears the painting layer down to transparent and whatever
 * lies under the canvas (the field's background) shows through. `line`, `rect` and `ellipse` draw their outline
 * (`drawShape`). A `fill` needs the canvas size (`bounds`) and is done at once here (`createFillJob`, run to its
 * end); without `bounds` it draws nothing
 */
export function drawStroke<Image>(context: PaintContext2D<Image>, stroke: Stroke, bounds?: { readonly width: number; readonly height: number }): void {
    if (stroke.tool === 'fill') {
        if (bounds !== undefined) createFillJob(context, stroke, bounds.width, bounds.height)?.step(Infinity);
        return;
    }
    if (isShapeTool(stroke.tool)) {
        drawShape(context, stroke);
        return;
    }
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
    else drawStroke(context, entry.stroke, { width, height });
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
    /**
     * How long one slice of a flood fill may run before it yields to the page, in milliseconds (default
     * `FILL_SLICE_MS`). The fill runs in slices on timers, so a large fill never freezes the page
     */
    readonly fillSliceMs?: number;
}

/** How long one slice of a flood fill runs before the painter yields to the page, in milliseconds */
export const FILL_SLICE_MS = 12;

/**
 * What a stroke begins with: the tool, the colour (a literal or a token; the eraser needs none), the size (the line
 * width of the brush, the eraser and the shapes; a fill keeps it but does not use it) and, for `fill`, the tolerance
 * (0..255, default `DEFAULT_FILL_TOLERANCE` of `./fill.ts`)
 */
export interface StrokeStart {
    readonly tool: PaintTool;
    readonly color?: unknown;
    readonly size: unknown;
    readonly tolerance?: unknown;
}

/** The painting engine of one canvas: strokes, shapes, fills, undo, redo and clear. It keeps no DOM and no store state */
export interface Painter {
    readonly width: number;
    readonly height: number;
    /** Whether a stroke is being drawn */
    readonly drawing: boolean;
    /** Whether a flood fill is still being written to the painting (see `idle`) */
    readonly busy: boolean;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    /** Whether nothing is painted (see `PaintLog.blank`) */
    readonly blank: boolean;
    /**
     * Begins a stroke at `point` (a stroke still being drawn is committed first, and a fill under way is finished).
     * Gives false, and begins nothing, for an unknown tool, a size that is not a number, a point that is not a number,
     * or a colour that does not resolve (`strokeColor`; for a fill, also one whose bytes cannot be read)
     */
    begin(start: StrokeStart, point: { readonly x: unknown; readonly y: unknown }): boolean;
    /**
     * Moves the stroke being drawn on and shows it (the live preview): the brush and the eraser add the points (coalesced
     * pointer events may bring several), a shape moves its second point to the last of them, a fill ignores them
     */
    extend(...points: { readonly x: unknown; readonly y: unknown }[]): void;
    /**
     * Commits the stroke being drawn to the log and gives it; undefined when no stroke was being drawn, or when it was a
     * shape of no size (pressed and released on one point), which leaves the painting as it was. A fill goes into the log
     * at once and is written to the painting in slices (`busy` until it is done)
     */
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
    /** Resolves once no fill is being written (at once when none is), so a save reads the finished painting */
    idle(): Promise<void>;
    /** Lets go of the off-screen surfaces; the painter does nothing after it */
    dispose(): void;
}

/**
 * Makes the painting engine of one canvas. It keeps two off-screen surfaces: the committed painting (the base bitmap
 * and the entries of the log, drawn in order) and, made on the first flatten, the base bitmap itself, which takes the
 * entries that fall off the 200-entry undo stack. A stroke being drawn is shown by copying the committed painting to
 * the visible canvas and drawing the whole stroke over it, so a translucent brush never doubles up and a shape's preview
 * follows the pointer without leaving a trail; on `end` it is drawn onto the committed painting. A fill is written onto
 * the committed painting by a `FillJob` in slices of `fillSliceMs` on timers, and shown when it is done; a stroke begun
 * meanwhile finishes it first, and undo, clear and reset drop it (they draw the committed painting again). Undo rebuilds
 * the committed painting from the base and the log, running any fill in it at once. Pixels never leave the canvases:
 * the caller reads them from its own canvas when it saves
 */
export function createPainter<Image = CanvasImageSource>(options: PainterOptions<Image>): Painter {
    const width = clampDimension(options.width, 1);
    const height = clampDimension(options.height, 1);
    const visible = options.context;
    const createSurface = options.createSurface ?? (createCanvasSurface as unknown as (width: number, height: number) => PaintSurface<Image>);
    const sliceMs = typeof options.fillSliceMs === 'number' && options.fillSliceMs > 0 ? options.fillSliceMs : FILL_SLICE_MS;
    let committed: PaintSurface<Image> | undefined = createSurface(width, height);
    let base: PaintSurface<Image> | undefined;
    let live: { tool: PaintTool; color: string; size: number; points: PaintPoint[]; tolerance?: number } | undefined;
    let filling: { job: FillJob; timer: ReturnType<typeof setTimeout> | undefined } | undefined;
    let waiting: (() => void)[] = [];
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

    /** Wakes the promises of `idle` */
    const wake = (): void => {
        const callbacks = waiting;
        waiting = [];
        for (const callback of callbacks) callback();
    };

    /** Stops the fill under way without finishing it; the caller draws the committed painting again */
    const dropFill = (): void => {
        if (filling === undefined) return;
        if (filling.timer !== undefined) clearTimeout(filling.timer);
        filling = undefined;
        wake();
    };

    /** Runs the fill under way to its end at once (a stroke begins over it) */
    const finishFill = (): void => {
        if (filling === undefined) return;
        const { job, timer } = filling;
        if (timer !== undefined) clearTimeout(timer);
        filling = undefined;
        job.step(Infinity);
        show();
        wake();
    };

    /** Runs one slice of the fill under way, then yields to the page until the next */
    const sliceFill = (): void => {
        const current = filling;
        if (current === undefined) return;
        current.timer = undefined;
        if (current.job.step(clock() + sliceMs)) {
            filling = undefined;
            show();
            wake();
        } else current.timer = setTimeout(sliceFill, 0);
    };

    /** Draws the committed painting again: the base, then every entry of the log */
    const rebuild = (): void => {
        if (committed === undefined) return;
        dropFill();
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
        const { tool, color, size, points, tolerance } = live;
        live = undefined;
        if (isShapeTool(tool) && shapeEnds(points) === undefined) {
            show();
            return undefined;
        }
        const stroke: Stroke = Object.freeze(tool === 'fill' ? { tool, color, size, points: Object.freeze([...points]), tolerance } : { tool, color, size, points: Object.freeze([...points]) });
        log.push(stroke);
        if (tool === 'fill') {
            const job = createFillJob(committed.context, stroke, width, height);
            if (job !== undefined) {
                filling = { job, timer: undefined };
                sliceFill();
            }
        } else drawStroke(committed.context, stroke);
        show();
        return stroke;
    };

    /**
     * The colour a fill writes, as text `parseRgba` reads: the resolved colour as it is when it parses, else read back
     * from a one-pixel surface (a named colour, `oklch()`, ...) as `rgba()`; undefined when it cannot be read
     */
    const fillColor = (color: string): string | undefined => {
        if (parseRgba(color) !== undefined) return color;
        try {
            const probe = createSurface(1, 1).context;
            probe.clearRect(0, 0, 1, 1);
            probe.fillStyle = color;
            probe.fillRect(0, 0, 1, 1);
            const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
            return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
        } catch {
            return undefined;
        }
    };

    return {
        width,
        height,
        get drawing(): boolean {
            return live !== undefined;
        },
        get busy(): boolean {
            return filling !== undefined;
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
            const resolved = start.tool === 'eraser' ? (strokeColor(start.color, options.read) ?? '#000') : strokeColor(start.color, options.read);
            const color = start.tool === 'fill' && resolved !== undefined ? fillColor(resolved) : resolved;
            if (color === undefined) return false;
            const points: PaintPoint[] = [];
            if (!addPoint(points, point, width, height)) return false;
            commit();
            finishFill();
            live = start.tool === 'fill' ? { tool: start.tool, color, size, points, tolerance: clampTolerance(start.tolerance) } : { tool: start.tool, color, size, points };
            show();
            return true;
        },
        extend(...points: { readonly x: unknown; readonly y: unknown }[]): void {
            if (live === undefined || live.tool === 'fill') return;
            if (isShapeTool(live.tool)) {
                let end: PaintPoint | undefined;
                for (const point of points) end = clampPoint(point, width, height) ?? end;
                if (end === undefined) return;
                live.points = [live.points[0] as PaintPoint, end];
                show();
                return;
            }
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
            finishFill();
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
            dropFill();
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
        idle(): Promise<void> {
            if (filling === undefined) return Promise.resolve();
            return new Promise((resolve) => waiting.push(resolve));
        },
        dispose(): void {
            disposed = true;
            live = undefined;
            dropFill();
            committed = undefined;
            base = undefined;
        }
    };
}
