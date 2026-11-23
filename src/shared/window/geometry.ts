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

/** The edge or corner a resize grip drags, by compass point: the north and west ones move the window as well */
export type Edge = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const EDGES: readonly Edge[] = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'];

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
 * The box resized at `edge` by `dx` and `dy` from `start`: never under `min`, and never past an edge of the area
 * (unless the window already reaches past it, when it keeps its size there). A north or west edge moves the window, so
 * the opposite edge stays where it was
 */
export function resizeBy(start: Box, edge: Edge, dx: number, dy: number, area: Area, min: MinSize): Box {
    const size = (from: number, delta: number, room: number, least: number): number =>
        Math.min(Math.max(from + delta, least), Math.max(room, from, least));
    const right = start.x + start.width;
    const bottom = start.y + start.height;
    let { x, y, width, height } = start;
    if (edge.includes('e')) width = size(start.width, dx, area.width - start.x, min.width);
    if (edge.includes('w')) {
        width = size(start.width, -dx, right - Math.min(0, start.x), min.width);
        x = right - width;
    }
    if (edge.includes('s')) height = size(start.height, dy, area.height - start.y, min.height);
    if (edge.includes('n')) {
        height = size(start.height, -dy, bottom, min.height);
        y = bottom - height;
    }
    return { x: round(x), y: round(y), width: round(width), height: round(height) };
}

/** What a move dropped at an edge of the area asks for: a half at a side, the whole area at the top */
export type SnapTarget = 'snapLeft' | 'snapRight' | 'maximize';

/** How close to an edge of the area the pointer has to be for a move to snap, in pixels */
export const SNAP_ZONE = 12;

/**
 * Where a move snaps with the pointer at `px`, `py` (from the top left of the area): the left or right edge to that
 * half, the top edge to the whole area, the sides first. Only to what the window's frame buttons offer (`shown`), so a
 * window without a snap button never snaps
 */
export function snapTarget(px: number, py: number, area: Area, shown: Record<Control, boolean>): SnapTarget | undefined {
    if (px <= SNAP_ZONE && shown.snapLeft) return 'snapLeft';
    if (px >= area.width - SNAP_ZONE && shown.snapRight) return 'snapRight';
    if (py <= SNAP_ZONE && shown.maximize) return 'maximize';
    return undefined;
}

/** The box a snap target covers in the area, which the drag shows as a preview */
export function snapBox(target: SnapTarget, area: Area): Box {
    const half = Math.floor(area.width / 2);
    if (target === 'snapLeft') return { x: 0, y: 0, width: half, height: area.height };
    if (target === 'snapRight') return { x: half, y: 0, width: area.width - half, height: area.height };
    return { x: 0, y: 0, width: area.width, height: area.height };
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
