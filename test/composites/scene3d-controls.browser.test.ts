import { captureChanges } from '@punyts/state-sync';
import type { Capture, Change } from '@punyts/state-sync';
import { afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';
import { isScene3dChunk } from '../../src/shared/scene3d/load.js';
import type { Scene3dChunk } from '../../src/shared/scene3d/load.js';

/** The built chunk of `../stateui-3d` (test/globalSetup.ts); empty when the workspace has not built it */
const script = inject('chunk3dScript');

const CAMERA = '$.app.children.eye';
/** The scene is 120 by 80 CSS pixels: a pointer move of 20 pixels turns the camera a quarter turn (2 pi per height) */
const WIDTH = 120;
const HEIGHT = 80;
/** How long the wheel is idle before a wheel gesture writes (`WHEEL_IDLE` of `@punyts/stateui-3d`) */
const WHEEL_IDLE = 200;

/** Answers `ui-load-3d` with the real chunk's global, as the runtime's `load3d` hook does */
function answerWith(chunk: unknown): () => void {
    const listener = (event: Event): void => {
        (event as CustomEvent<{ respond: (result: Promise<unknown>) => void }>).detail.respond(Promise.resolve(chunk));
    };
    document.addEventListener('ui-load-3d', listener);
    return () => document.removeEventListener('ui-load-3d', listener);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const canvasOf = (mounted: MountedComponent): HTMLCanvasElement => mounted.element.shadowRoot?.querySelector('.surface canvas') as HTMLCanvasElement;
const boxOf = (mounted: MountedComponent): HTMLElement => mounted.element.shadowRoot?.querySelector('.scene') as HTMLElement;

/** Every pixel of the scene's canvas, read in the task of the frame (the drawing buffer is not kept after it) */
function picture(mounted: MountedComponent): Uint8Array {
    const gl = canvasOf(mounted).getContext('webgl2');
    if (!gl) throw new Error('No WebGL canvas in the scene');
    const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return data;
}

/** True when fewer than 1% of the pixels differ by more than 32 in a channel (software rendering noise at the edges) */
function same(a: Uint8Array, b: Uint8Array): boolean {
    let differing = 0;
    for (let at = 0; at < a.length; at += 4) {
        if ([0, 1, 2].some((channel) => Math.abs((a[at + channel] ?? 0) - (b[at + channel] ?? 0)) > 32)) differing += 1;
    }
    return differing / (a.length / 4) < 0.01;
}

/**
 * Runs `act` and waits for the scene to be `ready` after it went `pending`, then reads the picture in that task.
 * Without `act` it waits for the first `ready` of a mount
 */
function ready(mounted: MountedComponent | (() => MountedComponent), act?: (mounted: MountedComponent) => void): Promise<{ picture: Uint8Array; mounted: MountedComponent }> {
    return new Promise((resolve, reject) => {
        const target = typeof mounted === 'function' ? mounted() : mounted;
        const timer = setTimeout(() => reject(new Error(`the scene is still ${target.element.getAttribute('data-render')}`)), 5000);
        let pending = act === undefined;
        const observer = new MutationObserver(() => {
            const state = target.element.getAttribute('data-render');
            if (state === 'pending') pending = true;
            if (!pending || state !== 'ready') return;
            observer.disconnect();
            clearTimeout(timer);
            resolve({ picture: picture(target), mounted: target });
        });
        observer.observe(target.element, { attributes: true, attributeFilter: ['data-render'] });
        act?.(target);
    });
}

/** Dispatches a mouse pointer event on the scene's canvas at a point in CSS pixels */
function pointer(mounted: MountedComponent, type: string, x: number, y = HEIGHT / 2): void {
    const canvas = canvasOf(mounted);
    const box = canvas.getBoundingClientRect();
    const buttons = type === 'pointerup' ? 0 : 1;
    canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, clientX: box.left + x, clientY: box.top + y, pointerId: 1, button: 0, buttons, pointerType: 'mouse', isPrimary: true }));
}

function wheel(mounted: MountedComponent, deltaY: number): void {
    const canvas = canvasOf(mounted);
    const box = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, composed: true, cancelable: true, clientX: box.left + WIDTH / 2, clientY: box.top + HEIGHT / 2, deltaY }));
}

function key(target: EventTarget, type: 'keydown' | 'keyup', name: string, code: string): KeyboardEvent {
    const event = new KeyboardEvent(type, { key: name, code, bubbles: true, cancelable: true, composed: true });
    target.dispatchEvent(event);
    return event;
}

