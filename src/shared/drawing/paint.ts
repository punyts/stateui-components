import { colorForm, cssName } from '@punyts/stateui-app/core';
import type { JsonObject, JsonValue } from '@punyts/stateui-app/core';
import type { Bounds } from './geometry.js';

/**
 * Reads a custom property (`--ui-color-accent-base`) from the computed style of the scene; an empty string or
 * undefined means the theme does not define it. SVG may leave it out and write `var()` as it is; canvas and 3D need it
 */
export type ReadCustomProperty = (name: string) => string | undefined;

/** A colour a renderer can use */
export interface ColorPaint {
    readonly kind: 'color';
    /** What SVG writes: the literal, or `var(--ui-…)` for a token */
    readonly css: string;
    /**
     * The colour itself, for canvas and 3D: the literal, or the token's value read from the computed style; undefined
     * for a token when no `read` was given
     */
    readonly computed?: string;
    /** The token path of a token colour (`color.accent.base`) */
    readonly token?: string;
}

/** One stop of a gradient, its colour resolved */
export interface GradientStop {
    /** 0 to 1 along the gradient */
    readonly offset: number;
    readonly color: ColorPaint;
}

/**
 * A gradient of a drawing's `paints`, in the units of the painted shape's bounding box (0 to 1 across it, as SVG's
 * `objectBoundingBox`). A linear gradient runs from (`x1`, `y1`) to (`x2`, `y2`) at `angle` degrees, clockwise from
 * left to right as `rotate` turns; a radial one spreads from (`cx`, `cy`) to a radius of half the box
 */
export type Gradient =
    | {
          readonly kind: 'linear';
          readonly name: string;
          readonly path: string;
          readonly stops: readonly GradientStop[];
          readonly angle: number;
          readonly x1: number;
          readonly y1: number;
          readonly x2: number;
          readonly y2: number;
      }
    | {
          readonly kind: 'radial';
          readonly name: string;
          readonly path: string;
          readonly stops: readonly GradientStop[];
          readonly cx: number;
          readonly cy: number;
          readonly r: number;
      };

/** What a shape is painted with: nothing, a colour, or a gradient of the drawing's `paints` */
export type Paint = { readonly kind: 'none' } | ColorPaint | { readonly kind: 'gradient'; readonly gradient: Gradient };

/** No paint: a renderer draws no fill (or no stroke) */
export const NO_PAINT: Paint = Object.freeze({ kind: 'none' });

/**
 * What `resolveColor` gives: a colour, the name of a paint for the caller to look up in `paints`, or the reason the
 * value cannot be a colour (`token`: a token the theme does not define; `invalid`: not a colour, a token or a name)
 */
export type ColorResolution =
    | ColorPaint
    | { readonly kind: 'paint'; readonly name: string }
    | { readonly kind: 'unset' }
    | { readonly kind: 'unresolved'; readonly reason: 'token' | 'invalid'; readonly value: string };

/** The codes a paint problem is reported as; `SUI-RUN-DRAW` is a value of a link that is not a colour at all */
export type PaintIssueCode = 'SUI-STATE-PAINT' | 'SUI-STATE-TOKEN' | 'SUI-RUN-DRAW';

/** A colour that resolved to no paint, for the feeder to report (with `buildError`) */
export interface PaintIssue {
    readonly code: PaintIssueCode;
    /**
     * The state path of the colour property (`<shape>.fill`, `<paints>.<name>.stops.<key>.color`), where the document
     * check (`validatePaints` of `@punyts/stateui-app`) reports the same problem
     */
    readonly path: string;
    /** The property that holds the colour (`fill`, `stroke`, `color` of a stop) */
    readonly property: string;
    /** The value as written: the paint name, the token reference or the bad value */
    readonly value: string;
}

/** The custom property of a token reference (`{color.accent.base}` is `--ui-color-accent-base`), or undefined */
export function tokenProperty(value: string): string | undefined {
    if (colorForm(value) !== 'token') return undefined;
    try {
        return cssName(value.slice(1, -1));
    } catch {
        return undefined;
    }
}

/**
 * Resolves a colour value to a literal, a custom property reference, or a computed colour when `read` is given. A
 * token reads its custom property through `read`, and an empty answer means the theme lacks it; without `read` a token
 * is taken on trust as `var(--ui-…)`. A paint name is handed back for the caller to look up. Unset (undefined, null or
 * an empty string) is no paint and no problem. Never throws
 */
