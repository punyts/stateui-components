import { resolveColor } from '../drawing/paint.js';
import type { ReadCustomProperty } from '../drawing/paint.js';

/** The tools of the painting engine; G2.6b adds `line`, `rect`, `ellipse` and `fill` */
export const PAINT_TOOLS = ['brush', 'eraser'] as const;

export type PaintTool = (typeof PAINT_TOOLS)[number];

/** Whether a value names a tool of the engine */
export function isPaintTool(value: unknown): value is PaintTool {
    return typeof value === 'string' && (PAINT_TOOLS as readonly string[]).includes(value);
}

/** How many entries the undo stack keeps; older ones are flattened into the base bitmap */
export const UNDO_LIMIT = 200;

/** A point on the painting, in canvas pixels (0..width, 0..height) */
export interface PaintPoint {
    readonly x: number;
    readonly y: number;
}

/**
 * One stroke: the tool, the colour as it was resolved when the stroke began (so a theme switch does not recolour it;
 * the eraser keeps the colour it was given but draws none), the brush size in pixels and the points in canvas pixels
 */
export interface Stroke {
    readonly tool: PaintTool;
    readonly color: string;
    readonly size: number;
    readonly points: readonly PaintPoint[];
}

/** One command of the log: a stroke, or `clear`, which wipes what is under it */
export type PaintEntry = { readonly kind: 'stroke'; readonly stroke: Stroke } | { readonly kind: 'clear' };

/** Points closer than this (in pixels) to the last point of a stroke are left out, so a resting pointer adds nothing */
export const MIN_POINT_DISTANCE = 0.5;

/**
 * The colour a stroke stores: a literal as it is, or a token (`{color.accent.base}`) read through `read` from the
 * computed style, by `resolveColor` of `../drawing/paint.ts`. Undefined for a value that is not a colour or a token,
 * a token the theme lacks, a token without `read` (canvas cannot draw `var()`), and a paint name (a gradient has no
 * place on a brush)
 */
export function strokeColor(value: unknown, read?: ReadCustomProperty): string | undefined {
    if (typeof value !== 'string') return undefined;
    const resolved = resolveColor(value, read);
    return resolved.kind === 'color' ? resolved.computed : undefined;
}

/** A point clamped into the canvas (0..width, 0..height); undefined when either coordinate is not a finite number */
export function clampPoint(point: { readonly x: unknown; readonly y: unknown }, width: number, height: number): PaintPoint | undefined {
    const { x, y } = point;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    return { x: Math.min(width, Math.max(0, x)), y: Math.min(height, Math.max(0, y)) };
}

/**
 * Adds a point to the points of a stroke being drawn: clamped into the canvas, and left out when it is not a number
 * or lies within `MIN_POINT_DISTANCE` of the last point. Gives whether the point was added
 */
export function addPoint(points: PaintPoint[], point: { readonly x: unknown; readonly y: unknown }, width: number, height: number): boolean {
    const clamped = clampPoint(point, width, height);
    if (clamped === undefined) return false;
    const last = points[points.length - 1];
    if (last !== undefined && Math.hypot(clamped.x - last.x, clamped.y - last.y) < MIN_POINT_DISTANCE) return false;
    points.push(clamped);
    return true;
}

/** What the log is made with */
export interface PaintLogOptions {
    /** How many entries undo can reach (default `UNDO_LIMIT`, at least 1) */
    readonly limit?: number;
    /**
     * Hears each entry that falls off the bottom of the stack, oldest first, to draw it into the base bitmap: what
     * the user can no longer undo stays painted
     */
    readonly onFlatten?: (entry: PaintEntry) => void;
}

/** The command log of a painting: what undo and redo walk through. It holds no pixels */
export interface PaintLog {
    /** The entries undo can reach, oldest first, drawn over the base bitmap in this order */
    readonly entries: readonly PaintEntry[];
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    /**
     * Whether nothing is painted: no brush stroke since the last `clear`, and, without a `clear` in reach, nothing
     * flattened into the base either (an eraser alone paints nothing)
     */
    readonly blank: boolean;
    /** Adds a stroke; the redo stack is dropped, and the oldest entry is flattened when the stack is full */
    push(stroke: Stroke): void;
    /** Adds a `clear` when something is painted; gives whether it did */
    clear(): boolean;
    /** Takes back the newest entry and gives it, or undefined when there is nothing to undo */
    undo(): PaintEntry | undefined;
    /** Puts back the entry undone last and gives it, or undefined when there is nothing to redo */
    redo(): PaintEntry | undefined;
    /** Forgets every entry and the base (a new or reset painting); nothing is flattened */
    reset(): void;
}

/**
 * Makes the command log of a painting: a bounded undo stack (`limit` entries, 200 by default) and a redo stack. When a
 * push would go over the limit, the oldest entry is handed to `onFlatten` and dropped, so the base bitmap holds it
 */
export function createPaintLog(options: PaintLogOptions = {}): PaintLog {
    const limit = Math.max(1, Math.floor(options.limit ?? UNDO_LIMIT));
    let done: PaintEntry[] = [];
    let undone: PaintEntry[] = [];
    let baseBlank = true;
    const add = (entry: PaintEntry): void => {
        done.push(entry);
        undone = [];
        while (done.length > limit) {
            const oldest = done.shift() as PaintEntry;
            if (oldest.kind === 'clear') baseBlank = true;
            else if (oldest.stroke.tool === 'brush') baseBlank = false;
            options.onFlatten?.(oldest);
        }
    };
    const isBlank = (): boolean => {
        for (let i = done.length - 1; i >= 0; i--) {
            const entry = done[i];
            if (entry.kind === 'clear') return true;
            if (entry.stroke.tool === 'brush') return false;
        }
        return baseBlank;
    };
    return {
        get entries(): readonly PaintEntry[] {
            return done;
        },
        get canUndo(): boolean {
            return done.length > 0;
        },
        get canRedo(): boolean {
            return undone.length > 0;
        },
        get blank(): boolean {
            return isBlank();
        },
        push(stroke: Stroke): void {
            add({ kind: 'stroke', stroke });
        },
        clear(): boolean {
            if (isBlank()) return false;
            add({ kind: 'clear' });
            return true;
        },
        undo(): PaintEntry | undefined {
            const entry = done.pop();
            if (entry !== undefined) undone.push(entry);
            return entry;
        },
        redo(): PaintEntry | undefined {
            const entry = undone.pop();
            if (entry !== undefined) done.push(entry);
            return entry;
        },
        reset(): void {
            done = [];
            undone = [];
            baseBlank = true;
        }
    };
}
