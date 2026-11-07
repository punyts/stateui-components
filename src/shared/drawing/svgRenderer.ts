import { IDENTITY, boundsAt, hitTest, preserveAspectRatioOf, readFit, readViewBox, transformOf } from './geometry.js';
import type { Bounds, Matrix, ViewBox } from './geometry.js';
import { createShapeDrag, dragAxes } from './drag.js';
import { createPaintResolver } from './paint.js';
import type { Gradient, Paint, PaintResolver } from './paint.js';
import { registerDrawingRenderer } from './render.js';
import type { DrawingIssue, DrawingRenderer, DrawingRendererOptions, ShapeEventName } from './render.js';
import { createScheduler } from './scheduler.js';
import { ANCHORS, BASELINES, CAPS, JOINS, ShapeReader, Unusable, contentBox } from './shapeReader.js';
import { createTransitions, keyPath, settleMoves, styleReader, tokenNormalizer } from './transition.js';
import { locateShape, shapeAttrs } from './tree.js';
import type { ShapeKind, ShapeTree } from './tree.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The element each shape is drawn as. `drawRepeat` is a group its copies (its bound `children`) go into; `drawImage`
 * is drawn by G1.9b, so it has no element yet
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

/** A number as an attribute value: no exponent noise from the matrix maths */
const num = (value: number): string => String(Math.round(value * 1e6) / 1e6);

const isMatrixIdentity = (m: Matrix): boolean => m.every((value, index) => Math.abs(value - IDENTITY[index]!) < 1e-12);

