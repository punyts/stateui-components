import { report } from '@punyts/core';
import type { ControllerContext } from '@punyts/stateui';
import type { JsonValue } from '@punyts/stateui-app/core';
import { createDrawingRenderer, drawingIssueError, isRendererKind } from '../shared/drawing/render.js';
import type { DrawingIssue, DrawingRenderer, RendererKind, ShapeEvent } from '../shared/drawing/render.js';
import '../shared/drawing/canvasRenderer.js';
import '../shared/drawing/svgRenderer.js';
import { expandRepeats } from '../shared/drawing/rows.js';
import { readShapeTree, shapeProperties } from '../shared/drawing/tree.js';
import type { ShapeTree } from '../shared/drawing/tree.js';

const rendererOf = (value: unknown): RendererKind => (isRendererKind(value) ? value : 'svg');

/** The paths of the theme a mode, brand or motion switch writes; the drawing is pending until the next frame after one */
const THEME_PATHS = ['$.theme.active', '$.theme.active.$all'];

/** True when a shape of the tree (a group's children and a repeat's copies included) has `interactive: true` */
const hasInteractive = (shapes: readonly ShapeTree[]): boolean =>
    shapes.some((shape) => shape.properties.interactive === true || hasInteractive(shape.children));

/**
 * The drawing (G1.5 of the graphics epic 1). The view holds the host (`role="img"`, labelled by `_title` and described
 * by `_description` when there is one) and a surface marked with `data-renderer`. The controller reads the shape nodes
 * of `children` into the plain shape tree (`readShapeTree`, links followed through the store) and hands it to the
 * renderer `renderer` names (`createDrawingRenderer`; the SVG renderer is `src/shared/drawing/svgRenderer.ts`), again
 * on every change at or below `children`, `paints`, `viewBox` or `fit`, at most once per microtask. A node that is not a
 * 2D shape, a shape the renderer cannot draw and a colour that resolves to no paint are reported once each
 * (`SUI-RUN-DRAW`, `SUI-STATE-PAINT`, `SUI-STATE-TOKEN`); the other shapes draw. Each `drawRepeat` is bound to its
 * records with the row binder (`expandRepeats`, G1.5b) before the tree goes to the renderer, capped for the renderer
 * (over the cap is `SUI-RUN-CAP`, reported once), and its record paths and the store paths its template reads are
 * watched too.
 *
 * The element carries `data-render="pending"` from the moment a redraw is asked for (the first draw, a state change, a
 * resize, a theme or mode switch) until the renderer says it is on screen (`drawn()`, after the next frame), then
 * `"ready"`; `ui_screenshot` waits for it.
 *
 * Events (G1.7): the renderer hears `press` and `hover` on interactive shapes, and the controller raises each on the
 * element as a bubbling, composed `CustomEvent` with `detail: { shape, key, x, y }` (the shape's state path, its key or
 * a copy's record key, the position in drawing units). The dispatcher runs the `on` entry of the shape `detail.shape`
 * names (for a repeat copy, the row template's, with `$row` at the record). While any shape is interactive the drawing
 * is a `group` rather than an `img`, since an image hides its children from assistive technology
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const childrenPath = `${basePath}.children`;
    const read = (name: string): JsonValue | undefined => store.get<JsonValue | undefined>(`${basePath}.${name}`) ?? undefined;
    const watched = [
        ...['children', 'paints', 'viewBox', 'fit'].flatMap((name) => [`${basePath}.${name}`, `${basePath}.${name}.$all`]),
        ...THEME_PATHS
    ];
    const rendererPath = `${basePath}.renderer`;
    let renderer: DrawingRenderer | undefined;
    let kind: RendererKind | undefined;
    let surface: HTMLElement | undefined;
    let observer: ResizeObserver | undefined;
    let disposed = false;
    let scheduled = false;
    let generation = 0;
    const reported = new Set<string>();
    /** The store paths the repeats read outside the drawing (records, linked template values), watched since the last draw */
    let repeatPaths: string[] = [];
    /** The repeats whose cut has been reported; one under its cap again is forgotten, so a later cut reports again */
    const cut = new Set<string>();

    const onIssue = (issue: DrawingIssue): void => {
        const error = drawingIssueError(issue);
        report.error(error.message, { code: error.code, path: error.statePath ?? basePath });
    };

    /** Makes the renderer `renderer` names, replacing one of another kind; none when that kind is not registered */
    const ensureRenderer = (): void => {
        if (surface === undefined) return;
        const wanted = rendererOf(store.get<unknown>(rendererPath));
        surface.setAttribute('data-renderer', wanted);
        if (renderer !== undefined && kind === wanted) return;
        renderer?.dispose();
        renderer = undefined;
        kind = wanted;
        try {
            renderer = createDrawingRenderer(surface, {
                renderer: wanted,
                path: basePath,
                reducedMotion: () => false,
                readProperty: read,
                onEvent: raise,
                onIssue
            });
        } catch {
            // Both kinds are registered (the imports above); a renderer that is not draws nothing
        }
    };

    /** Raises a shape's event on the element, for the dispatcher (`detail.shape` names the shape) */
    const raise = (event: ShapeEvent): void => {
        if (disposed) return;
        const detail = { shape: event.shape, key: event.key, x: event.x, y: event.y };
        element.dispatchEvent(new CustomEvent(event.name, { detail, bubbles: true, composed: true }));
    };

    /** The role of the drawing: `group` while a shape is interactive, so the shapes are reached as buttons, else `img` */
    const syncRole = (shapes: readonly ShapeTree[]): void => {
        const box = element.shadowRoot?.querySelector('.drawing');
        const role = hasInteractive(shapes) ? 'group' : 'img';
        if (box && box.getAttribute('role') !== role) box.setAttribute('role', role);
    };

    /** Reports once a key not reported before */
    const reportOnce = (key: string, message: string, code: string, path: string): void => {
        if (reported.has(key)) return;
        reported.add(key);
        report.error(message, { code, path });
    };

    /**
     * Binds each `drawRepeat` (G1.5b, `expandRepeats`: the raw template at `<repeat>.row`, the records, capped for the
     * renderer), reports a cut once as `SUI-RUN-CAP` and a template node or link it leaves out once, and watches the
     * record paths and the store paths each binding lists, so a record change redraws
     */
    const bindRepeats = (shapes: readonly ShapeTree[]): readonly ShapeTree[] => {
        const { shapes: expanded, repeats } = expandRepeats(shapes, {
            renderer: kind ?? 'svg',
            read: (path) => store.get<JsonValue | undefined>(path) ?? undefined,
            resolve: (path) => store.resolve(path),
            properties: shapeProperties
        });
        const paths = new Set<string>();
        const stillCut = new Set<string>();
        for (const { path, binding } of repeats) {
            for (const watch of [binding.recordsPath, ...binding.watch]) paths.add(watch).add(`${watch}.$all`);
            for (const node of binding.unknown) {
                const what = node.component === '' ? 'it is not a node' : `component "${node.component}" is not a 2D shape`;
                const issue = { code: 'SUI-RUN-DRAW', path: node.path, reason: `${what}, so it is not drawn` } as const;
                const error = drawingIssueError(issue);
                reportOnce(`${node.path}\u0000${node.component}`, error.message, error.code, node.path);
            }
            for (const error of binding.errors) reportOnce(`${error.code}\u0000${error.message}`, error.message, error.code, error.statePath ?? path);
            if (binding.cut === undefined) continue;
            stillCut.add(path);
            if (cut.has(path)) continue;
            cut.add(path);
            report.error(binding.cut.error.message, { code: binding.cut.code, path });
        }
        for (const path of cut) if (!stillCut.has(path)) cut.delete(path);
        const next = [...paths];
        const added = next.filter((path) => !repeatPaths.includes(path));
        const removed = repeatPaths.filter((path) => !paths.has(path));
        if (removed.length > 0) store.off(removed, request);
        if (added.length > 0) store.on(added, request);
        repeatPaths = next;
        return expanded;
    };

    const draw = (): void => {
        scheduled = false;
        if (disposed) return;
        const at = generation;
        ensureRenderer();
        // With no renderer the drawing is ready after the next frame; a renderer says itself (one frame for all canvases)
        let shown: Promise<void> | undefined;
        if (renderer !== undefined) {
            const { shapes, unknown } = readShapeTree(store.get<JsonValue | undefined>(childrenPath), childrenPath, {
                read: (path) => store.get<JsonValue | undefined>(path) ?? undefined,
                properties: shapeProperties
            });
            for (const node of unknown) {
                const key = `${node.path}\u0000${node.component}`;
                if (reported.has(key)) continue;
                reported.add(key);
                const what = node.component === '' ? 'it is not a node' : `component "${node.component}" is not a 2D shape`;
                onIssue({ code: 'SUI-RUN-DRAW', path: node.path, reason: `${what}, so it is not drawn` });
            }
            const tree = bindRepeats(shapes);
            renderer.update(tree);
            syncRole(tree);
            shown = renderer.drawn();
        }
        shown ??= new Promise((resolve) => requestAnimationFrame(() => resolve()));
        void shown.then(() => {
            if (!disposed && at === generation) element.setAttribute('data-render', 'ready');
        });
    };

    /** Marks the drawing pending and draws it in the next microtask; several requests in one task draw once */
    const request = (): void => {
        if (disposed) return;
        generation += 1;
        element.setAttribute('data-render', 'pending');
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(draw);
    };

    element.setAttribute('data-render', 'pending');
    store.on(watched, request);
    store.on(rendererPath, request);

    //the view is drawn once the controller has returned, so the renderer and the observer start in a later microtask
    const start = (attempts: number): void => {
        if (disposed) return;
        const found = element.shadowRoot?.querySelector<HTMLElement>('.surface') ?? undefined;
        if (found === undefined) {
            if (attempts > 0) queueMicrotask(() => start(attempts - 1));
            return;
        }
        surface = found;
        observer = new ResizeObserver(request);
        observer.observe(found);
        request();
    };
    queueMicrotask(() => start(8));

    return {
        dispose: () => {
            disposed = true;
            observer?.disconnect();
            store.off(watched, request);
            store.off(rendererPath, request);
            if (repeatPaths.length > 0) store.off(repeatPaths, request);
            repeatPaths = [];
            renderer?.dispose();
            renderer = undefined;
        }
    };
}
