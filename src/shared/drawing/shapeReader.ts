import { parsePathData } from '@punyts/stateui-app/core';
import type { JsonValue, PathCommand } from '@punyts/stateui-app/core';
import { treeBounds } from './geometry.js';
import type { Bounds, ViewBox } from './geometry.js';
import { tokenProperty } from './paint.js';
import type { ShapeTree } from './tree.js';

/**
 * The checks of the SVG renderer's property reading, shared so the canvas renderer leaves out the same shapes with the
 * same `SUI-RUN-DRAW` reasons; the SVG renderer reads through it too.
 */

export const ANCHORS = ['start', 'middle', 'end'] as const;
export const BASELINES = ['alphabetic', 'middle', 'hanging'] as const;
export const CAPS = ['butt', 'round', 'square'] as const;
export const JOINS = ['miter', 'round', 'bevel'] as const;

/** Thrown while reading one shape: the shape is not drawn, and the message is the reason that is reported */
export class Unusable extends Error {}

/** Reads the resolved properties of one shape, refusing a value that is set but cannot be drawn (throws `Unusable`) */
export class ShapeReader {
    constructor(private readonly shape: ShapeTree) {}

    private value(name: string): JsonValue | undefined {
        const value = this.shape.properties[name];
        return value === null ? undefined : value;
    }

    /** A finite number (at least `min` when given); undefined when unset */
    number(name: string, min?: number): number | undefined {
        const value = this.value(name);
        if (value === undefined) return undefined;
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Unusable(`property "${name}" is not a number`);
        if (min !== undefined && value < min) throw new Unusable(`property "${name}" is below ${min}`);
        return value;
    }

    /** One of the allowed words; undefined when unset */
    word<T extends string>(name: string, allowed: readonly T[]): T | undefined {
        const value = this.value(name);
        if (value === undefined) return undefined;
        if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw new Unusable(`property "${name}" is not one of ${allowed.join(', ')}`);
        return value as T;
    }

    /** A list of `[x, y]` pairs (exactly `count` when given); undefined when unset */
    points(name: string, count?: number): [number, number][] | undefined {
        const value = this.value(name);
        if (value === undefined) return undefined;
        const bad = new Unusable(`property "${name}" is not a list of [x, y] pairs${count === undefined ? '' : ` of ${count} points`}`);
        if (!Array.isArray(value) || (count !== undefined && value.length !== count)) throw bad;
        return value.map((pair) => {
            if (!Array.isArray(pair) || pair.length !== 2) throw bad;
            const [x, y] = pair;
            if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) throw bad;
            return [x, y];
        });
    }

    /** Checks a number or `[a, b]`, as `scale` */
    numberOrPair(name: string): void {
        const value = this.value(name);
        if (value === undefined || (typeof value === 'number' && Number.isFinite(value))) return;
        if (Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === 'number' && Number.isFinite(item))) return;
        throw new Unusable(`property "${name}" is not a number or a pair of numbers`);
    }

    /** Checks two numbers `[x, y]`, as `origin` */
    pair(name: string): void {
        const value = this.value(name);
        if (value === undefined) return;
        if (Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === 'number' && Number.isFinite(item))) return;
        throw new Unusable(`property "${name}" is not a pair of numbers [x, y]`);
    }

    /** A list of numbers of 0 or more, as `dash`; undefined when unset or empty */
    numbers(name: string): number[] | undefined {
        const value = this.value(name);
        if (value === undefined) return undefined;
        if (!Array.isArray(value) || !value.every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0)) {
            throw new Unusable(`property "${name}" is not a list of numbers of 0 or more`);
        }
        return value.length === 0 ? undefined : (value as number[]);
    }

    /** Text: a string, or a number or boolean shown as text; empty when unset */
    text(name: string): string {
        const value = this.value(name);
        if (value === undefined) return '';
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        throw new Unusable(`property "${name}" is not text`);
    }

    /** The parsed commands of path data; undefined when unset */
    pathCommands(name: string): readonly PathCommand[] | undefined {
        const value = this.value(name);
        if (value === undefined) return undefined;
        const parsed = typeof value === 'string' ? parsePathData(value) : undefined;
        if (parsed === undefined || !parsed.ok) throw new Unusable(`property "${name}" is not path data that parses`);
        return parsed.commands;
    }

    /** The custom property of a font token reference (`{font.family.sans}` is `--ui-font-family-sans`); undefined when unset */
    fontProperty(name: string): string | undefined {
        const value = this.value(name);
        if (value === undefined) return undefined;
        const property = typeof value === 'string' ? tokenProperty(value) : undefined;
        if (property === undefined) throw new Unusable(`property "${name}" is not a token reference such as {font.family.sans}`);
        return property;
    }

    /** Checks the transform properties every shape has: `x` and `y` (an offset for most kinds), `rotate`, `scale`, `origin` */
    transform(): void {
        this.number('x');
        this.number('y');
        this.number('rotate');
        this.numberOrPair('scale');
        this.pair('origin');
    }
}

/** The box a drawing with no `viewBox` shows: the bounds of its shapes, widened by half the widest stroke so no edge is cut */
export function contentBox(shapes: readonly ShapeTree[]): ViewBox | undefined {
    const box = treeBounds(shapes);
    if (box === undefined) return undefined;
    const pad = widestStroke(shapes) / 2;
    // A box with no width or no height (one straight line) is widened, since a viewBox of zero size draws nothing
    return padded(box, box.width <= 0 || box.height <= 0 ? Math.max(pad, 1) : pad);
}

function padded(box: Bounds, pad: number): ViewBox {
    return { x: box.x - pad, y: box.y - pad, width: box.width + 2 * pad, height: box.height + 2 * pad };
}

function widestStroke(shapes: readonly ShapeTree[]): number {
    let widest = 0;
    for (const shape of shapes) {
        const stroke = shape.properties.stroke;
        const width = shape.properties.strokeWidth;
        if (stroke !== undefined && stroke !== null && stroke !== '' && typeof width === 'number' && Number.isFinite(width)) widest = Math.max(widest, width);
        widest = Math.max(widest, widestStroke(shape.children));
    }
    return widest;
}
