import type { JsonValue } from '@punyts/stateui-app/core';
import { tokenProperty } from './paint.js';
import type { DrawingRendererOptions } from './render.js';
import { DEFAULT_DURATIONS, durationToken, easingToken } from './scheduler.js';
import type { ReadToken, Scheduler, Timing, TweenValue } from './scheduler.js';
import type { ShapeTree } from './tree.js';

/** A colour as red, green, blue (0 to 255) and alpha (0 to 1) */
export type Rgba = readonly [number, number, number, number];

/** The colour properties of a 2D shape: they tween as colours, every other property only as a number */
export const COLOR_PROPERTIES: readonly string[] = ['fill', 'stroke'];

/** The properties that never tween: the motion values themselves and the ones that are not drawn values */
const FIXED = new Set(['transition', 'animate', 'hidden', 'interactive', 'draggable', 'bounds', 'step', '_label', '_text']);

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTION = /^(rgba?|hsla?)\(\s*([^()]*)\)$/i;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** A number of a colour function: `50%` scaled to `percent`, a bare number as it is */
function channel(text: string, percent: number): number | undefined {
    const trimmed = text.trim();
    if (trimmed === '') return undefined;
    const value = trimmed.endsWith('%') ? (Number(trimmed.slice(0, -1)) / 100) * percent : Number(trimmed.replace(/deg$/i, ''));
    return Number.isFinite(value) ? value : undefined;
}

/**
 * A literal colour as `[r, g, b, a]`: `transparent`, hex (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`), `rgb()`, `rgba()`,
 * `hsl()` and `hsla()` with commas or spaces (and `/ alpha`); undefined for anything else (a colour name, another
 * colour space), which a renderer may first normalise
 */
export function parseColor(text: string): Rgba | undefined {
    const value = text.trim().toLowerCase();
    if (value === 'transparent') return [0, 0, 0, 0];
    const hex = HEX.exec(value);
    if (hex !== null) {
        let digits = hex[1]!;
        if (digits.length <= 4) digits = [...digits].map((digit) => digit + digit).join('');
        const parts = digits.match(/../g)!.map((pair) => Number.parseInt(pair, 16));
        return [parts[0]!, parts[1]!, parts[2]!, parts.length === 4 ? parts[3]! / 255 : 1];
    }
    const call = FUNCTION.exec(value);
    if (call === null) return undefined;
    const [body, alphaText] = call[2]!.split('/');
    const parts = body!.includes(',') ? body!.split(',') : body!.trim().split(/\s+/);
    if (alphaText !== undefined && parts.length !== 3) return undefined;
    if (parts.length !== 3 && parts.length !== 4) return undefined;
    const alphaPart = alphaText ?? parts[3];
    const alpha = alphaPart === undefined ? 1 : channel(alphaPart, 1);
    if (alpha === undefined) return undefined;
    if (call[1]!.startsWith('rgb')) {
        const rgb = parts.slice(0, 3).map((part) => channel(part, 255));
        if (rgb.some((part) => part === undefined)) return undefined;
        return [clamp(rgb[0]!, 0, 255), clamp(rgb[1]!, 0, 255), clamp(rgb[2]!, 0, 255), clamp(alpha, 0, 1)];
    }
    const hue = channel(parts[0]!, 1);
    const saturation = channel(parts[1]!, 1);
    const lightness = channel(parts[2]!, 1);
    if (hue === undefined || saturation === undefined || lightness === undefined) return undefined;
    const s = clamp(saturation, 0, 1);
    const l = clamp(lightness, 0, 1);
    const h = (((hue % 360) + 360) % 360) / 30;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number): number => {
        const k = (n + h) % 12;
        return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
    };
    return [f(0), f(8), f(4), clamp(alpha, 0, 1)];
}

