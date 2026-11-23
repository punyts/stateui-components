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
});
