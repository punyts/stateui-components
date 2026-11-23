import { report } from '@punyts/core';
import type { ControllerContext } from '@punyts/stateui';
import { buildError } from '@punyts/stateui-app';
import type { JsonValue } from '@punyts/stateui-app/core';
import { resolveColor } from '../shared/drawing/paint.js';
import { readStoredFile } from '../shared/field/files.js';
import { isReducedMotion } from '../shared/drawing/scheduler.js';
import { requestScene3dChunk } from '../shared/scene3d/load.js';
import { Repeat3dFeeder } from '../shared/scene3d/repeat.js';
import { keyName, readSceneKeys, takenKey } from '../shared/scene3d/keys.js';
import { SceneExport } from '../shared/scene3d/glbExport.js';
import { SceneLoop } from '../shared/play/loop.js';
import type { PlayContact, Vec3 } from '../shared/play/play.js';
import type { Load3dFailure, Scene3dChunk } from '../shared/scene3d/load.js';
import { isScene3dError, readScene3dTree } from '../shared/scene3d/tree.js';
import type { ColorResolver, Scene3d, Scene3dIssue, Scene3dSettings, Scene3dStatus } from '../shared/scene3d/tree.js';
import type { CameraMove, NodeMove } from '../shared/scene3d/tree.js';
import type { Scene3dEvent, Scene3dTree } from '../shared/scene3d/tree.js';

/** True when a node of the tree (a group's children and a repeat's copies included) has `interactive: true` (G3.8) */
const hasInteractive = (nodes: readonly Scene3dTree[]): boolean => nodes.some((node) => node.properties.interactive === true || hasInteractive(node.children));

/** The scene's own properties; a change at or below one of them, or below `children`, redraws the scene */
const SCENE_PROPERTIES = ['children', 'background', 'environment', 'fog', 'controls', 'play'] as const;

/** The token the scene's background is when `background` is unset */
const BACKGROUND_TOKEN = '{scene3d.background}';
/** The colour of the ambient light of the `studio` environment */
const AMBIENT_TOKEN = '{scene3d.ambient}';
/** The colour of a `label3d` that sets no `color` (G3.6b): the theme's text colour */
const LABEL_TOKEN = '{color.text.base}';
/** The active theme and its overlays (`mode`, `brand`, `motion`): a switch gives the tokens other values */
const THEME_PATHS = ['$.theme.active', '$.theme.active.$all'];

