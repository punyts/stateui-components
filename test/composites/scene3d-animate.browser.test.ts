import { report } from '@punyts/core';
import type { FileData, ReadFile } from '@punyts/stateui-app';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';
import { isScene3dChunk } from '../../src/shared/scene3d/load.js';
import type { Scene3dChunk } from '../../src/shared/scene3d/load.js';

// G3.9b of the graphics epic 3: `animate` of 3D nodes and the clips of a GLB `model`, with the real chunk

/** The built chunk of `../stateui-3d` and its animated model fixture (test/globalSetup.ts); empty when the workspace has none */
const script = inject('chunk3dScript');
const fixtureText = inject('clips3dFixture');

/** The fixture `box-clips.glb` of `@punyts/stateui-3d`: a unit box with the clips `slide` and `lift`, 1 s each */
const fixture = (): ArrayBuffer => Uint8Array.from(atob(fixtureText), (c) => c.charCodeAt(0)).buffer;
const MODEL_ID = '6f1c2a4e-8d3b-4c7a-9e21-3b5d7f9a1c11';
const CHAIR = '$.app.children.chair';
const BAR = '$.app.children.bar';
const reference = { id: MODEL_ID, name: 'chair.glb', size: 2976, type: 'model/gltf-binary' };

/** Answers `ui-load-3d` with the real chunk's global, as the runtime's `load3d` hook does */
function answerWith(chunk: unknown): () => void {
    const listener = (event: Event): void => {
        (event as CustomEvent<{ respond: (result: Promise<unknown>) => void }>).detail.respond(Promise.resolve(chunk));
    };
    document.addEventListener('ui-load-3d', listener);
    return () => document.removeEventListener('ui-load-3d', listener);
}

/** A `readFile` hook that answers the fixture for its id */
const readFile: ReadFile = async (id) => {
    const result: FileData = { file: { ...reference, id }, data: fixture() };
    return result;
};

/** The number of red pixels on the row of the canvas a fraction of its height from the top, read in the task of the frame */
function redOnRow(element: Element, fy: number): number {
    const canvas = element.shadowRoot?.querySelector('.surface canvas') as HTMLCanvasElement | null;
    const gl = canvas?.getContext('webgl2');
    if (!canvas || !gl) throw new Error('No WebGL canvas in the scene');
    const width = gl.drawingBufferWidth;
    const row = new Uint8Array(width * 4);
    gl.readPixels(0, Math.floor(gl.drawingBufferHeight * (1 - fy)), width, 1, gl.RGBA, gl.UNSIGNED_BYTE, row);
    let red = 0;
    for (let x = 0; x < width; x += 1) if (row[x * 4]! > 200 && row[x * 4 + 2]! < 60) red += 1;
    return red;
}

/** Mounts a scene and waits until its first frame is on screen */
function mountReady(state: Record<string, unknown>, motion?: string): Promise<MountedComponent> {
    return new Promise((resolve, reject) => {
        const mounted = mountComponent('scene3d', state, { hooks: { readFile }, ...(motion === undefined ? {} : { motion }) });
        const timer = setTimeout(() => reject(new Error(`the scene is still ${mounted.element.getAttribute('data-render')}`)), 8000);
        const observer = new MutationObserver(() => {
            if (mounted.element.getAttribute('data-render') !== 'ready') return;
            observer.disconnect();
            clearTimeout(timer);
            resolve(mounted);
        });
        observer.observe(mounted.element, { attributes: true, attributeFilter: ['data-render'] });
    });
}

/** Waits until the element is `ready` again after something made it `pending` */
function readyAgain(mounted: MountedComponent, act: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
        let pending = false;
        const timer = setTimeout(() => reject(new Error(`the scene is still ${mounted.element.getAttribute('data-render')}`)), 8000);
        const observer = new MutationObserver(() => {
            const state = mounted.element.getAttribute('data-render');
            if (state === 'pending') pending = true;
            if (state !== 'ready' || !pending) return;
            observer.disconnect();
            clearTimeout(timer);
            resolve();
        });
        observer.observe(mounted.element, { attributes: true, attributeFilter: ['data-render'] });
        act();
    });
}

const nextFrame = (): Promise<number> => new Promise((resolve) => requestAnimationFrame(resolve));
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A red bar 3 units wide and thin above the centre (its row is 0.3 of the height from the top), seen from the front, on
 * blue; `spin` turns it edge-on and back, so the red pixels on its row change from frame to frame. Optionally the
 * animated model below the centre
 */
