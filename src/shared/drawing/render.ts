import { buildError } from '@punyts/stateui-app/core';
import type { BuildError, JsonValue } from '@punyts/stateui-app/core';
import type { Bounds, ViewBox } from './geometry.js';
import type { ReadStoredFile } from '../field/files.js';
import type { PaintIssue } from './paint.js';
import type { ShapeTree } from './tree.js';

/** The renderers a drawing can use */
export const RENDERERS = ['svg', 'canvas'] as const;

export type RendererKind = (typeof RENDERERS)[number];

/** The events a shape raises (`events` of every shape, as the `interaction` partial declares them) */
export type ShapeEventName = 'press' | 'hover' | 'dragEnd';

/** What a renderer tells its feeder about a user action on a shape */
export interface ShapeEvent {
    readonly name: ShapeEventName;
    /** The state path of the shape (`…rows.<recordKey>` for a copy of a repeat); the `drawing` raises it as `detail.shape` */
    readonly shape: string;
    /** The key of the shape, or the record key of a repeat copy */
    readonly key: string;
    /** The pointer position in drawing units */
    readonly x: number;
    readonly y: number;
}

/**
 * The position a drag or an arrow key gave a draggable shape (G1.7b): the new values of its `x` and `y` properties,
 * only the axes it moves on. The feeder writes them (the `drawing` to the shape's own property, or for a repeat copy to
 * the record path `targetOf` gives); the renderer raises `dragEnd` right after
 */
export interface ShapeMove {
    /** The state path of the shape, as in `ShapeEvent` */
    readonly shape: string;
    /** The key of the shape, or the record key of a repeat copy */
    readonly key: string;
    readonly x?: number;
    readonly y?: number;
}

/**
 * A shape a renderer leaves out because a resolved value cannot be drawn (a link that delivers text where a number is
 * expected, path data that does not parse), or a node whose component is not a 2D shape. Reported as `SUI-RUN-DRAW`.
 * A `drawImage` whose picture cannot be read or decoded (G1.9b) is `SUI-RUN-FILE`, its reason the file code
 * (`not_found`, `offline`, `not_an_image`, …)
 */
export interface ShapeIssue {
    readonly code: 'SUI-RUN-DRAW' | 'SUI-RUN-FILE';
    /** The state path of the shape */
    readonly path: string;
    /** Why, in words that name properties and components only, never values: `property "x" is not a number` */
    readonly reason: string;
}

/** A problem a renderer hears while drawing: a colour that resolved to no paint, or a shape it does not draw */
export type DrawingIssue = PaintIssue | ShapeIssue;

/** True for an issue of a shape that is not drawn (not one of a colour) */
export const isShapeIssue = (issue: DrawingIssue): issue is ShapeIssue => 'reason' in issue;

/**
 * The error a feeder reports for an issue (with `report.error` of `@punyts/core`): `SUI-STATE-PAINT` and
 * `SUI-STATE-TOKEN` as the document check words them, `SUI-RUN-DRAW` with its reason, `SUI-RUN-FILE` for the
 * picture of a `drawImage`
 */
export function drawingIssueError(issue: DrawingIssue): BuildError {
    if (isShapeIssue(issue) && issue.code === 'SUI-RUN-FILE') return buildError('SUI-RUN-FILE', { component: 'drawImage', path: issue.path, reason: issue.reason, statePath: issue.path });
    if (isShapeIssue(issue)) return buildError('SUI-RUN-DRAW', { path: issue.path, reason: issue.reason, statePath: issue.path });
    if (issue.code === 'SUI-STATE-PAINT') return buildError('SUI-STATE-PAINT', { name: issue.property, path: issue.path, key: issue.value, statePath: issue.path });
    if (issue.code === 'SUI-STATE-TOKEN') return buildError('SUI-STATE-TOKEN', { name: issue.property, path: issue.path, token: issue.value, statePath: issue.path });
    const reason = `property "${issue.property}" is not a colour, a token or a paint name, so it is not painted`;
    return buildError('SUI-RUN-DRAW', { path: issue.path, reason, statePath: issue.path });
}

