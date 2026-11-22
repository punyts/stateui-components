/**
 * The pictures of `lightbox`: a keyed map `{ <key>: { src, _alt, _caption } }` (the keys in their order, content
 * translated by a locale overlay) or a data array of records `{ id?, src, alt?, caption? }` (the key is `id` when it is
 * text, else the position). A picture whose `src` is not an https URL or a `data:` URL of a picture is left out, as the
 * `image` atom refuses it
 */

/** One picture of the gallery */
export interface GalleryImage {
    readonly key: string;
    readonly src: string;
    readonly alt: string;
    readonly caption: string;
}

/** The sources a picture may come from: an https URL, or inline data of a png, jpeg, gif or webp picture */
const SAFE_SRC = /^(?:https:\/\/|data:image\/(?:png|jpeg|gif|webp)[;,])/i;

/** Whether a `src` may be shown */
export function isSafeImageSrc(src: unknown): src is string {
    return typeof src === 'string' && SAFE_SRC.test(src);
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The gallery's pictures in order */
export function galleryImages(images: unknown): GalleryImage[] {
    const result: GalleryImage[] = [];
    if (Array.isArray(images)) {
        images.forEach((record: unknown, index) => {
            if (record === null || typeof record !== 'object') return;
            const entry = record as Record<string, unknown>;
            if (!isSafeImageSrc(entry.src)) return;
            const id = entry.id;
            result.push({ key: typeof id === 'string' && id !== '' ? id : String(index), src: entry.src, alt: text(entry.alt), caption: text(entry.caption) });
        });
    } else if (images !== null && typeof images === 'object') {
        for (const [key, value] of Object.entries(images as Record<string, unknown>)) {
            if (value === null || typeof value !== 'object') continue;
            const entry = value as Record<string, unknown>;
            if (!isSafeImageSrc(entry.src)) continue;
            result.push({ key, src: entry.src, alt: text(entry._alt), caption: text(entry._caption) });
        }
    }
    return result;
}

/** The position of the active key, the first picture when it is not one of them, -1 for no pictures */
export function galleryIndex(images: readonly GalleryImage[], active: unknown): number {
    if (images.length === 0) return -1;
    const found = images.findIndex((image) => image.key === active);
    return found < 0 ? 0 : found;
}

/** The key one step away (`+1` or `-1`), wrapping when `loop`; undefined at an end without `loop` */
export function galleryStep(images: readonly GalleryImage[], index: number, step: 1 | -1, loop: boolean): string | undefined {
    if (images.length === 0) return undefined;
    let next = index + step;
    if (next < 0 || next >= images.length) {
        if (!loop) return undefined;
        next = (next + images.length) % images.length;
    }
    return images[next]?.key;
}

/** The zoom steps a picture is shown at: fitted, then 1.5, 2, 3 and 4 times */
export const ZOOM_STEPS: readonly number[] = [1, 1.5, 2, 3, 4];

/** The next zoom step in or out from a zoom, staying within the steps */
export function zoomStep(zoom: number, step: 1 | -1): number {
    const index = ZOOM_STEPS.findIndex((value) => value >= zoom - 1e-9);
    const at = index < 0 ? ZOOM_STEPS.length - 1 : index;
    const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, (ZOOM_STEPS[at] === zoom ? at : step > 0 ? at - 1 : at) + step));
    return ZOOM_STEPS[next] as number;
}
