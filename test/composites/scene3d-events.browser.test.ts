import { report } from '@punyts/core';
import { userEvent } from 'vitest/browser';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent, MountOptions, NodeState } from '../harness/createMountComponent.js';
import { isScene3dChunk } from '../../src/shared/scene3d/load.js';
import type { Scene3dChunk } from '../../src/shared/scene3d/load.js';

/** The built chunk of `../stateui-3d` (test/globalSetup.ts); empty when the workspace has not built it */
const script = inject('chunk3dScript');
const ROOT = '$.app.children';

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Answers `ui-load-3d` with the real chunk's global, as the runtime's `load3d` hook does */
function answerWith(chunk: unknown): () => void {
    const listener = (event: Event): void => {
        (event as CustomEvent<{ respond: (result: Promise<unknown>) => void }>).detail.respond(Promise.resolve(chunk));
    };
    document.addEventListener('ui-load-3d', listener);
    return () => document.removeEventListener('ui-load-3d', listener);
}

interface Mounted extends MountedComponent {
    /** The `press` and `hover` events the scene raised, in order */
    readonly raised: { type: string; detail: { shape: string; key: string; point: number[] } }[];
}

/** Mounts a scene, records its events, and waits until it is drawn (`data-render="ready"`, at most 200 frames) */
async function mountScene(node: NodeState, options: MountOptions = {}): Promise<Mounted> {
    const mounted = mountComponent('scene3d', node, { data: { ui: { part: '', hovered: '' } }, ...options });
    const raised: Mounted['raised'] = [];
    for (const type of ['press', 'hover']) mounted.element.addEventListener(type, (event) => raised.push({ type, detail: (event as CustomEvent).detail }));
    await Promise.resolve();
    for (let at = 0; at < 200; at += 1) {
        if (mounted.element.getAttribute('data-render') === 'ready' && mounted.element.shadowRoot?.querySelector('canvas')) break;
        await frame();
    }
    if (mounted.element.getAttribute('data-render') !== 'ready') throw new Error(`the scene is still ${mounted.element.getAttribute('data-render')}`);
    return Object.assign(mounted, { raised });
}

const canvasOf = (mounted: MountedComponent): HTMLCanvasElement => mounted.element.shadowRoot?.querySelector('.surface canvas') as HTMLCanvasElement;
const proxyOf = (mounted: MountedComponent, path: string): HTMLButtonElement | null => mounted.element.shadowRoot?.querySelector<HTMLButtonElement>(`.proxies > button[data-shape-path="${path}"]`) ?? null;
const boxOf = (mounted: MountedComponent): HTMLElement => mounted.element.shadowRoot?.querySelector('.scene') as HTMLElement;

/** Dispatches a keydown of `key` on `target`, as a press with the focus there, and gives it back */
function press(target: EventTarget, key: string, held: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true, ...held });
    target.dispatchEvent(event);
    return event;
}
const roleOf = (mounted: MountedComponent): string | null | undefined => mounted.element.shadowRoot?.querySelector('.scene')?.getAttribute('role');

/** Dispatches a mouse pointer event on the scene's canvas at a fraction of its size */
function pointer(mounted: MountedComponent, type: string, fx: number, fy: number, buttons: number): void {
    const canvas = canvasOf(mounted);
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, clientX: rect.left + rect.width * fx, clientY: rect.top + rect.height * fy, pointerId: 1, button: 0, buttons, pointerType: 'mouse', isPrimary: true }));
}

/** An `on` press entry that records the part */
const pressOn = (part: string) => ({ press: { command: 'set', target: '$.data.ui.part', value: part } });

const eye = { component: 'camera', position: [0, 0, 5], target: [0, 0, 0] };
const sun = { component: 'light', kind: 'directional', position: [0, 0, 10], target: [0, 0, 0] };

/** A cube of side 2 about the origin as custom geometry: vertices 0 to 3 its front (z = 1), the front face first */
const cube = (): Record<string, unknown> => ({
    component: 'mesh',
    interactive: true,
    geometry: {
        kind: 'custom',
        vertices: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]],
        faces: [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]]
    }
});

