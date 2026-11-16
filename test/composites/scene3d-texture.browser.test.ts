import { report } from '@punyts/core';
import { FileTransferError } from '@punyts/stateui-app';
import type { FileData, ReadFile } from '@punyts/stateui-app';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';
import { isScene3dChunk } from '../../src/shared/scene3d/load.js';
import type { Scene3dChunk } from '../../src/shared/scene3d/load.js';

/*
 * Textures from files (G3.7c of the graphics epic 3): a mesh's `material.map` is a picture file of the app's store, read
 * by the scene3d controller through `ui-file-read` (the host's `readFile` hook, a fake here) and drawn by the real chunk.
 */

/** The owner's tolerance for pixels drawn by software WebGL: 12 per channel */
const TOLERANCE = 12;
/** The built chunk of `../stateui-3d` (test/globalSetup.ts); empty when the workspace has none */
const script = inject('chunk3dScript');
const WALL = '$.app.children.wall';
/** The file ids (the file store's UUIDs, as the `fileRef` validator wants them) */
const IDS = { plan: '7a2c3b5f-9e4d-4d8b-8f32-4c6e8a0b2d01', gone: '7a2c3b5f-9e4d-4d8b-8f32-4c6e8a0b2d02', text: '7a2c3b5f-9e4d-4d8b-8f32-4c6e8a0b2d03' } as const;
const reference = (id: string, type = 'image/png') => ({ id, name: 'plan.png', size: 100, type });

/** A PNG of 64 by 64 pixels in quadrants: red top-left, green top-right, blue bottom-left, white bottom-right */
async function quadrants(): Promise<ArrayBuffer> {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    for (const [colour, x, y] of [
        ['#ff0000', 0, 0],
        ['#00ff00', 32, 0],
        ['#0000ff', 0, 32],
        ['#ffffff', 32, 32]
    ] as const) {
        context.fillStyle = colour;
        context.fillRect(x, y, 32, 32);
    }
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((made) => resolve(made as Blob), 'image/png'));
    return blob.arrayBuffer();
}

/** Answers `ui-load-3d` with the real chunk's global, as the runtime's `load3d` hook does */
function answerWith(chunk: unknown): () => void {
    const listener = (event: Event): void => {
        (event as CustomEvent<{ respond: (result: Promise<unknown>) => void }>).detail.respond(Promise.resolve(chunk));
    };
    document.addEventListener('ui-load-3d', listener);
    return () => document.removeEventListener('ui-load-3d', listener);
}

/** A `readFile` hook over a map of stored files (`not_found` for another id); `gate` holds the answers back */
function fakeRead(files: Record<string, ArrayBuffer>, gate: Promise<void> = Promise.resolve()): { readFile: ReadFile; reads: string[] } {
    const reads: string[] = [];
    const readFile: ReadFile = async (id) => {
        reads.push(id);
        await gate;
        const data = files[id];
        if (data === undefined) throw new FileTransferError('not_found', 'no such file');
        const result: FileData = { file: reference(id), data: data.slice(0) };
        return result;
    };
    return { readFile, reads };
}

/** The colour at a point of the scene's canvas, as fractions of its size from the top-left */
function pixelOf(element: Element, fx: number, fy: number): number[] {
    const canvas = element.shadowRoot?.querySelector('.surface canvas') as HTMLCanvasElement | null;
    const gl = canvas?.getContext('webgl2');
    if (!canvas || !gl) throw new Error('No WebGL canvas in the scene');
    const x = Math.min(gl.drawingBufferWidth - 1, Math.floor(gl.drawingBufferWidth * fx));
    const y = Math.min(gl.drawingBufferHeight - 1, Math.floor(gl.drawingBufferHeight * (1 - fy)));
    const pixel = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return [...pixel];
}

/** The plane's top-left and bottom-right quarters, read in the task of the frame that marks the scene ready */
interface Seen {
    topLeft: number[];
    bottomRight: number[];
}

/** Waits for `data-render="ready"` and reads two pixels at that moment (the drawing buffer is not kept once it is shown) */
function ready(mounted: MountedComponent): Promise<Seen> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`the scene is still ${mounted.element.getAttribute('data-render')}`)), 5000);
        const observer = new MutationObserver(() => {
            if (mounted.element.getAttribute('data-render') !== 'ready') return;
            observer.disconnect();
            clearTimeout(timer);
            resolve({ topLeft: pixelOf(mounted.element, 0.4, 0.4), bottomRight: pixelOf(mounted.element, 0.6, 0.6) });
        });
        observer.observe(mounted.element, { attributes: true, attributeFilter: ['data-render'] });
    });
}

