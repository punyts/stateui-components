import type { ControllerContext } from '@punyts/stateui';
import { isLeftToViewport } from '../shared/gestures/gestures.js';

interface CommandHost {
    commands?: Record<string, (value: unknown, payload: unknown) => void>;
}

interface View {
    x: number;
    y: number;
    zoom: number;
}

interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** A press that may become a pan, or a pinch of two pointers */
interface Gesture {
    readonly pointers: Map<number, { x: number; y: number }>;
    /** Where the gesture started and the view then, for a pan */
    startX: number;
    startY: number;
    start: View;
    /** The distance and middle of the two pointers when the pinch started */
    distance: number;
    middle: { x: number; y: number };
    moved: boolean;
    /** The gesture started on the empty area, not on the content */
    empty: boolean;
}

/** How far a pointer moves before a press becomes a pan, in pixels */
const SLOP = 4;
/** The factor of one zoom step */
const STEP = 1.25;
/** The space kept around the content by `fit` and around a box by `lookAt`, in pixels */
const MARGIN = 24;
/** How far an arrow key pans, in pixels */
const NUDGE = 40;
/** Elements a press acts on itself, so it never starts a pan */
const FIELDS = 'input, select, textarea, [contenteditable]';
/**
 * Content that takes the pointer itself, marked by its component: `data-own-gestures="drag"` keeps presses and drags (a
 * card a `board` moves), `"all"` the wheel as well (a live `embeddedApp`, whose app scrolls). Marked content may leave
 * one press to the viewport (`leaveToViewport`), such as a board's press on no card
 */
const OWN_DRAGS = '[data-own-gestures]';
const OWN_WHEEL = '[data-own-gestures="all"]';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** A box from a command's value, or from the `box` of the event that ran it (a `treeDiagram`'s `select` and `open`) */
function boxOf(value: unknown, payload: unknown): Box | undefined {
    for (const candidate of [value, isRecord(payload) ? payload['box'] : undefined, payload]) {
        if (!isRecord(candidate)) continue;
        const [x, y, width, height] = ['x', 'y', 'width', 'height'].map((name) => candidate[name]);
        if ([x, y, width, height].every((number) => typeof number === 'number' && Number.isFinite(number))) return { x, y, width, height } as Box;
    }
    return undefined;
}

