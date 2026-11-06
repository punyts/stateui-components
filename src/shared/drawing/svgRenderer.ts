import { parsePathData } from '@punyts/stateui-app/core';
import type { JsonValue } from '@punyts/stateui-app/core';
import { IDENTITY, boundsAt, hitTest, preserveAspectRatioOf, readFit, readViewBox, transformOf, treeBounds } from './geometry.js';
import type { Bounds, Matrix, ViewBox } from './geometry.js';
import { createPaintResolver, tokenProperty } from './paint.js';
import type { Gradient, Paint, PaintResolver } from './paint.js';
import { registerDrawingRenderer } from './render.js';
import type { DrawingIssue, DrawingRenderer, DrawingRendererOptions } from './render.js';
import { shapeAttrs } from './tree.js';
import type { ShapeKind, ShapeTree } from './tree.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The element each shape is drawn as. `drawRepeat` is a group its copies go into (G1.5b); `drawImage` is drawn by
 * G1.9b, so it has no element yet
 */
const TAGS: Readonly<Record<Exclude<ShapeKind, 'drawImage'>, string>> = {
    rect: 'rect',
    circle: 'circle',
    ellipse: 'ellipse',
    line: 'line',
    polyline: 'polyline',
    polygon: 'polygon',
    path: 'path',
    drawText: 'text',
    drawGroup: 'g',
    drawRepeat: 'g'
};

/** The SVG initial values of the paint attributes: a shape that keeps one writes nothing, so a group's value reaches it */
const INITIAL: Readonly<Record<string, string>> = { 'stroke-width': '1', opacity: '1', 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter' };

const ANCHORS = ['start', 'middle', 'end'];
const BASELINES = ['alphabetic', 'middle', 'hanging'];
const CAPS = ['butt', 'round', 'square'];
const JOINS = ['miter', 'round', 'bevel'];

/** A number as an attribute value: no exponent noise from the matrix maths */
const num = (value: number): string => String(Math.round(value * 1e6) / 1e6);

const isMatrixIdentity = (m: Matrix): boolean => m.every((value, index) => Math.abs(value - IDENTITY[index]!) < 1e-12);

/** A paint name made safe for an element id */
const idPart = (name: string): string => name.replace(/[^A-Za-z0-9_-]/g, '_');

/** Thrown inside the attribute reading of one shape: the shape is not drawn, and the reason is reported */
class Unusable extends Error {}

/** Reads the resolved properties of one shape, refusing a value that is set but cannot be drawn */
class PropertyReader {
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
    word(name: string, allowed: readonly string[]): string | undefined {
        const value = this.value(name);
        if (value === undefined) return undefined;
        if (typeof value !== 'string' || !allowed.includes(value)) throw new Unusable(`property "${name}" is not one of ${allowed.join(', ')}`);
        return value;
    }

    /** A list of `[x, y]` pairs as the `points` attribute (exactly `count` when given); undefined when unset */
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

    /** A number or `[a, b]`, as `scale`; undefined when unset */
    numberOrPair(name: string): void {
        const value = this.value(name);
        if (value === undefined || (typeof value === 'number' && Number.isFinite(value))) return;
        if (Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === 'number' && Number.isFinite(item))) return;
        throw new Unusable(`property "${name}" is not a number or a pair of numbers`);
    }

    /** Two numbers `[x, y]`, as `origin`; nothing when unset */
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

    /** Path data that parses; undefined when unset */
    pathData(name: string): string | undefined {
        const value = this.value(name);
        if (value === undefined) return undefined;
        if (typeof value !== 'string' || !parsePathData(value).ok) throw new Unusable(`property "${name}" is not path data that parses`);
        return value;
    }

    /** A token reference of a font (`{font.family.sans}`) as `var(--ui-font-family-sans)`; undefined when unset */
    font(name: string): string | undefined {
        const value = this.value(name);
        if (value === undefined) return undefined;
        const property = typeof value === 'string' ? tokenProperty(value) : undefined;
        if (property === undefined) throw new Unusable(`property "${name}" is not a token reference such as {font.family.sans}`);
        return `var(${property})`;
    }
}