export function resolveColor(value: JsonValue | undefined, read?: ReadCustomProperty): ColorResolution {
    if (value === undefined || value === null || value === '') return { kind: 'unset' };
    if (typeof value !== 'string') return { kind: 'unresolved', reason: 'invalid', value: JSON.stringify(value) };
    const form = colorForm(value);
    if (form === 'literal') return { kind: 'color', css: value, computed: value };
    if (form === 'paint') return { kind: 'paint', name: value };
    if (form === 'token') {
        const property = tokenProperty(value);
        if (property === undefined) return { kind: 'unresolved', reason: 'invalid', value };
        const token = value.slice(1, -1);
        const css = `var(${property})`;
        if (read === undefined) return { kind: 'color', css, token };
        let computed: string | undefined;
        try {
            computed = read(property)?.trim();
        } catch {
            computed = undefined;
        }
        if (computed === undefined || computed === '') return { kind: 'unresolved', reason: 'token', value };
        return { kind: 'color', css, computed, token };
    }
    return { kind: 'unresolved', reason: 'invalid', value };
}

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** The two numbers of `center`, written `[x, y]` or `{ x, y }`; undefined when it is neither */
function readPair(value: JsonValue | undefined): [number, number] | undefined {
    if (Array.isArray(value) && value.length === 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1])) return [value[0], value[1]];
    if (isObject(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y)) return [value.x, value.y];
    return undefined;
}

/**
 * The ends of a linear gradient at `angle` degrees in bounding-box units: through the centre, from one side of the box
 * to the other. 0 runs left to right and 90 top to bottom (clockwise on screen, as `rotate`)
 */
export function linearEnds(angle: number): { x1: number; y1: number; x2: number; y2: number } {
    const radians = (angle * Math.PI) / 180;
    const dx = Math.cos(radians) / 2;
    const dy = Math.sin(radians) / 2;
    const round = (n: number): number => Math.round(n * 1e9) / 1e9;
    return { x1: round(0.5 - dx), y1: round(0.5 - dy), x2: round(0.5 + dx), y2: round(0.5 + dy) };
}

/** Where a colour issue is reported and what it is */
type Report = (issue: PaintIssue) => void;

function issueOf(resolution: ColorResolution, owner: string, property: string): PaintIssue | undefined {
    const path = `${owner}.${property}`;
    if (resolution.kind === 'paint') return { code: 'SUI-STATE-PAINT', path, property, value: resolution.name };
    if (resolution.kind !== 'unresolved') return undefined;
    return { code: resolution.reason === 'token' ? 'SUI-STATE-TOKEN' : 'SUI-RUN-DRAW', path, property, value: resolution.value };
}

/** Reads one entry of `paints` into a gradient; undefined when it has no usable stop or is not a gradient */
function readGradient(name: string, entry: JsonValue, path: string, read: ReadCustomProperty | undefined, report: Report): Gradient | undefined {
    if (!isObject(entry)) return undefined;
    const stops: { offset: number; color: ColorPaint; order: number }[] = [];
    if (isObject(entry.stops)) {
        let order = 0;
        for (const [key, stop] of Object.entries(entry.stops)) {
            if (!isObject(stop) || !isFiniteNumber(stop.offset)) continue;
            const stopPath = `${path}.stops.${key}`;
            const color = resolveColor(stop.color, read);
            if (color.kind === 'color') stops.push({ offset: clamp01(stop.offset), color, order: order++ });
            else {
                // A stop takes a colour or a token, not another paint
                const issue = issueOf(color, stopPath, 'color');
                if (issue !== undefined) report(issue);
            }
        }
    }
    if (stops.length === 0) return undefined;
    stops.sort((a, b) => a.offset - b.offset || a.order - b.order);
    const resolved = stops.map(({ offset, color }) => ({ offset, color }));
    if (entry.kind === 'radial') {
        const [cx, cy] = readPair(entry.center) ?? [0.5, 0.5];
        return { kind: 'radial', name, path, stops: resolved, cx, cy, r: 0.5 };
    }
    if (entry.kind !== 'linear' && entry.kind !== undefined) return undefined;
    const angle = isFiniteNumber(entry.angle) ? entry.angle : 0;
    return { kind: 'linear', name, path, stops: resolved, angle, ...linearEnds(angle) };
}

/** The gradients of a drawing's `paints` and the stop colours that resolved to nothing */
export interface GradientsResult {
    readonly gradients: ReadonlyMap<string, Gradient>;
    readonly issues: readonly PaintIssue[];
}

/**
 * Builds the gradients of a drawing's `paints` (a map of `{ kind, stops, angle | center }`, `paintsPath` its state
 * path). A stop with an unresolvable colour is left out and listed in `issues`; an entry with no stop left, or of an
 * unknown kind, is not a gradient, so a shape that names it gets no paint
 */
