import { report } from '@punyts/core';
import { FileTransferError } from '@punyts/stateui-app';
import type { FileData, ReadFile } from '@punyts/stateui-app';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';
import { isScene3dChunk } from '../../src/shared/scene3d/load.js';
import type { Scene3dChunk } from '../../src/shared/scene3d/load.js';

/** The owner's tolerance for pixels drawn by software WebGL: 12 per channel */
const TOLERANCE = 12;
/** The built chunk of `../stateui-3d` and its model fixture (test/globalSetup.ts); empty when the workspace has none */
const script = inject('chunk3dScript');
const fixtureText = inject('model3dFixture');
const CHAIR = '$.app.children.chair';

/** The fixture `box.glb` of `@punyts/stateui-3d`: a unit box whose faces show an unlit texture, red above and green below */
const fixture = (): ArrayBuffer => Uint8Array.from(atob(fixtureText), (c) => c.charCodeAt(0)).buffer;
/** The file ids (the file store's UUIDs, as the `fileRef` validator wants them) */
const IDS = { chair: '6f1c2a4e-8d3b-4c7a-9e21-3b5d7f9a1c01', gone: '6f1c2a4e-8d3b-4c7a-9e21-3b5d7f9a1c02', packed: '6f1c2a4e-8d3b-4c7a-9e21-3b5d7f9a1c03' } as const;
const reference = (id: string) => ({ id, name: 'model.glb', size: 2268, type: 'model/gltf-binary' });

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

/**
 * Waits for `data-render="ready"` and reads the pixels above and below the centre at that moment (in the task of the
 * frame, since the drawing buffer is not kept once it is shown), and notes each `data-render` seen before it
 */
function ready(mounted: MountedComponent): Promise<{ above: number[]; below: number[]; seen: string[] }> {
    const seen: string[] = [mounted.element.getAttribute('data-render') ?? ''];
    return new Promise((resolve, reject) => {
        const check = (): boolean => {
            if (mounted.element.getAttribute('data-render') !== 'ready') return false;
            observer.disconnect();
            clearTimeout(timer);
            resolve({ above: pixelOf(mounted.element, 0.5, 0.42), below: pixelOf(mounted.element, 0.5, 0.58), seen });
            return true;
        };
        const timer = setTimeout(() => reject(new Error(`the scene is still ${mounted.element.getAttribute('data-render')}`)), 5000);
        const observer = new MutationObserver(() => {
            seen.push(mounted.element.getAttribute('data-render') ?? '');
            check();
        });
        observer.observe(mounted.element, { attributes: true, attributeFilter: ['data-render'] });
    });
}

function expectColor(actual: readonly number[], expected: readonly number[]): void {
    expected.forEach((value, channel) => {
        expect(Math.abs((actual[channel] ?? 0) - value), `channel ${channel} of [${actual.join(', ')}], expected [${expected.join(', ')}]`).toBeLessThanOrEqual(TOLERANCE);
    });
}

const viewer = (children: Record<string, unknown>): Record<string, unknown> => ({
    background: '#0000ff',
    environment: 'none',
    children: { eye: { component: 'camera', position: [0, 0, 3], target: [0, 0, 0] }, ...children }
});

describe.skipIf(script === '' || fixtureText === '')('scene3d model from a GLB file with the real 3D renderer chunk (G3.7b) in Chromium', () => {
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

    it('should read the model file through ui-file-read, stay pending until it is drawn, and show its embedded texture', async () => {
        // Arrange
        remove = answerWith(chunk);
        const spy = vi.spyOn(report, 'error');
        let open: () => void = () => undefined;
        const read = fakeRead({ [IDS.chair]: fixture() }, new Promise<void>((resolve) => (open = resolve)));
        const mounted = mountComponent('scene3d', viewer({ chair: { component: 'model', src: reference(IDS.chair) } }), { hooks: { readFile: read.readFile } });
        const drawn = ready(mounted);

        // Act: the file is answered only after a while
        await new Promise((resolve) => setTimeout(resolve, 150));
        const whileReading = mounted.element.getAttribute('data-render');
        open();
        const { above, below } = await drawn;

        // Assert
        expect(read.reads).toEqual([IDS.chair]);
        expect(whileReading).toBe('pending');
        expectColor(above, [255, 0, 0]);
        expectColor(below, [0, 255, 0]);
        expect(spy).not.toHaveBeenCalled();
    });

    it('should report a missing model file as SUI-RUN-FILE at the node path, and still draw the other nodes', async () => {
        // Arrange
        remove = answerWith(chunk);
        const spy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        const read = fakeRead({});

        // Act
        const mounted = mountComponent(
            'scene3d',
            viewer({
                chair: { component: 'model', src: reference(IDS.gone) },
                sun: { component: 'light', kind: 'directional', position: [0, 0, 10], target: [0, 0, 0] },
                post: { component: 'mesh', geometry: { kind: 'box', width: 0.2, height: 2, depth: 0.2 }, material: { color: '#ff0000' }, position: [0, 0, -2] }
            }),
            { hooks: { readFile: read.readFile } }
        );
        const { above } = await ready(mounted);

        // Assert: the box is not drawn, so the red post behind it shows
        expect(spy.mock.calls.map((call) => call[1])).toEqual([{ code: 'SUI-RUN-FILE', path: CHAIR }]);
        expect(spy.mock.calls[0]?.[0]).toContain('not_found');
        expect(above[0]).toBeGreaterThan(200);
        expect(above[2]).toBeLessThan(60);
    });

    it('should report a compressed model as SUI-RUN-3D naming the reason, and be ready', async () => {
        // Arrange: the fixture with Draco named as required
        remove = answerWith(chunk);
        const spy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        const bytes = new Uint8Array(fixture());
        const view = new DataView(bytes.buffer);
        const jsonLength = view.getUint32(12, true);
        const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as Record<string, unknown>;
        json.extensionsRequired = ['KHR_draco_mesh_compression'];
        // The JSON chunk again, padded with spaces to four bytes, and the header lengths with it
        const text = new TextEncoder().encode(JSON.stringify(json).padEnd(Math.ceil(JSON.stringify(json).length / 4) * 4, ' '));
        const rest = bytes.subarray(20 + jsonLength);
        const out = new Uint8Array(20 + text.length + rest.length);
        out.set(bytes.subarray(0, 20));
        out.set(text, 20);
        out.set(rest, 20 + text.length);
        new DataView(out.buffer).setUint32(8, out.length, true);
        new DataView(out.buffer).setUint32(12, text.length, true);
        const read = fakeRead({ [IDS.packed]: out.buffer });

        // Act
        const mounted = mountComponent('scene3d', viewer({ chair: { component: 'model', src: reference(IDS.packed) } }), { hooks: { readFile: read.readFile } });
        const { above } = await ready(mounted);

        // Assert
        expect(spy.mock.calls.map((call) => call[1])).toEqual([{ code: 'SUI-RUN-3D', path: CHAIR }]);
        expect(spy.mock.calls[0]?.[0]).toContain('draco: it uses KHR_draco_mesh_compression');
        expectColor(above, [0, 0, 255]);
    });
});
