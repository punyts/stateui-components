import { boundsAt, invert, multiply, shapeBounds, transformOf, IDENTITY } from './geometry.js';
import type { Bounds, Matrix } from './geometry.js';
import type { DrawingRendererOptions, ShapeMove } from './render.js';
import { targetOf } from './rows.js';
import { locateShape } from './tree.js';
import type { ShapeTree } from './tree.js';

/**
 * Dragging a shape (G1.7b of the graphics epic 1). The pure part (which axes a shape moves on, where a pointer drag or
 * an arrow key puts it, `bounds`) is Node-tested; `createShapeDrag` runs a drag for a renderer in the browser. A drag
 * moves the shape in the renderer only: nothing is written until the release, when the renderer hands the new `x` and
 * `y` to its feeder (`onMove`) and then raises `dragEnd`.
 */

/** An axis a shape is dragged along: its `x` or its `y` property */
export type DragAxis = 'x' | 'y';

/** A position of a shape: the values of its `x` and `y` properties (only the axes it moves on, for a move) */
export interface DragValues {
    x?: number;
    y?: number;
}

/** How far the pointer moves (in CSS pixels) before a press on a draggable shape becomes a drag rather than a press */
export const DRAG_THRESHOLD = 3;

/** The keyboard step when a shape has no usable `step`, in drawing units; Shift moves ten steps */
export const DEFAULT_STEP = 1;

const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** A number without the noise of the matrix maths */
const clean = (value: number): number => Math.round(value * 1e6) / 1e6 + 0;

/**
 * The axes a shape is dragged along: `x`, `y` or both from `draggable`, for a shape with `interactive: true` (a shape
 * that is not interactive takes no pointer events and no focus, so it cannot be dragged); none otherwise
 */
export function dragAxes(shape: ShapeTree): readonly DragAxis[] {
    if (shape.properties.interactive !== true || shape.properties.hidden === true) return [];
    switch (shape.properties.draggable) {
        case 'x':
            return ['x'];
        case 'y':
            return ['y'];
        case 'both':
            return ['x', 'y'];
        default:
            return [];
    }
}

/** The `x` and `y` of a shape, 0 for one that is unset */
export const positionOf = (shape: ShapeTree): { x: number; y: number } => ({ x: finite(shape.properties.x) ?? 0, y: finite(shape.properties.y) ?? 0 });

/** The shape with its `x` and `y` set to the values given (the others kept); a new object, the shape is not changed */
export function withPosition(shape: ShapeTree, values: DragValues): ShapeTree {
    const properties = { ...shape.properties };
    if (values.x !== undefined) properties.x = values.x;
    if (values.y !== undefined) properties.y = values.y;
    return { ...shape, properties };
}

/**
 * The tree with the shape at `path` (at the top, in a group or a repeat's copy) replaced by `next`; the shapes that are
 * not on the way to it are kept as they are. The same tree when no shape has the path
 */
export function replaceShape(shapes: readonly ShapeTree[], path: string, next: ShapeTree): readonly ShapeTree[] {
    let changed = false;
    const result = shapes.map((shape) => {
        if (shape.path === path) {
            changed = true;
            return next;
        }
        if (!path.startsWith(`${shape.path}.`) || shape.children.length === 0) return shape;
        const children = replaceShape(shape.children, path, next);
        if (children === shape.children) return shape;
        changed = true;
        return { ...shape, children };
    });
    return changed ? result : shapes;
}

/** The transform from the coordinates of a shape's parent to drawing units (its ancestors' transforms); undefined for no shape */
export function parentMatrix(shapes: readonly ShapeTree[], path: string): Matrix | undefined {
    const chain = locateShape(shapes, path);
    if (chain === undefined) return undefined;
    let matrix: Matrix = IDENTITY;
    for (const shape of chain.slice(0, -1)) matrix = multiply(matrix, transformOf(shape));
    return matrix;
}

const centreOf = (box: Bounds): [number, number] => [box.x + box.width / 2, box.y + box.height / 2];