/**
 * The 3D scene (G3.4, G3.5 and G3.5b of the graphics epic 3). The view holds the host (`role="img"`, labelled by `_title` and
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
 * the `scene3d.background` token when unset; the `scene3d.ambient` token; `environment`, `studio` when unset; `fog`),
 * and again on every change at or below `children`, `background`, `environment`, `fog` or `controls`, at most once per
 * microtask. The element is `pending` from each change until the scene says the frame is on screen (`drawn()`), then
 * `ready`. It is also `pending` from a `webglcontextlost` of the scene's canvas until the frame drawn after its
 * `webglcontextrestored` (G3.10), so a screenshot never captures the broken canvas of a lost context, and from a frame
 * the scene asks for by itself (a resize; the scene's `onStatus` `pending`) until that frame is drawn.
 *
 * A theme switch (`$.theme.active`, a `mode: "dark"` among them) makes the scene resolve its colours again
 * (`restyle`: the background, the environment, the fog and the nodes' tokens) and read reduced motion again, with no
 * state write; the element is `pending` until that frame is drawn.
 *
 * A node's `transition` (G3.9) is eased by the scene itself, which resolves the duration and easing names (`fast`,
 * `standard`, ...) when a tween starts, from the computed style of the `.surface` element it draws into, so the theme
 * and its `motion` overlay apply; the controller passes the tree as it is. The element stays `pending` until every
 * tween has arrived. Reduced motion (`--ui-motion-duration-base` parsing to 0) is read on mount and on a theme switch,
 * and makes every change jump.
 *
 * `animate` and clips (G3.9b) are played by the scene too, from the tree as it is: a node's `animate` (`spin`, `bob`,
 * `pulse`; any other name is `SUI-STATE-INVALID` from the `motion3d` partial) and a `model`'s clip named by `animation`
 * (the file's first when unset) while `playing` is true. Nothing is written to the store, and the element is `ready`
 * after the first frame, not after the animation (it may loop). A clip name the file does not have is reported once as
 * `SUI-RUN-3D` at the model's path, naming the clips the file has. With reduced motion neither plays and a clip shows its
 * first frame; the overlay is read on mount and on a theme switch, as for `transition`. The copies of a `repeat3d` do
 * not play their own `animate` (the repeat's own moves them all), and a camera's does not play.
 *
 * A failure is reported once as `SUI-RUN-3D` with the scene's path. Its reason is `no_chunk` when nothing answered
 * (the host serves no chunk), the hook's code when it rejected (`load_failed`, `script_error`, `timeout`),
 * `script_error` when the chunk's global is not the renderer's, `no_webgl` when the browser gives no WebGL context
 * (`createScene3d` throws a `Scene3dError`), and `context_lost` when a lost WebGL context is not restored within the
 * scene's 5 s (its `onStatus` `failed`): `_fallback` shows then, until the context comes back after all. A node in
 * `children` that is not a 3D node the renderer draws is reported once as `SUI-RUN-3D` at its own path, and the other
 * nodes draw.
 *
 * A `model`'s GLB file (G3.7b) is read by the controller for the scene (its `readFile` option), with the bubbling
 * `ui-file-read` event (`readStoredFile`, as `drawImage` reads its picture), since the chunk has no access to the store
 * or the host; the scene parses the bytes. A `model` whose `src` is empty or whose file cannot be read draws nothing
 * and is reported as `SUI-RUN-FILE` at the node's path (reason `no_file` or the read's code: `not_found`, `offline`,
 * ...); one whose file is not a GLB the frame can draw (compressed with Draco, Meshopt or KTX2, or with a buffer or image
 * outside the file) as `SUI-RUN-3D` at the node's path with the reason. The other nodes draw, and the element stays
 * `pending` until every model asked for has loaded or failed (the scene's `drawn()` waits for them)
 *
 * Textures (G3.7c): a `mesh`'s `material.map` is a picture file (png, jpeg, gif or webp; the shape's `fileRef`
 * validator refuses another type, a GLB or a text file among them, as `SUI-STATE-INVALID`) read the same way: the
 * scene decodes it to an `ImageBitmap` (no `blob:` URL) and wraps the mesh in it, the right way up and in sRGB. Until
 * it is drawn, and when its file is missing or does not decode, the mesh shows its colour only and the map is reported
 * as `SUI-RUN-FILE` at the mesh's path (reason the read's code, `not_an_image`, or `unsupported_type` for a linked
 * value of another type); the element stays `pending` until every map has loaded or failed. A `repeat3d`'s instances
 * share one material, so they share the first record's map (one read), each tinted by its own colour
 *
 * Controls (G3.8b): `controls` goes to the scene with its other properties (`none` when unset). With `orbit` or `pan`
 * the scene box (`role="img"`, labelled) is focusable and takes the keys, and a pointer drag, the wheel or the keys
 * move the camera in the renderer only: each frame of a gesture marks the element `pending` until it is drawn, and
 * nothing is written until the gesture ends (the release, the wheel idle for 200 ms, the key's release). Then the
 * scene hands over the active camera's `position` and `target` (`onCamera`), and the controller writes each once to the
 * camera node, as a 2D drag writes once per axis; a reload reads the view back from state. A camera written by state
 * during a gesture is shown when it ends, and the gesture writes nothing
 *
 * Repeats (G3.6): each `repeat3d` is bound to its records with the row binder of the 2D repeats (`Repeat3dFeeder`,
 * no node per record) before the tree goes to the scene, which draws the copies as one instanced mesh. Records past
 * 20,000 are cut (`SUI-RUN-CAP`, once); a row property every instance shares (`geometry`, `material` but its
 * colour, the shadow flags) that differs between records is `SUI-RUN-DRAW` naming it, and the first record's is
 * drawn. The records and the store paths the row reads are watched, so a record change redraws
 *
 * Labels (G3.6b): a `label3d` draws its `_text` in the page font (the surface's computed `font-family`, read by the
 * scene) as a sprite that faces the camera (its font `fontSize` scene units), in its `color` or the `color.text.base` token
 * (passed as the scene's `labelColor`), so a theme switch recolours it. The text is drawn on a canvas, never as markup;
 * an empty `_text` draws nothing and a very long one is cut off at the texture's width
 *
 * Events (G3.8): the scene casts a ray on pointer events and tells `press` (a click that did not move the camera: a
 * drag to rotate is never a press) and `hover` (entering) of a node with `interactive: true`; the controller raises
 * each on the element as a bubbling, composed `CustomEvent` with `detail: { shape, key, point }` (the node's state path,
 * `<repeat>.rows.<recordKey>` for a `repeat3d` copy; its key or the copy's record key; the point in world space). The
 * dispatcher runs the `on` entry of the node `detail.shape` names (for a copy, the row template's, with `$row` at the
 * record), as for a 2D shape. Each interactive node has a hidden proxy button over its projected box, in tree order,
 * named by `_label`, so the keyboard (Enter, Space), a screen reader and `ui_interact` reach it; while any node is
 * interactive the scene box's role is `group` (its buttons are reached), else `img`
 *
 * Drag (docs/design/stateui-3d-drag.md): an interactive node with `draggable` (`x`, `z` or `ground`) is dragged on its
 * parent's x-z plane in the renderer, kept in `bounds` and on multiples of `step` with `snap`; on release, or for an
 * arrow key on its proxy, the scene hands the new `position` to `onMove`, the controller writes it once to
 * `<path>.position`, and the scene raises `dragEnd` (`{ shape, key, point }`). A node of a `repeat3d` copy writes the
 * record field its `"<-position": "$row.<field>"` names (docs/design/stateui-3d-drag-copies.md)
 *
 * Keys (docs/design/stateui-game-input.md): while `keys` lists key names (`SCENE_KEYS`), the scene box is focusable
 * (`tabindex="0"`, unless it had one) and names them in `aria-keyshortcuts`. A listed key pressed while focus is in the
 * scene is heard on the element on the way down, stopped there (the camera controls do not see it, the page does not
 * scroll) and raised as a bubbling, composed `key` with `detail: { key }`; a held key repeats. Alt, Control or Meta held,
 * or Enter or Space on a proxy button, leave the press alone. The dispatcher records it at `$.raised.<path>.key`, so a
 * rule triggered there runs on every press
 *
 * The game loop (docs/design/stateui-game-loop.md): while `play.running` is true, the nodes with a `body` (a `mesh`,
 * `group3d` or `model`) move by their `velocity`, the keys held on their `control` and `play.gravity` (`SceneLoop` of
 * `src/shared/play/`, stepping 60 times a second on the animation frame while something moves). The scene draws each
 * frame's positions; the store hears of a body only at a contact, when it comes to rest and when the game stops. A
 * contact raises `contact` with `detail: { shape, key, with, repeat?, side }` on each of the two bodies (one for a side
 * of its `bounds`; `repeat` names the other's `repeat3d` when it is a copy), after both bodies' `position` and
 * `velocity` are written. A `repeat3d` copy with a `body` writes them to the record fields its `$row` links name. The keys a `control` names are taken as `keys`
 * are (the scene box is focusable and names them), held while down, and let go when focus leaves the scene. While bodies
 * move the element has `data-play="moving"`
 */
