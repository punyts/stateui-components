import type { ControllerContext } from '@punyts/stateui';
import { passedThreshold } from '../shared/drag/drag.js';
import { isMovablePlacement, keyStep, moveBy, placementOf, resizeBy, sameBox, shownControls } from '../shared/window/geometry.js';
import type { Area, Box, Control, Edge } from '../shared/window/geometry.js';

interface Drag {
    readonly kind: 'move' | 'resize';
    readonly edge: Edge;
    readonly pointer: number;
    readonly target: HTMLElement;
    readonly startX: number;
    readonly startY: number;
    readonly start: Box;
    readonly area: Area;
    /** A move starts once the pointer has passed the drag threshold; a resize at once */
    started: boolean;
    /** The box the window shows now; written to `placement` once, on pointer up */
    live: Box;
}

const CONTROL_NAMES: readonly string[] = ['snapLeft', 'snapRight', 'minimize', 'maximize', 'close'];

/**
 * A window on an `adhoc` layout. The frame buttons raise their events (`snapLeft`, `snapRight`, `minimize`, `maximize`,
 * `close`) and do nothing else: the app decides what they mean. A pointer down anywhere in the window, or focus moving
 * into it from outside, raises `activate` once. A drag of the title bar moves the window and a drag of the right edge,
 * bottom edge or corner resizes it; while it runs only the element's inline `translate`, `width` and `height` change,
 * and on release the new box is written to the node's `placement` as pixels (one write, which reaches the data when the
 * placement is linked) and one `move` or `resize` is raised with `{ x, y, width, height }`. Escape or a cancelled
 * pointer puts the window back. Arrow keys on the focused title move it by 16 px and Shift with an arrow resizes it,
 * writing at once; Enter and a double click on the title bar raise `maximize`. A window whose placement has no `x` and
 * `y` (one not in an `adhoc` layout), a `maximized` one, or one with `movable` or `resizable` off, is not dragged
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as HTMLElement;
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const placementPath = `${basePath}.placement`;
    const raise = (name: string, detail?: unknown): void => {
        host.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
    };

    // Which buttons show, and the maximize button's glyph; written only when they change, so a host that answers every
    // write (by saving the state, say) never loops through here
    const refresh = (): void => {
        const show = shownControls(read('controls'));
        if (JSON.stringify(show) !== JSON.stringify(read('show'))) store.set(`${basePath}.show`, show);
        const glyph = read('maximized') === true ? 'squares' : 'square';
        if (read('maximizeGlyph') !== glyph) store.set(`${basePath}.maximizeGlyph`, glyph);
    };
    const watched = [`${basePath}.controls`, `${basePath}.maximized`];
    store.on(watched, refresh);
    refresh();

    // activate: once per press, and when focus comes in from outside
    let pressed = false;
    const onPress = (): void => {
        pressed = true;
        setTimeout(() => {
            pressed = false;
        }, 0);
        raise('activate');
    };
    const onFocusIn = (event: FocusEvent): void => {
        if (pressed || event.relatedTarget === host || (event.relatedTarget instanceof Node && host.contains(event.relatedTarget))) return;
        raise('activate');
    };
    host.addEventListener('pointerdown', onPress, { capture: true });
    host.addEventListener('focusin', onFocusIn);

    /** The layout box the window sits in: the nearest `layout-host` above it */
    const layoutBox = (): HTMLElement | null => {
        let parent = host.parentElement;
        while (parent && !parent.hasAttribute('layout-host')) parent = parent.parentElement;
        return parent;
    };
    const canDrag = (kind: 'move' | 'resize'): boolean =>
        read('maximized') !== true && read(kind === 'move' ? 'movable' : 'resizable') !== false && isMovablePlacement(read('placement')) && layoutBox() !== null;
    /** The window's box and the area, measured: a placement in percent or any length becomes pixels */
    const measure = (): { box: Box; area: Area } | undefined => {
        const parent = layoutBox();
        if (!parent) return undefined;
        const outer = parent.getBoundingClientRect();
        const inner = host.getBoundingClientRect();
        return {
            box: { x: inner.left - outer.left - parent.clientLeft, y: inner.top - outer.top - parent.clientTop, width: inner.width, height: inner.height },
            area: { width: parent.clientWidth, height: parent.clientHeight }
        };
    };
    const minSize = () => ({ width: Number(read('minWidth')) || 0, height: Number(read('minHeight')) || 0 });

    /** Shows a box without writing it */
    const show = (drag: Drag, box: Box): void => {
        host.style.translate = `${box.x - drag.start.x}px ${box.y - drag.start.y}px`;
        if (drag.kind === 'resize') {
            host.style.width = `${box.width}px`;
            host.style.height = `${box.height}px`;
        }
    };
    const unshow = (): void => {
        host.style.removeProperty('translate');
        host.style.removeProperty('width');
        host.style.removeProperty('height');
    };
    /** Writes the box into the placement (keeping its other fields, such as `z`) and raises `move` or `resize` */
    const commit = (kind: 'move' | 'resize', box: Box): void => {
        const current = read('placement');
        const fields = placementOf(box);
        store.set(placementPath, { ...(isMovablePlacement(current) ? current : {}), ...fields } as never);
        raise(kind, { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) });
    };

    let drag: Drag | undefined;
    const onEscape = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape' || !drag) return;
        event.preventDefault();
        const ended = drag;
        drag = undefined;
        if (ended.target.hasPointerCapture(ended.pointer)) ended.target.releasePointerCapture(ended.pointer);
        unshow();
        document.removeEventListener('keydown', onEscape, true);
    };
    const begin = (event: PointerEvent, kind: 'move' | 'resize', edge: Edge): void => {
        const target = event.currentTarget as HTMLElement | null;
        const measured = measure();
        if (!target || !measured) return;
        try {
            target.setPointerCapture(event.pointerId);
        } catch {
            // a pointer the browser does not know (a synthetic one) cannot be captured; the drag still runs
        }
        drag = {
            kind,
            edge,
            pointer: event.pointerId,
            target,
            startX: event.clientX,
            startY: event.clientY,
            start: measured.box,
            area: measured.area,
            started: kind === 'resize',
            live: measured.box
        };
        document.addEventListener('keydown', onEscape, true);
    };
    const finish = (event: PointerEvent): Drag | undefined => {
        const ended = drag;
        if (!ended || event.pointerId !== ended.pointer) return undefined;
        drag = undefined;
        if (ended.target.hasPointerCapture(event.pointerId)) ended.target.releasePointerCapture(event.pointerId);
        document.removeEventListener('keydown', onEscape, true);
        return ended;
    };

    /** A keyboard move or resize: measured, stepped and written at once */
    const step = (kind: 'move' | 'resize', dx: number, dy: number): void => {
        const measured = measure();
        if (!measured) return;
        const box = kind === 'move' ? moveBy(measured.box, dx, dy, measured.area) : resizeBy(measured.box, 'se', dx, dy, measured.area, minSize());
        if (!sameBox(box, measured.box)) commit(kind, box);
    };

    return {
        onControl: (event: MouseEvent) => {
            const name = (event.currentTarget as HTMLElement | null)?.dataset['control'];
            if (name !== undefined && CONTROL_NAMES.includes(name)) raise(name as Control);
        },
        onTitleDoubleClick: (event: MouseEvent) => {
            if ((event.target as Element | null)?.closest('button')) return;
            raise('maximize');
        },
        onHandleKeyDown: (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                raise('maximize');
                return;
            }
            const next = keyStep(event.key, event.shiftKey);
            if (next === undefined || !canDrag(next.kind)) return;
            event.preventDefault();
            step(next.kind, next.dx, next.dy);
        },
        onTitlePointerDown: (event: PointerEvent) => {
            if (event.button !== 0 || (event.target as Element | null)?.closest('button') || !canDrag('move')) return;
            begin(event, 'move', 'se');
        },
        onGripPointerDown: (event: PointerEvent) => {
            const edge = (event.currentTarget as HTMLElement | null)?.dataset['edge'] as Edge | undefined;
            if (event.button !== 0 || edge === undefined || !canDrag('resize')) return;
            event.preventDefault();
            begin(event, 'resize', edge);
        },
        onPointerMove: (event: PointerEvent) => {
            if (!drag || event.pointerId !== drag.pointer) return;
            if (!drag.started) {
                if (!passedThreshold(drag.startX, drag.startY, event.clientX, event.clientY)) return;
                drag.started = true;
            }
            const dx = event.clientX - drag.startX;
            const dy = event.clientY - drag.startY;
            drag.live = drag.kind === 'move' ? moveBy(drag.start, dx, dy, drag.area) : resizeBy(drag.start, drag.edge, dx, dy, drag.area, minSize());
            show(drag, drag.live);
        },
        onPointerUp: (event: PointerEvent) => {
            const ended = finish(event);
            if (!ended) return;
            // the placement is written first, so the box never jumps back between the two
            if (ended.started && !sameBox(ended.live, ended.start)) commit(ended.kind, ended.live);
            unshow();
        },
        onPointerCancel: (event: PointerEvent) => {
            if (finish(event)) unshow();
        },
        dispose: () => {
            store.off(watched, refresh);
            host.removeEventListener('pointerdown', onPress, { capture: true });
            host.removeEventListener('focusin', onFocusIn);
            document.removeEventListener('keydown', onEscape, true);
            unshow();
        }
    };
}