/**
 * How the shape moves in its parent's coordinates for one unit of each axis: a column per axis. Most kinds take `x`
 * and `y` as an offset (one to one); a rotated or scaled `rect` with its own `origin` moves along its own axes
 */
function moveColumns(shape: ShapeTree, axes: readonly DragAxis[]): [number, number][] {
    const at = positionOf(shape);
    const base = shapeBounds(shape);
    return axes.map((axis): [number, number] => {
        const one = shapeBounds(withPosition(shape, axis === 'x' ? { x: at.x + 1 } : { y: at.y + 1 }));
        if (base === undefined || one === undefined) return axis === 'x' ? [1, 0] : [0, 1];
        const [x0, y0] = centreOf(base);
        const [x1, y1] = centreOf(one);
        return [x1 - x0, y1 - y0];
    });
}

/** The change of each axis that moves the shape by `[dx, dy]` (in its parent's coordinates), as near as its axes allow */
function solve(columns: readonly [number, number][], dx: number, dy: number): number[] {
    if (columns.length === 2) {
        const [[a, b], [c, d]] = columns as [[number, number], [number, number]];
        const det = a * d - b * c;
        if (Math.abs(det) > 1e-12) return [(d * dx - c * dy) / det, (a * dy - b * dx) / det];
    }
    // One axis (or two that move the shape the same way): the nearest point along each, by itself
    return columns.map(([a, b]) => {
        const length = a * a + b * b;
        return length < 1e-12 ? 0 : (a * dx + b * dy) / length;
    });
}

/** The `bounds` of a shape (`{ x, y, width, height }` in its parent's coordinates), or undefined when it has none usable */
export function boundsOfDrag(shape: ShapeTree): Bounds | undefined {
    const value = shape.properties.bounds;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const { x, y, width, height } = value as Record<string, unknown>;
    const box = { x: finite(x), y: finite(y), width: finite(width), height: finite(height) };
    if (box.x === undefined || box.y === undefined || box.width === undefined || box.height === undefined) return undefined;
    if (box.width < 0 || box.height < 0) return undefined;
    return box as Bounds;
}

/** How far a span `[start, start + size]` has to shift to sit inside `[min, min + room]`; to its start when it is wider */
function shiftInto(start: number, size: number, min: number, room: number): number {
    if (size > room || start < min) return min - start;
    if (start + size > min + room) return min + room - (start + size);
    return 0;
}

/**
 * The values clamped so the shape's bounds (in its parent's coordinates, stroke not included) stay inside its `bounds`:
 * a shape wider than them sits at their start. A shape with no geometry keeps its position (`x`, `y`) inside them. Only
 * the axes in `values` change; values with no `bounds` come back as they are
 */
export function clampMove(shape: ShapeTree, values: DragValues): DragValues {
    const limits = boundsOfDrag(shape);
    if (limits === undefined) return values;
    const axes = (['x', 'y'] as const).filter((axis) => values[axis] !== undefined);
    const moved = withPosition(shape, values);
    const at = positionOf(moved);
    const box = shapeBounds(moved) ?? { x: at.x, y: at.y, width: 0, height: 0 };
    const sx = shiftInto(box.x, box.width, limits.x, limits.width);
    const sy = shiftInto(box.y, box.height, limits.y, limits.height);
    if (sx === 0 && sy === 0) return values;
    const change = solve(moveColumns(moved, axes), sx, sy);
    const result: DragValues = {};
    axes.forEach((axis, index) => {
        result[axis] = clean((values[axis] as number) + (change[index] ?? 0));
    });
    return result;
}

/**
 * Where a pointer drag puts the shape at `path` of `shapes`: `start` is its position when the drag started, `dx` and
 * `dy` how far the pointer moved in drawing units. The move is taken into the shape's parent's coordinates (through its
 * groups' transforms), kept to the axes the shape moves on, and clamped by `bounds`. Undefined when the shape is not in
 * the tree or not draggable
 */
