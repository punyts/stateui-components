import type { JsonValue } from '@punyts/stateui-app/core';
import type { Bounds, ViewBox } from './geometry.js';
import type { ShapeTree } from './tree.js';

/** The renderers a drawing can use */
export const RENDERERS = ['svg', 'canvas'] as const;

export type RendererKind = (typeof RENDERERS)[number];

/** The events a shape raises (`events` of every shape) */
export type ShapeEventName = 'press' | 'hover' | 'drag-end';

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
    /** Called for every `press`, `hover` and `drag-end` on an interactive shape */
    onEvent(event: ShapeEvent): void;
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