/** What a renderer is made with */
export interface DrawingRendererOptions {
    readonly renderer: RendererKind;
    /**
     * The `viewBox` when the caller owns the sizing (the chart does); without it the renderer reads the `viewBox` and
     * `fit` properties through `readProperty`, and fits the tree's bounds when there is no `viewBox`
     */
    readonly viewBox?: ViewBox;
    /** True while motion is reduced (the theme's `motion.duration.base` resolves to a duration of zero) */
    reducedMotion(): boolean;
    /** Reads a property of the feeding node (`fit`, `viewBox`, `paints`, …), links followed; undefined when unset */
    readProperty(name: string): JsonValue | undefined;
    /** Called for every `press`, `hover` and `dragEnd` on an interactive shape */
    onEvent(event: ShapeEvent): void;
    /**
     * Called once when a pointer drag of a draggable shape is released, and for each arrow key that moves one (G1.7b),
     * with its new position, right before its `dragEnd`. The renderer never writes: the feeder does, here. Without it
     * no shape is draggable
     */
    onMove?(move: ShapeMove): void;
    /**
     * The state path of the feeding node (`$.app.children.map`), so the problems of its `paints` carry their path
     * (`<path>.paints.<name>.stops.<key>.color`); without it they are reported under `paints`
     */
    readonly path?: string;
    /** Hears each problem once: a colour that resolved to no paint, or a shape left out; the feeder reports it */
    onIssue?(issue: DrawingIssue): void;
    /**
     * Reads a stored file for a `drawImage` whose `src` is a file reference (G1.9b; the `drawing` raises
     * `ui-file-read`). Without it such a picture is not drawn and is reported as `SUI-RUN-FILE` `offline`
     */
    readonly readFile?: ReadStoredFile;
}

/**
 * A renderer draws a plain shape tree into its target and follows it with `update`. It never writes to the store: the
 * feeder (the `drawing` component from the store, the chart from its adapter) hands it a new tree and hears events.
 * After `dispose` every call is a no-op.
 */
export interface DrawingRenderer {
    /** Draws the tree, writing only what changed since the last one */
    update(tree: readonly ShapeTree[]): void;
    /** The topmost interactive shape at a point in drawing units, as `hitTest` with `interactive` finds it */
    hit(x: number, y: number): ShapeTree | undefined;
    /** The bounds in drawing units of the shape with this state path, or undefined */
    boundsOf(path: string): Bounds | undefined;
    /** The element of a shape (by its path): the SVG element, or for canvas the proxy button; undefined when there is none */
    elementOf(id: string): Element | undefined;
    /**
     * Resolves once the last `update` is on screen: after the next frame, and after any image it draws is decoded. A
     * feeder marks itself ready then (the `drawing` host's `data-render`). Resolves at once after `dispose`
     */
    drawn(): Promise<void>;
    /** Removes everything the renderer added to its target and stops listening */
    dispose(): void;
}

/** Makes a renderer of one kind; G1.5 (SVG) and G1.6 (canvas) register theirs */
export type DrawingRendererFactory = (target: Element, options: DrawingRendererOptions) => DrawingRenderer;

const factories = new Map<RendererKind, DrawingRendererFactory>();

/** Registers the factory of a renderer kind, replacing one registered before; gives back a function that removes it */
export function registerDrawingRenderer(kind: RendererKind, factory: DrawingRendererFactory): () => void {
    factories.set(kind, factory);
    return () => {
        if (factories.get(kind) === factory) factories.delete(kind);
    };
}

/** True for a renderer kind */
export const isRendererKind = (value: unknown): value is RendererKind => (RENDERERS as readonly unknown[]).includes(value);

/**
 * Makes the renderer `options.renderer` names into `target`. The one function both feeders use; throws when no
 * renderer of that kind is registered (a wiring mistake, not a user one)
 */
export function createDrawingRenderer(target: Element, options: DrawingRendererOptions): DrawingRenderer {
    const factory = factories.get(options.renderer);
    if (factory === undefined) throw new Error(`createDrawingRenderer: no "${options.renderer}" renderer is registered`);
    return factory(target, options);
}
