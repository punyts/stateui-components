import type { PaintContext2D, PaintSurface } from '../../src/shared/paint/draw.ts';

/**
 * A tiny software raster for the painting engine's Node tests: a `width` by `height` RGBA bitmap (straight alpha) and a
 * context with the members `PaintContext2D` names. Coverage is all or nothing per pixel (a pixel is covered when its
 * centre lies within half the line width of the path, or within the radius of a dot), so results are exact and
 * repeatable. It knows `source-over` and `destination-out` and colours written `#rgb`, `#rrggbb`, `#rrggbbaa` and
 * `rgba(r, g, b, a)`; quadratic curves and ellipses are flattened into short lines. The pixel members read and write
 * the bitmap directly, as `ImageData` does
 */
export interface FakeBitmap {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8ClampedArray;
}

export type FakeContext = PaintContext2D<FakeBitmap>;

/** How many lines a quadratic curve is flattened into */
const CURVE_STEPS = 6;

/** How many lines an ellipse is flattened into */
const ELLIPSE_STEPS = 64;

function parseColor(value: string): [number, number, number, number] {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
    if (hex !== null) {
        let digits = hex[1];
        if (digits.length === 3) digits = [...digits].map((d) => d + d).join('');
        const byte = (i: number): number => parseInt(digits.slice(i, i + 2), 16);
        return [byte(0), byte(2), byte(4), digits.length === 8 ? byte(6) / 255 : 1];
    }
    const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value);
    if (rgba !== null) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] === undefined ? 1 : Number(rgba[4])];
    throw new Error(`The fake canvas cannot read the colour ${value}`);
}

