import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';
import { parseDuration } from '../../src/shared/drawing/scheduler.js';
import { isScene3dChunk } from '../../src/shared/scene3d/load.js';
import type { Scene3dChunk } from '../../src/shared/scene3d/load.js';

// G3.9 of the graphics epic 3: `transition` of 3D nodes and the `reduced` motion overlay, with the real chunk

/** The owner's tolerance for pixels drawn by software WebGL: 12 per channel */
const TOLERANCE = 12;
/** The built chunk of `../stateui-3d` (test/globalSetup.ts); empty when the workspace has not built it */
const script = inject('chunk3dScript');

const RED = [255, 0, 0];
const BLUE = [0, 0, 255];

/** Answers `ui-load-3d` with the real chunk's global, as the runtime's `load3d` hook does */
function answerWith(chunk: unknown): () => void {
    const listener = (event: Event): void => {
        (event as CustomEvent<{ respond: (result: Promise<unknown>) => void }>).detail.respond(Promise.resolve(chunk));
    };
    document.addEventListener('ui-load-3d', listener);
    return () => document.removeEventListener('ui-load-3d', listener);
}

/** The colour at the centre of the scene's canvas, read in the task of the frame */
function centreOf(element: Element): number[] {
    const canvas = element.shadowRoot?.querySelector('.surface canvas') as HTMLCanvasElement | null;
    const gl = canvas?.getContext('webgl2');
    if (!canvas || !gl) throw new Error('No WebGL canvas in the scene');
    const pixel = new Uint8Array(4);
    gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return [...pixel];
}

/**
 * Makes the change `act` and waits for `data-render="ready"`: the centre pixel then (in the frame's task), how long it
 * took, and whether the element was `pending` on the way
 */
function readyAfter(mounted: MountedComponent, act: (mounted: MountedComponent) => void): Promise<{ centre: number[]; ms: number; pendingSeen: boolean }> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`the scene is still ${mounted.element.getAttribute('data-render')}`)), 8000);
        let pendingSeen = false;
        const began = performance.now();
        const observer = new MutationObserver(() => {
            const state = mounted.element.getAttribute('data-render');
            if (state === 'pending') pendingSeen = true;
            if (state !== 'ready' || !pendingSeen) return;
            observer.disconnect();
            clearTimeout(timer);
            resolve({ centre: centreOf(mounted.element), ms: performance.now() - began, pendingSeen });
        });
        observer.observe(mounted.element, { attributes: true, attributeFilter: ['data-render'] });
        act(mounted);
    });
}

/** Mounts a scene and waits until its first frame is on screen: the scene and its centre pixel then */
function mountReady(state: Record<string, unknown>, motion?: string): Promise<{ mounted: MountedComponent; centre: number[] }> {
    return new Promise((resolve, reject) => {
        const mounted = mountComponent('scene3d', state, motion === undefined ? undefined : { motion });
        const timer = setTimeout(() => reject(new Error(`the scene is still ${mounted.element.getAttribute('data-render')}`)), 8000);
        const observer = new MutationObserver(() => {
            if (mounted.element.getAttribute('data-render') !== 'ready') return;
            observer.disconnect();
            clearTimeout(timer);
            resolve({ mounted, centre: centreOf(mounted.element) });
        });
        observer.observe(mounted.element, { attributes: true, attributeFilter: ['data-render'] });
    });
}

function expectColor(actual: readonly number[], expected: readonly number[]): void {
    expected.forEach((value, channel) => {
        expect(Math.abs((actual[channel] ?? 0) - value), `channel ${channel} of [${actual.join(', ')}], expected [${expected.join(', ')}]`).toBeLessThanOrEqual(TOLERANCE);
    });
}

/** A red box at the centre, lit by an ambient light of intensity 1, on blue; it eases over `duration` ms */
const scene = (duration: number | string): Record<string, unknown> => ({
    background: '#0000ff',
    environment: 'none',
    children: {
        eye: { component: 'camera', position: [0, 0, 5], target: [0, 0, 0] },
        sun: { component: 'light', kind: 'ambient', intensity: 1 },
        box: { component: 'mesh', geometry: { kind: 'box' }, material: { color: '#ff0000' }, position: [0, 0, 0], transition: { duration } }
    }
});

/** Moves the box far to the right, out of view: the centre turns blue once it has gone */
const moveAway = (target: MountedComponent): void => {
    target.store.set('$.app.children.box.position', [50, 0, 0]);
};

describe.skipIf(script === '')('scene3d transition with the real 3D renderer chunk (G3.9) in Chromium', () => {
    let chunk: Scene3dChunk;
    let remove: (() => void) | undefined;

    beforeAll(() => {
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

    it("should ease a node to its new position over the theme's motion.duration.slow, pending until it arrives", async () => {
        // Arrange: the renderer reads the duration token from the theme (400 ms as shipped)
        remove = answerWith(chunk);
        const { mounted, centre: before } = await mountReady(scene('slow'));
        const slow = parseDuration(getComputedStyle(mounted.element).getPropertyValue('--ui-motion-duration-slow')) ?? 0;

        // Act
        const after = await readyAfter(mounted, moveAway);

        // Assert
        expectColor(before, RED);
        expectColor(after.centre, BLUE);
        expect(slow).toBeGreaterThan(0);
        expect(after.ms).toBeGreaterThanOrEqual(slow * 0.9);
    });

    it('should jump with the reduced motion overlay, read on mount', async () => {
        // Arrange
        remove = answerWith(chunk);
        const { mounted } = await mountReady(scene(5000), 'reduced');

        // Act
        const after = await readyAfter(mounted, moveAway);

        // Assert: ready in about a frame, not after 5 s
        expectColor(after.centre, BLUE);
        expect(after.ms).toBeLessThan(1000);
    });

    it('should end a running tween at its end when the motion overlay switches to reduced', async () => {
        // Arrange
        remove = answerWith(chunk);
        const { mounted } = await mountReady(scene(5000));

        // Act: the tween runs for 5 s; the overlay switch ends it
        const after = await readyAfter(mounted, (target) => {
            moveAway(target);
            setTimeout(() => target.setTheme('motion', 'reduced'), 100);
        });

        // Assert
        expectColor(after.centre, BLUE);
        expect(after.ms).toBeLessThan(2000);
    });
});