export function dragTo(shapes: readonly ShapeTree[], path: string, start: { x: number; y: number }, dx: number, dy: number): DragValues | undefined {
    const chain = locateShape(shapes, path);
    const shape = chain?.[chain.length - 1];
    const axes = shape === undefined ? [] : dragAxes(shape);
    if (shape === undefined || axes.length === 0) return undefined;
    const inverse = invert(parentMatrix(shapes, path) ?? IDENTITY) ?? IDENTITY;
    // A distance, not a point: only the linear part of the inverse applies
    const px = inverse[0] * dx + inverse[2] * dy;
    const py = inverse[1] * dx + inverse[3] * dy;
    const from = withPosition(shape, start);
    const change = solve(moveColumns(from, axes), px, py);
    const values: DragValues = {};
    axes.forEach((axis, index) => {
        values[axis] = clean(start[axis] + (change[index] ?? 0));
    });
    return clampMove(from, values);
}

/** The arrow keys and the axis and direction each moves along */
const ARROWS: Readonly<Record<string, readonly [DragAxis, number]>> = { ArrowLeft: ['x', -1], ArrowRight: ['x', 1], ArrowUp: ['y', -1], ArrowDown: ['y', 1] };

/**
 * Where an arrow key puts a draggable shape: `step` drawing units (default 1) along the key's axis, ten times that with
 * Shift, clamped by `bounds`. Undefined for a key that is not an arrow, or an axis the shape does not move on
 */
export function stepMove(shape: ShapeTree, key: string, shift: boolean): DragValues | undefined {
    const arrow = ARROWS[key];
    if (arrow === undefined) return undefined;
    const [axis, direction] = arrow;
    if (!dragAxes(shape).includes(axis)) return undefined;
    const own = finite(shape.properties.step);
    const step = own !== undefined && own >= 0 ? own : DEFAULT_STEP;
    const at = positionOf(shape);
    return clampMove(shape, { [axis]: clean(at[axis] + direction * step * (shift ? 10 : 1)) });
}

/** A repeat whose copies are draggable but have a literal (or not `$row`-linked) `x` or `y`, so a drag has nowhere to write */
export interface UnlinkedRepeat {
    /** The state path of the `drawRepeat` */
    readonly path: string;
    readonly axis: DragAxis;
}

/**
 * The tree with every draggable shape of a repeat copy that has no record path for an axis it moves on (`targetOf` of
 * `rows.ts`: its `x` or `y` is a literal or linked to anything but `$row`) made not draggable, so it does not move, and
 * the repeats it found, for the feeder to report once each (`SUI-RUN-DRAW`). A copy is not a node and has no alias to
 * write through; a node's own `x` and `y` always have a path, so shapes outside repeats are kept as they are
 */
export function lockUnlinkedCopies(shapes: readonly ShapeTree[]): { shapes: readonly ShapeTree[]; unlinked: readonly UnlinkedRepeat[] } {
    const unlinked: UnlinkedRepeat[] = [];
    const inCopy = (shape: ShapeTree, repeat: string): ShapeTree => {
        let next = shape;
        const missing = dragAxes(shape).find((axis) => targetOf(shape, axis) === undefined);
        if (missing !== undefined) {
            if (!unlinked.some((entry) => entry.path === repeat)) unlinked.push({ path: repeat, axis: missing });
            const properties = { ...shape.properties };
            delete properties.draggable;
            next = { ...shape, properties };
        }
        const children = next.children.map((child) => inCopy(child, repeat));
        return children.some((child, index) => child !== next.children[index]) ? { ...next, children } : next;
    };
    const visit = (shape: ShapeTree): ShapeTree => {
        const children =
            shape.kind === 'drawRepeat' ? shape.children.map((copy) => inCopy(copy, shape.path)) : shape.kind === 'drawGroup' ? shape.children.map(visit) : shape.children;
        return children.some((child, index) => child !== shape.children[index]) ? { ...shape, children } : shape;
    };
    const result = shapes.map(visit);
    return { shapes: result.some((shape, index) => shape !== shapes[index]) ? result : shapes, unlinked };
}