/** A colour tween value written back as a literal both renderers draw */
export function formatColor(value: readonly number[]): string {
    const [r, g, b, a] = value.map((part, index) => (index < 3 ? clamp(Math.round(part), 0, 255) : clamp(Math.round(part * 1000) / 1000, 0, 1)));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** The key of a property of a shape in the scheduler */
const keyOf = (path: string, property: string): string => `${path}\u0000${property}`;

/** The state path of the shape a scheduler key belongs to */
export const keyPath = (key: string): string => key.slice(0, key.indexOf('\u0000'));

/** What `createTransitions` needs */
export interface TransitionOptions {
    readonly scheduler: Scheduler;
    /** Reads a custom property of the scene's computed style (the motion tokens, a colour token's value) */
    readonly read: ReadToken;
    /**
     * Turns a colour text the parser does not read (a colour name, another colour space) into one it does; a renderer
     * passes the browser's own (a 2D context's `fillStyle`). Undefined when it cannot
     */
    readonly normalize?: (css: string) => string | undefined;
}

/** The transitions of a scene: from each new tree to the tree to draw, its values tweened */
export interface Transitions {
    /**
     * Takes the feeder's new tree: a numeric or colour property of a shape with `transition` that changed starts a tween
     * from the value on screen (a running one from where it is); any other change jumps. Gives the tree to draw now
     */
    apply(target: readonly ShapeTree[]): readonly ShapeTree[];
    /** The last tree `apply` took, with every running tween at its current value (the same tree when none runs) */
    current(): readonly ShapeTree[];
    /**
     * Puts properties of a shape at these values at once, as the values of the tree on screen (a drag that ended is
     * not tweened back and forth): their tweens stop, and the next tree that brings these values starts none
     */
    settle(path: string, values: Readonly<Record<string, JsonValue | undefined>>): void;
    /** Forgets everything (`dispose` of the renderer) */
    dispose(): void;
}

/** Reads custom properties from an element's computed style (the scene's svg or canvas); an empty value is undefined */
export function styleReader(element: Element): ReadToken {
    return (name) => element.ownerDocument.defaultView?.getComputedStyle(element).getPropertyValue(name).trim() || undefined;
}

/**
 * The browser's own reading of a colour (a 2D context's `fillStyle` gives `#rrggbb` or `rgba(...)` for any colour it
 * knows), for a colour `parseColor` does not read; undefined when the browser does not know it either
 */
export function tokenNormalizer(document: Document): (css: string) => string | undefined {
    let context: CanvasRenderingContext2D | null | undefined;
    return (css) => {
        context ??= document.createElement('canvas').getContext('2d');
        if (!context) return undefined;
        // A colour the context refuses leaves the old value: set from two different ones, it is known only when both agree
        context.fillStyle = '#000';
        context.fillStyle = css;
        const first = context.fillStyle;
        context.fillStyle = '#fff';
        context.fillStyle = css;
        return typeof first === 'string' && first === context.fillStyle ? first : undefined;
    };
}

/**
 * The options a renderer gives its drag (`createShapeDrag`): `onMove` puts the moved axes at their new values in the
 * transitions first, so the position the feeder writes is shown where the drag left it, never tweened from where it was
 */
export function settleMoves(options: DrawingRendererOptions, transitions: Transitions): Pick<DrawingRendererOptions, 'onMove' | 'onEvent'> {
    return {
        onEvent: (event) => options.onEvent(event),
        onMove:
            options.onMove === undefined
                ? undefined
                : (move) => {
                      transitions.settle(move.shape, { x: move.x, y: move.y });
                      options.onMove?.(move);
                  }
    };
}

/** What a shape's `transition` asks for, or undefined when it has none; the chart's `transition` reads the same (G2.4b) */
export function timingOf(transition: JsonValue | undefined, read: ReadToken): Timing | undefined {
    if (transition === null || typeof transition !== 'object' || Array.isArray(transition)) return undefined;
    const { duration, easing } = transition as Record<string, JsonValue>;
    let ms: number | undefined;
    if (typeof duration === 'number') ms = duration;
    else if (typeof duration === 'string') ms = durationToken(duration, read);
    ms ??= durationToken('base', read) ?? DEFAULT_DURATIONS.base!;
    const curve = (typeof easing === 'string' ? easingToken(easing, read) : undefined) ?? easingToken('standard', read)!;
    return { duration: ms, easing: curve };
}

/**
 * Follows the values of the shapes with `transition` from tree to tree and runs their changes through the scheduler.
 * A number tweens as a number; `fill` and `stroke` tween as colours when both values are colours it can read (a
 * literal or a token, read through `read`); a gradient, a paint name or a value of another kind jumps. A shape that
 * is new, or gains `transition` with its change, jumps. With reduced motion the scheduler jumps every change
 */
export function createTransitions(options: TransitionOptions): Transitions {
    const { scheduler } = options;
    /** The values of each shape with `transition` in the last tree, by path */
    let previous = new Map<string, Record<string, JsonValue>>();
    /** The running tweens of each shape, by path: property to whether it is a colour */
    const active = new Map<string, Map<string, boolean>>();
    let target: readonly ShapeTree[] = [];
    let cache = new Map<string, string | undefined>();

    const read = (name: string): string | undefined => {
        if (cache.has(name)) return cache.get(name);
        const value = options.read(name);
        cache.set(name, value);
        return value;
    };

    const colorOf = (value: JsonValue | undefined): Rgba | undefined => {
        if (typeof value !== 'string') return undefined;
        const property = tokenProperty(value);
        const css = property === undefined ? value : read(property);
        if (css === undefined || css === '') return undefined;
        const parsed = parseColor(css);
        if (parsed !== undefined) return parsed;
        const normal = options.normalize?.(css);
        return normal === undefined ? undefined : parseColor(normal);
    };

    const stop = (path: string, property: string): void => {
        const running = active.get(path);
        if (running === undefined || !running.delete(property)) return;
        if (running.size === 0) active.delete(path);
        scheduler.cancel(keyOf(path, property));
    };

    const stopAll = (path: string): void => {
        for (const property of [...(active.get(path)?.keys() ?? [])]) stop(path, property);
    };

    const start = (path: string, property: string, from: TweenValue, to: TweenValue, timing: Timing, color: boolean): void => {
        const key = keyOf(path, property);
        scheduler.tween(key, from, to, timing);
        if (scheduler.valueOf(key) === undefined) {
            stop(path, property);
            return;
        }
        let running = active.get(path);
        if (running === undefined) {
            running = new Map();
            active.set(path, running);
        }
        running.set(property, color);
    };

    /** Starts or stops the tweens of one shape against its values in the last tree */
    const follow = (shape: ShapeTree, next: Map<string, Record<string, JsonValue>>): void => {
        const transition = shape.properties.transition;
        if (transition === undefined || transition === null || shape.properties.hidden === true) {
            if (active.has(shape.path)) stopAll(shape.path);
            return;
        }
        const values: Record<string, JsonValue> = { ...shape.properties };
        next.set(shape.path, values);
        const before = previous.get(shape.path);
        if (before === undefined) return;
        let timing: Timing | undefined;
        const properties = new Set([...Object.keys(before), ...Object.keys(values)]);
        for (const property of properties) {
            if (FIXED.has(property)) continue;
            const from = before[property];
            const to = values[property];
            if (from === to) continue;
            if (typeof from === 'number' && typeof to === 'number' && Number.isFinite(from) && Number.isFinite(to)) {
                timing ??= timingOf(transition, read);
                if (timing !== undefined) start(shape.path, property, from, to, timing, false);
                continue;
            }
            if (COLOR_PROPERTIES.includes(property) && from !== undefined && to !== undefined) {
                const a = colorOf(from);
                const b = a === undefined ? undefined : colorOf(to);
                if (a !== undefined && b !== undefined) {
                    timing ??= timingOf(transition, read);
                    if (timing !== undefined) start(shape.path, property, a, b, timing, true);
                    continue;
                }
            }
            stop(shape.path, property);
        }
    };

    const walk = (shapes: readonly ShapeTree[], next: Map<string, Record<string, JsonValue>>): void => {
        for (const shape of shapes) {
            follow(shape, next);
            walk(shape.children, next);
            if (shape.clip !== undefined) walk([shape.clip], next);
        }
    };

    /** The shapes with every running tween at its value; the same objects where nothing runs */
    const tweened = (shapes: readonly ShapeTree[]): readonly ShapeTree[] => {
        let changed = false;
        const result = shapes.map((shape) => {
            const running = active.get(shape.path);
            let properties = shape.properties;
            if (running !== undefined) {
                let values: Record<string, JsonValue> | undefined;
                for (const [property, color] of running) {
                    const value = scheduler.valueOf(keyOf(shape.path, property));
                    if (value === undefined) {
                        // Ended: the shape shows the value of the tree
                        running.delete(property);
                        continue;
                    }
                    values ??= { ...properties };
                    values[property] = color ? formatColor(value as readonly number[]) : (value as number);
                }
                if (running.size === 0) active.delete(shape.path);
                if (values !== undefined) properties = values;
            }
            const children = shape.children.length === 0 ? shape.children : tweened(shape.children);
            const clip = shape.clip === undefined ? undefined : tweened([shape.clip])[0];
            if (properties === shape.properties && children === shape.children && clip === shape.clip) return shape;
            changed = true;
            const next: ShapeTree = { ...shape, properties, children };
            return clip === undefined ? next : { ...next, clip };
        });
        return changed ? result : shapes;
    };

    return {
        apply(next) {
            cache = new Map();
            target = next;
            const values = new Map<string, Record<string, JsonValue>>();
            walk(next, values);
            for (const path of [...active.keys()]) if (!values.has(path)) stopAll(path);
            previous = values;
            return active.size === 0 ? next : tweened(next);
        },
        current() {
            return active.size === 0 ? target : tweened(target);
        },
        settle(path, values) {
            const known = previous.get(path);
            for (const [property, value] of Object.entries(values)) {
                if (value === undefined) continue;
                stop(path, property);
                if (known !== undefined) known[property] = value;
            }
        },
        dispose() {
            for (const path of [...active.keys()]) stopAll(path);
            previous = new Map();
            target = [];
        }
    };
}
