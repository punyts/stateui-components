/** The smallest width or height of a painting, in pixels */
export const MIN_CANVAS_SIZE = 1;

/** The largest width or height of a painting, in pixels (the design's limit for `paintField`) */
export const MAX_CANVAS_SIZE = 4096;

/** The smallest brush size, in pixels */
export const MIN_BRUSH_SIZE = 1;

/** The largest brush size, in pixels; a wider brush is clamped to it */
export const MAX_BRUSH_SIZE = 200;

/** The most entries a `sizes` list keeps; the rest are left out */
export const MAX_SIZES = 12;

/** The brush sizes when `sizes` gives none that can be used */
export const DEFAULT_SIZES: readonly number[] = Object.freeze([2, 4, 8, 16]);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const clampTo = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * A `width` or `height` of a painting: a finite number rounded to whole pixels and clamped to 1..4096. Anything else
 * (a string, NaN, Infinity, a missing value) gives `fallback`, clamped the same way
 */
export function clampDimension(value: unknown, fallback: number): number {
    const chosen = isFiniteNumber(value) ? value : isFiniteNumber(fallback) ? fallback : MIN_CANVAS_SIZE;
    return clampTo(Math.round(chosen), MIN_CANVAS_SIZE, MAX_CANVAS_SIZE);
}

/** The `width` and `height` of a painting, each clamped by `clampDimension` */
export function clampCanvasSize(width: unknown, height: unknown, fallback: { readonly width: number; readonly height: number }): { width: number; height: number } {
    return { width: clampDimension(width, fallback.width), height: clampDimension(height, fallback.height) };
}

/** A brush size: a finite number rounded to whole pixels and clamped to 1..200; anything else is undefined */
export function clampBrushSize(value: unknown): number | undefined {
    if (!isFiniteNumber(value)) return undefined;
    return clampTo(Math.round(value), MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
}

/**
 * A sane `sizes` list: the entries that are finite numbers, each clamped by `clampBrushSize`, repeats left out, in the
 * author's order, at most 12. A value that is not an array, or has no usable entry, gives `DEFAULT_SIZES`
 */
export function clampSizes(value: unknown): number[] {
    const sizes: number[] = [];
    if (Array.isArray(value)) {
        for (const entry of value) {
            const size = clampBrushSize(entry);
            if (size === undefined || sizes.includes(size)) continue;
            sizes.push(size);
            if (sizes.length === MAX_SIZES) break;
        }
    }
    return sizes.length > 0 ? sizes : [...DEFAULT_SIZES];
}

/** The current brush size: `value` clamped by `clampBrushSize`, or the first of `sizes` when it is not a number */
export function pickSize(value: unknown, sizes: readonly number[]): number {
    return clampBrushSize(value) ?? clampBrushSize(sizes[0]) ?? DEFAULT_SIZES[0];
}

/** Where a picture lies in a painting, in canvas pixels */
export interface PlacedBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Where a background picture of `imageWidth` by `imageHeight` pixels is drawn in a painting of `width` by `height`
 * (G2.9b): scaled to fit without changing its aspect ratio (`contain`) and centred, so a wide picture leaves bands above
 * and below and a tall one bands left and right. A picture with no pixels gives an empty box in the centre
 */
export function containBox(imageWidth: number, imageHeight: number, width: number, height: number): PlacedBox {
    if (!(imageWidth > 0) || !(imageHeight > 0)) return { x: width / 2, y: height / 2, width: 0, height: 0 };
    const scale = Math.min(width / imageWidth, height / imageHeight);
    const placedWidth = imageWidth * scale;
    const placedHeight = imageHeight * scale;
    return { x: (width - placedWidth) / 2, y: (height - placedHeight) / 2, width: placedWidth, height: placedHeight };
}
