import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent, MountOptions, NodeState } from '../harness/createMountComponent.js';
import { isScene3dChunk } from '../../src/shared/scene3d/load.js';
import type { Scene3dChunk } from '../../src/shared/scene3d/load.js';

/**
 * The move, rotate and scale gizmo (docs/design/stateui-3d-gizmo.md) with the real chunk of `../stateui-3d`: a handle
 * held and moved changes the node in the renderer only, and its release writes the one property it changes once
 */
const script = inject('chunk3dScript');
const ROOT = '$.app.children';

/** One handle length on screen (`GIZMO_PIXELS` of the chunk) */
const HANDLE = 96;

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Answers `ui-load-3d` with the real chunk's global, as the runtime's `load3d` hook does */
function answerWith(chunk: unknown): () => void {
    const listener = (event: Event): void => {
        (event as CustomEvent<{ respond: (result: Promise<unknown>) => void }>).detail.respond(Promise.resolve(chunk));
    };
    document.addEventListener('ui-load-3d', listener);
    return () => document.removeEventListener('ui-load-3d', listener);
}

/** Mounts a scene and waits until it is drawn */
async function mountScene(node: NodeState, options: MountOptions = {}): Promise<MountedComponent> {
    const mounted = mountComponent('scene3d', node, { data: { ui: { part: '', pressed: '' } }, ...options });
    await Promise.resolve();
    for (let at = 0; at < 200; at += 1) {
        if (mounted.element.getAttribute('data-render') === 'ready' && mounted.element.shadowRoot?.querySelector('canvas')) break;
        await frame();
    }
    if (mounted.element.getAttribute('data-render') !== 'ready') throw new Error(`the scene is still ${mounted.element.getAttribute('data-render')}`);
    return mounted;
}

const canvasOf = (mounted: MountedComponent): HTMLCanvasElement => mounted.element.shadowRoot?.querySelector('.surface canvas') as HTMLCanvasElement;

/** Dispatches a mouse pointer event on the canvas, `dx` and `dy` CSS pixels from its centre */
function pointer(mounted: MountedComponent, type: string, dx: number, dy: number, buttons: number): void {
    const rect = canvasOf(mounted).getBoundingClientRect();
    const init = { bubbles: true, composed: true, cancelable: true, clientX: rect.left + rect.width / 2 + dx, clientY: rect.top + rect.height / 2 + dy, pointerId: 1, button: 0, buttons, pointerType: 'mouse', isPrimary: true };
    canvasOf(mounted).dispatchEvent(new PointerEvent(type, init));
}

/** Holds the handle at a point, moves the pointer to another in steps, and lets go there */
async function dragHandle(mounted: MountedComponent, from: [number, number], to: [number, number]): Promise<void> {
    pointer(mounted, 'pointerdown', ...from, 1);
    for (const part of [0.25, 0.5, 0.75, 1]) pointer(mounted, 'pointermove', from[0] + (to[0] - from[0]) * part, from[1] + (to[1] - from[1]) * part, 1);
    await frame();
    pointer(mounted, 'pointerup', ...to, 0);
    await frame();
}

/** World units per CSS pixel at the origin, for the camera five units away with a 50 degree field of view */
const unitsPerPixel = (mounted: MountedComponent): number => (2 * 5 * Math.tan((25 * Math.PI) / 180)) / canvasOf(mounted).getBoundingClientRect().height;

const eye = { component: 'camera', position: [0, 0, 5], target: [0, 0, 0], fov: 50 };
const sun = { component: 'light', kind: 'directional', position: [0, 0, 10], target: [0, 0, 0] };

/** A scene with a small interactive box at the origin showing a gizmo; its press and dragEnd record themselves */
const scene = (gizmo: string, own: Record<string, unknown> = {}): NodeState => ({
    _title: 'Workbench',
    background: '#000000',
    environment: 'none',
    controls: 'orbit',
    children: {
        eye,
        sun,
        lid: {
            component: 'mesh',
            geometry: { kind: 'box', width: 0.2, height: 0.2, depth: 0.2 },
            interactive: true,
            _label: 'Lid',
            gizmo,
            on: { press: { command: 'set', target: '$.data.ui.pressed', value: 'lid' }, dragEnd: { command: 'set', target: '$.data.ui.part', value: 'lid' } },
            ...own
        }
    }
});

