/**
 * The pure parts of `map`: Web Mercator projection, which raster tiles cover a view and where they and the markers stand,
 * and the tile URL rule. A tile is 256 pixels at its own zoom; the view's zoom may be fractional, and the tiles of the
 * nearest whole zoom are scaled to it. A tile URL is a template with `{z}`, `{x}` and `{y}`, an https URL with a host or
 * a path of the app's own origin (our server's tile route), so the browser never names an outside tile host the
 * document did not
 */

/** The edge of one tile at its own zoom, in pixels */
export const TILE_SIZE = 256;
/** The latitude Web Mercator stops at, where the world is square */
export const MAX_LATITUDE = 85.0511287798;
/** The zoom range a map takes */
export const MAP_ZOOM_MIN = 0;
export const MAP_ZOOM_MAX = 22;

const HTTPS = /^https:\/\/[^/?#@\s{}]+(?:[/?#]|$)/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const UNSAFE = /[\u0000- \u007f-\u009f\\]/;

/** Whether `template` is a tile URL template the map loads: https or a path of the app's own origin, naming `{z}`, `{x}` and `{y}` */
export function isTileTemplate(template: unknown): template is string {
    if (typeof template !== 'string' || template === '' || UNSAFE.test(template)) return false;
    if (!template.includes('{z}') || !template.includes('{x}') || !template.includes('{y}')) return false;
    if (HTTPS.test(template)) return true;
    return !SCHEME.test(template) && !template.startsWith('//') && !template.startsWith('#');
}

/** The URL of one tile, with its coordinates filled in */
export function tileUrl(template: string, z: number, x: number, y: number): string {
    return template.replaceAll('{z}', String(z)).replaceAll('{x}', String(x)).replaceAll('{y}', String(y));
}

/** A point in world pixels at a zoom: x grows east, y grows south */
export interface WorldPoint {
    readonly x: number;
    readonly y: number;
}

/** A place, in degrees */
export interface LatLng {
    readonly lat: number;
    readonly lng: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** The edge of the whole world at `zoom`, in pixels */
export function worldSize(zoom: number): number {
    return TILE_SIZE * 2 ** zoom;
}

/** A longitude brought into [-180, 180) */
export function wrapLng(lng: number): number {
    const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180;
    return wrapped === -180 && lng > 0 ? 180 : wrapped;
}

/** `place` in world pixels at `zoom`; the latitude is clamped to Web Mercator's range */
export function project(place: LatLng, zoom: number): WorldPoint {
    const size = worldSize(zoom);
    const lat = (clamp(place.lat, -MAX_LATITUDE, MAX_LATITUDE) * Math.PI) / 180;
    return {
        x: ((place.lng + 180) / 360) * size,
        y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * size
    };
}

/** The place at world pixel `point` at `zoom` */
export function unproject(point: WorldPoint, zoom: number): LatLng {
    const size = worldSize(zoom);
    const n = Math.PI - (2 * Math.PI * point.y) / size;
    return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lng: (point.x / size) * 360 - 180 };
}

/** A zoom clamped to `min` and `max` (themselves within the map's range); a value that is not a number is `min` */
export function clampMapZoom(zoom: number, min = MAP_ZOOM_MIN, max = MAP_ZOOM_MAX): number {
    const low = clamp(Number.isFinite(min) ? min : MAP_ZOOM_MIN, MAP_ZOOM_MIN, MAP_ZOOM_MAX);
    const high = clamp(Number.isFinite(max) ? max : MAP_ZOOM_MAX, low, MAP_ZOOM_MAX);
    return Number.isFinite(zoom) ? clamp(zoom, low, high) : low;
}

/** A centre with its latitude clamped and its longitude wrapped; a value that is not a number is 0 */
export function normalizeCenter(lat: unknown, lng: unknown): LatLng {
    const read = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
    return { lat: clamp(read(lat), -MAX_LATITUDE, MAX_LATITUDE), lng: wrapLng(read(lng)) };
}

/** One tile as the view draws it: its URL and where it stands in the view, in pixels */
export interface PlacedTile {
    readonly src: string;
    readonly left: number;
    readonly top: number;
    readonly size: number;
}

/** A view: the place at its middle, its zoom and its size in pixels */
export interface MapView {
    readonly center: LatLng;
    readonly zoom: number;
    readonly width: number;
    readonly height: number;
}

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * The tiles that cover `view`, keyed `t<z>_<x>_<y>` by their unwrapped column so a world seen twice has two keys. They
 * come from the nearest whole zoom; columns wrap around the world and rows outside it are left out. No more than
 * `limit` tiles are placed, nearest the middle first
 */
export function coverTiles(view: MapView, template: string, limit = 256): Record<string, PlacedTile> {
    const placed: Record<string, PlacedTile> = {};
    if (!isTileTemplate(template) || !(view.width > 0) || !(view.height > 0)) return placed;
    const tileZoom = clamp(Math.round(view.zoom), MAP_ZOOM_MIN, MAP_ZOOM_MAX);
    const scale = 2 ** (view.zoom - tileZoom);
    const middle = project(view.center, tileZoom);
    const left = middle.x - view.width / 2 / scale;
    const top = middle.y - view.height / 2 / scale;
    const count = 2 ** tileZoom;
    const size = TILE_SIZE * scale;
    const firstX = Math.floor(left / TILE_SIZE);
    const lastX = Math.ceil((left + view.width / scale) / TILE_SIZE) - 1;
    const firstY = Math.max(0, Math.floor(top / TILE_SIZE));
    const lastY = Math.min(count - 1, Math.ceil((top + view.height / scale) / TILE_SIZE) - 1);
    const cells: { x: number; y: number; distance: number }[] = [];
    for (let y = firstY; y <= lastY; y++) {
        for (let x = firstX; x <= lastX; x++) {
            const dx = (x + 0.5) * TILE_SIZE - middle.x;
            const dy = (y + 0.5) * TILE_SIZE - middle.y;
            cells.push({ x, y, distance: dx * dx + dy * dy });
        }
    }
    cells.sort((a, b) => a.distance - b.distance);
    for (const { x, y } of cells.slice(0, Math.max(0, limit))) {
        const column = ((x % count) + count) % count;
        placed[`t${tileZoom}_${x}_${y}`] = { src: tileUrl(template, tileZoom, column, y), left: round((x * TILE_SIZE - left) * scale), top: round((y * TILE_SIZE - top) * scale), size: round(size) };
    }
    return placed;
}

/**
 * Where `place` stands in `view`, in pixels from its top left corner. Of the copies of the world side by side, the one
 * nearest the middle is taken
 */
export function placeInView(place: LatLng, view: MapView): { left: number; top: number } {
    const point = project({ lat: place.lat, lng: wrapLng(place.lng) }, view.zoom);
    const middle = project(view.center, view.zoom);
    const size = worldSize(view.zoom);
    let dx = point.x - middle.x;
    dx -= Math.round(dx / size) * size;
    return { left: round(view.width / 2 + dx), top: round(view.height / 2 + point.y - middle.y) };
}

/** The centre after the view is dragged by `dx`, `dy` pixels: the content follows the pointer */
export function panBy(view: MapView, dx: number, dy: number): LatLng {
    const middle = project(view.center, view.zoom);
    const size = worldSize(view.zoom);
    const y = clamp(middle.y - dy, 0, size);
    const next = unproject({ x: middle.x - dx, y }, view.zoom);
    return { lat: clamp(next.lat, -MAX_LATITUDE, MAX_LATITUDE), lng: wrapLng(next.lng) };
}

/** The centre after zooming to `zoom` around the view point `at` (pixels from the top left), which keeps its place */
export function zoomAround(view: MapView, zoom: number, at: { left: number; top: number }): LatLng {
    const offsetX = at.left - view.width / 2;
    const offsetY = at.top - view.height / 2;
    const before = project(view.center, view.zoom);
    const anchor = unproject({ x: before.x + offsetX, y: before.y + offsetY }, view.zoom);
    const after = project(anchor, zoom);
    const next = unproject({ x: after.x - offsetX, y: after.y - offsetY }, zoom);
    return { lat: clamp(next.lat, -MAX_LATITUDE, MAX_LATITUDE), lng: wrapLng(next.lng) };
}

/** A marker as the view draws it */
export interface PlacedMarker {
    readonly label: string;
    readonly left: number;
    readonly top: number;
    readonly selected: boolean;
}

/**
 * The markers of a keyed map `{ <key>: { lat, lng, _label } }` or a list of records (keyed by `id`, else `m<index>`)
 * placed in `view`; a marker without a numeric `lat` and `lng`, or far outside the view, is left out
 */
export function placeMarkers(markers: unknown, view: MapView, selected: string): Record<string, PlacedMarker> {
    const placed: Record<string, PlacedMarker> = {};
    if (markers === null || typeof markers !== 'object') return placed;
    const entries: [string, unknown][] = Array.isArray(markers)
        ? markers.map((value, index) => {
              const id = value !== null && typeof value === 'object' ? (value as Record<string, unknown>)['id'] : undefined;
              return [typeof id === 'string' && id !== '' && !/^\d+$/.test(id) ? id : `m${index}`, value];
          })
        : Object.entries(markers as Record<string, unknown>);
    const margin = 64;
    for (const [key, value] of entries) {
        if (value === null || typeof value !== 'object') continue;
        const record = value as Record<string, unknown>;
        const { lat, lng } = record;
        if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const at = placeInView({ lat, lng }, view);
        if (at.left < -margin || at.top < -margin || at.left > view.width + margin || at.top > view.height + margin) continue;
        const label = typeof record['_label'] === 'string' ? record['_label'] : typeof record['label'] === 'string' ? record['label'] : key;
        placed[key] = { label, left: at.left, top: at.top, selected: key === selected };
    }
    return placed;
}
