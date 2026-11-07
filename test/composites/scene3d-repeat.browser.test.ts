import { report } from '@punyts/core';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';
import { isScene3dChunk } from '../../src/shared/scene3d/load.js';
import type { Scene3dChunk } from '../../src/shared/scene3d/load.js';
import type { Scene3dOptions, Scene3dSettings, Scene3dTree } from '../../src/shared/scene3d/tree.js';

/** The owner's tolerance for pixels drawn by software WebGL: 12 per channel */
const TOLERANCE = 12;
/** The built chunk of `../stateui-3d` (test/globalSetup.ts); empty when the workspace has not built it */
const script = inject('chunk3dScript');
/** The render timeout of `ui_screenshot` (G1.10): a scene of 10,000 instances must be ready within it */
const RENDER_TIMEOUT = 10_000;
const REPEAT = '$.app.children.crates';

const LIT_RED = [252, 27, 27];
const LIT_GREEN = [27, 252, 27];

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A crate row: its place, colour and name from the record */
const crate = { component: 'mesh', geometry: { kind: 'box' }, '<-position': '$row.at', '<-material': '$row.paint', interactive: true, '<-_label': '$row.name' };

/** A scene with a camera, a light and one repeat over `$.data.crates` */
const crates = (row: Record<string, unknown> = crate): Record<string, unknown> => ({
    _title: 'Crates',
    background: '#000000',
    environment: 'none',
    children: {
        eye: { component: 'camera', position: [0, 0, 5], target: [0, 0, 0] },
        sun: { component: 'light', kind: 'directional', position: [0, 0, 10], target: [0, 0, 0] },
        crates: { component: 'repeat3d', '<-records': '$.data.crates', row }
    }
});

/** Two crates a quarter of the canvas left and right of the centre */
const pair = (left: string, right: string): unknown[] => [
    { id: 'left', at: [-1.75, 0, 0], paint: { color: left }, name: 'Left' },
    { id: 'right', at: [1.75, 0, 0], paint: { color: right }, name: 'Right' }
];

const calls = (spy: { mock: { calls: unknown[][] } }, code: string): unknown[][] =>
    spy.mock.calls.filter((call) => (call[1] as { code?: string } | undefined)?.code === code);

/** Answers `ui-load-3d` with a fake chunk that records the trees the controller hands it */
function fakeChunk(): { updates: (readonly Scene3dTree[])[]; remove: () => void } {
    const updates: (readonly Scene3dTree[])[] = [];
    const createScene3d = (_host: Element, options?: Scene3dOptions) => ({
        update: (tree: readonly Scene3dTree[], _settings?: Scene3dSettings) => void updates.push(tree),
        drawn: () => Promise.resolve(),
        dispose: () => undefined,
        hit: () => undefined,
        boundsOf: () => undefined,
        elementOf: () => undefined,
        restyle: () => undefined,
        setReducedMotion: () => undefined,
        reducedMotion: options?.reducedMotion ?? false
    });
    const listener = (event: Event): void => {
        (event as CustomEvent<{ respond: (result: Promise<unknown>) => void }>).detail.respond(Promise.resolve({ version: '0.0.0', createScene3d }));
    };
    document.addEventListener('ui-load-3d', listener);
    return { updates, remove: () => document.removeEventListener('ui-load-3d', listener) };
}

/** The repeat of the last tree handed to the scene */
const repeatOf = (updates: (readonly Scene3dTree[])[]): Scene3dTree | undefined => updates[updates.length - 1]?.find((node) => node.path === REPEAT);

describe('scene3d repeat3d wiring (G3.6), with a fake chunk', () => {
    let remove: (() => void) | undefined;

    afterEach(() => {
        remove?.();
        remove = undefined;
        mountComponent.unmountAll();
        vi.restoreAllMocks();
    });

    it('should hand the scene the repeat with one resolved mesh copy per record, and follow a record change', async () => {
        // Arrange
        const fake = fakeChunk();
        remove = fake.remove;
        const mounted = mountComponent('scene3d', crates(), { data: { crates: pair('#ff0000', '#00ff00') } });
        await settle();
        const before = repeatOf(fake.updates);

        // Act
        mounted.store.set('$.data.crates.1.at', [0, 2, 0]);
        await settle();

        // Assert
        expect(before?.kind).toBe('repeat3d');
        expect(before?.properties).not.toHaveProperty('records');
        expect(before?.children.map((copy) => [copy.kind, copy.key, copy.path])).toEqual([
            ['mesh', 'left', `${REPEAT}.rows.left`],
            ['mesh', 'right', `${REPEAT}.rows.right`]
        ]);
        expect(before?.children[0]?.properties).toMatchObject({ position: [-1.75, 0, 0], material: { color: '#ff0000' }, _label: 'Left', interactive: true, geometry: { kind: 'box' } });
        expect(repeatOf(fake.updates)?.children[1]?.properties.position).toEqual([0, 2, 0]);
    });

    it('should report a row geometry that differs between records once, naming it, and a missing record set not at all', async () => {
        // Arrange
        const fake = fakeChunk();
        remove = fake.remove;
        const spy = vi.spyOn(report, 'error');
        const row = { component: 'mesh', '<-geometry': '$row.shape', '<-position': '$row.at' };

        // Act
        const mixed = mountComponent('scene3d', crates(row), { data: { crates: [{ shape: { kind: 'box' } }, { shape: { kind: 'sphere' } }] } });
        await settle();
        mixed.store.set('$.data.crates.0.at', [1, 0, 0]);
        await settle();
        const empty = mountComponent('scene3d', { ...crates(), children: { crates: { component: 'repeat3d', row: crate } } });
        await settle();

        // Assert
        const draws = calls(spy, 'SUI-RUN-DRAW');
        expect(draws).toHaveLength(1);
        expect(draws[0]?.[0]).toContain('"geometry"');
        expect(draws[0]?.[1]).toEqual({ code: 'SUI-RUN-DRAW', path: REPEAT });
        expect(spy.mock.calls.filter((call) => (call[1] as { path?: string }).path?.startsWith('$.app.children.crates') && call !== draws[0])).toEqual([]);
        expect(repeatOf(fake.updates)?.children).toEqual([]);
        expect(empty.element.getAttribute('data-render')).toBe('ready');
    });
});

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