/**
 * Pans and zooms its `content` with one transform. The view is state: `x` and `y` are where the content's origin stands
 * in the viewport, in pixels, and `zoom` its scale, kept between `minZoom` and `maxZoom`; a document links them to keep
 * the view, and any write to them moves it. A drag pans (it starts once the pointer has moved a few pixels, so a press
 * on the content still reaches it, and the click that ends a drag does not); a wheel pans, and with Ctrl (a trackpad's
 * pinch) zooms around the pointer; two fingers pinch and pan. With the viewport focused the arrows pan, + and - zoom and
 * 0 resets. Content that takes the pointer itself is left alone: a press inside an element marked `data-own-gestures`
 * never pans, and with `data-own-gestures="all"` neither does the wheel. A drag selects no text and drags nothing out of the content. While a gesture runs the view is written at most once a frame, and `change` ({ x, y, zoom }) is raised when
 * it ends, and after each command. A press on the empty area, not the content, that does not pan raises `press`.
 *
 * `inset` ({ top, right, bottom, left } in pixels) is the part of the viewport something covers, such as a floating
 * panel: the commands work in the area it leaves free. `zoomIn` and `zoomOut` zoom by a step around the middle of that
 * area, `zoomReset` to 1; `fit` (a number value: the margin) shows the whole content, at most at zoom 1; `lookAt` brings
 * a box of the content ({ x, y, width, height }, the value or the `box` of the event's payload) into view, moving as
 * little as it can and keeping the zoom. The content is measured at its own size (`offsetWidth`, `offsetHeight`)
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const part = (selector: string): HTMLElement | null => element.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
    /** Whether the event's target is in content of this viewport that matches `selector`: what holds the viewport itself (a live `embeddedApp` its page runs in) does not count */
    const inside = (event: Event, selector: string): boolean => {
        for (const target of event.composedPath()) {
            if (target === element) return false;
            if (target instanceof Element && target.matches(selector)) return true;
        }
        return false;
    };
    const limits = (): { min: number; max: number } => {
        const min = Math.max(0.01, finite(read('minZoom'), 0.1));
        return { min, max: Math.max(min, finite(read('maxZoom'), 4)) };
    };
    const clampZoom = (zoom: number): number => {
        const { min, max } = limits();
        return Math.min(max, Math.max(min, zoom));
    };
    const view = (): View => ({ x: finite(read('x'), 0), y: finite(read('y'), 0), zoom: clampZoom(finite(read('zoom'), 1)) });
    let disposed = false;
    let pending: View | undefined;
    let frame = 0;
    let gesture: Gesture | undefined;
    let swallowClick = false;
    let wheelEnd: ReturnType<typeof setTimeout> | undefined;

    const write = (next: View): void => {
        const now = view();
        const round = (value: number): number => Math.round(value * 100) / 100;
        const values: [keyof View, number][] = [['x', round(next.x)], ['y', round(next.y)], ['zoom', Math.round(clampZoom(next.zoom) * 10000) / 10000]];
        for (const [name, value] of values) {
            if (now[name] !== value || read(name) !== value) store.set(`${basePath}.${name}`, value);
        }
    };
    /** Writes the view on the next frame: a gesture moves it many times a frame */
    const later = (next: View): void => {
        pending = next;
        if (frame !== 0) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            if (pending !== undefined && !disposed) write(pending);
            pending = undefined;
        });
    };
    const flush = (): void => {
        if (frame !== 0) cancelAnimationFrame(frame);
        frame = 0;
        if (pending !== undefined) write(pending);
        pending = undefined;
    };
    const raise = (): void => {
        element.dispatchEvent(new CustomEvent('change', { detail: view(), bubbles: true, composed: true }));
    };
    const current = (): View => pending ?? view();

    /** The viewport's box on the screen and the area `inset` leaves free in it, in viewport pixels */
    const area = (): { rect: DOMRect; left: number; top: number; width: number; height: number } => {
        const rect = (part('.viewport') ?? element).getBoundingClientRect();
        const inset = read('inset');
        const side = (name: string): number => Math.max(0, isRecord(inset) ? finite(inset[name], 0) : 0);
        const left = side('left');
        const top = side('top');
        return { rect, left, top, width: Math.max(1, rect.width - left - side('right')), height: Math.max(1, rect.height - top - side('bottom')) };
    };
    /** The view zoomed to `zoom` with the point `px`, `py` of the viewport staying where it is */
    const zoomAround = (from: View, zoom: number, px: number, py: number): View => {
        const next = clampZoom(zoom);
        const factor = next / from.zoom;
        return { x: px - (px - from.x) * factor, y: py - (py - from.y) * factor, zoom: next };
    };
    const middle = (): { x: number; y: number } => {
        const free = area();
        return { x: free.left + free.width / 2, y: free.top + free.height / 2 };
    };
    const zoomBy = (factor: number): void => {
        const at = middle();
        const from = current();
        write(zoomAround(from, from.zoom * factor, at.x, at.y));
        raise();
    };

    const fit = (value: unknown): void => {
        const content = part('.world');
        if (content === null) return;
        const width = content.offsetWidth;
        const height = content.offsetHeight;
        if (width <= 0 || height <= 0) return;
        const margin = Math.max(0, finite(value, MARGIN));
        const free = area();
        const zoom = clampZoom(Math.min(1, (free.width - 2 * margin) / width, (free.height - 2 * margin) / height));
        write({ x: free.left + (free.width - width * zoom) / 2, y: free.top + (free.height - height * zoom) / 2, zoom });
        raise();
    };

    /** Moves the view as little as it can for the box to stand inside the free area, its leading edges first */
    const lookAt = (value: unknown, payload: unknown): void => {
        const box = boxOf(value, payload);
        if (box === undefined) return;
        const free = area();
        const now = current();
        const shift = (start: number, size: number, areaStart: number, areaSize: number): number => {
            const low = areaStart + MARGIN;
            const high = areaStart + areaSize - MARGIN;
            if (start < low || size > high - low) return low - start;
            if (start + size > high) return high - (start + size);
            return 0;
        };
        const dx = shift(now.x + box.x * now.zoom, box.width * now.zoom, free.left, free.width);
        const dy = shift(now.y + box.y * now.zoom, box.height * now.zoom, free.top, free.height);
        if (dx === 0 && dy === 0) return;
        write({ x: now.x + dx, y: now.y + dy, zoom: now.zoom });
        raise();
    };

    const host = element as Element & CommandHost;
    host.commands = {
        zoomIn: () => zoomBy(STEP),
        zoomOut: () => zoomBy(1 / STEP),
        zoomReset: () => zoomBy(1 / current().zoom),
        fit: (value) => fit(value),
        lookAt: (value, payload) => lookAt(value, payload)
    };

    /** The click that ends a pan is the pan's, not the content's */
    const onClickCapture = (event: Event): void => {
        if (!swallowClick) return;
        swallowClick = false;
        event.stopPropagation();
        event.preventDefault();
    };
    element.addEventListener('click', onClickCapture, true);

    /** A drag pans: it never drags a link, an image or a picture out of the content */
    const onDragStart = (event: Event): void => {
        if (read('pannable') !== false) event.preventDefault();
    };
    element.addEventListener('dragstart', onDragStart, true);

    const local = (event: PointerEvent | WheelEvent): { x: number; y: number } => {
        const rect = area().rect;
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const pinchOf = (pointers: Map<number, { x: number; y: number }>): { distance: number; middle: { x: number; y: number } } => {
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        return { distance: Math.hypot(a.x - b.x, a.y - b.y), middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    };
    /** Starts the gesture again from where it is: when a second finger comes or one of two lifts */
    const restart = (state: Gesture): void => {
        state.start = current();
        const first = [...state.pointers.values()][0];
        if (first !== undefined) {
            state.startX = first.x;
            state.startY = first.y;
        }
        if (state.pointers.size === 2) Object.assign(state, pinchOf(state.pointers));
    };

    return {
        onPointerDown: (event: PointerEvent) => {
            if (read('pannable') === false || (event.pointerType === 'mouse' && event.button !== 0)) return;
            if (inside(event, FIELDS) || (inside(event, OWN_DRAGS) && !isLeftToViewport(event))) return;
            const at = local(event);
            if (gesture === undefined) {
                const target = event.composedPath()[0];
                gesture = { pointers: new Map(), startX: at.x, startY: at.y, start: current(), distance: 0, middle: at, moved: false, empty: target === part('.viewport') || target === part('.world') };
            }
            gesture.pointers.set(event.pointerId, at);
            restart(gesture);
        },
        onPointerMove: (event: PointerEvent) => {
            const state = gesture;
            if (state === undefined || !state.pointers.has(event.pointerId)) return;
            const at = local(event);
            state.pointers.set(event.pointerId, at);
            if (state.pointers.size >= 2) {
                const pinch = pinchOf(state.pointers);
                const zoomed = zoomAround(state.start, state.start.zoom * (pinch.distance / Math.max(1, state.distance)), state.middle.x, state.middle.y);
                state.moved = true;
                later({ ...zoomed, x: zoomed.x + pinch.middle.x - state.middle.x, y: zoomed.y + pinch.middle.y - state.middle.y });
                return;
            }
            const dx = at.x - state.startX;
            const dy = at.y - state.startY;
            if (!state.moved && Math.hypot(dx, dy) < SLOP) return;
            if (!state.moved) {
                state.moved = true;
                try {
                    part('.viewport')?.setPointerCapture(event.pointerId);
                } catch {
                    //a pointer the browser no longer tracks cannot be captured; the pan goes on without it
                }
                part('.viewport')?.setAttribute('data-panning', '');
            }
            later({ x: state.start.x + dx, y: state.start.y + dy, zoom: state.start.zoom });
        },
        onPointerUp: (event: PointerEvent) => {
            const state = gesture;
            if (state === undefined || !state.pointers.delete(event.pointerId)) return;
            if (state.pointers.size > 0) {
                restart(state);
                return;
            }
            gesture = undefined;
            part('.viewport')?.removeAttribute('data-panning');
            if (!state.moved) {
                if (state.empty) element.dispatchEvent(new CustomEvent('press', { detail: {}, bubbles: true, composed: true }));
                return;
            }
            swallowClick = event.type === 'pointerup';
            //the click, if one comes, follows this event in the same task
            setTimeout(() => {
                swallowClick = false;
            }, 0);
            flush();
            raise();
        },
        onWheel: (event: WheelEvent) => {
            if (read('pannable') === false || inside(event, OWN_WHEEL)) return;
            event.preventDefault();
            const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
            const from = current();
            if (event.ctrlKey || event.metaKey) {
                const at = local(event);
                later(zoomAround(from, from.zoom * Math.exp((-event.deltaY * scale) / 300), at.x, at.y));
            } else {
                const dx = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
                const dy = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
                later({ x: from.x - dx * scale, y: from.y - dy * scale, zoom: from.zoom });
            }
            clearTimeout(wheelEnd);
            wheelEnd = setTimeout(() => {
                if (disposed) return;
                flush();
                raise();
            }, 150);
        },
        onKeyDown: (event: KeyboardEvent) => {
            if (event.target !== part('.viewport') || event.altKey || event.ctrlKey || event.metaKey) return;
            const from = current();
            const moves: Record<string, [number, number]> = { ArrowLeft: [NUDGE, 0], ArrowRight: [-NUDGE, 0], ArrowUp: [0, NUDGE], ArrowDown: [0, -NUDGE] };
            const move = moves[event.key];
            if (move !== undefined) {
                write({ x: from.x + move[0], y: from.y + move[1], zoom: from.zoom });
                raise();
            } else if (event.key === '+' || event.key === '=') zoomBy(STEP);
            else if (event.key === '-') zoomBy(1 / STEP);
            else if (event.key === '0') zoomBy(1 / from.zoom);
            else return;
            event.preventDefault();
        },
        dispose: () => {
            disposed = true;
            if (frame !== 0) cancelAnimationFrame(frame);
            clearTimeout(wheelEnd);
            element.removeEventListener('click', onClickCapture, true);
            element.removeEventListener('dragstart', onDragStart, true);
            delete host.commands;
        }
    };
}