/** Where the cube's front top-right corner (1, 1, 1) is drawn, as fractions of the canvas, seen by the camera at z = 5 (fov 50) */
function cornerAt(mounted: MountedComponent): [number, number] {
    const { width, height } = canvasOf(mounted).getBoundingClientRect();
    const half = 4 * Math.tan((25 * Math.PI) / 180);
    return [0.5 + 0.5 / (half * (width / height)), 0.5 - 0.5 / half];
}

/** A titled scene with an interactive box at the origin and a plain box to its right, each with a press entry */
const parts = (own: Record<string, unknown> = {}): NodeState => ({
    _title: 'Parts',
    background: '#000000',
    environment: 'none',
    ...own,
    children: {
        eye,
        sun,
        lid: { component: 'mesh', geometry: { kind: 'box' }, interactive: true, _label: 'Lid', on: { ...pressOn('lid'), hover: { command: 'set', target: '$.data.ui.hovered', value: 'lid' } } },
        base: { component: 'mesh', position: [2, 0, 0], geometry: { kind: 'box' }, on: pressOn('base') }
    }
});

describe.skipIf(script === '')('scene3d press and hover with the real 3D renderer chunk (G3.8) in Chromium', () => {
    let chunk: Scene3dChunk;
    let remove: (() => void) | undefined;

    beforeAll(() => {
        if (isScene3dChunk((globalThis as Record<string, unknown>).__stateui3d)) {
            chunk = (globalThis as Record<string, unknown>).__stateui3d as Scene3dChunk;
            return;
        }
        const element = document.createElement('script');
        element.textContent = script;
        document.head.append(element);
        const global = (globalThis as Record<string, unknown>).__stateui3d;
        if (!isScene3dChunk(global)) throw new Error('The chunk set no __stateui3d');
        chunk = global;
    });

    afterEach(() => {
        remove?.();
        remove = undefined;
        mountComponent.unmountAll();
        vi.restoreAllMocks();
    });

    it('should raise press for a real click on the interactive mesh, and the dispatcher should run its on entry', async () => {
        // Arrange
        remove = answerWith(chunk);
        const spy = vi.spyOn(report, 'error');
        const mounted = await mountScene(parts());

        // Act
        await userEvent.click(canvasOf(mounted));

        // Assert: the press of the box's near face, at z = 0.5
        const presses = mounted.raised.filter((event) => event.type === 'press');
        expect(presses.map((event) => [event.detail.shape, event.detail.key])).toEqual([[`${ROOT}.lid`, 'lid']]);
        expect(presses[0]?.detail.point[2]).toBeCloseTo(0.5, 2);
        expect(mounted.store.get('$.data.ui.part')).toBe('lid');
        expect(spy).not.toHaveBeenCalled();
    });

    it('should raise nothing for a click on empty space or on a mesh that is not interactive', async () => {
        // Arrange
        remove = answerWith(chunk);
        const mounted = await mountScene(parts());
        const canvas = canvasOf(mounted);

        // Act: the corner, then the plain box to the right
        await userEvent.click(canvas, { position: { x: 3, y: 3 } });
        const box = canvas.getBoundingClientRect();
        await userEvent.click(canvas, { position: { x: box.width / 2 + (2 / 3.5) * (box.width / 2) * 0.95, y: box.height / 2 } });

        // Assert
        expect(mounted.raised.filter((event) => event.type === 'press')).toEqual([]);
        expect(mounted.store.get('$.data.ui.part')).toBe('');
    });

    it('should raise hover once when the pointer enters the mesh', async () => {
        // Arrange
        remove = answerWith(chunk);
        const mounted = await mountScene(parts());
        const canvas = canvasOf(mounted);
        await userEvent.hover(canvas, { position: { x: 2, y: 2 } });

        // Act
        await userEvent.hover(canvas);
        const box = canvas.getBoundingClientRect();
        await userEvent.hover(canvas, { position: { x: box.width / 2 + 1, y: box.height / 2 + 1 } });

        // Assert
        expect(mounted.raised.filter((event) => event.type === 'hover').map((event) => event.detail.shape)).toEqual([`${ROOT}.lid`]);
        expect(mounted.store.get('$.data.ui.hovered')).toBe('lid');
    });

    it('should raise no press for an orbit drag that ends on the mesh, and write the camera once', async () => {
        // Arrange
        remove = answerWith(chunk);
        const mounted = await mountScene(parts({ controls: 'orbit' }));
        const writes = vi.fn();
        mounted.store.on(['$.app.children.eye.position'], writes);

        // Act
        pointer(mounted, 'pointerdown', 0.5, 0.5, 1);
        for (const fx of [0.55, 0.6, 0.55, 0.5]) pointer(mounted, 'pointermove', fx, 0.5, 1);
        pointer(mounted, 'pointerup', 0.5, 0.5, 0);
        await frame();

        // Assert
        expect(mounted.raised.filter((event) => event.type === 'press')).toEqual([]);
        expect(mounted.store.get('$.data.ui.part')).toBe('');
        expect(writes).toHaveBeenCalledTimes(1);
        mounted.store.off(['$.app.children.eye.position'], writes);
    });

    it('should give the interactive mesh a proxy button named by its label over its box, and press it with Enter and a click', async () => {
        // Arrange
        remove = answerWith(chunk);
        const mounted = await mountScene(parts());
        const proxy = proxyOf(mounted, `${ROOT}.lid`) as HTMLButtonElement;

        // Act
        proxy.focus();
        await userEvent.keyboard('{Enter}');
        const byKey = mounted.raised[mounted.raised.length - 1]?.detail.point;
        mounted.store.set('$.data.ui.part', '');
        proxy.click();

        // Assert: the proxy's box is the box's projected bounds, around the canvas's centre; the plain box has none
        const canvas = canvasOf(mounted).getBoundingClientRect();
        const rect = proxy.getBoundingClientRect();
        expect(Math.abs(rect.left + rect.width / 2 - (canvas.left + canvas.width / 2))).toBeLessThan(1);
        expect(Math.abs(rect.top + rect.height / 2 - (canvas.top + canvas.height / 2))).toBeLessThan(1);
        expect(rect.width).toBeGreaterThan(10);
        expect(proxy.getAttribute('aria-label')).toBe('Lid');
        expect(proxy.getAttribute('data-shape-kind')).toBe('mesh');
        expect(proxyOf(mounted, `${ROOT}.base`)).toBeNull();
        expect(byKey).toEqual([0, 0, 0]);
        expect(mounted.store.get('$.data.ui.part')).toBe('lid');
        expect(mounted.raised.filter((event) => event.type === 'press')).toHaveLength(2);
    });

    it('should make the scene box a group while a node is interactive, and an image again when none is', async () => {
        // Arrange
        remove = answerWith(chunk);
        const mounted = await mountScene(parts());
        const before = roleOf(mounted);

        // Act
        mounted.store.set('$.app.children.lid.interactive', false);
        for (let at = 0; at < 10 && roleOf(mounted) !== 'img'; at += 1) await frame();

        // Assert
        expect(before).toBe('group');
        expect(roleOf(mounted)).toBe('img');
        expect(proxyOf(mounted, `${ROOT}.lid`)).toBeNull();
    });

    it('should press a repeat3d copy, running the row template entry with $row at its record, and name each copy proxy by its record', async () => {
        // Arrange: two crates a quarter of the canvas left and right of the centre
        remove = answerWith(chunk);
        const crate = {
            component: 'mesh',
            geometry: { kind: 'box' },
            '<-position': '$row.at',
            interactive: true,
            '<-_label': '$row.name',
            on: { press: { command: 'set', target: '$.data.ui.part', value: '$row.name' } }
        };
        const scene = { _title: 'Crates', background: '#000000', environment: 'none', children: { eye, sun, crates: { component: 'repeat3d', '<-records': '$.data.crates', row: crate } } };
        const records = [
            { id: 'left', at: [-1.75, 0, 0], name: 'Left' },
            { id: 'right', at: [1.75, 0, 0], name: 'Right' }
        ];
        const mounted = await mountScene(scene, { data: { ui: { part: '', hovered: '' }, crates: records } });
        const canvas = canvasOf(mounted);
        const box = canvas.getBoundingClientRect();

        // Act
        await userEvent.click(canvas, { position: { x: box.width * 0.75, y: box.height / 2 } });

        // Assert
        const presses = mounted.raised.filter((event) => event.type === 'press');
        expect(presses.map((event) => [event.detail.shape, event.detail.key])).toEqual([[`${ROOT}.crates.rows.right`, 'right']]);
        expect(mounted.store.get('$.data.ui.part')).toBe('Right');
        const proxies = Array.from(mounted.element.shadowRoot?.querySelectorAll('.proxies > button') ?? []);
        expect(proxies.map((proxy) => [proxy.getAttribute('data-shape-path'), proxy.getAttribute('aria-label')])).toEqual([
            [`${ROOT}.crates.rows.left`, 'Left'],
            [`${ROOT}.crates.rows.right`, 'Right']
        ]);
    });

    it('should take the listed keys while focused, raise key for the dispatcher and record every press, and leave the rest to the controls', async () => {
        // Arrange
        remove = answerWith(chunk);
        const mounted = await mountScene(parts({ controls: 'orbit', keys: ['ArrowLeft', 'w', 'Space'], on: { key: { command: 'set', target: '$.data.ui.part', value: 'key' } } }));
        const keyed: string[] = [];
        mounted.element.addEventListener('key', (event) => keyed.push((event as CustomEvent<{ key: string }>).detail.key));
        const set = vi.spyOn(mounted.store, 'set');
        const box = boxOf(mounted);
        box.focus();
        const camera = (): unknown => JSON.stringify(mounted.store.get('$.app.children.eye.position'));
        const before = camera();

        // Act
        const arrow = press(box, 'ArrowLeft');
        press(box, 'ArrowLeft');
        const upper = press(box, 'W');
        const chord = press(box, 'w', { ctrlKey: true });
        box.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true, composed: true }));
        const afterTaken = camera();
        const other = press(box, 'ArrowRight', { code: 'ArrowRight' });
        box.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true, composed: true }));
        await frame();

        // Assert
        expect(box.getAttribute('tabindex')).toBe('0');
        expect(box.getAttribute('aria-keyshortcuts')).toBe('ArrowLeft w Space');
        expect(keyed).toEqual(['ArrowLeft', 'ArrowLeft', 'w']);
        expect([arrow.defaultPrevented, upper.defaultPrevented, chord.defaultPrevented, other.defaultPrevented]).toEqual([true, true, false, true]);
        expect(mounted.store.get('$.data.ui.part')).toBe('key');
        expect(mounted.store.get('$.raised.app.key')).toEqual({ key: 'w' });
        expect(set.mock.calls.filter(([path, , options]) => String(path).startsWith('$.raised') && (options as { always?: boolean } | undefined)?.always === true)).toHaveLength(3);
        expect(afterTaken).toBe(before);
        expect(camera()).not.toBe(before);
    });

    it('should give back the tabindex it set when keys are cleared, and leave Enter on a proxy button to the press', async () => {
        // Arrange
        remove = answerWith(chunk);
        const mounted = await mountScene(parts({ keys: ['Enter'] }));
        const keyed: string[] = [];
        mounted.element.addEventListener('key', (event) => keyed.push((event as CustomEvent<{ key: string }>).detail.key));
        const box = boxOf(mounted);
        const focusable = box.getAttribute('tabindex');

        // Act
        press(proxyOf(mounted, `${ROOT}.lid`) as HTMLButtonElement, 'Enter');
        press(box, 'Enter');
        mounted.store.set('$.app.keys', []);
        await frame();

        // Assert
        expect(focusable).toBe('0');
        expect(mounted.store.get('$.data.ui.part')).toBe('lid');
        expect(keyed).toEqual(['Enter']);
        expect(box.hasAttribute('tabindex')).toBe(false);
        expect(box.hasAttribute('aria-keyshortcuts')).toBe(false);
    });

    // Dragging (docs/design/stateui-3d-drag.md) ---------------------------------------------------------------------

    /** A scene seen from above and in front, with orbit controls and a draggable box at the origin */
    const board = (piece: Record<string, unknown> = {}): NodeState => ({
        _title: 'Board',
        background: '#000000',
        environment: 'none',
        controls: 'orbit',
        children: {
            eye: { component: 'camera', position: [0, 8, 4], target: [0, 0, 0] },
            sun,
            piece: { component: 'mesh', geometry: { kind: 'box' }, interactive: true, _label: 'Piece', draggable: 'ground', on: { ...pressOn('piece'), dragEnd: { command: 'set', target: '$.data.ui.hovered', value: 'dropped' } }, ...piece }
        }
    });
    const PIECE = `${ROOT}.piece`;
    /** The writes of the piece's position a spy on the store's `set` saw */
    const positionWrites = (spy: { mock: { calls: unknown[][] } }): unknown[][] => spy.mock.calls.filter(([path]) => path === `${PIECE}.position`);

    it('should move a draggable mesh with the pointer, write its position once on release, raise dragEnd and leave the camera alone', async () => {
        // Arrange
        remove = answerWith(chunk);
        const mounted = await mountScene(board());
        mounted.element.addEventListener('dragEnd', (event) => mounted.raised.push({ type: 'dragEnd', detail: (event as CustomEvent).detail }));
        const set = vi.spyOn(mounted.store, 'set');

        // Act
        pointer(mounted, 'pointerdown', 0.5, 0.5, 1);
        for (const fx of [0.55, 0.6, 0.65, 0.7]) pointer(mounted, 'pointermove', fx, 0.5, 1);
        await frame();
        const during = positionWrites(set).length;
        pointer(mounted, 'pointerup', 0.7, 0.5, 0);
        await frame();

        // Assert: along x on the ground, z kept at 0
        const position = mounted.store.get(`${PIECE}.position`) as number[];
        expect(during).toBe(0);
        expect(positionWrites(set)).toHaveLength(1);
        expect(position[0]).toBeGreaterThan(0.5);
        expect(position[1]).toBe(0);
        expect(position[2]).toBeCloseTo(0, 5);
        expect(set.mock.calls.filter(([path]) => String(path).startsWith('$.app.children.eye'))).toEqual([]);
        expect(mounted.raised.filter((event) => event.type === 'press')).toEqual([]);
        expect(mounted.raised.filter((event) => event.type === 'dragEnd').map((event) => event.detail.shape)).toEqual([PIECE]);
        expect(mounted.store.get('$.data.ui.hovered')).toBe('dropped');
        expect(mounted.store.get('$.data.ui.part')).toBe('');
        expect(canvasOf(mounted).style.touchAction).toBe('none');
    });

    it('should press a draggable mesh for a pointer that moves within the slop, and write no position', async () => {
        // Arrange
        remove = answerWith(chunk);
        const mounted = await mountScene(board());
        const set = vi.spyOn(mounted.store, 'set');

        // Act
        pointer(mounted, 'pointerdown', 0.5, 0.5, 1);
        pointer(mounted, 'pointermove', 0.501, 0.5, 1);
        pointer(mounted, 'pointerup', 0.501, 0.5, 0);
        await frame();

        // Assert
        expect(mounted.store.get('$.data.ui.part')).toBe('piece');
        expect(positionWrites(set)).toEqual([]);
    });

    it('should put the mesh back and write nothing when Escape is pressed during a drag', async () => {
        // Arrange
        remove = answerWith(chunk);
        const mounted = await mountScene(board());
        const set = vi.spyOn(mounted.store, 'set');
        pointer(mounted, 'pointerdown', 0.5, 0.5, 1);
        for (const fx of [0.6, 0.7]) pointer(mounted, 'pointermove', fx, 0.5, 1);

        // Act
        press(canvasOf(mounted), 'Escape');
        pointer(mounted, 'pointerup', 0.7, 0.5, 0);
        await frame();

        // Assert
        expect(positionWrites(set)).toEqual([]);
        expect(mounted.store.get(`${PIECE}.position`)).toEqual([0, 0, 0]);
        expect(mounted.store.get('$.data.ui.hovered')).toBe('');
        expect(mounted.store.get('$.data.ui.part')).toBe('');
    });

    it('should keep a drag inside bounds and on multiples of step with snap', async () => {
        // Arrange
        remove = answerWith(chunk);
        const mounted = await mountScene(board({ bounds: { x: -1, z: -1, width: 2, depth: 2 }, step: 0.5, snap: true }));

        // Act: far to the right
        pointer(mounted, 'pointerdown', 0.5, 0.5, 1);
        for (const fx of [0.6, 0.8, 0.95]) pointer(mounted, 'pointermove', fx, 0.5, 1);
        pointer(mounted, 'pointerup', 0.95, 0.5, 0);
        await frame();

        // Assert
        expect(mounted.store.get(`${PIECE}.position`)).toEqual([1, 0, 0]);
    });

    it('should move a draggable mesh by its step for an arrow key on its proxy button, ten steps with Shift', async () => {
        // Arrange
        remove = answerWith(chunk);
        const mounted = await mountScene(board({ draggable: 'x' }));
        const proxy = proxyOf(mounted, PIECE) as HTMLButtonElement;
        const set = vi.spyOn(mounted.store, 'set');

        // Act
        const right = press(proxy, 'ArrowRight');
        await frame();
        const afterRight = JSON.parse(JSON.stringify(mounted.store.get(`${PIECE}.position`))) as unknown;
        const camera = set.mock.calls.filter(([path]) => String(path).startsWith('$.app.children.eye')).length;
        press(proxy, 'ArrowUp');
        await frame();
        press(proxy, 'ArrowLeft', { shiftKey: true });
        await frame();

        // Assert: a taken key does not pan the camera; Up does not move an x-only node
        expect(right.defaultPrevented).toBe(true);
        expect(afterRight).toEqual([1, 0, 0]);
        expect(camera).toBe(0);
        expect(positionWrites(set)).toHaveLength(2);
        expect(mounted.store.get(`${PIECE}.position`)).toEqual([-9, 0, 0]);
        expect(mounted.store.get('$.data.ui.hovered')).toBe('dropped');
    });

    // Dragging repeat3d copies (docs/design/stateui-3d-drag-copies.md) ---------------------------------------------

    /** A board with a repeat of draggable crates whose position links their record's `at`, the row's dragEnd recording the record */
    const crates = (records: unknown[], row: Record<string, unknown> = {}) => ({
        node: {
            _title: 'Crates',
            background: '#000000',
            environment: 'none',
            controls: 'orbit',
            children: {
                eye: { component: 'camera', position: [0, 8, 4], target: [0, 0, 0] },
                sun,
                crates: {
                    component: 'repeat3d',
                    '<-records': '$.data.crates',
                    row: { component: 'mesh', geometry: { kind: 'box' }, '<-position': '$row.at', interactive: true, '<-_label': '$row.name', draggable: 'ground', on: { dragEnd: { command: 'set', target: '$.data.ui.part', value: '$row.name' } }, ...row }
                }
            }
        },
        options: { data: { ui: { part: '', hovered: '' }, crates: records } }
    });

    it('should drag a repeat3d copy, write its record field once on release, run the row dragEnd with $row at the record, and leave the other copy', async () => {
        // Arrange: the left crate under the centre of the canvas
        remove = answerWith(chunk);
        const { node, options } = crates([
            { id: 'left', at: [0, 0, 0], name: 'Left' },
            { id: 'right', at: [-2.5, 0, 0], name: 'Right' }
        ]);
        const mounted = await mountScene(node, options);
        const set = vi.spyOn(mounted.store, 'set');

        // Act
        pointer(mounted, 'pointerdown', 0.5, 0.5, 1);
        for (const fx of [0.55, 0.6, 0.65, 0.7]) pointer(mounted, 'pointermove', fx, 0.5, 1);
        await frame();
        const during = set.mock.calls.length;
        pointer(mounted, 'pointerup', 0.7, 0.5, 0);
        await frame();

        // Assert
        const left = mounted.store.get('$.data.crates.0.at') as number[];
        expect(during).toBe(0);
        expect(set.mock.calls.filter(([path]) => path === '$.data.crates.0.at')).toHaveLength(1);
        expect(left[0]).toBeGreaterThan(0.5);
        expect(left[1]).toBe(0);
        expect(left[2]).toBeCloseTo(0, 5);
        expect(mounted.store.get('$.data.crates.1.at')).toEqual([-2.5, 0, 0]);
        expect(mounted.store.get('$.data.ui.part')).toBe('Left');
        expect(set.mock.calls.filter(([path]) => String(path).startsWith('$.app.children.eye'))).toEqual([]);
    });

    it('should put a dragged copy back and write nothing on Escape, and move a copy by its step for an arrow key on its proxy', async () => {
        // Arrange
        remove = answerWith(chunk);
        const { node, options } = crates([{ id: 'left', at: [0, 0, 0], name: 'Left' }]);
        const mounted = await mountScene(node, options);
        const set = vi.spyOn(mounted.store, 'set');
        pointer(mounted, 'pointerdown', 0.5, 0.5, 1);
        for (const fx of [0.6, 0.7]) pointer(mounted, 'pointermove', fx, 0.5, 1);

        // Act
        press(canvasOf(mounted), 'Escape');
        pointer(mounted, 'pointerup', 0.7, 0.5, 0);
        await frame();
        const writesAfterEscape = set.mock.calls.length;
        press(proxyOf(mounted, `${ROOT}.crates.rows.left`) as HTMLButtonElement, 'ArrowRight');
        await frame();

        // Assert
        expect(writesAfterEscape).toBe(0);
        expect(mounted.store.get('$.data.crates.0.at')).toEqual([1, 0, 0]);
    });

    it('should not drag a copy whose position is not linked to its record, and report the repeat', async () => {
        // Arrange
        remove = answerWith(chunk);
        const errors = vi.spyOn(report, 'error');
        const { node, options } = crates([{ id: 'left', name: 'Left' }], { position: [0, 0, 0] });
        delete (node.children.crates.row as Record<string, unknown>)['<-position'];
        const mounted = await mountScene(node, options);
        const set = vi.spyOn(mounted.store, 'set');

        // Act
        pointer(mounted, 'pointerdown', 0.5, 0.5, 1);
        for (const fx of [0.6, 0.7]) pointer(mounted, 'pointermove', fx, 0.5, 1);
        pointer(mounted, 'pointerup', 0.7, 0.5, 0);
        await frame();

        // Assert: the gesture turns the camera instead, as on any node that is not draggable
        expect(set.mock.calls.filter(([path]) => String(path).startsWith('$.data.crates') || String(path).includes('.rows.'))).toEqual([]);
        expect(errors.mock.calls.some(([, context]) => (context as { code?: string } | undefined)?.code === 'SUI-RUN-DRAW')).toBe(true);
    });
    it('should write the picked face of a custom mesh in edit mode once per press, raise no press, and clear it for a press beside it (mesh editor, V2)', async () => {
        // Arrange
        remove = answerWith(chunk);
        const mounted = await mountScene({ _title: 'Shaper', background: '#000000', environment: 'none', children: { eye, sun, shape: { ...cube(), edit: { mode: 'face', picked: [] }, on: pressOn('shape') } } });
        const set = vi.spyOn(mounted.store, 'set');

        // Act
        pointer(mounted, 'pointerdown', 0.5, 0.5, 1);
        pointer(mounted, 'pointerup', 0.5, 0.5, 0);
        const picked = [...(mounted.store.get('$.app.children.shape.edit.picked') as number[])];
        await frame();
        pointer(mounted, 'pointerdown', 0.02, 0.02, 1);
        pointer(mounted, 'pointerup', 0.02, 0.02, 0);

        // Assert: the front face is the first
        expect(picked).toEqual([0]);
        expect(mounted.store.get('$.app.children.shape.edit.picked')).toEqual([]);
        expect(set.mock.calls.filter(([path]) => String(path).endsWith('.edit.picked'))).toHaveLength(2);
        expect(mounted.raised.filter((event) => event.type === 'press')).toEqual([]);
        expect(mounted.store.get('$.data.ui.part')).toBe('');
    });

    it('should write the pick through a linked edit to the state it names', async () => {
        // Arrange
        remove = answerWith(chunk);
        const mounted = await mountScene(
            { _title: 'Shaper', background: '#000000', environment: 'none', children: { eye, sun, shape: { ...cube(), '<-edit': '$.data.ui.edit' } } },
            { data: { ui: { part: '', hovered: '', edit: { mode: 'vertex', picked: [] } } } }
        );
        const corner = cornerAt(mounted);

        // Act
        pointer(mounted, 'pointerdown', corner[0], corner[1], 1);
        pointer(mounted, 'pointerup', corner[0], corner[1], 0);

        // Assert: the front corner at the top right
        expect(mounted.store.get('$.data.ui.edit.picked')).toEqual([2]);
    });
    it('should write the geometry once when the gizmo moves a pick, undo it with Ctrl+Z and redo it with Ctrl+Shift+Z (mesh editor, V3)', async () => {
        // Arrange
        remove = answerWith(chunk);
        const mounted = await mountScene({ _title: 'Shaper', background: '#000000', environment: 'none', children: { eye, sun, shape: { ...cube(), gizmo: 'move', snap: true, step: 0.5, edit: { mode: 'vertex', picked: [2] } } } });
        const { width, height } = canvasOf(mounted).getBoundingClientRect();
        const [fx, fy] = cornerAt(mounted);
        // 0.6 units along x at the corner (z = 1, 4 from the camera), snapped to 0.5
        const reach = (0.6 * height) / (2 * 4 * Math.tan((25 * Math.PI) / 180)) / width;
        const vertex = (): unknown => (mounted.store.get('$.app.children.shape.geometry.vertices') as number[][])[2]?.slice();
        const set = vi.spyOn(mounted.store, 'set');

        // Act
        const start = fx + 30 / width;
        pointer(mounted, 'pointerdown', start, fy, 1);
        for (const step of [0.25, 0.5, 0.75, 1]) pointer(mounted, 'pointermove', start + reach * step, fy, 1);
        pointer(mounted, 'pointerup', start + reach, fy, 0);
        const moved = vertex();
        await frame();
        const box = boxOf(mounted);
        press(box, 'z', { ctrlKey: true });
        const undone = vertex();
        press(box, 'z', { ctrlKey: true, shiftKey: true });

        // Assert
        expect(moved).toEqual([1.5, 1, 1]);
        expect(undone).toEqual([1, 1, 1]);
        expect(vertex()).toEqual([1.5, 1, 1]);
        expect(set.mock.calls.filter(([path]) => String(path).endsWith('.geometry'))).toHaveLength(3);
        expect(set.mock.calls.filter(([path]) => String(path).endsWith('.position'))).toEqual([]);
        expect(box.getAttribute('tabindex')).toBe('0');
        expect(box.getAttribute('aria-keyshortcuts')).toBe('Control+Z Control+Shift+Z');
    });

    it('should run a linked editRequest once on the pick, record it done, undo it, and report one that does not fit the mode (mesh editor, V4)', async () => {
        // Arrange
        remove = answerWith(chunk);
        const errors = vi.spyOn(report, 'error');
        const mounted = await mountScene(
            { _title: 'Shaper', background: '#000000', environment: 'none', children: { eye, sun, shape: { ...cube(), edit: { mode: 'face', picked: [0] }, '<-editRequest': '$.data.ui.request' } } },
            { data: { ui: { part: '', hovered: '', request: null } } }
        );
        const faces = (): number => (mounted.store.get('$.app.children.shape.geometry.faces') as unknown[]).length;
        const set = vi.spyOn(mounted.store, 'set');

        // Act
        mounted.store.set('$.data.ui.request', { op: 'extrude', amount: 0.5, n: 1 });
        await frame();
        const extruded = faces();
        mounted.store.set('$.data.ui.request', { op: 'undo', n: 2 });
        await frame();
        const undone = faces();
        mounted.store.set('$.data.ui.request', { op: 'merge', n: 3 });
        await frame();
        await frame();

        // Assert
        expect(extruded).toBe(10);
        expect(undone).toBe(6);
        expect(faces()).toBe(6);
        expect(mounted.store.get('$.app.children.shape.edit.done')).toEqual({ op: 'merge', n: 3 });
        expect(mounted.store.get('$.app.children.shape.edit.picked')).toEqual([0]);
        expect(set.mock.calls.filter(([path]) => String(path).endsWith('.geometry'))).toHaveLength(2);
        expect(errors.mock.calls.filter(([, context]) => (context as { code?: string } | undefined)?.code === 'SUI-RUN-3D')).toHaveLength(1);
    });
});