/** The pixels at the given points once the scene is `ready` after `act` (or after mounting), read in the frame's task */
function readyPixels(
    mounted: MountedComponent | (() => MountedComponent),
    points: readonly (readonly [number, number])[],
    act?: (mounted: MountedComponent) => void,
    timeout = 5000
): Promise<{ pixels: number[][]; mounted: MountedComponent }> {
    return new Promise((resolve, reject) => {
        const target = typeof mounted === 'function' ? mounted() : mounted;
        const timer = setTimeout(() => reject(new Error(`the scene is still ${target.element.getAttribute('data-render')}`)), timeout);
        let changed = act === undefined;
        const observer = new MutationObserver(() => {
            if (!changed || target.element.getAttribute('data-render') !== 'ready') return;
            observer.disconnect();
            clearTimeout(timer);
            resolve({ pixels: points.map(([fx, fy]) => pixelOf(target.element, fx, fy)), mounted: target });
        });
        observer.observe(target.element, { attributes: true, attributeFilter: ['data-render'] });
        if (act !== undefined) {
            act(target);
            changed = true;
        }
    });
}

function expectColor(actual: readonly number[], expected: readonly number[]): void {
    expected.forEach((value, channel) => {
        expect(Math.abs((actual[channel] ?? 0) - value), `channel ${channel} of [${actual.join(', ')}], expected [${expected.join(', ')}]`).toBeLessThanOrEqual(TOLERANCE);
    });
}

describe.skipIf(script === '')('scene3d repeat3d with the real 3D renderer chunk (G3.6) in Chromium', () => {
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

    const answer = (): void => {
        const listener = (event: Event): void => {
            (event as CustomEvent<{ respond: (result: Promise<unknown>) => void }>).detail.respond(Promise.resolve(chunk));
        };
        document.addEventListener('ui-load-3d', listener);
        remove = () => document.removeEventListener('ui-load-3d', listener);
    };

    it('should draw a colour per record, seen at two known pixels, and recolour one record', async () => {
        // Arrange
        answer();
        const spy = vi.spyOn(report, 'error');
        const points = [
            [0.25, 0.5],
            [0.75, 0.5]
        ] as const;

        // Act
        const first = await readyPixels(() => mountComponent('scene3d', crates(), { data: { crates: pair('#ff0000', '#00ff00') } }), points);
        const recoloured = await readyPixels(first.mounted, points, (target) => target.store.set('$.data.crates.0.paint.color', '#00ff00'));

        // Assert
        expectColor(first.pixels[0] ?? [], LIT_RED);
        expectColor(first.pixels[1] ?? [], LIT_GREEN);
        expectColor(recoloured.pixels[0] ?? [], LIT_GREEN);
        expect(spy).not.toHaveBeenCalled();
    });

    it('should draw nothing for an empty record set and leave no stale instance when the last record goes', async () => {
        // Arrange
        answer();
        const spy = vi.spyOn(report, 'error');
        const points = [[0.5, 0.5]] as const;
        const one = [{ id: 'only', at: [0, 0, 0], paint: { color: '#ff0000' }, name: 'Only' }];

        // Act
        const empty = await readyPixels(() => mountComponent('scene3d', crates(), { data: { crates: [] } }), points);
        const drawn = await readyPixels(empty.mounted, points, (target) => target.store.set('$.data.crates', one));
        const gone = await readyPixels(empty.mounted, points, (target) => target.store.set('$.data.crates', []));

        // Assert
        expectColor(empty.pixels[0] ?? [], [0, 0, 0]);
        expectColor(drawn.pixels[0] ?? [], LIT_RED);
        expectColor(gone.pixels[0] ?? [], [0, 0, 0]);
        expect(spy).not.toHaveBeenCalled();
    });

    it('should be ready with 10,000 instances within the 10 s render timeout, and log the time', async () => {
        // Arrange: a 100 by 100 grid with no camera node, framed by the default camera. The records are small: the data
        // branch of a document is limited to 512 KiB (SUI-DOC-LIMIT-DATA)
        answer();
        const records = Array.from({ length: 10_000 }, (_, index) => ({ at: [index % 100, Math.floor(index / 100), 0] }));
        const scene = crates({ component: 'mesh', geometry: { kind: 'box', width: 0.8, height: 0.8, depth: 0.8 }, material: { color: '#ff0000' }, '<-position': '$row.at' });
        const { eye: _eye, ...children } = scene.children as Record<string, unknown>;
        const started = performance.now();

        // Act
        const { mounted } = await readyPixels(() => mountComponent('scene3d', { ...scene, children }, { data: { crates: records } }), [[0.5, 0.5]], undefined, RENDER_TIMEOUT);
        const elapsed = performance.now() - started;

        // Assert
        console.info(`scene3d: 10,000 repeat3d instances ready in ${elapsed.toFixed(0)} ms`);
        expect(elapsed).toBeLessThan(RENDER_TIMEOUT);
        expect(mounted.element.hasAttribute('data-fallback')).toBe(false);
    });
});
