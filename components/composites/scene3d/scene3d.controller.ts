import { report } from '@punyts/core';
import type { ControllerContext } from '@punyts/stateui';
import { buildError } from '@punyts/stateui-app';
import type { JsonValue } from '@punyts/stateui-app/core';
import { resolveColor } from '../shared/drawing/paint.js';
import { isReducedMotion } from '../shared/drawing/scheduler.js';
import { requestScene3dChunk } from '../shared/scene3d/load.js';
import type { Load3dFailure, Scene3dChunk } from '../shared/scene3d/load.js';
import { isScene3dError, readScene3dTree } from '../shared/scene3d/tree.js';
import type { ColorResolver, Scene3d, Scene3dSettings } from '../shared/scene3d/tree.js';

/** The scene's own properties; a change at or below one of them, or below `children`, redraws the scene */
const SCENE_PROPERTIES = ['children', 'background', 'environment', 'fog', 'controls'] as const;

/** The token the scene's background is when `background` is unset */
const BACKGROUND_TOKEN = '{scene3d.background}';
/** The colour of the ambient light an environment other than `none` adds (the presets themselves are G3.5b) */
const AMBIENT_TOKEN = '{scene3d.ambient}';

/**
 * The 3D scene (G3.4 and G3.5 of the graphics epic 3). The view holds the host (`role="img"`, labelled by `_title` and
 * described by `_description` when there is one), the surface the renderer draws into and the `_fallback` text, shown
 * while the element carries `data-fallback`.
 *
 * On mount the element is `data-render="pending"` and the controller asks for the 3D renderer chunk with the bubbling,
 * composed `ui-load-3d` event (`requestScene3dChunk`). An unanswered event (a host without the `load3d` hook) or a
 * failed load shows `_fallback` and marks the scene `ready`, so a screenshot does not wait for it.
 *
 * With the chunk, the controller makes the scene on the `.surface` element with its `createScene3d` (G3.5): colours,
 * literals or tokens, are resolved by the paint resolver of the 2D renderers (`resolveColor`) from the surface's
 * computed style (`--ui-…`). It reads the 3D nodes of `children` into the plain node tree (`readScene3dTree`, links
 * followed through the store) and hands it to the scene's `update` with the scene's own properties (`background`, or
 * the `scene3d.background` token when unset; the `scene3d.ambient` token; `environment`), and again on every change at
 * or below `children`, `background`, `environment`, `fog` or `controls`, at most once per microtask. The element is
 * `pending` from each change until the scene says the frame is on screen (`drawn()`), then `ready`.
 *
 * A failure is reported once as `SUI-RUN-3D` with the scene's path. Its reason is `no_chunk` when nothing answered
 * (the host serves no chunk), the hook's code when it rejected (`load_failed`, `script_error`, `timeout`),
 * `script_error` when the chunk's global is not the renderer's, and `no_webgl` when the browser gives no WebGL context
 * (`createScene3d` throws a `Scene3dError`). A node in `children` that is not a 3D node the renderer draws is reported
 * once as `SUI-RUN-3D` at its own path, and the other nodes draw
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const read = (path: string): JsonValue | undefined => store.get<JsonValue | undefined>(path) ?? undefined;
    const watched = SCENE_PROPERTIES.flatMap((name) => [`${basePath}.${name}`, `${basePath}.${name}.$all`]);
    const reported = new Set<string>();
    let scene: Scene3d | undefined;
    let disposed = false;
    let scheduled = false;
    let generation = 0;

    const fail = (reason: string, path = basePath): void => {
        const error = buildError('SUI-RUN-3D', { component: 'scene3d', path, reason, statePath: path });
        report.error(error.message, { code: 'SUI-RUN-3D', path });
    };

    const showFallback = (reason: string): void => {
        element.setAttribute('data-fallback', '');
        element.setAttribute('data-render', 'ready');
        fail(reason);
    };

    /** The scene's own properties, the default tokens filling in for an unset `background` */
    const settings = (): Scene3dSettings => {
        const background = read(`${basePath}.background`);
        return {
            background: background === undefined || background === null || background === '' ? BACKGROUND_TOKEN : background,
            ambient: AMBIENT_TOKEN,
            environment: read(`${basePath}.environment`) ?? 'studio'
        };
    };

    const draw = (): void => {
        scheduled = false;
        if (disposed || scene === undefined) return;
        const at = generation;
        const childrenPath = `${basePath}.children`;
        const { nodes, unknown } = readScene3dTree(read(childrenPath), childrenPath, { read });
        for (const node of unknown) {
            const key = `${node.path}\u0000${node.component}`;
            if (reported.has(key)) continue;
            reported.add(key);
            const what = node.component === '' ? 'it is not a node' : `component "${node.component}" is not a 3D node`;
            fail(`${what}, so it is not drawn`, node.path);
        }
        scene.update(nodes, settings());
        void scene.drawn().then(() => {
            if (!disposed && at === generation) element.setAttribute('data-render', 'ready');
        });
    };

    /** Marks the scene pending and draws it in the next microtask; several requests in one task draw once */
    const request = (): void => {
        if (disposed) return;
        generation += 1;
        element.setAttribute('data-render', 'pending');
        if (scheduled || scene === undefined) return;
        scheduled = true;
        queueMicrotask(draw);
    };

    /** Makes the scene on the surface with the chunk's renderer, or shows `_fallback` when it cannot draw */
    const start = (chunk: Scene3dChunk): void => {
        const surface = element.shadowRoot?.querySelector<HTMLElement>('.surface') ?? undefined;
        const box = element.shadowRoot?.querySelector<HTMLElement>('.scene') ?? undefined;
        if (surface === undefined || box === undefined) return;
        // The scene's own tokens are set only when a theme overrides them; the view's CSS carries them with their
        // defaults, as the scene's background colour and the surface's text colour
        const sceneTokens: Readonly<Record<string, () => string>> = {
            [BACKGROUND_TOKEN]: () => getComputedStyle(box).backgroundColor,
            [AMBIENT_TOKEN]: () => getComputedStyle(surface).color
        };
        // Other tokens are read from the surface's computed style, below the host, so a node theme's overrides apply
        const resolve: ColorResolver = (value) => {
            const own = typeof value === 'string' && Object.hasOwn(sceneTokens, value) ? sceneTokens[value] : undefined;
            if (own !== undefined) {
                const colour = own().trim();
                return colour === '' || colour === 'transparent' || colour === 'rgba(0, 0, 0, 0)' ? undefined : colour;
            }
            const style = getComputedStyle(surface);
            const resolved = resolveColor(value, (name) => style.getPropertyValue(name).trim() || undefined);
            return resolved.kind === 'color' ? resolved.computed : undefined;
        };
        const style = getComputedStyle(element);
        const reducedMotion = isReducedMotion((name) => style.getPropertyValue(name).trim() || undefined);
        try {
            scene = chunk.createScene3d(surface, { resolveColor: resolve, reducedMotion });
        } catch (error) {
            showFallback(isScene3dError(error) ? error.code : `script_error: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        element.removeAttribute('data-fallback');
        store.on(watched, request);
        request();
    };

    element.setAttribute('data-render', 'pending');

    //the element is in the page once the controller has returned, so the request bubbles to the dispatcher a microtask later
    queueMicrotask(() => {
        if (disposed) return;
        requestScene3dChunk(element).then(
            (chunk) => {
                if (!disposed) start(chunk);
            },
            (failure: Load3dFailure) => {
                if (!disposed) showFallback(reasonOf(failure));
            }
        );
    });

    return {
        dispose: () => {
            disposed = true;
            store.off(watched, request);
            scene?.dispose();
            scene = undefined;
        }
    };
}

/** The `SUI-RUN-3D` reason of a failed chunk request */
function reasonOf(failure: Load3dFailure): string {
    if (failure.code === 'offline') return 'no_chunk';
    if (failure.code === 'invalid') return 'script_error';
    const code = (failure.cause as { code?: unknown } | undefined)?.code;
    return typeof code === 'string' ? code : 'load_failed';
}
