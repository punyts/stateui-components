import { boundsAt, hitTest } from './geometry.js';
import type { Bounds } from './geometry.js';
import type { DrawingRenderer, DrawingRendererOptions, ShapeEvent } from './render.js';
import type { ShapeTree } from './tree.js';

/**
 * A renderer that draws nothing, for tests of feeders and of the contract: it keeps every tree it was given, answers
 * `hit` and `boundsOf` from `geometry.ts` (the answers the real renderers must give for the same tree) and lets a test
 * raise an event as a user would
 */
export interface FakeRenderer extends DrawingRenderer {
    readonly target: Element;
    readonly options: DrawingRendererOptions;
    /** Every tree passed to `update`, in order */
    readonly updates: readonly (readonly ShapeTree[])[];
    readonly disposed: boolean;
    /** Raises an event through `options.onEvent`, as a pointer on the shape would */
    emit(event: ShapeEvent): void;
}

export function createFakeRenderer(target: Element, options: DrawingRendererOptions): FakeRenderer {
    const updates: (readonly ShapeTree[])[] = [];
    let tree: readonly ShapeTree[] = [];
    let disposed = false;
    return {
        target,
        options,
        updates,
        get disposed(): boolean {
            return disposed;
        },
        update(next: readonly ShapeTree[]): void {
            if (disposed) return;
            tree = next;
            updates.push(next);
        },
        hit(x: number, y: number): ShapeTree | undefined {
            return disposed ? undefined : hitTest(tree, x, y, { interactive: true });
        },
        boundsOf(path: string): Bounds | undefined {
            return disposed ? undefined : boundsAt(tree, path);
        },
        elementOf(): Element | undefined {
            return undefined;
        },
        dispose(): void {
            disposed = true;
            tree = [];
        },
        emit(event: ShapeEvent): void {
            if (!disposed) options.onEvent(event);
        }
    };
}
