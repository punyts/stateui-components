/**
 * The pure parts of `fileField`'s crop step: the ratios it offers, the part of the picture a frame shows at a zoom and a
 * centre, the size of the cropped picture, and its type and name. The frame always lies inside the picture: at zoom 1 it
 * is the largest rectangle of the ratio the picture holds, and a larger zoom shrinks it about its centre
 */

/** The crop ratios `crop` takes; '' turns the crop step off */
export const CROP_RATIOS = ['', '1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'] as const;

/** The zoom range of the crop step */
export const CROP_ZOOM_MIN = 1;
export const CROP_ZOOM_MAX = 4;

/** The longest edge of a cropped picture, in pixels; a larger crop is scaled down to it */
export const CROP_MAX_EDGE = 2048;

/** The picture types the crop step opens; any other file is sent as it is */
export const CROPPABLE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** A ratio `w:h` as a width over height, or 0 when `ratio` is not one of `CROP_RATIOS` (or is '') */
export function cropRatio(ratio: unknown): number {
    if (typeof ratio !== 'string' || ratio === '' || !(CROP_RATIOS as readonly string[]).includes(ratio)) return 0;
    const [width, height] = ratio.split(':').map(Number) as [number, number];
    return width / height;
}

/** The part of the picture the frame shows, in picture pixels, with the centre it was clamped to */
export interface CropRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly centerX: number;
    readonly centerY: number;
}

/** A zoom clamped to the crop step's range; a value that is not a number is 1 */
export function clampZoom(zoom: number): number {
    return Number.isFinite(zoom) ? Math.min(CROP_ZOOM_MAX, Math.max(CROP_ZOOM_MIN, zoom)) : CROP_ZOOM_MIN;
}

/**
 * The frame of `ratio` (width over height) over a picture of `width` by `height` at `zoom`, centred as near `centerX`,
 * `centerY` as the picture allows
 */
export function cropRect(width: number, height: number, ratio: number, zoom: number, centerX: number, centerY: number): CropRect {
    const scale = clampZoom(zoom);
    const fullWidth = Math.min(width, height * ratio);
    const frameWidth = fullWidth / scale;
    const frameHeight = fullWidth / ratio / scale;
    const halfWidth = frameWidth / 2;
    const halfHeight = frameHeight / 2;
    const cx = Math.min(width - halfWidth, Math.max(halfWidth, Number.isFinite(centerX) ? centerX : width / 2));
    const cy = Math.min(height - halfHeight, Math.max(halfHeight, Number.isFinite(centerY) ? centerY : height / 2));
    return { x: cx - halfWidth, y: cy - halfHeight, width: frameWidth, height: frameHeight, centerX: cx, centerY: cy };
}

/** The pixel size of the cropped picture: the frame's size, scaled down so its longest edge is at most `maxEdge` */
export function croppedSize(rect: Pick<CropRect, 'width' | 'height'>, maxEdge = CROP_MAX_EDGE): { width: number; height: number } {
    const scale = Math.min(1, maxEdge / Math.max(rect.width, rect.height));
    return { width: Math.max(1, Math.round(rect.width * scale)), height: Math.max(1, Math.round(rect.height * scale)) };
}

/** The type a cropped picture is encoded as: its own for PNG, JPEG and WebP; PNG for a GIF (its first frame) */
export function croppedType(type: string): string {
    return type === 'image/jpeg' || type === 'image/webp' ? type : 'image/png';
}

const EXTENSIONS: Readonly<Record<string, string>> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

/** The name of a cropped picture: the original name, its extension changed when the type changed */
export function croppedName(name: string, from: string, to: string): string {
    if (from === to) return name;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    return `${stem}${EXTENSIONS[to] ?? ''}`;
}
