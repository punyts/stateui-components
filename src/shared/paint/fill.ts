/**
 * Flood fill for the painting engine (G2.6b of the graphics epic 2): a scanline fill over the RGBA pixels of a canvas,
 * with a tolerance, bounded to the canvas, never recursive. The search keeps its own stack of seeds and a mask of the
 * pixels it has visited, so a fill colour close to the colour it replaces cannot loop. A fill replaces pixels: it
 * writes the fill colour as it is (a translucent fill colour is not blended over what was there)
 */

/** A colour as four bytes: red, green, blue and alpha (straight, not premultiplied), each 0..255 */
export type Rgba = readonly [number, number, number, number];

/** The pixels a fill reads and writes: `ImageData`, or a plain object of the same shape in a test */
export interface PaintPixels {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8ClampedArray;
}

/** The tolerance when none is given: how far (0..255, per channel) a pixel may be from the seed's colour and still fill */
export const DEFAULT_FILL_TOLERANCE = 32;

/** The largest tolerance; at 255 every pixel matches */
export const MAX_FILL_TOLERANCE = 255;

/** A tolerance: a finite number rounded and clamped to 0..255; anything else gives `DEFAULT_FILL_TOLERANCE` */
export function clampTolerance(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_FILL_TOLERANCE;
    return Math.min(MAX_FILL_TOLERANCE, Math.max(0, Math.round(value)));
}

const byte = (value: number): number => Math.min(255, Math.max(0, Math.round(value)));

/** A channel of `rgb()`: a number 0..255 or a percentage */
const channel = (text: string): number => (text.endsWith('%') ? (parseFloat(text) / 100) * 255 : parseFloat(text));

/** An alpha of `rgb()` or `hsl()`: a number 0..1 or a percentage; absent is opaque */
const alpha = (text: string | undefined): number => (text === undefined ? 1 : text.endsWith('%') ? parseFloat(text) / 100 : parseFloat(text));

const FUNCTION = /^(rgba?|hsla?)\(\s*([^)]*)\)$/i;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:%|deg)?$/i;

/** The parts of a colour function, comma or space separated, with an optional `/ alpha`; undefined when malformed */
function functionParts(body: string): string[] | undefined {
    const [main, slash, ...rest] = body.split('/');
    if (rest.length > 0) return undefined;
    const parts = main.includes(',') ? main.split(',').map((part) => part.trim()) : main.trim().split(/\s+/);
    if (slash !== undefined) {
        if (parts.length !== 3) return undefined;
        parts.push(slash.trim());
    }
    return parts.every((part) => NUMBER.test(part)) && (parts.length === 3 || parts.length === 4) ? parts : undefined;
}

/** The RGB bytes of an HSL colour (hue in degrees, saturation and lightness 0..1) */
function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
    const h = (((hue % 360) + 360) % 360) / 360;
    const s = Math.min(1, Math.max(0, saturation));
    const l = Math.min(1, Math.max(0, lightness));
    const k = (n: number): number => (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [byte(f(0) * 255), byte(f(8) * 255), byte(f(4) * 255)];
}

/**
 * The bytes of a CSS colour written as hex (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`), `rgb()`, `rgba()`, `hsl()`,
 * `hsla()` (comma or space syntax, with an optional `/ alpha`) or `transparent`; undefined for any other text (a named
 * colour, `oklch()`, ...), which the painter reads back from a one-pixel canvas instead
 */
export function parseRgba(value: string): Rgba | undefined {
    const text = value.trim();
    if (text.toLowerCase() === 'transparent') return [0, 0, 0, 0];
    const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text);
    if (hex !== null) {
        let digits = hex[1];
        if (digits.length <= 4) digits = [...digits].map((digit) => digit + digit).join('');
        const at = (index: number): number => parseInt(digits.slice(index, index + 2), 16);
        return [at(0), at(2), at(4), digits.length === 8 ? at(6) : 255];
    }
    const call = FUNCTION.exec(text);
    if (call === null) return undefined;
    const parts = functionParts(call[2]);
    if (parts === undefined) return undefined;
    const a = byte(alpha(parts[3]) * 255);
    if (call[1].toLowerCase().startsWith('rgb')) return [byte(channel(parts[0])), byte(channel(parts[1])), byte(channel(parts[2])), a];
    const [r, g, b] = hslToRgb(parseFloat(parts[0]), parseFloat(parts[1]) / 100, parseFloat(parts[2]) / 100);
    return [r, g, b, a];
}

