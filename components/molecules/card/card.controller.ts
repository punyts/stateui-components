import type { ControllerContext } from '@punyts/stateui';

/** Controls that keep their own click and keys: the card's `press` ignores events that start in them */
const OWN_ACTION = 'button, a[href], input, select, textarea, summary, [tabindex]';

/** How far the pointer moves, in pixels, before a press on a draggable card becomes a drag */
const DRAG_THRESHOLD = 5;

/** Where the pointer is, in the card's window, as the drag events carry it */
export interface CardDragPoint {
    readonly x: number;
    readonly y: number;
}

/**
 * `press` fires only while `interactive`. A click counts unless it started in a control inside the card (a button in
 * `actions`; a `press` raised inside the card stays inside it), and Enter or Space counts only when the card itself has the focus.
 * The host carries `aria-busy` while `loading`.
 *
 * While `draggable`, the card is a drag source by the pointer (mouse, pen or touch). A press that moves past a few
 * pixels raises `dragStart`, then `dragMove` as the pointer moves and `dragEnd` when it is let go, each with the
 * pointer's `{ x, y }` in the window; `dragEnd` has `cancelled: true` when Escape or the browser ended it. The card
 * keeps the pointer for the whole drag, so a page around a frame of cards learns where it goes from the events. A
 * drag is not a press
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const interactive = (): boolean => store.get(`${basePath}.interactive`) === true;
    const draggable = (): boolean => store.get(`${basePath}.draggable`) === true;
    const press = (): void => {
        element.dispatchEvent(new CustomEvent('press', { bubbles: true, composed: true }));
    };
    const raise = (name: 'dragStart' | 'dragMove' | 'dragEnd', detail: CardDragPoint & { cancelled?: boolean }): void => {
        element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
    };
    const syncBusy = (): void => {
        if (store.get(`${basePath}.loading`) === true) element.setAttribute('aria-busy', 'true');
        else element.removeAttribute('aria-busy');
    };
    store.on([`${basePath}.loading`], syncBusy);
    syncBusy();

    /** The press that may become a drag, and whether it has */
    let held: { id: number; x: number; y: number; dragging: boolean; surface: Element } | null = null;
    /** A drag just ended: the click that follows its pointerup is not a press */
    let dragged = false;
    const end = (point: CardDragPoint, cancelled: boolean): void => {
        const was = held;
        held = null;
        removeEventListener('keydown', onEscape, true);
        if (was === null) return;
        if (was.surface.hasPointerCapture(was.id)) was.surface.releasePointerCapture(was.id);
        if (!was.dragging) return;
        dragged = true;
        setTimeout(() => {
            dragged = false;
        }, 0);
        raise('dragEnd', cancelled ? { ...point, cancelled: true } : point);
    };
    const onEscape = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape' || held === null || !held.dragging) return;
        event.preventDefault();
        event.stopPropagation();
        end({ x: held.x, y: held.y }, true);
    };

    return {
        dispose: () => {
            store.off([`${basePath}.loading`], syncBusy);
            removeEventListener('keydown', onEscape, true);
        },
        onInnerPress: (event: Event) => event.stopPropagation(),
        onClick: (event: Event) => {
            if (!interactive() || dragged) return;
            const surface = event.currentTarget as Element;
            for (const node of event.composedPath()) {
                if (node === surface) break;
                if (node instanceof Element && node.matches(OWN_ACTION)) return;
            }
            press();
        },
        onPointerDown: (event: PointerEvent) => {
            if (!draggable() || event.button !== 0 || !event.isPrimary) return;
            const surface = event.currentTarget as Element;
            for (const node of event.composedPath()) {
                if (node === surface) break;
                if (node instanceof Element && node.matches(OWN_ACTION)) return;
            }
            held = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false, surface };
            try {
                surface.setPointerCapture(event.pointerId);
            } catch {
                // A pointer the browser no longer tracks: the moves still come while it is over the card
            }
        },
        onPointerMove: (event: PointerEvent) => {
            if (held === null || event.pointerId !== held.id) return;
            const point = { x: event.clientX, y: event.clientY };
            if (!held.dragging) {
                if (Math.hypot(point.x - held.x, point.y - held.y) < DRAG_THRESHOLD) return;
                held.dragging = true;
                addEventListener('keydown', onEscape, true);
                raise('dragStart', point);
            }
            held.x = point.x;
            held.y = point.y;
            event.preventDefault();
            raise('dragMove', point);
        },
        onPointerUp: (event: PointerEvent) => {
            if (held === null || event.pointerId !== held.id) return;
            end({ x: event.clientX, y: event.clientY }, false);
        },
        onPointerCancel: (event: PointerEvent) => {
            if (held === null || event.pointerId !== held.id) return;
            end({ x: event.clientX, y: event.clientY }, true);
        },
        onKeyDown: (event: KeyboardEvent) => {
            if (!interactive() || event.target !== event.currentTarget) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            press();
        }
    };
}