const scene = (bar: Record<string, unknown>, chair?: Record<string, unknown>): Record<string, unknown> => ({
    background: '#0000ff',
    environment: 'none',
    children: {
        eye: { component: 'camera', position: [0, 0, 5], target: [0, 0, 0] },
        sun: { component: 'light', kind: 'ambient', intensity: 1 },
        bar: { component: 'mesh', geometry: { kind: 'box', width: 3, height: 0.4, depth: 0.1 }, material: { color: '#ff0000' }, position: [0, 0.9, 0], ...bar },
        ...(chair === undefined ? {} : { chair: { component: 'model', src: reference, position: [0, -1, 0], ...chair } })
    }
});
const BAR_ROW = 0.3;

/**
 * The red pixels on the bar's row after each animation-frame callback during `count` frames: the drawing buffer is not
 * kept after the frame, so the row is read right after each callback (the scene's own among them) in its frame
 */
async function rowsOver(mounted: MountedComponent, count: number): Promise<number[]> {
    const rows: number[] = [];
    const original = window.requestAnimationFrame.bind(window);
    const spy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) =>
        original((time) => {
            callback(time);
            rows.push(redOnRow(mounted.element, BAR_ROW));
        })
    );
    for (let i = 0; i < count; i += 1) await nextFrame();
    spy.mockRestore();
    return rows;
}

describe.skipIf(script === '' || fixtureText === '')('scene3d animate and model clips with the real 3D renderer chunk (G3.9b) in Chromium', () => {
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
        remove?.();
        remove = undefined;
        mountComponent.unmountAll();
        vi.restoreAllMocks();
    });

    it('should turn a node with spin over time, be ready while it turns, and leave the store untouched', async () => {
        // Arrange
        remove = answerWith(chunk);
        const mounted = await mountReady(scene({ animate: { name: 'spin', duration: 1000 } }));
        const node = JSON.stringify(mounted.store.get(BAR));
        const writes = vi.spyOn(mounted.store, 'set');

        // Act
        const rows = await rowsOver(mounted, 30);

        // Assert: the bar's width on screen changed from frame to frame, and nothing was written
        expect(Math.max(...rows) - Math.min(...rows)).toBeGreaterThan(20);
        expect(mounted.element.getAttribute('data-render')).toBe('ready');
        expect(JSON.stringify(mounted.store.get(BAR))).toBe(node);
        expect(writes).not.toHaveBeenCalled();
    });

    it('should report an unknown clip as SUI-RUN-3D at the model path, naming the clips the file has', async () => {
        // Arrange
        remove = answerWith(chunk);
        const spy = vi.spyOn(report, 'error').mockImplementation(() => undefined);

        // Act
        await mountReady(scene({}, { animation: 'walk', playing: true }));

        // Assert
        expect(spy.mock.calls.map((call) => call[1])).toEqual([{ code: 'SUI-RUN-3D', path: CHAIR }]);
        expect(spy.mock.calls[0]?.[0]).toContain('unknown_clip: the file has no clip "walk"; its clips are "slide", "lift"');
    });

    it('should play nothing and ask for no frame with the reduced overlay at mount, and play once full motion is back', async () => {
        // Arrange
        remove = answerWith(chunk);
        const resting = redOnRow((await mountReady(scene({}))).element, BAR_ROW);
        mountComponent.unmountAll();
        const mounted = await mountReady(scene({ animate: { name: 'spin' } }, { animation: 'lift', playing: true }), 'reduced');
        const row = redOnRow(mounted.element, BAR_ROW);
        await nextFrame();
        const frames = vi.spyOn(window, 'requestAnimationFrame');

        // Act: reduced
        await sleep(150);
        const reduced = { frames: frames.mock.calls.length, row };
        frames.mockClear();
        mounted.setTheme('motion', 'full');
        await sleep(150);

        // Assert
        expect(reduced).toEqual({ frames: 0, row: resting });
        expect(frames.mock.calls.length).toBeGreaterThan(3);
    });

    it('should stop animate and the clip when the reduced overlay is switched on, the bar at rest and no frame asked for', async () => {
        // Arrange
        remove = answerWith(chunk);
        const resting = redOnRow((await mountReady(scene({}))).element, BAR_ROW);
        mountComponent.unmountAll();
        const mounted = await mountReady(scene({ animate: { name: 'spin' } }, { animation: 'slide', playing: true }));
        const turning = await rowsOver(mounted, 10);

        // Act
        await readyAgain(mounted, () => mounted.setTheme('motion', 'reduced'));
        const row = redOnRow(mounted.element, BAR_ROW);
        const frames = vi.spyOn(window, 'requestAnimationFrame');
        await sleep(150);

        // Assert
        expect(new Set(turning).size).toBeGreaterThan(1);
        expect(row).toBe(resting);
        expect(frames).not.toHaveBeenCalled();
    });
});