/** What `createShapeDrag` needs of its renderer */
export interface ShapeDragHost {
    /** The renderer's `onMove` (the feeder writes) and `onEvent` (it raises `dragEnd`) */
    readonly options: Pick<DrawingRendererOptions, 'onMove' | 'onEvent'>;
    /** A pointer position in drawing units */
    toDrawing(event: MouseEvent): { x: number; y: number };
    /** Draws `tree` now or in the next frame: the base tree with the dragged shape moved, or the base tree again; `path` moved */
    show(tree: readonly ShapeTree[], path: string): void;
}

/** A renderer's drag: one at a time, by pointer or by key */
export interface ShapeDrag {
    /** The tree to draw for a new base tree: with the shape of a drag in progress moved; a drag whose shape is gone ends with no write */
    apply(base: readonly ShapeTree[]): readonly ShapeTree[];
    /**
     * A pointer went down on an interactive shape (`shape` from the base tree). For a draggable one and the primary
     * button it starts a drag: the pointer is captured on `capture` and its moves and release are heard on `listen`.
     * True when a drag started
     */
    pointerDown(event: PointerEvent, shape: ShapeTree, capture: Element, listen: Element): boolean;
    /** An arrow key on a focused draggable shape moves it by `step`, writes and raises `dragEnd`; true when it did */
    key(event: KeyboardEvent, shape: ShapeTree): boolean;
    /** True (once) for the click that ends a drag or a cancelled one: it is not a press */
    swallowClick(): boolean;
    /** Ends a drag with no write and stops listening */
    dispose(): void;
}

interface Session {
    readonly path: string;
    readonly key: string;
    readonly pointerId: number;
    readonly capture: Element;
    readonly listen: Element;
    /** The pointer when it went down, in CSS pixels and in drawing units */
    readonly client: { x: number; y: number };
    readonly at: { x: number; y: number };
    /** The shape's `x` and `y` when it went down */
    readonly start: { x: number; y: number };
    /** True once the pointer moved past `DRAG_THRESHOLD`; before that a release is a press */
    moving: boolean;
    /** True after Escape: the drag is undone and the rest of the gesture is ignored */
    cancelled: boolean;
    values?: DragValues;
}

/**
 * Runs pointer drags and key moves for a renderer. A press on a draggable shape captures the pointer; once it moves
 * past `DRAG_THRESHOLD` pixels the shape follows it in the renderer (`show`) on every move, with no store write. On
 * release the shape is shown where the tree has it again, the new position goes to `onMove` (the feeder writes it: one
 * write per axis) and `dragEnd` is raised with the pointer position, after the write. Escape or a pointer cancel ends
 * the drag with no write and puts the shape back; the click that ends a drag is not a press. An arrow key on a focused
 * draggable shape is a finished move: `onMove` at once, then `dragEnd` at the moved shape's centre. Without `onMove`
 * nothing is draggable
 */
