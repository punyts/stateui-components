import type { IconPath, IconStyledPath } from '../src/icons/types.ts';

/** The empty bounding box every Tabler icon starts with */
export const BOUNDING_BOX_PATH = 'M0 0h24v24H0z';

export type IconVariant = 'outline' | 'filled';

type Attributes = Record<string, string>;

const SVG_ELEMENT = /<([a-zA-Z][\w-]*)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*\/?>/g;
const ATTRIBUTE = /([\w:-]+)\s*=\s*"([^"]*)"/g;
const GEOMETRY_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
    path: ['d'],
    circle: ['cx', 'cy', 'r'],
    ellipse: ['cx', 'cy', 'rx', 'ry'],
    rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
    line: ['x1', 'y1', 'x2', 'y2'],
    polyline: ['points']
};

const format = (value: number): string => String(Number(value.toFixed(4)));
const join = (parts: readonly (string | number)[]): string =>
    parts.map((part) => (typeof part === 'number' ? format(part) : part)).join(' ');

function readAttributes(source: string): Attributes {
    const attributes: Attributes = {};
    for (const match of source.matchAll(ATTRIBUTE)) attributes[match[1] as string] = match[2] as string;
    return attributes;
}

function readNumber(attributes: Attributes, name: string, fallback?: number): number {
    const raw = attributes[name];
    if (raw === undefined) {
        if (fallback === undefined) throw new Error(`The "${name}" attribute is missing`);
        return fallback;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`The "${name}" attribute is not a number: "${raw}"`);
    return value;
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
    return join(['M', cx - rx, cy, 'a', rx, ry, '0 1 0', 2 * rx, 0, 'a', rx, ry, '0 1 0', -2 * rx, 0, 'z']);
}

function rectPath(attributes: Attributes): string {
    const x = readNumber(attributes, 'x', 0);
    const y = readNumber(attributes, 'y', 0);
    const width = readNumber(attributes, 'width');
    const height = readNumber(attributes, 'height');
    const rawRx = attributes.rx === undefined ? undefined : readNumber(attributes, 'rx');
    const rawRy = attributes.ry === undefined ? undefined : readNumber(attributes, 'ry');
    const rx = Math.min(rawRx ?? rawRy ?? 0, width / 2);
    const ry = Math.min(rawRy ?? rawRx ?? 0, height / 2);
    if (rx <= 0 || ry <= 0) return join(['M', x, y, 'h', width, 'v', height, 'h', -width, 'z']);
    return join([
        'M', x + rx, y,
        'h', width - 2 * rx,
        'a', rx, ry, '0 0 1', rx, ry,
        'v', height - 2 * ry,
        'a', rx, ry, '0 0 1', -rx, ry,
        'h', -(width - 2 * rx),
        'a', rx, ry, '0 0 1', -rx, -ry,
        'v', -(height - 2 * ry),
        'a', rx, ry, '0 0 1', rx, -ry,
        'z'
    ]);
}

function polylinePath(points: string): string {
    const numbers = points
        .trim()
        .split(/[\s,]+/)
        .filter((part) => part !== '')
        .map(Number);
    if (numbers.length < 2 || numbers.length % 2 !== 0 || numbers.some((value) => !Number.isFinite(value))) {
        throw new Error(`The "points" attribute is not a list of coordinate pairs: "${points}"`);
    }
    const parts: (string | number)[] = [];
    for (let index = 0; index < numbers.length; index += 2) {
        parts.push(index === 0 ? 'M' : 'L', numbers[index] as number, numbers[index + 1] as number);
    }
    return join(parts);
}

/** Converts the geometry of one `path`, `circle`, `ellipse`, `rect`, `line` or `polyline` element to path data */
export function elementToPathData(tag: string, attributes: Attributes): string {
    switch (tag) {
        case 'path': {
            const d = attributes.d;
            if (d === undefined) throw new Error('A path has no "d" attribute');
            return d;
        }
        case 'circle': {
            const r = readNumber(attributes, 'r');
            return ellipsePath(readNumber(attributes, 'cx', 0), readNumber(attributes, 'cy', 0), r, r);
        }
        case 'ellipse':
            return ellipsePath(
                readNumber(attributes, 'cx', 0),
                readNumber(attributes, 'cy', 0),
                readNumber(attributes, 'rx'),
                readNumber(attributes, 'ry')
            );
        case 'rect':
            return rectPath(attributes);
        case 'line':
            return join([
                'M', readNumber(attributes, 'x1', 0), readNumber(attributes, 'y1', 0),
                'L', readNumber(attributes, 'x2', 0), readNumber(attributes, 'y2', 0)
            ]);
        case 'polyline':
            return polylinePath(attributes.points ?? '');
        default:
            throw new Error(`The <${tag}> element is not supported`);
    }
}

function styledPath(tag: string, attributes: Attributes, variant: IconVariant): IconPath {
    const geometry = GEOMETRY_ATTRIBUTES[tag] ?? [];
    const style: { fill?: true; stroke?: false; opacity?: number } = {};
    for (const [name, value] of Object.entries(attributes)) {
        if (geometry.includes(name)) continue;
        if (name === 'fill' && value === 'currentColor') {
            if (variant === 'outline') style.fill = true;
        } else if (name === 'stroke' && value === 'none') {
            style.stroke = false;
        } else if (name === 'opacity' && Number.isFinite(Number(value))) {
            style.opacity = Number(value);
        } else {
            throw new Error(`The ${name}="${value}" attribute on <${tag}> is not supported`);
        }
    }
    const d = elementToPathData(tag, attributes);
    return Object.keys(style).length === 0 ? d : ({ d, ...style } satisfies IconStyledPath);
}

/**
 * Reads the drawing elements of one Tabler SVG file as path data. The empty bounding-box path is dropped, and
 * `circle`, `rect`, `line`, `polyline` and `ellipse` elements are converted to path data. A path style Tabler sets on
 * its own (`fill`, `stroke="none"`, `opacity`) is kept; anything else throws, so no icon silently changes
 */
export function svgToPaths(svg: string, variant: IconVariant): IconPath[] {
    const paths: IconPath[] = [];
    for (const match of svg.matchAll(SVG_ELEMENT)) {
        const tag = match[1] as string;
        if (tag === 'svg') continue;
        const attributes = readAttributes(match[2] as string);
        if (tag === 'path' && attributes.d === BOUNDING_BOX_PATH) continue;
        paths.push(styledPath(tag, attributes, variant));
    }
    return paths;
}