/** A red box with a green marker beside it, lit by an ambient light, seen by a camera at z = 5 */
const scene = (controls: string, eye: Record<string, unknown> = {}): Record<string, unknown> => ({
    background: '#0000ff',
    environment: 'none',
    controls,
    children: {
        eye: { component: 'camera', position: [0, 0, 5], target: [0, 0, 0], ...eye },
        fill: { component: 'light', kind: 'ambient', intensity: 1 },
        box: { component: 'mesh', geometry: { kind: 'box' }, material: { color: '#ff0000' } },
        marker: { component: 'mesh', position: [1.5, 0, 0], geometry: { kind: 'box', width: 0.5, height: 0.5, depth: 0.5 }, material: { color: '#00ff00' } }
    }
});

let capture: Capture | undefined;

/** Mounts the scene at 120 by 80 CSS pixels, waits for its first frame and starts a sync capture of the store */
async function mountScene(node: Record<string, unknown>): Promise<{ mounted: MountedComponent; first: Uint8Array; sent: () => Change[] }> {
    const { mounted, picture: first } = await ready(() => {
        const target = mountComponent('scene3d', node);
        target.host.style.width = `${WIDTH}px`;
        (target.element as HTMLElement).style.setProperty('--ui-scene3d-height', `${HEIGHT}px`);
        return target;
    });
    const changes: Change[] = [];
    capture = captureChanges(mounted.store, { base: () => 0, onChanges: (batch) => changes.push(...batch) });
    const sent = (): Change[] => {
        capture?.flush();
        return changes.filter((change) => change.path.startsWith('$.app'));
    };
    return { mounted, first, sent };
}

const writes = (changes: readonly Change[]): [string, unknown][] => changes.map((change) => [change.path, change.value]);
const length = (value: unknown): number => Math.hypot(...(value as number[]));

