import type { JsonValue } from '@punyts/stateui-app/core';
import { IMAGE_FILE_TYPES, isFileRef, readImageBitmap, transferCode } from '../field/files.js';
import type { ReadStoredFile, StoredFile } from '../field/files.js';
import { fitViewBox } from './geometry.js';
import type { Bounds, Fit } from './geometry.js';
import { Unusable } from './shapeReader.js';

/**
 * The pictures of `drawImage` (G1.9b of the graphics epic 1): what a `src` is, how each renderer loads it, and where a
 * picture lies in its box. A `src` is a `data:` URL of a png, jpeg, gif or webp picture, or the reference of such a file
 * of the app's store, read through the host (`ui-file-read`, the feeder's `readFile`). The runtime frame's policy has
 * `img-src data:` and no `blob:` and no network, so the SVG renderer shows a file as a `data:` URL built from its bytes,
 * and the canvas renderer draws the decoded `ImageBitmap` (`createImageBitmap` on a `Blob`, which `img-src` does not
 * govern; a `data:` URL is decoded through an `img` first)
 */

/** Where a picture comes from: a `data:` URL as written, or a stored file by its id */
export type ImageSource =
    | { readonly kind: 'data'; readonly key: string; readonly url: string }
    | { readonly kind: 'file'; readonly key: string; readonly id: string; readonly type: string };

/** The head of a `data:` URL and its media type */
const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+)[;,]/i;

/** The reason a `src` is refused with (`SUI-RUN-DRAW`); the document check refuses the same values as `SUI-STATE-INVALID` */
const NOT_A_PICTURE = 'property "src" is not a data: URL of a png, jpeg, gif or webp picture, or the reference of such a file';

/**
 * The source of a `drawImage`'s `src`, or undefined when it is unset. Throws `Unusable` for any other value: a `data:`
 * URL of another type (an SVG among them), a file of another type, or text that is not a `data:` URL
 */
export function imageSourceOf(value: JsonValue | undefined): ImageSource | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'string') {
        const type = DATA_URL.exec(value)?.[1]?.toLowerCase();
        if (type !== undefined && IMAGE_FILE_TYPES.includes(type)) return { kind: 'data', key: value, url: value };
    } else if (isFileRef(value) && IMAGE_FILE_TYPES.includes(value.type)) {
        return { kind: 'file', key: `file:${value.id}`, id: value.id, type: value.type };
    }
    throw new Unusable(NOT_A_PICTURE);
}

/** Where a picture of `width` by `height` pixels is drawn in its box by `fit`, and whether it must be cut to the box (`cover`) */
export interface PlacedImage extends Bounds {
    readonly clip: boolean;
}

/**
 * Places a picture in a `drawImage`'s box as SVG's `preserveAspectRatio` does (`contain` is `xMidYMid meet`, `cover`
 * `xMidYMid slice`, `stretch` `none`), for the canvas renderer
 */
export function placeImage(fit: Fit, imageWidth: number, imageHeight: number, box: Bounds): PlacedImage {
    if (!(imageWidth > 0) || !(imageHeight > 0) || !(box.width > 0) || !(box.height > 0)) return { x: box.x, y: box.y, width: 0, height: 0, clip: false };
    const view = fitViewBox({ x: 0, y: 0, width: imageWidth, height: imageHeight }, box.width, box.height, fit);
    return { x: box.x + view.offsetX, y: box.y + view.offsetY, width: imageWidth * view.scaleX, height: imageHeight * view.scaleY, clip: fit === 'cover' };
}

/** What the loader knows of a source: still loading, loaded, or failed with a reason (`not_found`, `not_an_image`, …) */
export type ImageState<T> = { readonly status: 'pending' } | { readonly status: 'ready'; readonly value: T } | { readonly status: 'failed'; readonly reason: string };

export interface ImageLoaderOptions<T> {
    /** Loads a source; rejects with `{ reason }` */
    load(source: ImageSource, signal: AbortSignal): Promise<T>;
    /** Lets go of a loaded value that is no longer used (closes a bitmap) */
    release?(value: T): void;
    /** Called once a load has ended, loaded or failed, so the renderer draws again */
    onSettled(): void;
}

/** One cache of loaded pictures per renderer, by source */
export interface ImageLoader<T> {
    /** The state of a source, starting its load when it is new; marks it used until the next `sweep` */
    use(source: ImageSource): ImageState<T>;
    /** Drops (aborts or releases) the sources not used since the last sweep; a renderer sweeps after each update */
    sweep(): void;
    /** Resolves once no load is under way (the renderer then draws what loaded) */
    settled(): Promise<void>;
    dispose(): void;
}

interface Entry<T> {
    state: ImageState<T>;
    readonly abort: AbortController;
    readonly done: Promise<void>;
}