export function createShapeDrag(host: ShapeDragHost): ShapeDrag {
    let base: readonly ShapeTree[] = [];
    let session: Session | undefined;
    let swallow = false;

    const current = (): ShapeTree | undefined => {
        if (session === undefined) return undefined;
        const chain = locateShape(base, session.path);
        return chain?.[chain.length - 1];
    };

    const moved = (): readonly ShapeTree[] => {
        const shape = current();
        if (session?.values === undefined || shape === undefined || session.cancelled) return base;
        return replaceShape(base, session.path, withPosition(shape, session.values));
    };

    const stopListening = (active: Session): void => {
        active.listen.removeEventListener('pointermove', onMove as EventListener);
        active.listen.removeEventListener('pointerup', onUp as EventListener);
        active.listen.removeEventListener('pointercancel', onCancel as EventListener);
        active.listen.ownerDocument.removeEventListener('keydown', onEscape, true);
        try {
            if (active.capture.hasPointerCapture(active.pointerId)) active.capture.releasePointerCapture(active.pointerId);
        } catch {
            // A pointer that is gone has no capture to release
        }
    };

    /** Ends the drag in progress; the shape is shown where the base tree has it */
    const end = (): Session | undefined => {
        const active = session;
        if (active === undefined) return undefined;
        session = undefined;
        stopListening(active);
        if (active.moving && !active.cancelled) host.show(base, active.path);
        return active;
    };

    /** Undoes the drag (Escape): the shape goes back, nothing is written, and the release that follows is ignored */
    const cancel = (): void => {
        if (session === undefined) return;
        if (session.moving) swallow = true;
        if (session.moving && !session.cancelled) host.show(base, session.path);
        session.cancelled = true;
    };

    const onMove = (event: PointerEvent): void => {
        const active = session;
        if (active === undefined || event.pointerId !== active.pointerId || active.cancelled) return;
        if (!active.moving) {
            const far = Math.hypot(event.clientX - active.client.x, event.clientY - active.client.y);
            if (far < DRAG_THRESHOLD) return;
            active.moving = true;
        }
        const point = host.toDrawing(event);
        const values = dragTo(base, active.path, active.start, point.x - active.at.x, point.y - active.at.y);
        if (values === undefined) return;
        active.values = values;
        host.show(moved(), active.path);
    };

    const onUp = (event: PointerEvent): void => {
        const active = session;
        if (active === undefined || event.pointerId !== active.pointerId) return;
        end();
        if (!active.moving || active.cancelled || active.values === undefined) return;
        swallow = true;
        const point = host.toDrawing(event);
        commit(active.path, active.key, active.values, point);
    };

    const onCancel = (event: PointerEvent): void => {
        if (session === undefined || event.pointerId !== session.pointerId) return;
        cancel();
        end();
    };

    const onEscape = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape' || session === undefined || session.cancelled) return;
        event.preventDefault();
        event.stopPropagation();
        cancel();
    };

    /** Hands the new position to the feeder (it writes), then raises `dragEnd` */
    const commit = (path: string, key: string, values: DragValues, at: { x: number; y: number }): void => {
        const move: ShapeMove = { shape: path, key, ...values };
        host.options.onMove?.(move);
        host.options.onEvent({ name: 'dragEnd', shape: path, key, x: at.x, y: at.y });
    };

    return {
        apply(next) {
            base = next;
            if (session !== undefined && current() === undefined) {
                session.cancelled = true;
                end();
            }
            return session === undefined ? next : moved();
        },
        pointerDown(event, shape, capture, listen) {
            swallow = false;
            if (host.options.onMove === undefined || event.button !== 0 || dragAxes(shape).length === 0) return false;
            if (session !== undefined) end();
            const at = host.toDrawing(event);
            session = {
                path: shape.path,
                key: shape.key,
                pointerId: event.pointerId,
                capture,
                listen,
                client: { x: event.clientX, y: event.clientY },
                at,
                start: positionOf(shape),
                moving: false,
                cancelled: false
            };
            try {
                capture.setPointerCapture(event.pointerId);
            } catch {
                // A pointer the browser does not know (a scripted event) cannot be captured; its events still reach `listen`
            }
            listen.addEventListener('pointermove', onMove as EventListener);
            listen.addEventListener('pointerup', onUp as EventListener);
            listen.addEventListener('pointercancel', onCancel as EventListener);
            listen.ownerDocument.addEventListener('keydown', onEscape, true);
            return true;
        },
        key(event, shape) {
            if (host.options.onMove === undefined || session !== undefined || event.altKey || event.ctrlKey || event.metaKey) return false;
            const values = stepMove(shape, event.key, event.shiftKey);
            if (values === undefined) return false;
            event.preventDefault();
            const box = boundsAt(replaceShape(base, shape.path, withPosition(shape, values)), shape.path);
            const centre = box === undefined ? positionOf(withPosition(shape, values)) : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
            commit(shape.path, shape.key, values, centre);
            return true;
        },
        swallowClick() {
            const was = swallow;
            swallow = false;
            return was;
        },
        dispose() {
            if (session !== undefined) session.cancelled = true;
            end();
            base = [];
        }
    };
}