describe.skipIf(script === '')('scene3d orbit and pan controls with the real 3D renderer chunk (G3.8b) in Chromium', () => {
    let chunk: Scene3dChunk;
    let remove: (() => void) | undefined;

    beforeAll(() => {
        if (!isScene3dChunk((globalThis as Record<string, unknown>).__stateui3d)) {
            const element = document.createElement('script');
            element.textContent = script;
            document.head.append(element);
        }
        const global = (globalThis as Record<string, unknown>).__stateui3d;
        if (!isScene3dChunk(global)) throw new Error('The chunk set no __stateui3d');
        chunk = global;
    });

    afterEach(() => {
        capture?.stop();
        capture = undefined;
        remove?.();
        remove = undefined;
        mountComponent.unmountAll();
    });

    it('should move the camera on every frame of a drag with nothing sent, then write position and target once on release', async () => {
        // Arrange
        remove = answerWith(chunk);
        const { mounted, first, sent } = await mountScene(scene('orbit'));
        pointer(mounted, 'pointerdown', 60);

        // Act
        const frames: Uint8Array[] = [];
        for (const x of [64, 68, 72]) frames.push((await ready(mounted, (target) => pointer(target, 'pointermove', x))).picture);
        const during = [...sent()];
        // A copy: the store changes the array it holds in place on a later write
        const stored = JSON.parse(JSON.stringify(mounted.store.get(`${CAMERA}.position`))) as unknown;
        await ready(mounted, (target) => pointer(target, 'pointerup', 72));
        const released = writes(sent());

        // Assert: every frame drew another picture; one write per property, on release
        for (const [index, frame] of frames.entries()) expect(same(frame, index === 0 ? first : (frames[index - 1] as Uint8Array)), `frame ${index}`).toBe(false);
        expect(during).toEqual([]);
        expect(stored).toEqual([0, 0, 5]);
        expect(released.map(([path]) => path)).toEqual([`${CAMERA}.position`, `${CAMERA}.target`]);
        expect(released[1]?.[1]).toEqual([0, 0, 0]);
        expect(length(released[0]?.[1])).toBeCloseTo(5, 4);
        expect(mounted.store.get(`${CAMERA}.position`)).toEqual(released[0]?.[1]);
    });

    it('should write once after the wheel is idle for 200 ms', async () => {
        // Arrange
        remove = answerWith(chunk);
        const { mounted, sent } = await mountScene(scene('orbit'));

        // Act
        wheel(mounted, -100);
        await sleep(60);
        wheel(mounted, -100);
        await sleep(WHEEL_IDLE - 60);
        const beforeIdle = [...sent()];
        await sleep(160);
        const after = writes(sent());

        // Assert
        expect(beforeIdle).toEqual([]);
        expect(after.map(([path]) => path)).toEqual([`${CAMERA}.position`, `${CAMERA}.target`]);
        expect(length(after[0]?.[1])).toBeLessThan(5);
    });

    it('should make the scene focusable and orbit and zoom with the keys, writing when a key is released', async () => {
        // Arrange
        remove = answerWith(chunk);
        const { mounted, first, sent } = await mountScene(scene('orbit'));
        const box = boxOf(mounted);
        box.focus();

        // Act
        const turned = await ready(mounted, () => key(box, 'keydown', 'ArrowLeft', 'ArrowLeft'));
        const whileHeld = [...sent()];
        key(box, 'keyup', 'ArrowLeft', 'ArrowLeft');
        const afterTurn = writes(sent());
        key(box, 'keydown', '+', 'Equal');
        key(box, 'keyup', '+', 'Equal');
        const afterZoom = writes(sent());

        // Assert
        expect(box.getAttribute('tabindex')).toBe('0');
        expect(mounted.element.shadowRoot?.activeElement).toBe(box);
        expect(same(turned.picture, first)).toBe(false);
        expect(whileHeld).toEqual([]);
        expect(afterTurn).toHaveLength(2);
        const turn = afterTurn[0]?.[1] as number[];
        expect(Math.abs(Math.atan2(turn[0] ?? 0, turn[2] ?? 0))).toBeCloseTo(Math.PI / 12, 4);
        expect(afterZoom).toHaveLength(4);
        expect(length(afterZoom[2]?.[1])).toBeCloseTo(4, 4);
    });

    it('should restore the camera on Escape during a drag and write nothing', async () => {
        // Arrange
        remove = answerWith(chunk);
        const { mounted, first, sent } = await mountScene(scene('orbit'));
        pointer(mounted, 'pointerdown', 60);
        const moved = await ready(mounted, (target) => pointer(target, 'pointermove', 70));

        // Act
        const restored = await ready(mounted, () => key(document.body, 'keydown', 'Escape', 'Escape'));
        pointer(mounted, 'pointermove', 76);
        pointer(mounted, 'pointerup', 76);
        await sleep(50);

        // Assert
        expect(same(moved.picture, first)).toBe(false);
        expect(same(restored.picture, first)).toBe(true);
        expect(sent()).toEqual([]);
        expect(mounted.store.get(`${CAMERA}.position`)).toEqual([0, 0, 5]);
    });

    it('should ignore drags, the wheel and arrow keys and write nothing with controls none', async () => {
        // Arrange
        remove = answerWith(chunk);
        const { mounted, sent } = await mountScene(scene('none'));
        const box = boxOf(mounted);

        // Act
        pointer(mounted, 'pointerdown', 60);
        pointer(mounted, 'pointermove', 75);
        pointer(mounted, 'pointerup', 75);
        wheel(mounted, -100);
        const arrow = key(box, 'keydown', 'ArrowLeft', 'ArrowLeft');
        key(box, 'keyup', 'ArrowLeft', 'ArrowLeft');
        await sleep(WHEEL_IDLE + 60);

        // Assert
        expect(box.hasAttribute('tabindex')).toBe(false);
        expect(arrow.defaultPrevented).toBe(false);
        expect(mounted.element.getAttribute('data-render')).toBe('ready');
        expect(sent()).toEqual([]);
    });

    it('should apply a camera written to state during a gesture when the gesture ends, and write nothing for the gesture', async () => {
        // Arrange: the picture of the camera state will write
        remove = answerWith(chunk);
        const far = (await mountScene(scene('orbit', { position: [0, 0, 8] }))).first;
        capture?.stop();
        mountComponent.unmountAll();
        const { mounted, sent } = await mountScene(scene('orbit'));
        pointer(mounted, 'pointerdown', 60);
        const moved = await ready(mounted, (target) => pointer(target, 'pointermove', 70));

        // Act
        const during = await ready(mounted, (target) => target.store.set(`${CAMERA}.position`, [0, 0, 8]));
        const ended = await ready(mounted, (target) => pointer(target, 'pointerup', 70));

        // Assert
        expect(same(during.picture, moved.picture)).toBe(true);
        expect(same(ended.picture, far)).toBe(true);
        expect(writes(sent())).toEqual([[`${CAMERA}.position`, [0, 0, 8]]]);
    });

    it('should show the same view after a reload: the camera read back from state is the last gesture end', async () => {
        // Arrange
        remove = answerWith(chunk);
        const { mounted, sent } = await mountScene(scene('orbit'));
        pointer(mounted, 'pointerdown', 60);
        pointer(mounted, 'pointermove', 70, 34);
        const before = await ready(mounted, (scene3d) => pointer(scene3d, 'pointerup', 70, 34));
        const [position, target] = writes(sent()).map(([, value]) => value);
        const children = JSON.parse(JSON.stringify(mounted.store.get('$.app.children'))) as Record<string, unknown>;
        mountComponent.unmountAll();
        capture?.stop();
        capture = undefined;

        // Act: a new mount from the state the gesture wrote
        const reloaded = await mountScene({ ...scene('orbit'), children });

        // Assert
        const eye = children.eye as { position: unknown; target: unknown };
        expect(eye.position).toEqual(position);
        expect(eye.target).toEqual(target);
        expect(position).not.toEqual([0, 0, 5]);
        expect(same(reloaded.first, before.picture)).toBe(true);
    });
});