export function buildGradients(paints: JsonValue | undefined, paintsPath: string, read?: ReadCustomProperty): GradientsResult {
    const gradients = new Map<string, Gradient>();
    const issues: PaintIssue[] = [];
    if (isObject(paints)) {
        for (const [name, entry] of Object.entries(paints)) {
            const gradient = readGradient(name, entry, `${paintsPath}.${name}`, read, (issue) => issues.push(issue));
            if (gradient !== undefined) gradients.set(name, gradient);
        }
    }
    return { gradients, issues };
}

/**
 * A gradient placed on a shape's bounds in drawing units, for canvas (`createLinearGradient`,
 * `createRadialGradient`); a radial gradient keeps the box's two radii, which canvas draws by scaling
 */
export function placeGradient(
    gradient: Gradient,
    bounds: Bounds
): { kind: 'linear'; x1: number; y1: number; x2: number; y2: number } | { kind: 'radial'; cx: number; cy: number; rx: number; ry: number } {
    const at = (fx: number, fy: number): [number, number] => [bounds.x + fx * bounds.width, bounds.y + fy * bounds.height];
    if (gradient.kind === 'linear') {
        const [x1, y1] = at(gradient.x1, gradient.y1);
        const [x2, y2] = at(gradient.x2, gradient.y2);
        return { kind: 'linear', x1, y1, x2, y2 };
    }
    const [cx, cy] = at(gradient.cx, gradient.cy);
    return { kind: 'radial', cx, cy, rx: gradient.r * bounds.width, ry: gradient.r * bounds.height };
}

/** What a paint resolver reads from */
export interface PaintResolverOptions {
    /** The drawing's `paints` property */
    readonly paints?: JsonValue;
    /** The state path of `paints` (`$.app.….paints`), for the problems of a stop */
    readonly paintsPath?: string;
    /** Reads a custom property from the scene's computed style (canvas and 3D; SVG may pass it to check tokens) */
    readonly read?: ReadCustomProperty;
    /** Hears each problem once (the feeder reports it with `buildError` and `report.error`) */
    readonly onIssue?: (issue: PaintIssue) => void;
}

/** Resolves the colours of one drawing; one per renderer, kept across redraws so a problem is reported once */
export interface PaintResolver {
    /** The paint of a shape's colour property (`fill`, `stroke`; `path` is the shape's); an unresolvable one is no paint, reported once */
    resolve(value: JsonValue | undefined, path: string, property: string): Paint;
    /** The gradients of `paints` as built last */
    readonly gradients: ReadonlyMap<string, Gradient>;
    /**
     * Rebuilds from new `paints` or a new `read` (the theme or mode changed); the options left out are kept. Problems
     * already reported are not reported again
     */
    update(options: Omit<PaintResolverOptions, 'onIssue'>): void;
}

/**
 * Makes the paint resolver of a drawing. It never throws and never stops other shapes: an unknown token at run time
 * (`SUI-STATE-TOKEN`), a paint name with no gradient in `paints` (`SUI-STATE-PAINT`) and a linked value that is not a
 * colour (`SUI-RUN-DRAW`) each resolve to no paint and reach `onIssue` once per path, property and value
 */
export function createPaintResolver(options: PaintResolverOptions = {}): PaintResolver {
    let paints = options.paints;
    let paintsPath = options.paintsPath ?? 'paints';
    let read = options.read;
    let gradients: ReadonlyMap<string, Gradient> = new Map();
    const reported = new Set<string>();
    const report = (issue: PaintIssue): void => {
        const key = `${issue.code}\u0000${issue.path}\u0000${issue.property}\u0000${issue.value}`;
        if (reported.has(key)) return;
        reported.add(key);
        try {
            options.onIssue?.(issue);
        } catch {
            // A failing reporter must not stop a drawing
        }
    };
    const rebuild = (): void => {
        const result = buildGradients(paints, paintsPath, read);
        gradients = result.gradients;
        for (const issue of result.issues) report(issue);
    };
    rebuild();
    return {
        get gradients(): ReadonlyMap<string, Gradient> {
            return gradients;
        },
        resolve(value: JsonValue | undefined, path: string, property: string): Paint {
            const color = resolveColor(value, read);
            if (color.kind === 'color') return color;
            if (color.kind === 'paint') {
                const gradient = gradients.get(color.name);
                if (gradient !== undefined) return { kind: 'gradient', gradient };
            }
            const issue = issueOf(color, path, property);
            if (issue !== undefined) report(issue);
            return NO_PAINT;
        },
        update(next: Omit<PaintResolverOptions, 'onIssue'>): void {
            if ('paints' in next) paints = next.paints;
            if (next.paintsPath !== undefined) paintsPath = next.paintsPath;
            if ('read' in next) read = next.read;
            rebuild();
        }
    };
}