/** A paint name made safe for an element id */
const idPart = (name: string): string => name.replace(/[^A-Za-z0-9_-]/g, '_');

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
 * it. Each element carries `data-shape-path` and `data-shape-kind`, and a feeder's `attrs` as given. A `drawRepeat`'s
 * copies (its `children` as `expandRepeats` binds them, already capped at 2,000) are drawn into its `g` like a group's
 * children, one element per copy at `<repeat>.rows.<recordKey>`, so a change to one record touches only its element.
 *
 * A redraw keeps what it wrote per shape: it writes only the attributes and text that changed, removes the elements
 * of shapes that are gone, and moves elements (never recreates them) to follow the order of a `children` map. A shape
 * with a value it cannot draw (text where a number belongs, path data that does not parse) is left out and reported
 * once through `onIssue`; the others draw. `drawText` text is set with `textContent`, never as markup.
 *
 * Events (G1.7): the svg takes no pointer events (`pointer-events="none"`), so a shape without `interactive: true` is
 * not hit and a press on it or on empty space reaches nothing. An interactive shape is the button itself: `role="button"`,
 * `tabindex="0"`, `aria-label` from `_label` and `pointer-events="visiblePainted"` (a feeder's `attrs` may override the
 * first three); the shapes inside an interactive group take the group's. A click on it, or Enter or Space while it has
 * focus, is `press`; the pointer entering it is `hover`, once per entry. Each goes to `onEvent` with the shape's path
 * and key and the position in drawing units (the pointer's, or the shape's centre for a key or a click with no pointer)
 *
 * Drag (G1.7b, `createShapeDrag` of `drag.ts`): an interactive shape with `draggable` (and a feeder that passes
 * `onMove`) carries `data-draggable` with its axes. A press on it captures the pointer, the element follows every move
 * (only its own attributes are rewritten, nothing is written to the store), and the release hands the new `x` and `y`
 * to `onMove` and raises `dragEnd`; the click that ends a drag is not a press. Escape or a pointer cancel puts it back.
 * The arrow keys move a focused one by `step` (Shift ten), each key a finished move
 *
 * Motion (G1.8, `scheduler.ts` and `transition.ts`): a change of a number or of `fill` or `stroke` of a shape with
 * `transition` tweens in the renderer's own frame loop (only the moving shapes' attributes are rewritten each frame);
 * with reduced motion (`options.reducedMotion()`, asked on every update) it jumps. A position a drag or an arrow key
 * hands to `onMove` is shown at once, not tweened. `drawn()` resolves once the running tweens have ended
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
    /** The interactive shapes of the last update, by path: the ones that raise `press` and `hover` */
    let interactive = new Map<string, ShapeTree>();
    /** The path of the interactive shape the pointer is in, so `hover` fires once per entry */
    let hovered: string | undefined;

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
        // No pointer events by default: only interactive shapes take them, a press elsewhere reaches nothing
        const next: Record<string, string> = { fill: 'currentColor', class: 'svg', 'pointer-events': 'none' };
        if (box !== undefined) next.viewBox = [box.x, box.y, box.width, box.height].map(num).join(' ');
        next.preserveAspectRatio = preserveAspectRatioOf(readFit(options.readProperty('fit')));
        writeAttrs(svg, rootAttrs, next);
        rootAttrs = next;
    };

    /** The paint attributes of a shape: only what it sets, so an unset one falls back to its group */
    const paintAttrs = (shape: ShapeTree, read: ShapeReader, attrs: Record<string, string>): void => {
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
    const geometryAttrs = (shape: ShapeTree, read: ShapeReader, attrs: Record<string, string>): void => {
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
                // The commands are parsed only to refuse path data that does not parse; the text is written as given
                if (read.pathCommands('d') !== undefined) attrs.d = shape.properties.d as string;
                break;
            }
            case 'drawText': {
                put('x', read.number('x'));
                put('y', read.number('y'));
                attrs['text-anchor'] = read.word('anchor', ANCHORS) ?? 'start';
                attrs['dominant-baseline'] = read.word('baseline', BASELINES) ?? 'alphabetic';
                const font = read.fontProperty('font');
                if (font !== undefined) attrs['font-family'] = `var(${font})`;
                put('font-size', read.number('fontSize', 0));
                break;
            }
            case 'drawGroup':
            case 'drawRepeat':
            case 'drawImage':
                break;
        }
        // x and y (an offset in the transform for most kinds) are checked here so a bad one is reported, not taken as 0
        read.transform();
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
        const read = new ShapeReader(shape);
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
        if (shape.properties.interactive === true) {
            // An SVG element is not a native button: the role, the tab stop and the name make it one, and the keys are
            // handled below. The svg takes no pointer events, so an interactive shape turns them back on for itself
            interactive.set(shape.path, shape);
            attrs.role = 'button';
            attrs.tabindex = '0';
            const label = shape.properties._label;
            if (typeof label === 'string' && label !== '') attrs['aria-label'] = label;
            attrs['pointer-events'] = 'visiblePainted';
            const axes = options.onMove === undefined ? [] : dragAxes(shape);
            if (axes.length > 0) attrs['data-draggable'] = axes.length === 2 ? 'both' : axes[0]!;
        }
        Object.assign(attrs, shapeAttrs(shape.attrs));
        attrs['data-shape-path'] = shape.path;
        attrs['data-shape-kind'] = shape.kind;

        const entry = elementFor(shape, TAGS[shape.kind]);
        seen.add(shape.path);
        if (shape.kind === 'drawGroup') {
            const clip = shape.clip === undefined ? undefined : drawClip(shape, shape.clip);
            if (clip !== undefined) attrs['clip-path'] = `url(#${clip})`;
            place(entry.element, shape.children);
        } else if (shape.kind === 'drawRepeat') {
            // One element per copy the feeder bound (`expandRepeats`), keyed by its path `<repeat>.rows.<recordKey>`
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

    /** The interactive shape an event target is in: the nearest drawn element at or above it that is interactive */
    const shapeAt = (target: EventTarget | null): ShapeTree | undefined => {
        let node = target instanceof Node ? target : null;
        while (node !== null && node !== svg) {
            const path = node instanceof Element ? paths.get(node) : undefined;
            const shape = path === undefined ? undefined : interactive.get(path);
            if (shape !== undefined) return shape;
            node = node.parentNode;
        }
        return undefined;
    };

    /** A pointer position in drawing units (the svg's own user space, its `viewBox`) */
    const toDrawing = (event: MouseEvent): { x: number; y: number } => {
        const matrix = svg.getScreenCTM();
        if (matrix === null) return { x: 0, y: 0 };
        const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
        return { x: point.x, y: point.y };
    };

    /** The centre of a shape in drawing units, the position of a press that has no pointer (a key, a scripted click) */
    const centreOf = (shape: ShapeTree): { x: number; y: number } => {
        const box = boundsAt(tree, shape.path);
        return box === undefined ? { x: 0, y: 0 } : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };

    const raise = (name: ShapeEventName, shape: ShapeTree, at: { x: number; y: number }): void => {
        options.onEvent({ name, shape: shape.path, key: shape.key, x: at.x, y: at.y });
    };

    /** Transitions: the tweened shapes are redrawn alone in each frame of the scheduler */
    const view = document.defaultView;
    const scheduler = createScheduler({
        requestFrame: view === null ? undefined : (callback) => view.requestAnimationFrame(callback),
        cancelFrame: (handle) => view?.cancelAnimationFrame(handle),
        onFrame(changed) {
            if (disposed) return;
            tree = drag.apply(transitions.current());
            for (const path of new Set([...changed].map(keyPath))) {
                const chain = locateShape(tree, path);
                const shape = chain?.[chain.length - 1];
                if (shape !== undefined) drawShape(shape);
            }
        }
    });
    const transitions = createTransitions({ scheduler, read: styleReader(svg), normalize: tokenNormalizer(document) });

    /** Drags: a moved shape is redrawn alone (its element's attributes), from the tree with it moved */
    const drag = createShapeDrag({
        options: settleMoves(options, transitions),
        toDrawing,
        show(next, path) {
            if (disposed) return;
            tree = next;
            const chain = locateShape(next, path);
            const shape = chain?.[chain.length - 1];
            if (shape !== undefined) drawShape(shape);
        }
    });

    /** A press on a draggable interactive shape may start a drag (the pointer is captured on its element) */
    const onDown = (event: PointerEvent): void => {
        const shape = shapeAt(event.target);
        const element = shape === undefined ? undefined : drawn.get(shape.path)?.element;
        if (shape !== undefined && element !== undefined) drag.pointerDown(event, shape, element, svg);
    };

    /** A click on an interactive shape is a press; one with no pointer (`detail` 0, as `element.click()`) is at its centre */
    const onClick = (event: MouseEvent): void => {
        if (drag.swallowClick()) return;
        const shape = shapeAt(event.target);
        if (shape !== undefined) raise('press', shape, event.detail === 0 ? centreOf(shape) : toDrawing(event));
    };

    /** Enter and Space on a focused interactive shape are a press, as on a native button (held keys do not repeat it) */
    const onKey = (event: KeyboardEvent): void => {
        const shape = shapeAt(event.target);
        if (shape === undefined) return;
        // The arrow keys move a draggable shape
        if (drag.key(event, shape)) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (!event.repeat) raise('press', shape, centreOf(shape));
    };

    /** The pointer entered an element: `hover` when that puts it in an interactive shape it was not in */
    const onOver = (event: PointerEvent): void => {
        const shape = shapeAt(event.target);
        if (shape?.path === hovered) return;
        hovered = shape?.path;
        if (shape !== undefined) raise('hover', shape, toDrawing(event));
    };

    /** The pointer left an element: out of the hovered shape unless it went to another part of the same one */
    const onOut = (event: PointerEvent): void => {
        if (shapeAt(event.relatedTarget)?.path !== hovered) hovered = undefined;
    };

    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('click', onClick);
    svg.addEventListener('keydown', onKey);
    svg.addEventListener('pointerover', onOver);
    svg.addEventListener('pointerout', onOut);

    return {
        update(next: readonly ShapeTree[]): void {
            if (disposed) return;
            // Reduced motion is asked for each update (the feeder reads it on mount and when the motion overlay changes);
            // a changed value of a shape with `transition` starts at the value on screen, and a drag in progress keeps
            // its shape where the pointer has it
            scheduler.setReduced(options.reducedMotion());
            tree = drag.apply(transitions.apply(next));
            wanted = new Set();
            collectPaths(tree, wanted);
            seen = new Set();
            interactive = new Map();
            resolver.update({ paints: options.readProperty('paints'), paintsPath });
            syncGradients();
            syncViewBox();
            place(svg, tree);
            if (hovered !== undefined && !interactive.has(hovered)) hovered = undefined;
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
            // On screen once the tweens that run have ended, so a screenshot shows where the shapes go
            return frame.then(() => scheduler.settled());
        },
        dispose(): void {
            if (disposed) return;
            disposed = true;
            drag.dispose();
            scheduler.dispose();
            transitions.dispose();
            svg.removeEventListener('pointerdown', onDown);
            svg.removeEventListener('click', onClick);
            svg.removeEventListener('keydown', onKey);
            svg.removeEventListener('pointerover', onOver);
            svg.removeEventListener('pointerout', onOut);
            interactive.clear();
            hovered = undefined;
            svg.remove();
            drawn.clear();
            gradients.clear();
            clips.clear();
            tree = [];
        }
    };
}

registerDrawingRenderer('svg', createSvgRenderer);