describe.skipIf(script === '')('scene3d gizmo with the real 3D renderer chunk in Chromium', () => {
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

    it('should lift a node with the y arrow of a move gizmo, write its position once on release, run dragEnd and move no camera', async () => {
        // Arrange
        remove = answerWith(chunk);
        const mounted = await mountScene(scene('move'));
        const set = vi.spyOn(mounted.store, 'set');

        // Act: the y arrow points up the screen from the node
        pointer(mounted, 'pointerdown', 0, -HANDLE * 0.6, 1);
        for (const dy of [-70, -80, -90, -100]) pointer(mounted, 'pointermove', 0, -HANDLE * 0.6 + dy / 2, 1);
        await frame();
        const during = set.mock.calls.length;
        pointer(mounted, 'pointerup', 0, -HANDLE * 0.6 - 50, 0);
        await frame();

        // Assert
        const position = mounted.store.get(`${ROOT}.lid.position`) as number[];
        expect(during).toBe(0);
        expect(set.mock.calls.filter(([path]) => path === `${ROOT}.lid.position`)).toHaveLength(1);
        expect(position[0]).toBeCloseTo(0, 3);
        expect(position[1]).toBeCloseTo(50 * unitsPerPixel(mounted), 2);
        expect(position[2]).toBeCloseTo(0, 3);
        expect(mounted.store.get('$.data.ui.part')).toBe('lid');
        expect(mounted.store.get('$.data.ui.pressed')).toBe('');
        expect(set.mock.calls.filter(([path]) => String(path).startsWith(`${ROOT}.eye`))).toEqual([]);
    });

    it('should turn a node about z with the ring of a rotate gizmo and write its rotation in degrees', async () => {
        // Arrange: the ring about z faces the camera; the rings about x and y are edge-on through the centre
        remove = answerWith(chunk);
        const mounted = await mountScene(scene('rotate'));
        const set = vi.spyOn(mounted.store, 'set');
        const reach = HANDLE * 0.9 * Math.SQRT1_2;

        // Act: a quarter turn, from the upper right of the ring to its upper left
        await dragHandle(mounted, [reach, -reach], [-reach, -reach]);

        // Assert
        const rotation = mounted.store.get(`${ROOT}.lid.rotation`) as number[];
        expect(rotation[0]).toBeCloseTo(0, 3);
        expect(rotation[1]).toBeCloseTo(0, 3);
        expect(Math.abs((rotation[2] as number) - 90)).toBeLessThan(2);
        expect(set.mock.calls.map(([path]) => path).filter((path) => String(path).startsWith(`${ROOT}.lid`))).toEqual([`${ROOT}.lid.rotation`]);
    });

    it('should turn in steps of 15 degrees with snap', async () => {
        // Arrange
        remove = answerWith(chunk);
        const mounted = await mountScene(scene('rotate', { snap: true }));
        const reach = HANDLE * 0.9 * Math.SQRT1_2;

        // Act: about 80 degrees
        await dragHandle(mounted, [reach, -reach], [-reach * 0.75, -reach * 1.2]);

        // Assert
        const turned = (mounted.store.get(`${ROOT}.lid.rotation`) as number[])[2] as number;
        expect(turned / 15).toBeCloseTo(Math.round(turned / 15), 3);
        expect(turned).toBeGreaterThan(60);
    });

    it('should scale all three axes with the centre cube of a scale gizmo: up one handle length doubles it', async () => {
        // Arrange
        remove = answerWith(chunk);
        const mounted = await mountScene(scene('scale'));

        // Act
        await dragHandle(mounted, [0, 0], [0, -HANDLE]);

        // Assert
        const scale = mounted.store.get(`${ROOT}.lid.scale`) as number[];
        expect(scale.map((value) => Math.round(value * 100) / 100)).toEqual([2, 2, 2]);
    });

    it('should put the node back and write nothing on Escape, and a handle held without moving is not a press', async () => {
        // Arrange
        remove = answerWith(chunk);
        const mounted = await mountScene(scene('move'));
        const set = vi.spyOn(mounted.store, 'set');

        // Act
        pointer(mounted, 'pointerdown', 0, -HANDLE * 0.6, 1);
        pointer(mounted, 'pointermove', 0, -HANDLE, 1);
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        pointer(mounted, 'pointerup', 0, -HANDLE, 0);
        await frame();
        pointer(mounted, 'pointerdown', 0, -HANDLE * 0.6, 1);
        pointer(mounted, 'pointerup', 0, -HANDLE * 0.6, 0);
        await frame();

        // Assert
        expect(set.mock.calls.filter(([path]) => String(path).startsWith(`${ROOT}.lid`))).toEqual([]);
        expect(mounted.store.get('$.data.ui.pressed')).toBe('');
        expect(mounted.store.get('$.data.ui.part')).toBe('');
    });

    it('should show no gizmo on a node that is not interactive', async () => {
        // Arrange
        remove = answerWith(chunk);
        const mounted = await mountScene(scene('move', { interactive: false }));
        const set = vi.spyOn(mounted.store, 'set');

        // Act
        await dragHandle(mounted, [0, -HANDLE * 0.6], [0, -HANDLE * 1.2]);

        // Assert
        expect(set.mock.calls.filter(([path]) => String(path).startsWith(`${ROOT}.lid`))).toEqual([]);
    });

    it('should write the record field a repeat3d copy links for the property its gizmo changes', async () => {
        // Arrange
        remove = answerWith(chunk);
        const node: NodeState = {
            _title: 'Crates',
            background: '#000000',
            environment: 'none',
            children: {
                eye,
                sun,
                crates: {
                    component: 'repeat3d',
                    '<-records': '$.data.crates',
                    row: { component: 'mesh', geometry: { kind: 'box', width: 0.2, height: 0.2, depth: 0.2 }, '<-position': '$row.at', '<-scale': '$row.size', interactive: true, '<-_label': '$row.name', '<-gizmo': '$row.tool' }
                }
            }
        };
        const mounted = await mountScene(node, { data: { ui: { part: '', pressed: '' }, crates: [{ id: 'one', at: [0, 0, 0], size: [1, 1, 1], name: 'One', tool: 'scale' }] } });

        // Act
        await dragHandle(mounted, [0, 0], [0, -HANDLE]);

        // Assert
        const size = mounted.store.get('$.data.crates.0.size') as number[];
        expect(size.map((value) => Math.round(value * 100) / 100)).toEqual([2, 2, 2]);
        expect(mounted.store.get('$.data.crates.0.at')).toEqual([0, 0, 0]);
    });
});
