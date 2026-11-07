import { report } from '@punyts/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';
import type { Scene3dOptions, Scene3dSettings, Scene3dTree } from '../../src/shared/scene3d/tree.js';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** One scene the fake `createScene3d` made: its host, options, the updates it got, and the `drawn` promises to settle */
interface FakeScene {
    host: Element;
    options: Scene3dOptions | undefined;
    updates: { tree: readonly Scene3dTree[]; settings: Scene3dSettings | undefined }[];
    /** Settles every `drawn()` asked for so far, as the next frame would */
    frame(): void;
    disposed: boolean;
}

/** Answers `ui-load-3d` with a fake chunk whose `createScene3d` records what the controller does, until removed */
function fakeChunk(create?: () => never): { scenes: FakeScene[]; remove: () => void } {
    const scenes: FakeScene[] = [];
    const createScene3d = (host: Element, options?: Scene3dOptions) => {
        if (create) create();
        let waiting: (() => void)[] = [];
        const scene: FakeScene = {
            host,
            options,
            updates: [],
            disposed: false,
            frame: () => {
                const done = waiting;
                waiting = [];
                for (const resolve of done) resolve();
            }
        };
        scenes.push(scene);
        return {
            update: (tree: readonly Scene3dTree[], settings?: Scene3dSettings) => void scene.updates.push({ tree, settings }),
            drawn: () => new Promise<void>((resolve) => waiting.push(resolve)),
            dispose: () => void (scene.disposed = true),
            hit: () => undefined,
            boundsOf: () => undefined,
            elementOf: () => undefined,
            setReducedMotion: () => undefined,
            reducedMotion: options?.reducedMotion ?? false
        };
    };
    const listener = (event: Event): void => {
        (event as CustomEvent<{ respond: (result: Promise<unknown>) => void }>).detail.respond(Promise.resolve({ version: '0.0.0', createScene3d }));
    };
    document.addEventListener('ui-load-3d', listener);
    return { scenes, remove: () => document.removeEventListener('ui-load-3d', listener) };
}

const SCENE = {
    _title: 'Box',
    children: {
        eye: { component: 'camera', position: [0, 0, 5] },
        sun: { component: 'light', kind: 'directional', intensity: 2 },
        rig: { component: 'group3d', children: { box: { component: 'mesh', geometry: { kind: 'box' }, material: { color: '#ff0000' } } } }
    }
};

const render = (mounted: MountedComponent): string | null => mounted.element.getAttribute('data-render');