const reasonOf = (error: unknown): string => {
    const reason = typeof error === 'object' && error !== null ? (error as { reason?: unknown }).reason : undefined;
    return typeof reason === 'string' && reason !== '' ? reason : 'internal';
};

export function createImageLoader<T>(options: ImageLoaderOptions<T>): ImageLoader<T> {
    const entries = new Map<string, Entry<T>>();
    let used = new Set<string>();
    let disposed = false;

    const drop = (key: string): void => {
        const entry = entries.get(key);
        if (entry === undefined) return;
        entries.delete(key);
        entry.abort.abort();
        if (entry.state.status === 'ready') options.release?.(entry.state.value);
    };

    return {
        use(source: ImageSource): ImageState<T> {
            used.add(source.key);
            const known = entries.get(source.key);
            if (known !== undefined) return known.state;
            if (disposed) return { status: 'pending' };
            const abort = new AbortController();
            const entry: Entry<T> = {
                state: { status: 'pending' },
                abort,
                done: Promise.resolve()
                    .then(() => options.load(source, abort.signal))
                    .then(
                        (value) => {
                            if (abort.signal.aborted) {
                                options.release?.(value);
                                return;
                            }
                            entry.state = { status: 'ready', value };
                            options.onSettled();
                        },
                        (error: unknown) => {
                            if (abort.signal.aborted) return;
                            entry.state = { status: 'failed', reason: reasonOf(error) };
                            options.onSettled();
                        }
                    )
            };
            entries.set(source.key, entry);
            return entry.state;
        },
        sweep(): void {
            for (const key of [...entries.keys()]) if (!used.has(key)) drop(key);
            used = new Set();
        },
        async settled(): Promise<void> {
            for (;;) {
                const pending = [...entries.values()].filter((entry) => entry.state.status === 'pending' && !entry.abort.signal.aborted);
                if (pending.length === 0 || disposed) return;
                await Promise.all(pending.map((entry) => entry.done));
            }
        },
        dispose(): void {
            disposed = true;
            for (const key of [...entries.keys()]) drop(key);
            used = new Set();
        }
    };
}

/** Decodes a picture through an `img` (allowed by `img-src data:`); rejects with `{ reason: 'not_an_image' }` */
function decodeUrl(document: Document, url: string): Promise<HTMLImageElement> {
    const image = document.createElement('img');
    image.src = url;
    return image.decode().then(
        () => image,
        () => {
            throw { reason: 'not_an_image' };
        }
    );
}

/** The bytes of a stored picture as a `data:` URL of its type; rejects with `{ reason }` */
function dataUrlOf(document: Document, stored: StoredFile): Promise<string> {
    const type = stored.file.type.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!IMAGE_FILE_TYPES.includes(type)) return Promise.reject({ reason: 'unsupported_type' });
    const view = document.defaultView;
    if (view === null) return Promise.reject({ reason: 'internal' });
    return new Promise((resolve, reject) => {
        const reader = new view.FileReader();
        reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject({ reason: 'internal' }));
        reader.onerror = () => reject({ reason: 'internal' });
        reader.readAsDataURL(new Blob([stored.data], { type }));
    });
}

/** A source's file read with `readFile`; with none (a feeder that reads no files) it is `offline`, as an unanswered read */
function readOf(readFile: ReadStoredFile | undefined): ReadStoredFile {
    return readFile ?? (() => Promise.reject({ code: 'offline' }));
}

/**
 * The SVG renderer's load: a `data:` URL for the `image` element's `href`, the source's own or one built from the file's
 * bytes. Either is decoded once before it is used, so a picture that does not decode is reported (`not_an_image`) and
 * the drawing is not ready before its pictures are
 */
export function loadImageUrl(document: Document, readFile: ReadStoredFile | undefined): (source: ImageSource, signal: AbortSignal) => Promise<string> {
    const read = readOf(readFile);
    return async (source, signal) => {
        let url: string;
        if (source.kind === 'data') url = source.url;
        else {
            const stored = await read(source.id, signal).catch((error: unknown) => {
                throw { reason: transferCode(error) };
            });
            url = await dataUrlOf(document, stored);
        }
        await decodeUrl(document, url);
        return url;
    };
}

/** The canvas renderer's load: the decoded `ImageBitmap` of a file's bytes, or of a `data:` URL decoded through an `img` */
export function loadImageBitmap(document: Document, readFile: ReadStoredFile | undefined): (source: ImageSource, signal: AbortSignal) => Promise<ImageBitmap> {
    const read = readOf(readFile);
    return async (source, signal) => {
        if (source.kind === 'file') return readImageBitmap(read, source.id, signal);
        const image = await decodeUrl(document, source.url);
        return createImageBitmap(image).catch(() => {
            throw { reason: 'not_an_image' };
        });
    };
}
