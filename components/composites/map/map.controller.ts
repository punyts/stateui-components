import type { ControllerContext } from '@punyts/stateui';
import { clampMapZoom, coverTiles, normalizeCenter, panBy, placeMarkers, zoomAround } from '../shared/map/map.js';
import type { LatLng, MapView } from '../shared/map/map.js';
import { isUnrendered } from '../shared/records/viewport.js';

interface CommandHost {
    commands?: Record<string, (value: unknown, payload: unknown) => void>;
}

/** How far a pointer moves before a press becomes a pan, in pixels */
const SLOP = 4;
/** How far an arrow key pans, in pixels */
const NUDGE = 64;
/** The zoom one wheel notch or a key changes */
const STEP = 1;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const roundDegrees = (value: number): number => Math.round(value * 1e7) / 1e7;

/**
 * A street map of raster tiles. `tiles` is a URL template with `{z}`, `{x}` and `{y}` (https or a path of the app's own
 * origin, our server's tile route; anything else draws no tiles), `lat`, `lng` and `zoom` are the view, kept between
 * `minZoom` and `maxZoom`, and a document links them to keep it. The tiles covering the view and the markers in it are
 * runtime state (`tileList`, `markerList`), recomputed when the view, its size, the tiles or the markers change; the
 * size comes from a `ResizeObserver`. `markers` is a keyed map or a list of `{ lat, lng, _label }`; pressing a marker
 * writes `selected` and raises `select` ({ key, lat, lng }). A drag pans (the content follows the pointer), the wheel
 * zooms around the pointer, and with the map focused the arrows pan and + and - zoom; `change` ({ lat, lng, zoom }) is
 * raised when a gesture ends and after each command. Commands: `zoomIn`, `zoomOut`, and `lookAt` ({ lat, lng, zoom? },
 * the value or the payload of the event that ran it)
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as Element & CommandHost;
    const path = (name: string): string => `${basePath}.${name}`;
    const read = (name: string): unknown => store.get<unknown>(path(name));
    const part = (selector: string): HTMLElement | null => element.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
    const limits = (): { min: number; max: number } => {
        const min = clampMapZoom(finite(read('minZoom'), 0));
        return { min, max: clampMapZoom(finite(read('maxZoom'), 18), min) };
    };
    const zoomOf = (zoom: number): number => {
        const { min, max } = limits();
        return clampMapZoom(zoom, min, max);
    };
    const view = (): MapView => ({
        center: normalizeCenter(read('lat'), read('lng')),
        zoom: zoomOf(finite(read('zoom'), 2)),
        width: finite(read('width'), 0),
        height: finite(read('height'), 0)
    });

    let disposed = false;
    let observer: ResizeObserver | undefined;
    let frame = 0;
    let pending: { center: LatLng; zoom: number } | undefined;
    let wheelEnd: ReturnType<typeof setTimeout> | undefined;
    let gesture: { id: number; startX: number; startY: number; start: MapView; moved: boolean } | undefined;

    const refresh = (): void => {
        const now = view();
        const { min, max } = limits();
        const template = read('tiles');
        store.set(path('tileList'), coverTiles(now, typeof template === 'string' ? template : ''));
        store.set(path('markerList'), placeMarkers(read('markers'), now, typeof read('selected') === 'string' ? (read('selected') as string) : ''));
        store.set(path('atMin'), now.zoom <= min);
        store.set(path('atMax'), now.zoom >= max);
    };

    const write = (center: LatLng, zoom: number): void => {
        const values: [string, number][] = [
            ['lat', roundDegrees(center.lat)],
            ['lng', roundDegrees(center.lng)],
            ['zoom', Math.round(zoomOf(zoom) * 1000) / 1000]
        ];
        for (const [name, value] of values) if (read(name) !== value) store.set(path(name), value);
    };
    /** Writes the view on the next frame: a gesture moves it many times a frame */
    const later = (center: LatLng, zoom: number): void => {
        pending = { center, zoom };
        if (frame !== 0) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            if (pending !== undefined && !disposed) write(pending.center, pending.zoom);
            pending = undefined;
        });
    };
    const flush = (): void => {
        if (frame !== 0) cancelAnimationFrame(frame);
        frame = 0;
        if (pending !== undefined) write(pending.center, pending.zoom);
        pending = undefined;
    };
    const raiseChange = (): void => {
        const now = view();
        element.dispatchEvent(new CustomEvent('change', { detail: { lat: now.center.lat, lng: now.center.lng, zoom: now.zoom }, bubbles: true, composed: true }));
    };
    const zoomTo = (zoom: number, at?: { left: number; top: number }): void => {
        const now = view();
        const next = zoomOf(zoom);
        write(at === undefined ? now.center : zoomAround(now, next, at), next);
        raiseChange();
    };
    const lookAt = (value: unknown, payload: unknown): void => {
        for (const candidate of [value, payload]) {
            if (!isRecord(candidate)) continue;
            const { lat, lng, zoom } = candidate;
            if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
            write(normalizeCenter(lat, lng), typeof zoom === 'number' && Number.isFinite(zoom) ? zoom : view().zoom);
            raiseChange();
            return;
        }
    };
    /** A pointer's place in the map, in pixels from its top left corner (read from layout at the event, never during a write) */
    const local = (event: { clientX: number; clientY: number }): { left: number; top: number } => {
        const box = part('.map')?.getBoundingClientRect();
        return { left: event.clientX - (box?.left ?? 0), top: event.clientY - (box?.top ?? 0) };
    };

    const watched = [path('lat'), path('lng'), path('zoom'), path('minZoom'), path('maxZoom'), path('tiles'), path('markers'), path('markers.$all'), path('selected'), path('width'), path('height')];
    store.on(watched, refresh);
    refresh();

    const start = (attempts: number): void => {
        if (disposed) return;
        const map = part('.map');
        if (map === null) {
            if (attempts > 0) queueMicrotask(() => start(attempts - 1));
            return;
        }
        observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                if (isUnrendered(entry)) continue;
                const width = Math.round(entry.contentRect.width);
                const height = Math.round(entry.contentRect.height);
                if (read('width') !== width) store.set(path('width'), width);
                if (read('height') !== height) store.set(path('height'), height);
            }
        });
        observer.observe(map);
    };
    queueMicrotask(() => start(8));

    host.commands = {
        zoomIn: () => zoomTo(view().zoom + STEP),
        zoomOut: () => zoomTo(view().zoom - STEP),
        lookAt
    };

    return {
        onPointerDown: (event: PointerEvent): void => {
            if (event.button !== 0 || gesture !== undefined) return;
            const target = event.target as Element | null;
            if (target?.closest('button')) return;
            gesture = { id: event.pointerId, startX: event.clientX, startY: event.clientY, start: view(), moved: false };
            (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
        },
        onPointerMove: (event: PointerEvent): void => {
            if (gesture === undefined || event.pointerId !== gesture.id) return;
            const dx = event.clientX - gesture.startX;
            const dy = event.clientY - gesture.startY;
            if (!gesture.moved && Math.hypot(dx, dy) < SLOP) return;
            if (!gesture.moved) part('.map')?.setAttribute('data-panning', '');
            gesture.moved = true;
            later(panBy(gesture.start, dx, dy), gesture.start.zoom);
        },
        onPointerUp: (event: PointerEvent): void => {
            if (gesture === undefined || event.pointerId !== gesture.id) return;
            const moved = gesture.moved;
            gesture = undefined;
            part('.map')?.removeAttribute('data-panning');
            if (!moved) return;
            flush();
            raiseChange();
        },
        onWheel: (event: WheelEvent): void => {
            event.preventDefault();
            const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
            const now = pending === undefined ? view() : { ...view(), center: pending.center, zoom: pending.zoom };
            const next = zoomOf(now.zoom - (event.deltaY * scale) / 200);
            later(zoomAround(now, next, local(event)), next);
            clearTimeout(wheelEnd);
            wheelEnd = setTimeout(() => {
                if (disposed) return;
                flush();
                raiseChange();
            }, 150);
        },
        onKeyDown: (event: KeyboardEvent): void => {
            if (event.target !== part('.map') || event.altKey || event.ctrlKey || event.metaKey) return;
            const now = view();
            const moves: Record<string, [number, number]> = { ArrowLeft: [NUDGE, 0], ArrowRight: [-NUDGE, 0], ArrowUp: [0, NUDGE], ArrowDown: [0, -NUDGE] };
            const move = moves[event.key];
            if (move !== undefined) {
                write(panBy(now, move[0], move[1]), now.zoom);
                raiseChange();
            } else if (event.key === '+' || event.key === '=') zoomTo(now.zoom + STEP);
            else if (event.key === '-') zoomTo(now.zoom - STEP);
            else return;
            event.preventDefault();
        },
        onMarker: (event: Event): void => {
            const key = (event.currentTarget as HTMLElement | null)?.dataset['key'];
            if (key === undefined) return;
            const markers = read('markers');
            const record = Array.isArray(markers) ? undefined : isRecord(markers) ? markers[key] : undefined;
            const listed = Array.isArray(markers) ? markers.find((item, index) => (isRecord(item) && item['id'] === key) || `m${index}` === key) : undefined;
            const found = isRecord(record) ? record : isRecord(listed) ? listed : {};
            store.set(path('selected'), key);
            element.dispatchEvent(new CustomEvent('select', { detail: { key, lat: found['lat'], lng: found['lng'] }, bubbles: true, composed: true }));
        },
        onZoomIn: (): void => zoomTo(view().zoom + STEP),
        onZoomOut: (): void => zoomTo(view().zoom - STEP),
        dispose: (): void => {
            disposed = true;
            if (frame !== 0) cancelAnimationFrame(frame);
            clearTimeout(wheelEnd);
            observer?.disconnect();
            store.off(watched, refresh);
            delete host.commands;
        }
    };
}
