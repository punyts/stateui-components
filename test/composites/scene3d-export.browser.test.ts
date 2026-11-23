import { afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent, NodeState } from '../harness/createMountComponent.js';
import { isScene3dChunk } from '../../src/shared/scene3d/load.js';
import type { Scene3dChunk } from '../../src/shared/scene3d/load.js';

/**
 * The GLB export of a scene3d (docs/design/stateui-3d-glb-export.md) with the real chunk of `../stateui-3d`: a set
 * `exportRequest` hands a GLB to `ui-file-transfer` (a fake host hook here), writes `exported` and raises `exported`
 */
const script = inject('chunk3dScript');
const SCENE = '$.app';

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Answers `ui-load-3d` with the real chunk's global, as the runtime's `load3d` hook does */
function answerWith(chunk: unknown): () => void {
    const listener = (event: Event): void => {
        (event as CustomEvent<{ respond: (result: Promise<unknown>) => void }>).detail.respond(Promise.resolve(chunk));
    };
    document.addEventListener('ui-load-3d', listener);
    return () => document.removeEventListener('ui-load-3d', listener);
}

/** Answers `ui-file-transfer` with a reference to each file it gets, and keeps the files */
function storeFiles(files: File[]): () => void {
    const listener = (event: Event): void => {
        const { file, respond } = (event as CustomEvent<{ file: File; respond: (result: Promise<unknown>) => void }>).detail;
        files.push(file);
        respond(Promise.resolve({ id: `file-${files.length}`, name: file.name, size: file.size, type: file.type }));
    };
    document.addEventListener('ui-file-transfer', listener);
    return () => document.removeEventListener('ui-file-transfer', listener);
}

/** Waits up to 200 frames for a condition */
async function until(done: () => boolean): Promise<void> {
    for (let at = 0; at < 200 && !done(); at += 1) await frame();
}

/** The JSON chunk of a GLB, after checking its header */
async function gltfOf(file: File): Promise<{ nodes?: unknown[]; meshes?: unknown[]; asset?: { generator?: string } }> {
    const data = await file.arrayBuffer();
    const view = new DataView(data);
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(4, true)).toBe(2);
    expect(view.getUint32(8, true)).toBe(data.byteLength);
    const length = view.getUint32(12, true);
    return JSON.parse(new TextDecoder().decode(new Uint8Array(data, 20, length)));
}

const scene = (own: Record<string, unknown> = {}): NodeState => ({
    _title: 'Board',
    environment: 'none',
    on: { exported: { command: 'set', target: '$.data.ui.saved', value: 'yes' } },
    ...own,
    children: {
        eye: { component: 'camera', position: [0, 0, 5], target: [0, 0, 0] },
        sun: { component: 'light', kind: 'directional', position: [0, 0, 10], target: [0, 0, 0] },
        lid: { component: 'mesh', geometry: { kind: 'box' }, material: { color: '#ff0000' } },
        base: { component: 'mesh', position: [2, 0, 0], geometry: { kind: 'sphere' } }
    }
});

/** Mounts a scene and records its `exported` events */
async function mountScene(node: NodeState): Promise<MountedComponent & { readonly raised: unknown[] }> {
    const mounted = mountComponent('scene3d', node, { data: { ui: { saved: '' } } });
    const raised: unknown[] = [];
    mounted.element.addEventListener('exported', (event) => raised.push((event as CustomEvent).detail));
    await Promise.resolve();
    await until(() => mounted.element.getAttribute('data-render') === 'ready');
    return Object.assign(mounted, { raised });
}

describe.skipIf(script === '')('scene3d GLB export with the real 3D renderer chunk in Chromium', () => {
    let chunk: Scene3dChunk;
    const removes: (() => void)[] = [];

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
        for (const remove of removes.splice(0)) remove();
        mountComponent.unmountAll();
    });

    it('should hand a GLB of the drawn meshes, write exported and run on.exported when exportRequest is set', async () => {
        // Arrange
        const files: File[] = [];
        removes.push(answerWith(chunk), storeFiles(files));
        const mounted = await mountScene(scene());

        // Act
        mounted.store.set(`${SCENE}.exportRequest`, 1);
        await until(() => files.length > 0 && mounted.raised.length > 0);

        // Assert
        expect(files).toHaveLength(1);
        const file = files[0] as File;
        expect(file.name).toBe('Board.glb');
        expect(file.type).toBe('model/gltf-binary');
        const gltf = await gltfOf(file);
        expect(gltf.asset?.generator).toBe('StateUI');
        expect(gltf.nodes).toHaveLength(2);
        expect(gltf.meshes).toHaveLength(2);
        const reference = { id: 'file-1', name: 'Board.glb', size: file.size, type: 'model/gltf-binary' };
        expect(mounted.store.get(`${SCENE}.exported`)).toEqual({ request: 1, file: reference });
        expect(mounted.raised).toEqual([{ file: reference }]);
        expect(mounted.store.get('$.data.ui.saved')).toBe('yes');
    });

    it('should export at once for a request set before the scene is drawn, and not again for the same request', async () => {
        // Arrange
        const files: File[] = [];
        removes.push(answerWith(chunk), storeFiles(files));

        // Act
        const mounted = await mountScene(scene({ exportRequest: 'turn-1' }));
        await until(() => files.length > 0);
        mounted.store.set(`${SCENE}.exportRequest`, 'turn-1');
        await frame();
        await frame();
        mounted.store.set(`${SCENE}.exportRequest`, 'turn-2');
        await until(() => files.length > 1);

        // Assert
        expect(files).toHaveLength(2);
        expect((mounted.store.get(`${SCENE}.exported`) as { request: unknown }).request).toBe('turn-2');
    });

    it('should write offline when the host has no file hook', async () => {
        // Arrange
        removes.push(answerWith(chunk));
        const mounted = await mountScene(scene());

        // Act
        mounted.store.set(`${SCENE}.exportRequest`, 7);
        await until(() => mounted.store.get(`${SCENE}.exported.request`) === 7);

        // Assert
        expect(mounted.store.get(`${SCENE}.exported`)).toEqual({ request: 7, error: 'offline' });
        expect(mounted.raised).toHaveLength(0);
        expect(mounted.store.get('$.data.ui.saved')).toBe('');
    });
});
