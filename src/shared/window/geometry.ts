/**
 * The pure parts of `window`: where a move or a resize leaves the window's box inside the layout box it sits in, the
 * keyboard steps, the placement written on release and the frame buttons a `controls` list shows
 */

/** A window's box in pixels from the top left of its layout box */
export interface Box {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** The size of the layout box the window sits in */
export interface Area {
    readonly width: number;
    readonly height: number;
}

/** The smallest size a resize leaves */
export interface MinSize {
    readonly width: number;
    readonly height: number;
}

/** The edge a resize grip drags: the right edge, the bottom edge or the bottom-right corner */
export type Edge = 'e' | 's' | 'se';

/** How much of the title bar stays inside the layout box, in pixels */
export const KEEP_VISIBLE = 48;

/** How far one arrow key moves or resizes, in pixels */
export const KEY_STEP = 16;

/** The frame buttons, in the order they show */
export const CONTROLS = ['snapLeft', 'snapRight', 'minimize', 'maximize', 'close'] as const;
export type Control = (typeof CONTROLS)[number];

export const DEFAULT_CONTROLS: readonly Control[] = ['minimize', 'maximize', 'close'];

const round = (value: number): number => Math.round(value);

/** Keeps at least `KEEP_VISIBLE` pixels of the title bar inside the area, and the top edge inside it */
export function clampMove(box: Box, area: Area): Box {
    const minX = KEEP_VISIBLE - box.width;
    const maxX = Math.max(minX, area.width - KEEP_VISIBLE);
    const maxY = Math.max(0, area.height - KEEP_VISIBLE);
    return {
        ...box,
        x: round(Math.min(Math.max(box.x, minX), maxX)),
        y: round(Math.min(Math.max(box.y, 0), maxY))
    };
}

/** The box moved by `dx` and `dy` from `start`, kept inside the area */
export function moveBy(start: Box, dx: number, dy: number, area: Area): Box {
    return clampMove({ ...start, x: start.x + dx, y: start.y + dy }, area);
}

/**
 * The box resized at `edge` by `dx` and `dy` from `start`: never under `min`, and never past the right or bottom edge
 * of the area (unless the window already reaches past it, when it keeps its size there)
 */
export function resizeBy(start: Box, edge: Edge, dx: number, dy: number, area: Area, min: MinSize): Box {
    const size = (from: number, delta: number, room: number, least: number): number =>
        Math.min(Math.max(from + delta, least), Math.max(room, from, least));
    return {
        ...start,
        width: round(edge === 's' ? start.width : size(start.width, dx, area.width - start.x, min.width)),
        height: round(edge === 'e' ? start.height : size(start.height, dy, area.height - start.y, min.height))
    };
}

/** What an arrow key does: a move without Shift and a resize of the bottom-right corner with it; undefined for other keys */
export function keyStep(key: string, shift: boolean): { kind: 'move' | 'resize'; dx: number; dy: number } | undefined {
    const steps: Record<string, readonly [number, number]> = {
        ArrowLeft: [-KEY_STEP, 0],
        ArrowRight: [KEY_STEP, 0],
        ArrowUp: [0, -KEY_STEP],
        ArrowDown: [0, KEY_STEP]
    };
    const step = Object.hasOwn(steps, key) ? steps[key] : undefined;
    if (step === undefined) return undefined;
    return { kind: shift ? 'resize' : 'move', dx: step[0], dy: step[1] };
}

/** The placement fields a box is written as: whole pixels */
export function placementOf(box: Box): { x: string; y: string; width: string; height: string } {
    return { x: `${round(box.x)}px`, y: `${round(box.y)}px`, width: `${round(box.width)}px`, height: `${round(box.height)}px` };
}

/** True when two boxes are the same in whole pixels */
export function sameBox(a: Box, b: Box): boolean {
    return round(a.x) === round(b.x) && round(a.y) === round(b.y) && round(a.width) === round(b.width) && round(a.height) === round(b.height);
}

/** Which frame buttons show, from a `controls` value: the known names it lists; the default for anything that is not a list */
export function shownControls(value: unknown): Record<Control, boolean> {
    const listed: readonly unknown[] = Array.isArray(value) ? value : DEFAULT_CONTROLS;
    const shown = {} as Record<Control, boolean>;
    for (const control of CONTROLS) shown[control] = listed.includes(control);
    return shown;
}

/** True for a placement the window can move: an object with `x` and `y`, as an `adhoc` layout places a child */
export function isMovablePlacement(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) && 'x' in value && 'y' in value;
}
