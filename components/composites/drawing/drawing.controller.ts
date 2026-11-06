import { report } from '@punyts/core';
import type { ControllerContext } from '@punyts/stateui';
import type { JsonValue } from '@punyts/stateui-app/core';
import { createDrawingRenderer, drawingIssueError, isRendererKind } from '../shared/drawing/render.js';
import type { DrawingIssue, DrawingRenderer, RendererKind } from '../shared/drawing/render.js';
import '../shared/drawing/svgRenderer.js';
import { readShapeTree, shapeProperties } from '../shared/drawing/tree.js';

const rendererOf = (value: unknown): RendererKind => (isRendererKind(value) ? value : 'svg');

/** The paths of the theme a mode, brand or motion switch writes; the drawing is pending until the next frame after one */
const THEME_PATHS = ['$.theme.active', '$.theme.active.$all'];

/**
 * The drawing (G1.5 of the graphics epic 1). The view holds the host (`role="img"`, labelled by `_title` and described
 * by `_description` when there is one) and a surface marked with `data-renderer`. The controller reads the shape nodes
 * of `children` into the plain shape tree (`readShapeTree`, links followed through the store) and hands it to the
 * renderer `renderer` names (`createDrawingRenderer`; the SVG renderer is `src/shared/drawing/svgRenderer.ts`), again
 * on every change at or below `children`, `paints`, `viewBox` or `fit`, at most once per microtask. A node that is not a
 * 2D shape, a shape the renderer cannot draw and a colour that resolves to no paint are reported once each
 * (`SUI-RUN-DRAW`, `SUI-STATE-PAINT`, `SUI-STATE-TOKEN`); the other shapes draw.
 *
 * The element carries `data-render="pending"` from the moment a redraw is asked for (the first draw, a state change, a
 * resize, a theme or mode switch) until the renderer says it is on screen (`drawn()`, after the next frame), then
 * `"ready"`; `ui_screenshot` waits for it
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
                onEvent: () => undefined,
                onIssue
            });
        } catch {
            // The canvas renderer comes with G1.6: until it is registered a canvas drawing draws nothing
        }
    };

    const draw = (): void => {
        scheduled = false;
        if (disposed) return;
        const at = generation;
        ensureRenderer();
        let shown: Promise<void> = new Promise((resolve) => requestAnimationFrame(() => resolve()));
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
            renderer.update(shapes);
            shown = renderer.drawn();
        }
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
            renderer?.dispose();
            renderer = undefined;
        }
    };
}