/** What the renderer wrote for one shape, so a redraw writes only what differs and never reads the DOM */
interface Drawn {
    readonly element: SVGElement;
    readonly tag: string;
    attrs: Record<string, string>;
    text: string;
}

/** What it wrote for one gradient of `paints` */
interface DrawnGradient {
    readonly element: SVGElement;
    readonly signature: string;
}

/**
 * The SVG renderer (G1.5 of the graphics epic 1). It draws into an `svg` it adds to `target` with `createElementNS`
 * (one element per shape: `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path`, `text` for `drawText`,
 * `g` for `drawGroup` and `drawRepeat`) and writes every value through `setAttribute`, never a `style` attribute, so
 * it stays inside a `style-src 'self'` policy. Paint is written as presentation attributes (a token colour as
 * `var(--ui-…)`, a gradient of `paints` as `url(#…)` to a `defs` entry), so a component stylesheet rule can override
 * it. Each element carries `data-shape-path` and `data-shape-kind`, and a feeder's `attrs` as given.
 *
 * A redraw keeps what it wrote per shape: it writes only the attributes and text that changed, removes the elements
 * of shapes that are gone, and moves elements (never recreates them) to follow the order of a `children` map. A shape
 * with a value it cannot draw (text where a number belongs, path data that does not parse) is left out and reported
 * once through `onIssue`; the others draw. `drawText` text is set with `textContent`, never as markup.
 */