/** The category of the scene's reports, for stateui-3d too (it has no reporter): the chunk loaded, the scene made and disposed, each issue */
const CATEGORY = 'stateui-components.scene3d';

export default function controller({ element, store, basePath }: ControllerContext) {
    const read = (path: string): JsonValue | undefined => store.get<JsonValue | undefined>(path) ?? undefined;
    const watched = SCENE_PROPERTIES.flatMap((name) => [`${basePath}.${name}`, `${basePath}.${name}.$all`]);
    const reported = new Set<string>();
    let scene: Scene3d | undefined;
    let disposed = false;
    let scheduled = false;
    let generation = 0;
    /** True from a `webglcontextlost` of the scene's canvas until its `webglcontextrestored` */
    let lost = false;
    let surfaceOf: HTMLElement | undefined;
    const keysPath = `${basePath}.keys`;
    const keysWatched = [keysPath, `${keysPath}.$all`];
    /** True when the controller gave the scene box its `tabindex` for `keys` */
    let ownTabIndex = false;
    const exportWatched = [`${basePath}.exportRequest`, `${basePath}.exportRequest.$all`];

    /** The game loop of `play` and the nodes' `body` (docs/design/stateui-game-loop.md) */
    const loop = new SceneLoop({
        write: (path, value) => {
            // A copy's velocity with no $row link has nowhere to go; its game value lives in the scene until it stops
            if (repeats.writesNowhere(path)) return false;
            store.set(repeats.writeTarget(path) ?? path, value);
            return true;
        },
        contact: (contact: PlayContact) => {
            if (disposed) return;
            const detail = { shape: contact.path, key: contact.key, with: contact.with, ...(contact.repeat !== undefined && { repeat: contact.repeat }), side: contact.side };
            element.dispatchEvent(new CustomEvent('contact', { detail, bubbles: true, composed: true }));
        },
        draw: (tree) => {
            if (!disposed) scene?.update(tree);
        },
        measure: (path) => {
            const box = scene?.boundsOf(path);
            return box === undefined ? undefined : (box.max.map((max, axis) => (max - (box.min[axis] as number)) / 2) as Vec3);
        },
        problem: (reason, path) => {
            const at = path === '' ? basePath : path;
            const key = `${at}\u0000${reason}`;
            if (reported.has(key)) return;
            reported.add(key);
            fail(reason, at);
        },
        frame: (callback) => requestAnimationFrame(callback),
        cancel: (handle) => cancelAnimationFrame(handle),
        // `data-play="moving"` while bodies move, so a check (ui_interact) can wait for the game to come to rest
        moving: (on) => {
            if (disposed) return;
            if (on) element.setAttribute('data-play', 'moving');
            else element.removeAttribute('data-play');
        }
    });

    /** The keys the scene takes: those `keys` lists and those a body's `control` names while the game runs */
    const takenKeys = (): string[] => [...new Set([...readSceneKeys(read(keysPath)), ...loop.controlKeys()])];

    /** Raises `ui-file-transfer`; the promise rejects with `offline` when nothing answers (the host has no hook) */
    const hand = (file: File, signal: AbortSignal): Promise<unknown> =>
        new Promise((resolve, reject) => {
            let answered = false;
            const detail = {
                file,
                signal,
                respond: (result: Promise<unknown>): void => {
                    answered = true;
                    result.then(resolve, reject);
                }
            };
            element.dispatchEvent(new CustomEvent('ui-file-transfer', { detail, bubbles: true, composed: true }));
            if (!answered) reject({ code: 'offline' });
        });

    /** The GLB export of `exportRequest` (docs/design/stateui-3d-glb-export.md) */
    const exporter = new SceneExport({
        request: () => read(`${basePath}.exportRequest`),
        exported: () => read(`${basePath}.exported`),
        title: () => read(`${basePath}._title`),
        scene: () => (disposed ? undefined : scene),
        hand,
        write: (value) => store.set(`${basePath}.exported`, value),
        raise: (file) => {
            report(CATEGORY, 'Exported the scene %s as a GLB of %s bytes', [basePath, file.size]);
            element.dispatchEvent(new CustomEvent('exported', { detail: { file }, bubbles: true, composed: true }));
        }
    });
    const syncExport = (): void => exporter.sync();

    /** Makes the scene box focusable and names the keys while `keys` lists some; gives back a `tabindex` it set */
    const syncKeys = (): void => {
        const box = element.shadowRoot?.querySelector<HTMLElement>('.scene');
        if (disposed || !box) return;
        const keys = takenKeys();
        if (keys.length > 0) {
            if (!box.hasAttribute('tabindex')) {
                box.setAttribute('tabindex', '0');
                ownTabIndex = true;
            }
            const names = keys.join(' ');
            if (box.getAttribute('aria-keyshortcuts') !== names) box.setAttribute('aria-keyshortcuts', names);
            return;
        }
        if (ownTabIndex) box.removeAttribute('tabindex');
        ownTabIndex = false;
        box.removeAttribute('aria-keyshortcuts');
    };

    /**
     * Takes a listed key on its way down to the scene and raises `key` for the dispatcher; a key a body's `control`
     * names is held for the game loop as well
     */
    const onKeyDown = (event: KeyboardEvent): void => {
        if (disposed) return;
        const origin = event.composedPath()[0];
        const name = takenKey(event, takenKeys(), origin instanceof HTMLButtonElement);
        if (name === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        loop.keyDown(name);
        if (readSceneKeys(read(keysPath)).includes(name)) element.dispatchEvent(new CustomEvent('key', { detail: { key: name }, bubbles: true, composed: true }));
    };

    /** A key the game loop holds came up */
    const onKeyUp = (event: KeyboardEvent): void => {
        if (!disposed) loop.keyUp(keyName(event.key));
    };

    /** Focus left the scene: the loop lets go of every key */
    const onFocusOut = (event: FocusEvent): void => {
        if (!disposed && !(event.relatedTarget instanceof Node && element.contains(event.relatedTarget))) loop.releaseAll();
    };

    const fail = (reason: string, path = basePath): void => {
        const error = buildError('SUI-RUN-3D', { component: 'scene3d', path, reason, statePath: path });
        report.error(error.message, { code: 'SUI-RUN-3D', path });
    };

    /**
     * A node the scene cannot draw (G3.7b): a model's file as `SUI-RUN-FILE`, its bytes as `SUI-RUN-3D`, at the node's
     * path; a mesh's `material.map` file (G3.7c) as `SUI-RUN-FILE` naming the mesh (or the repeat3d)
     */
    const onIssue = ({ kind, path, reason, node }: Scene3dIssue): void => {
        if (disposed) return;
        const code = kind === 'file' ? 'SUI-RUN-FILE' : 'SUI-RUN-3D';
        report(CATEGORY, 'The scene %s cannot draw %s: %s, %s %s', [basePath, path, code, kind, reason.split(/[\s:]/)[0] ?? reason]);
        const error = buildError(code, { component: node ?? 'model', path, reason, statePath: path });
        report.error(error.message, { code, path });
    };

    /** Reads a model's or a map's file through the host, as `drawImage` reads its picture */
    const readFile = (id: string, signal: AbortSignal): Promise<ArrayBuffer> => readStoredFile(element, id, signal).then((stored) => stored.data);

    const showFallback = (reason: string): void => {
        element.setAttribute('data-fallback', '');
        element.setAttribute('data-render', 'ready');
        fail(reason);
    };

    /** The scene's own properties, the default tokens filling in for an unset `background` */
    const settings = (): Scene3dSettings => {
        const background = read(`${basePath}.background`);
        const fog = read(`${basePath}.fog`);
        return {
            background: background === undefined || background === null || background === '' ? BACKGROUND_TOKEN : background,
            ambient: AMBIENT_TOKEN,
            environment: read(`${basePath}.environment`) ?? 'studio',
            // A copy: the store may change the object it holds in place on a later write
            fog: fog === undefined ? undefined : (JSON.parse(JSON.stringify(fog)) as JsonValue),
            controls: read(`${basePath}.controls`) ?? 'none',
            // G3.6b
            labelColor: LABEL_TOKEN
        };
    };

    /**
     * Writes the camera an orbit or pan gesture ended with (G3.8b): once per property, to the camera node's own
     * `position` and `target` (a link on it is an alias, so the write reaches the link's target), as a 2D drag writes
     */
    const onCamera = (move: CameraMove): void => {
        if (disposed) return;
        store.set(`${move.path}.position`, [...move.position]);
        store.set(`${move.path}.target`, [...move.target]);
    };

    /**
     * Writes a dragged node's `position` once, at the end of its drag (docs/design/stateui-3d-drag.md), or the `position`,
     * `rotation` or `scale` a gizmo's handle changed (docs/design/stateui-3d-gizmo.md): a `<-position` link on the node
     * is an alias, so the write reaches the link's target. A node of a `repeat3d` copy is not a node of the store: the
     * value goes to the record field its `$row` link names (docs/design/stateui-3d-drag-copies.md). The scene raises
     * `dragEnd` after it
     */
    const onMove = (move: NodeMove): void => {
        if (disposed) return;
        const path = `${move.path}.${move.property}`;
        store.set(repeats.writeTarget(path) ?? path, [...move.value]);
    };

    /** Raises a node's `press`, `hover` or `dragEnd` on the element, for the dispatcher (`detail.shape` names the node, G3.8) */
    const onEvent = (event: Scene3dEvent): void => {
        if (disposed) return;
        const detail = { shape: event.shape, key: event.key, point: [...event.point] };
        element.dispatchEvent(new CustomEvent(event.name, { detail, bubbles: true, composed: true }));
    };

    /** The role of the scene box: `group` while a node is interactive, so its proxy buttons are reached, else `img` (G3.8) */
    const syncRole = (nodes: readonly Scene3dTree[]): void => {
        const box = element.shadowRoot?.querySelector('.scene');
        const role = hasInteractive(nodes) ? 'group' : 'img';
        if (box && box.getAttribute('role') !== role) box.setAttribute('role', role);
    };

    /** Marks the element `ready` once the scene's next frame is on screen, unless another change came first */
    const readyAfterFrame = (): void => {
        const at = generation;
        void scene?.drawn().then(() => {
            // A frame while the context is lost draws nothing: the scene stays pending until the one after the restore
            if (!disposed && at === generation && !lost) element.setAttribute('data-render', 'ready');
        });
    };

    /** Something other than a state change of the scene gives another picture: pending until it is drawn */
    const repaint = (): void => {
        if (disposed || scene === undefined) return;
        generation += 1;
        element.setAttribute('data-render', 'pending');
        readyAfterFrame();
    };

    const draw = (): void => {
        scheduled = false;
        if (disposed || scene === undefined) return;
        const childrenPath = `${basePath}.children`;
        const { nodes, unknown } = readScene3dTree(read(childrenPath), childrenPath, { read });
        for (const node of unknown) {
            const key = `${node.path}\u0000${node.component}`;
            if (reported.has(key)) continue;
            reported.add(key);
            const what = node.component === '' ? 'it is not a node' : `component "${node.component}" is not a 3D node`;
            fail(`${what}, so it is not drawn`, node.path);
        }
        const expanded = repeats.expand(nodes);
        syncRole(expanded);
        scene.update(loop.sync(expanded, read(`${basePath}.play`)), settings());
        // The camera controls give back a `tabindex` they set when they are turned off, which `keys` may still need
        syncKeys();
        readyAfterFrame();
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

    /**
     * The `repeat3d` nodes (G3.6): bound to their records on every draw, their copies handed to the scene as the
     * repeat's `children` (one instanced mesh); their records and template links watched, problems reported once
     */
    const repeats = new Repeat3dFeeder({
        read,
        resolve: (path) => store.resolve(path),
        on: (paths) => store.on(paths, request),
        off: (paths) => store.off(paths, request),
        report: (error, path) => report.error(error.message, { code: error.code, path })
    });

    /**
     * The canvas lost its WebGL context (G3.1: the first page of a newly started headless Chromium loses its contexts
     * once, and a screenshot then shows a broken image): pending until the frame drawn after the restore
     */
    const onContextLost = (): void => {
        lost = true;
        generation += 1;
        element.setAttribute('data-render', 'pending');
    };

    /** The context is back: draw again, and be ready once that frame is on screen; a `_fallback` shown for it goes */
    const onContextRestored = (): void => {
        lost = false;
        element.removeAttribute('data-fallback');
        request();
    };

    /**
     * What the scene tells by itself (G3.5b): `pending` for a frame it asked for (a resize, a restored context), `lost`
     * as the context event above, and `failed` when the context did not come back within its 5 s: `_fallback` and one
     * `SUI-RUN-3D` `context_lost`
     */
    const onStatus = (status: Scene3dStatus): void => {
        if (disposed) return;
        if (status === 'lost') onContextLost();
        else if (status === 'failed') showFallback('context_lost');
        else repaint();
    };

    /** A theme switch: the same tokens resolve to other colours, and the motion overlay may change reduced motion */
    const onTheme = (): void => {
        if (disposed || scene === undefined) return;
        scene.restyle();
        repaint();
        // Read once the switch is applied to the page's styles, as the colours are read when the frame is drawn
        queueMicrotask(() => {
            if (!disposed) scene?.setReducedMotion(readReducedMotion());
        });
    };

    const readReducedMotion = (): boolean => {
        const style = getComputedStyle(element);
        return isReducedMotion((name) => style.getPropertyValue(name).trim() || undefined);
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
        try {
            scene = chunk.createScene3d(surface, { resolveColor: resolve, reducedMotion: readReducedMotion(), onStatus, readFile, onIssue, onCamera, keyTarget: box, onEvent, onMove });
        } catch (error) {
            report(CATEGORY, 'Could not make the scene %s: %s', [basePath, isScene3dError(error) ? error.code : 'script_error']);
            showFallback(isScene3dError(error) ? error.code : `script_error: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        element.removeAttribute('data-fallback');
        report(CATEGORY, 'Made the scene %s', [basePath]);
        // The context events do not bubble: they are heard on the way down to the renderer's canvas in the surface
        surfaceOf = surface;
        surface.addEventListener('webglcontextlost', onContextLost, true);
        surface.addEventListener('webglcontextrestored', onContextRestored, true);
        store.on(watched, request);
        store.on(THEME_PATHS, onTheme);
        request();
        store.on(exportWatched, syncExport);
        syncExport();
    };

    element.setAttribute('data-render', 'pending');

    //the element is in the page once the controller has returned, so the request bubbles to the dispatcher a microtask later
    element.addEventListener('keydown', onKeyDown, true);
    element.addEventListener('keyup', onKeyUp, true);
    element.addEventListener('focusout', onFocusOut);
    store.on(keysWatched, syncKeys);

    queueMicrotask(() => {
        if (disposed) return;
        syncKeys();
        const asked = performance.now();
        const took = (): number => Math.round((performance.now() - asked) * 10) / 10;
        requestScene3dChunk(element).then(
            (chunk) => {
                report(CATEGORY, 'Loaded the 3D runtime chunk for %s in %s ms', [basePath, took()]);
                if (!disposed) start(chunk);
            },
            (failure: Load3dFailure) => {
                report(CATEGORY, 'Could not load the 3D runtime chunk for %s: %s, after %s ms', [basePath, reasonOf(failure), took()]);
                if (!disposed) showFallback(reasonOf(failure));
            }
        );
    });

    return {
        dispose: () => {
            disposed = true;
            element.removeEventListener('keydown', onKeyDown, true);
            element.removeEventListener('keyup', onKeyUp, true);
            element.removeEventListener('focusout', onFocusOut);
            loop.dispose();
            store.off(keysWatched, syncKeys);
            store.off(watched, request);
            store.off(THEME_PATHS, onTheme);
            store.off(exportWatched, syncExport);
            exporter.dispose();
            repeats.dispose();
            surfaceOf?.removeEventListener('webglcontextlost', onContextLost, true);
            surfaceOf?.removeEventListener('webglcontextrestored', onContextRestored, true);
            if (scene !== undefined) report(CATEGORY, 'Disposed the scene %s', [basePath]);
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