/** The rows a fill touched (`top`..`bottom`, inclusive) and how many pixels it wrote; `count` 0 when it wrote none */
export interface FillResult {
    readonly count: number;
    readonly top: number;
    readonly bottom: number;
}

/** A fill that runs in steps: `step` works until `deadline` (a `performance.now()` time) and gives whether it is done */
export interface FillSearch {
    step(deadline: number): boolean;
    readonly done: boolean;
    readonly result: FillResult;
}

/** How many spans the search fills between two looks at the clock */
const SPANS_PER_CHECK = 64;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Starts a flood fill of `pixels` from the seed (`x`, `y`, rounded down; outside the canvas fills nothing) with
 * `color`: every pixel connected to the seed through its four neighbours whose channels each lie within `tolerance` of
 * the seed pixel's becomes `color`. The search is a scanline fill with an explicit stack: it fills the run of matching
 * pixels left and right of a seed, then pushes one seed per matching run in the rows above and below. It never
 * recurses, never reads outside the canvas, and visits each pixel once (a mask of `width * height` bytes)
 */
export function createFillSearch(pixels: PaintPixels, x: number, y: number, color: Rgba, tolerance: number = DEFAULT_FILL_TOLERANCE): FillSearch {
    const { width, height, data } = pixels;
    const seedX = Math.floor(x);
    const seedY = Math.floor(y);
    let count = 0;
    let top = height;
    let bottom = -1;
    const inside = Number.isFinite(seedX) && Number.isFinite(seedY) && seedX >= 0 && seedY >= 0 && seedX < width && seedY < height;
    let done = !inside;
    const result = (): FillResult => ({ count, top: count === 0 ? 0 : top, bottom: count === 0 ? -1 : bottom });
    if (!inside) {
        return { step: () => true, done: true, result: result() };
    }

    const limit = clampTolerance(tolerance);
    const seed = (seedY * width + seedX) * 4;
    const t0 = data[seed];
    const t1 = data[seed + 1];
    const t2 = data[seed + 2];
    const t3 = data[seed + 3];
    const [c0, c1, c2, c3] = color.map(byte);
    const visited = new Uint8Array(width * height);
    const stack: number[] = [seedY * width + seedX];

    /** Whether pixel `index` (not byte index) is unvisited and within the tolerance of the seed's colour */
    const matches = (index: number): boolean => {
        if (visited[index] !== 0) return false;
        const at = index * 4;
        return (
            Math.abs(data[at] - t0) <= limit &&
            Math.abs(data[at + 1] - t1) <= limit &&
            Math.abs(data[at + 2] - t2) <= limit &&
            Math.abs(data[at + 3] - t3) <= limit
        );
    };

    /** Pushes one seed for each run of matching pixels between `left` and `right` in `row` */
    const seedRow = (row: number, left: number, right: number): void => {
        let inRun = false;
        const start = row * width;
        for (let column = left; column <= right; column++) {
            const index = start + column;
            if (matches(index)) {
                if (!inRun) stack.push(index);
                inRun = true;
            } else inRun = false;
        }
    };

    const step = (deadline: number): boolean => {
        let spans = 0;
        while (stack.length > 0) {
            const index = stack.pop() as number;
            if (!matches(index)) continue;
            const row = Math.floor(index / width);
            const start = row * width;
            let left = index - start;
            let right = left;
            while (left > 0 && matches(start + left - 1)) left--;
            while (right < width - 1 && matches(start + right + 1)) right++;
            for (let column = left; column <= right; column++) {
                const pixel = start + column;
                visited[pixel] = 1;
                const at = pixel * 4;
                data[at] = c0;
                data[at + 1] = c1;
                data[at + 2] = c2;
                data[at + 3] = c3;
            }
            count += right - left + 1;
            if (row < top) top = row;
            if (row > bottom) bottom = row;
            if (row > 0) seedRow(row - 1, left, right);
            if (row < height - 1) seedRow(row + 1, left, right);
            spans += 1;
            if (spans % SPANS_PER_CHECK === 0 && now() >= deadline) return false;
        }
        done = true;
        return true;
    };

    return {
        step,
        get done(): boolean {
            return done;
        },
        get result(): FillResult {
            return result();
        }
    };
}

/** Flood fills `pixels` in one go (see `createFillSearch`) and gives what it touched */
export function floodFill(pixels: PaintPixels, x: number, y: number, color: Rgba, tolerance: number = DEFAULT_FILL_TOLERANCE): FillResult {
    const search = createFillSearch(pixels, x, y, color, tolerance);
    search.step(Infinity);
    return search.result;
}