describe('scene3d drawing through the chunk (G3.5), with a fake chunk', () => {
    let fake: ReturnType<typeof fakeChunk> | undefined;

    afterEach(() => {
        fake?.remove();
        fake = undefined;
        mountComponent.unmountAll();
        vi.restoreAllMocks();
    });

    it('should make the scene on the surface and hand it the node tree and the scene settings', async () => {
        // Arrange
        fake = fakeChunk();

        // Act
        const mounted = mountComponent('scene3d', SCENE);
        await settle();

        // Assert
        const [scene] = fake.scenes;
        expect(fake.scenes).toHaveLength(1);
        expect(scene?.host).toBe(mounted.element.shadowRoot?.querySelector('.surface'));
        expect(scene?.updates).toHaveLength(1);
        const tree = scene?.updates[0]?.tree ?? [];
        expect(tree.map((node) => [node.kind, node.path])).toEqual([
            ['camera', '$.app.children.eye'],
            ['light', '$.app.children.sun'],
            ['group3d', '$.app.children.rig']
        ]);
        expect(tree[2]?.children[0]).toMatchObject({ kind: 'mesh', key: 'box', path: '$.app.children.rig.children.box' });
        expect(tree[2]?.children[0]?.properties).toMatchObject({ geometry: { kind: 'box' }, material: { color: '#ff0000' } });
        // The defaults of the shapes are there, as the store holds them
        expect(tree[0]?.properties).toMatchObject({ kind: 'perspective', fov: 50, target: [0, 0, 0] });
        expect(scene?.updates[0]?.settings).toEqual({ background: '{scene3d.background}', ambient: '{scene3d.ambient}', environment: 'studio' });
    });

    it('should be pending until the first frame is on screen, then ready', async () => {
        // Arrange
        fake = fakeChunk();
        const mounted = mountComponent('scene3d', SCENE);
        await settle();
        const before = render(mounted);

        // Act
        fake.scenes[0]?.frame();
        await settle();

        // Assert
        expect(before).toBe('pending');
        expect(render(mounted)).toBe('ready');
        expect(mounted.element.hasAttribute('data-fallback')).toBe(false);
    });

    it('should redraw on a change below children and of the scene properties, once per task, and not for the title', async () => {
        // Arrange
        fake = fakeChunk();
        const mounted = mountComponent('scene3d', SCENE);
        await settle();
        const scene = fake.scenes[0];
        scene?.frame();
        await settle();

        // Act
        mounted.store.set('$.app.children.rig.children.box.position', [1, 2, 3]);
        mounted.store.set('$.app.children.rig.children.box.material.color', '#00ff00');
        const pending = render(mounted);
        await settle();
        const afterChildren = scene?.updates.length;
        mounted.store.set('$.app.background', '#123456');
        await settle();
        mounted.store.set('$.app.environment', 'none');
        await settle();
        mounted.store.set('$.app._title', 'Other');
        await settle();

        // Assert
        expect(pending).toBe('pending');
        expect(afterChildren).toBe(2);
        expect(scene?.updates[1]?.tree[2]?.children[0]?.properties).toMatchObject({ position: [1, 2, 3], material: { color: '#00ff00' } });
        expect(scene?.updates[2]?.settings?.background).toBe('#123456');
        expect(scene?.updates[3]?.settings?.environment).toBe('none');
        expect(scene?.updates).toHaveLength(4);
        scene?.frame();
        await settle();
        expect(render(mounted)).toBe('ready');
    });

    it('should draw a node added to children and leave out one that is removed', async () => {
        // Arrange
        fake = fakeChunk();
        const mounted = mountComponent('scene3d', SCENE);
        await settle();

        // Act
        mounted.store.set('$.app.children.ball', { component: 'mesh', geometry: { kind: 'sphere' } });
        await settle();
        mounted.store.delete('$.app.children.sun' as never);
        await settle();

        // Assert
        const updates = fake.scenes[0]?.updates ?? [];
        expect(updates.at(-2)?.tree.map((node) => node.key)).toEqual(['eye', 'sun', 'rig', 'ball']);
        expect(updates.at(-1)?.tree.map((node) => node.key)).toEqual(['eye', 'rig', 'ball']);
    });

    it('should read a linked property through the store', async () => {
        // Arrange
        fake = fakeChunk();

        // Act
        const mounted = mountComponent(
            'scene3d',
            { children: { box: { component: 'mesh', '<-position': '$.data.where' } } },
            { data: { where: [4, 5, 6] } }
        );
        await settle();
        mounted.store.set('$.data.where', [7, 8, 9]);
        await settle();

        // Assert
        const updates = fake.scenes[0]?.updates ?? [];
        expect(updates[0]?.tree[0]?.properties.position).toEqual([4, 5, 6]);
        expect(updates.at(-1)?.tree[0]?.properties.position).toEqual([7, 8, 9]);
    });

    it('should resolve colours and tokens from the computed style of the surface', async () => {
        // Arrange
        fake = fakeChunk();
        mountComponent('scene3d', SCENE);
        await settle();
        const scene = fake.scenes[0];
        const resolve = scene?.options?.resolveColor;
        const style = getComputedStyle(scene?.host as Element);
        const box = (scene?.host as Element).parentElement as HTMLElement;
        const defaults = [resolve?.('{scene3d.background}'), resolve?.('{scene3d.ambient}')];
        box.style.setProperty('--ui-scene3d-background', '#ff0000');
        box.style.setProperty('--ui-scene3d-ambient', 'rgb(1, 2, 3)');

        // Assert: the scene's own tokens with their defaults (surface.base and surface.raised), or a theme's override
        expect(resolve?.('#ff8800')).toBe('#ff8800');
        expect(defaults[0]).toMatch(/^rgb/);
        expect(defaults[1]).toMatch(/^rgb/);
        expect(resolve?.('{scene3d.background}')).toBe('rgb(255, 0, 0)');
        expect(resolve?.('{scene3d.ambient}')).toBe('rgb(1, 2, 3)');
        expect(resolve?.('{color.accent.base}')).toBe(style.getPropertyValue('--ui-color-accent-base').trim());
        expect(resolve?.('{color.accent.base}')).not.toBe('');
        expect(resolve?.('{color.no.such}')).toBeUndefined();
        expect(resolve?.('sky')).toBeUndefined();
        expect(scene?.options?.reducedMotion).toBe(false);
    });

    it('should pass reduced motion from the motion overlay', async () => {
        // Arrange
        fake = fakeChunk();

        // Act
        mountComponent('scene3d', SCENE, { motion: 'reduced' });
        await settle();

        // Assert
        expect(fake.scenes[0]?.options?.reducedMotion).toBe(true);
    });

    it('should show _fallback and report one SUI-RUN-3D no_webgl when the scene cannot be made', async () => {
        // Arrange
        const spy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        fake = fakeChunk(() => {
            throw Object.assign(new Error('WebGL is not available'), { name: 'Scene3dError', code: 'no_webgl' });
        });

        // Act
        const mounted = mountComponent('scene3d', { ...SCENE, _fallback: 'No 3D here' });
        await settle();

        // Assert
        const calls = spy.mock.calls.filter((call) => (call[1] as { code?: string } | undefined)?.code === 'SUI-RUN-3D');
        expect(calls).toHaveLength(1);
        expect(calls[0]?.[0]).toContain('no_webgl');
        expect(calls[0]?.[1]).toEqual({ code: 'SUI-RUN-3D', path: '$.app' });
        expect(mounted.element.hasAttribute('data-fallback')).toBe(true);
        expect(render(mounted)).toBe('ready');
    });

    it('should report a node that is not a 3D node once, at its path, and draw the others', async () => {
        // Arrange
        const spy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        fake = fakeChunk();
        const mounted = mountComponent('scene3d', SCENE);
        await settle();

        // Act
        mounted.store.set('$.app.children.square', { component: 'rect', width: 10 });
        await settle();
        mounted.store.set('$.app.children.eye.fov', 30);
        await settle();

        // Assert
        const calls = spy.mock.calls.filter((call) => (call[1] as { code?: string } | undefined)?.code === 'SUI-RUN-3D');
        expect(calls).toHaveLength(1);
        expect(calls[0]?.[1]).toEqual({ code: 'SUI-RUN-3D', path: '$.app.children.square' });
        expect(fake.scenes[0]?.updates.at(-1)?.tree.map((node) => node.key)).toEqual(['eye', 'sun', 'rig']);
    });

    it('should dispose the scene on unmount and draw nothing after it', async () => {
        // Arrange
        fake = fakeChunk();
        const mounted = mountComponent('scene3d', SCENE);
        await settle();
        const scene = fake.scenes[0];

        // Act
        mounted.dispose();
        await settle();

        // Assert
        expect(scene?.disposed).toBe(true);
        expect(scene?.updates).toHaveLength(1);
    });
});