export function createSvgRenderer(target: Element, options: DrawingRendererOptions): DrawingRenderer {
    const document = target.ownerDocument;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'svg');
    // A shape with no fill of its own takes the text colour the stylesheet gives the svg
    svg.setAttribute('fill', 'currentColor');
    const defs = document.createElementNS(SVG_NS, 'defs');
    svg.append(defs);
    target.append(svg);

    const drawn = new Map<string, Drawn>();
    const paths = new WeakMap<Element, string>();
    const gradients = new Map<string, DrawnGradient>();
    const clips = new Map<string, { element: SVGElement; id: string }>();
    const reported = new Set<string>();
    let clipCount = 0;
    let tree: readonly ShapeTree[] = [];
    let wanted = new Set<string>();
    let seen = new Set<string>();
    let rootAttrs: Record<string, string> = {};
    let disposed = false;

    const issue = (problem: DrawingIssue): void => {
        const key = 'reason' in problem ? `${problem.path}\u0000${problem.reason}` : `${problem.code}\u0000${problem.path}\u0000${problem.value}`;
        if (reported.has(key)) return;
        reported.add(key);
        try {
            options.onIssue?.(problem);
        } catch {
            // A failing reporter must not stop a drawing
        }
    };

    const paintsPath = options.path === undefined ? 'paints' : `${options.path}.paints`;
    const resolver: PaintResolver = createPaintResolver({ paints: options.readProperty('paints'), paintsPath, onIssue: issue });

    /** Writes the attributes that differ from what was written, and removes those no longer given */
    const writeAttrs = (element: Element, written: Record<string, string>, next: Record<string, string>): void => {
        for (const name of Object.keys(written)) if (!Object.hasOwn(next, name)) element.removeAttribute(name);
        for (const [name, value] of Object.entries(next)) if (written[name] !== value) element.setAttribute(name, value);
    };

    const gradientId = (name: string): string => `paint-${idPart(name)}`;

    const paintValue = (paint: Paint): string => {
        if (paint.kind === 'color') return paint.css;
        if (paint.kind === 'gradient') return `url(#${gradientId(paint.gradient.name)})`;
        return 'none';
    };

    /** The gradients of `paints` as `linearGradient` and `radialGradient` entries of `defs`, rebuilt only when one changed */
    const syncGradients = (): void => {
        const next = new Map<string, Gradient>(resolver.gradients);
        for (const [name, entry] of gradients) {
            if (next.has(name)) continue;
            entry.element.remove();
            gradients.delete(name);
        }
        for (const [name, gradient] of next) {
            const signature = JSON.stringify(gradient);
            const known = gradients.get(name);
            if (known?.signature === signature) continue;
            const element = document.createElementNS(SVG_NS, gradient.kind === 'linear' ? 'linearGradient' : 'radialGradient');
            element.setAttribute('id', gradientId(name));
            if (gradient.kind === 'linear') {
                for (const key of ['x1', 'y1', 'x2', 'y2'] as const) element.setAttribute(key, num(gradient[key]));
            } else {
                for (const key of ['cx', 'cy', 'r'] as const) element.setAttribute(key, num(gradient[key]));
            }
            for (const stop of gradient.stops) {
                const at = document.createElementNS(SVG_NS, 'stop');
                at.setAttribute('offset', num(stop.offset));
                at.setAttribute('stop-color', stop.color.css);
                element.append(at);
            }
            if (known === undefined) defs.append(element);
            else known.element.replaceWith(element);
            gradients.set(name, { element, signature });
        }
    };

    /** The `viewBox` and `preserveAspectRatio` of the svg: the caller's, the `viewBox` property, or the tree's bounds */
    const syncViewBox = (): void => {
        const box: ViewBox | undefined = options.viewBox ?? readViewBox(options.readProperty('viewBox')) ?? contentBox(tree);
        const next: Record<string, string> = { fill: 'currentColor', class: 'svg' };
        if (box !== undefined) next.viewBox = [box.x, box.y, box.width, box.height].map(num).join(' ');
        next.preserveAspectRatio = preserveAspectRatioOf(readFit(options.readProperty('fit')));
        writeAttrs(svg, rootAttrs, next);
        rootAttrs = next;
    };

    /** The paint attributes of a shape: only what it sets, so an unset one falls back to its group */
    const paintAttrs = (shape: ShapeTree, read: PropertyReader, attrs: Record<string, string>): void => {
        for (const name of ['fill', 'stroke'] as const) {
            const value = shape.properties[name];
            if (value === undefined || value === null || value === '') continue;
            attrs[name] = paintValue(resolver.resolve(value, shape.path, name));
        }
        const width = read.number('strokeWidth', 0);
        if (width !== undefined) attrs['stroke-width'] = num(width);
        const opacity = read.number('opacity', 0);
        if (opacity !== undefined) attrs.opacity = num(Math.min(1, opacity));
        const dash = read.numbers('dash');
        if (dash !== undefined) attrs['stroke-dasharray'] = dash.map(num).join(' ');
        const cap = read.word('cap', CAPS);
        if (cap !== undefined) attrs['stroke-linecap'] = cap;
        const join = read.word('join', JOINS);
        if (join !== undefined) attrs['stroke-linejoin'] = join;
        for (const [name, initial] of Object.entries(INITIAL)) if (attrs[name] === initial) delete attrs[name];
    };

    /** The geometry attributes of a shape by its kind; throws `Unusable` for a value it cannot draw */
    const geometryAttrs = (shape: ShapeTree, read: PropertyReader, attrs: Record<string, string>): void => {
        const put = (attr: string, value: number | undefined): void => {
            if (value !== undefined) attrs[attr] = num(value);
        };
        switch (shape.kind) {
            case 'rect':
                put('x', read.number('x'));
                put('y', read.number('y'));
                put('width', read.number('width', 0));
                put('height', read.number('height', 0));
                put('rx', read.number('radius', 0));
                break;
            case 'circle':
                put('cx', read.number('cx'));
                put('cy', read.number('cy'));
                put('r', read.number('r', 0));
                break;
            case 'ellipse':
                put('cx', read.number('cx'));
                put('cy', read.number('cy'));
                put('rx', read.number('rx', 0));
                put('ry', read.number('ry', 0));
                break;
            case 'line': {
                const points = read.points('points', 2);
                if (points === undefined) break;
                const [[x1, y1], [x2, y2]] = points as [[number, number], [number, number]];
                Object.assign(attrs, { x1: num(x1), y1: num(y1), x2: num(x2), y2: num(y2) });
                break;
            }
            case 'polyline':
            case 'polygon': {
                const points = read.points('points');
                if (points !== undefined) attrs.points = points.map(([x, y]) => `${num(x)},${num(y)}`).join(' ');
                break;
            }
            case 'path': {
                const d = read.pathData('d');
                if (d !== undefined) attrs.d = d;
                break;
            }
            case 'drawText': {
                put('x', read.number('x'));
                put('y', read.number('y'));
                attrs['text-anchor'] = read.word('anchor', ANCHORS) ?? 'start';
                attrs['dominant-baseline'] = read.word('baseline', BASELINES) ?? 'alphabetic';
                const font = read.font('font');
                if (font !== undefined) attrs['font-family'] = font;
                put('font-size', read.number('fontSize', 0));
                break;
            }
            case 'drawGroup':
            case 'drawRepeat':
            case 'drawImage':
                break;
        }
        if (shape.kind !== 'rect' && shape.kind !== 'drawText' && shape.kind !== 'drawImage') {
            // x and y are an offset in the transform; checked here so a bad one is reported, not taken as 0
            read.number('x');
            read.number('y');
        }
        read.number('rotate');
        read.numberOrPair('scale');
        read.pair('origin');
    };

    /** The element of a shape, made when it is new or its kind changed */
    const elementFor = (shape: ShapeTree, tag: string): Drawn => {
        const known = drawn.get(shape.path);
        if (known !== undefined && known.tag === tag) return known;
        known?.element.remove();
        const element = document.createElementNS(SVG_NS, tag);
        paths.set(element, shape.path);
        const entry: Drawn = { element, tag, attrs: {}, text: '' };
        drawn.set(shape.path, entry);
        return entry;
    };

    /** Removes the element of a shape that is no longer drawn (it and everything inside it) */
    const drop = (path: string): void => {
        const entry = drawn.get(path);
        if (entry === undefined) return;
        entry.element.remove();
        drawn.delete(path);
    };

    /** Draws one shape and gives its element, or undefined when it is not drawn */
    const drawShape = (shape: ShapeTree): SVGElement | undefined => {
        // A hidden shape (the shared `hidden`) is left out like a removed one; drawImage is drawn by G1.9b
        if (shape.kind === 'drawImage' || shape.properties.hidden === true) return undefined;
        const read = new PropertyReader(shape);
        const attrs: Record<string, string> = {};
        let text = '';
        try {
            geometryAttrs(shape, read, attrs);
            if (shape.kind === 'drawText') text = read.text('_text');
            paintAttrs(shape, read, attrs);
        } catch (error) {
            if (!(error instanceof Unusable)) throw error;
            issue({ code: 'SUI-RUN-DRAW', path: shape.path, reason: `${error.message}, so the shape is not drawn` });
            drop(shape.path);
            return undefined;
        }
        const matrix = transformOf(shape);
        if (!isMatrixIdentity(matrix)) attrs.transform = `matrix(${matrix.map(num).join(' ')})`;
        Object.assign(attrs, shapeAttrs(shape.attrs));
        attrs['data-shape-path'] = shape.path;
        attrs['data-shape-kind'] = shape.kind;

        const entry = elementFor(shape, TAGS[shape.kind]);
        seen.add(shape.path);
        if (shape.kind === 'drawGroup') {
            const clip = shape.clip === undefined ? undefined : drawClip(shape, shape.clip);
            if (clip !== undefined) attrs['clip-path'] = `url(#${clip})`;
            place(entry.element, shape.children);
        }
        writeAttrs(entry.element, entry.attrs, attrs);
        entry.attrs = attrs;
        if (shape.kind === 'drawText' && entry.text !== text) {
            entry.text = text;
            entry.element.textContent = text;
        }
        return entry.element;
    };

    /** The `clipPath` of a group in `defs`, holding its clip shape; gives its id, or undefined when the clip is not drawn */
    const drawClip = (group: ShapeTree, shape: ShapeTree): string | undefined => {
        let clip = clips.get(group.path);
        if (clip === undefined) {
            const element = document.createElementNS(SVG_NS, 'clipPath');
            const id = `clip-${++clipCount}`;
            element.setAttribute('id', id);
            defs.append(element);
            clip = { element, id };
            clips.set(group.path, clip);
        }
        place(clip.element, [shape]);
        return seen.has(shape.path) ? clip.id : undefined;
    };

    /**
     * Puts the elements of `shapes` into `parent` in their order. An element already in place stays where it is, one
     * out of place is moved (never recreated), and elements of shapes that are gone are skipped for the sweep
     */
    const place = (parent: Element, shapes: readonly ShapeTree[]): void => {
        // The position is kept as the element placed last, since drawing a shape may remove the element after it
        let previous: ChildNode | null = parent === svg ? defs : null;
        for (const shape of shapes) {
            const element = drawShape(shape);
            if (element === undefined) continue;
            let cursor: ChildNode | null = previous === null ? parent.firstChild : previous.nextSibling;
            while (cursor !== null && cursor !== element && !wanted.has(paths.get(cursor as Element) ?? '')) cursor = cursor.nextSibling;
            if (element !== cursor) parent.insertBefore(element, cursor);
            previous = element;
        }
    };

    const collectPaths = (shapes: readonly ShapeTree[], into: Set<string>): void => {
        for (const shape of shapes) {
            into.add(shape.path);
            collectPaths(shape.children, into);
            if (shape.clip !== undefined) collectPaths([shape.clip], into);
        }
    };

    let frame: Promise<void> | undefined;

    return {
        update(next: readonly ShapeTree[]): void {
            if (disposed) return;
            tree = next;
            wanted = new Set();
            collectPaths(next, wanted);
            seen = new Set();
            resolver.update({ paints: options.readProperty('paints'), paintsPath });
            syncGradients();
            syncViewBox();
            place(svg, next);
            for (const path of [...drawn.keys()]) if (!seen.has(path)) drop(path);
            for (const [path, clip] of clips) {
                if (seen.has(path) && drawn.get(path)?.attrs['clip-path'] !== undefined) continue;
                clip.element.remove();
                clips.delete(path);
            }
            frame = undefined;
        },
        hit(x: number, y: number): ShapeTree | undefined {
            return disposed ? undefined : hitTest(tree, x, y, { interactive: true });
        },
        boundsOf(path: string): Bounds | undefined {
            return disposed ? undefined : boundsAt(tree, path);
        },
        elementOf(id: string): Element | undefined {
            return disposed ? undefined : drawn.get(id)?.element;
        },
        drawn(): Promise<void> {
            if (disposed) return Promise.resolve();
            frame ??= new Promise<void>((resolve) => {
                const view = document.defaultView;
                if (view === null) resolve();
                else view.requestAnimationFrame(() => resolve());
            });
            return frame;
        },
        dispose(): void {
            if (disposed) return;
            disposed = true;
            svg.remove();
            drawn.clear();
            gradients.clear();
            clips.clear();
            tree = [];
        }
    };
}

/** The box a drawing with no `viewBox` shows: the bounds of its shapes, widened by half the widest stroke so no edge is cut */
function contentBox(shapes: readonly ShapeTree[]): ViewBox | undefined {
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

registerDrawingRenderer('svg', createSvgRenderer);