function expectColor(actual: readonly number[], expected: readonly number[]): void {
    expected.forEach((value, channel) => {
        expect(Math.abs((actual[channel] ?? 0) - value), `channel ${channel} of [${actual.join(', ')}], expected [${expected.join(', ')}]`).toBeLessThanOrEqual(TOLERANCE);
    });
}

/** A 2 by 2 plane facing a camera at z = 3, lit by an ambient light of 1 (a surface shows its own colour) */
const viewer = (material: Record<string, unknown>): Record<string, unknown> => ({
    background: '#000000',
    environment: 'none',
    children: {
        eye: { component: 'camera', position: [0, 0, 3], target: [0, 0, 0] },
        fill: { component: 'light', kind: 'ambient' },
        wall: { component: 'mesh', geometry: { kind: 'plane', width: 2, height: 2 }, material }
    }
});

describe.skipIf(script === '')('scene3d mesh material.map from a picture file with the real 3D renderer chunk (G3.7c) in Chromium', () => {
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

    it('should read the map through ui-file-read, stay pending until it is drawn, and show red at the top-left of the plane', async () => {
        // Arrange
        remove = answerWith(chunk);
        const spy = vi.spyOn(report, 'error');
        let open: () => void = () => undefined;
        const read = fakeRead({ [IDS.plan]: await quadrants() }, new Promise<void>((resolve) => (open = resolve)));
        const mounted = mountComponent('scene3d', viewer({ map: reference(IDS.plan) }), { hooks: { readFile: read.readFile } });
        const drawn = ready(mounted);

        // Act: the file is answered only after a while
        await new Promise((resolve) => setTimeout(resolve, 150));
        const whileReading = mounted.element.getAttribute('data-render');
        open();
        const { topLeft, bottomRight } = await drawn;

        // Assert
        expect(read.reads).toEqual([IDS.plan]);
        expect(whileReading).toBe('pending');
        expectColor(topLeft, [255, 0, 0]);
        expectColor(bottomRight, [255, 255, 255]);
        expect(spy).not.toHaveBeenCalled();
    });

    it('should draw the colour only and report SUI-RUN-FILE at the mesh path for a missing file and bytes that are no picture', async () => {
        // Arrange
        remove = answerWith(chunk);
        const spy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        const read = fakeRead({ [IDS.text]: new TextEncoder().encode('not a picture').buffer as ArrayBuffer });

        for (const [id, reason] of [
            [IDS.gone, 'not_found'],
            [IDS.text, 'not_an_image']
        ] as const) {
            // Act
            const mounted = mountComponent('scene3d', viewer({ map: reference(id), color: '#ff00ff' }), { hooks: { readFile: read.readFile } });
            const { topLeft, bottomRight } = await ready(mounted);
            mountComponent.unmountAll();

            // Assert: the scene draws, the plane in its colour
            expectColor(topLeft, [255, 0, 255]);
            expectColor(bottomRight, [255, 0, 255]);
            expect(spy.mock.calls.map((call) => call[1])).toEqual([{ code: 'SUI-RUN-FILE', path: WALL }]);
            expect(String(spy.mock.calls[0]?.[0])).toContain(reason);
            expect(String(spy.mock.calls[0]?.[0])).toContain('mesh');
            spy.mockClear();
        }
        expect(read.reads).toEqual([IDS.gone, IDS.text]);
    });

    it('should refuse a map that is a GLB or a text file as SUI-STATE-INVALID and read nothing', () => {
        // Arrange
        remove = answerWith(chunk);
        const read = fakeRead({});

        // Act / Assert
        for (const type of ['model/gltf-binary', 'text/plain']) {
            expect(() => mountComponent('scene3d', viewer({ map: reference(IDS.plan, type) }), { hooks: { readFile: read.readFile } })).toThrow(
                /SUI-STATE-INVALID Property "material" at \$\.app\.children\.wall\.material/
            );
            mountComponent.unmountAll();
        }
        expect(read.reads).toEqual([]);
    });
});