/** The distance from (px, py) to the segment from (ax, ay) to (bx, by) */
function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function createFakeBitmap(width: number, height: number): FakeBitmap {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** A fake 2D context drawing into `bitmap` */
export function createFakeContext(bitmap: FakeBitmap): FakeContext {
    const { width, height, data } = bitmap;
    type Segment = [number, number, number, number];
    let segments: Segment[] = [];
    let dots: [number, number, number][] = [];
    let at: [number, number] | undefined;
    let subpath: [number, number] | undefined;
    const stack: Record<string, unknown>[] = [];

    /** Composites one pixel of colour `color` at alpha `alpha` with the context's operation */
    const blend = (index: number, color: [number, number, number, number], operation: string): void => {
        const [r, g, b, a] = color;
        const da = data[index + 3] / 255;
        if (operation === 'destination-out') {
            data[index + 3] = Math.round(da * (1 - a) * 255);
            return;
        }
        const oa = a + da * (1 - a);
        if (oa === 0) {
            data.fill(0, index, index + 4);
            return;
        }
        data[index] = Math.round((r * a + data[index] * da * (1 - a)) / oa);
        data[index + 1] = Math.round((g * a + data[index + 1] * da * (1 - a)) / oa);
        data[index + 2] = Math.round((b * a + data[index + 2] * da * (1 - a)) / oa);
        data[index + 3] = Math.round(oa * 255);
    };

    /** Paints every pixel whose centre passes `covers`, inside the box */
    const paintPixels = (box: [number, number, number, number], covers: (x: number, y: number) => boolean, style: unknown): void => {
        const color = parseColor(String(style));
        const [x0, y0, x1, y1] = [Math.max(0, Math.floor(box[0])), Math.max(0, Math.floor(box[1])), Math.min(width - 1, Math.ceil(box[2])), Math.min(height - 1, Math.ceil(box[3]))];
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                if (covers(x + 0.5, y + 0.5)) blend((y * width + x) * 4, color, context.globalCompositeOperation);
            }
        }
    };

    const context: FakeContext = {
        globalCompositeOperation: 'source-over',
        strokeStyle: '#000',
        fillStyle: '#000',
        lineWidth: 1,
        lineCap: 'butt',
        lineJoin: 'miter',
        save() {
            stack.push({ op: context.globalCompositeOperation, stroke: context.strokeStyle, fill: context.fillStyle, width: context.lineWidth, cap: context.lineCap, join: context.lineJoin });
        },
        restore() {
            const saved = stack.pop();
            if (saved === undefined) return;
            context.globalCompositeOperation = saved.op as GlobalCompositeOperation;
            context.strokeStyle = saved.stroke as string;
            context.fillStyle = saved.fill as string;
            context.lineWidth = saved.width as number;
            context.lineCap = saved.cap as CanvasLineCap;
            context.lineJoin = saved.join as CanvasLineJoin;
        },
        beginPath() {
            segments = [];
            dots = [];
            at = undefined;
            subpath = undefined;
        },
        moveTo(x, y) {
            at = [x, y];
            subpath = [x, y];
        },
        closePath() {
            if (subpath !== undefined) context.lineTo(subpath[0], subpath[1]);
        },
        ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle) {
            for (let i = 0; i <= ELLIPSE_STEPS; i++) {
                const angle = startAngle + ((endAngle - startAngle) * i) / ELLIPSE_STEPS;
                const px = x + radiusX * Math.cos(angle) * Math.cos(rotation) - radiusY * Math.sin(angle) * Math.sin(rotation);
                const py = y + radiusX * Math.cos(angle) * Math.sin(rotation) + radiusY * Math.sin(angle) * Math.cos(rotation);
                if (i === 0 && at === undefined) context.moveTo(px, py);
                else context.lineTo(px, py);
            }
        },
        lineTo(x, y) {
            if (at !== undefined) segments.push([at[0], at[1], x, y]);
            at = [x, y];
        },
        quadraticCurveTo(cpx, cpy, x, y) {
            const start = at ?? [cpx, cpy];
            for (let i = 1; i <= CURVE_STEPS; i++) {
                const t = i / CURVE_STEPS;
                const u = 1 - t;
                context.lineTo(u * u * start[0] + 2 * u * t * cpx + t * t * x, u * u * start[1] + 2 * u * t * cpy + t * t * y);
            }
        },
        arc(x, y, radius) {
            dots.push([x, y, radius]);
        },
        stroke() {
            // Each pixel is painted once per stroke: covered by any segment, so a translucent stroke never doubles up
            const half = context.lineWidth / 2;
            if (segments.length === 0) return;
            const xs = segments.flatMap((s) => [s[0], s[2]]);
            const ys = segments.flatMap((s) => [s[1], s[3]]);
            const box: [number, number, number, number] = [Math.min(...xs) - half, Math.min(...ys) - half, Math.max(...xs) + half, Math.max(...ys) + half];
            paintPixels(box, (px, py) => segments.some(([ax, ay, bx, by]) => distanceToSegment(px, py, ax, ay, bx, by) <= half), context.strokeStyle);
        },
        fill() {
            for (const [x, y, r] of dots) paintPixels([x - r, y - r, x + r, y + r], (px, py) => Math.hypot(px - x, py - y) <= r, context.fillStyle);
        },
        clearRect(x, y, w, h) {
            for (let row = Math.max(0, y); row < Math.min(height, y + h); row++) data.fill(0, (row * width + Math.max(0, x)) * 4, (row * width + Math.min(width, x + w)) * 4);
        },
        fillRect(x, y, w, h) {
            paintPixels([x, y, x + w - 1, y + h - 1], (px, py) => px >= x && px <= x + w && py >= y && py <= y + h, context.fillStyle);
        },
        createImageData(w, h) {
            return createFakeBitmap(w, h);
        },
        getImageData(x, y, w, h) {
            const out = createFakeBitmap(w, h);
            for (let row = 0; row < h; row++) {
                for (let column = 0; column < w; column++) {
                    const tx = x + column;
                    const ty = y + row;
                    if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
                    out.data.set(data.subarray((ty * width + tx) * 4, (ty * width + tx) * 4 + 4), (row * w + column) * 4);
                }
            }
            return out;
        },
        putImageData(pixels, dx, dy, dirtyX, dirtyY, dirtyWidth, dirtyHeight) {
            for (let row = dirtyY; row < dirtyY + dirtyHeight && row < pixels.height; row++) {
                for (let column = dirtyX; column < dirtyX + dirtyWidth && column < pixels.width; column++) {
                    const tx = dx + column;
                    const ty = dy + row;
                    if (row < 0 || column < 0 || tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
                    data.set(pixels.data.subarray((row * pixels.width + column) * 4, (row * pixels.width + column) * 4 + 4), (ty * width + tx) * 4);
                }
            }
        },
        drawImage(image, dx, dy) {
            for (let y = 0; y < image.height; y++) {
                for (let x = 0; x < image.width; x++) {
                    const tx = x + dx;
                    const ty = y + dy;
                    if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
                    const from = (y * image.width + x) * 4;
                    const a = image.data[from + 3] / 255;
                    if (a === 0 && context.globalCompositeOperation === 'source-over') continue;
                    blend((ty * width + tx) * 4, [image.data[from], image.data[from + 1], image.data[from + 2], a], context.globalCompositeOperation);
                }
            }
        }
    };
    return context;
}

/** A fake surface for `createPainter`'s `createSurface` */
export function createFakeSurface(width: number, height: number): PaintSurface<FakeBitmap> {
    const image = createFakeBitmap(width, height);
    return { image, context: createFakeContext(image) };
}
