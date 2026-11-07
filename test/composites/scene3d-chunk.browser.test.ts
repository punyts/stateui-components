import { report } from '@punyts/core';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';
import { isScene3dChunk } from '../../src/shared/scene3d/load.js';
import type { Scene3dChunk } from '../../src/shared/scene3d/load.js';

/** The owner's tolerance for pixels drawn by software WebGL: 12 per channel */
const TOLERANCE = 12;
/** The built chunk of `../stateui-3d` (test/globalSetup.ts); empty when the workspace has not built it */
const script = inject('chunk3dScript');

const LIT_RED = [252, 27, 27];
const LIT_GREEN = [27, 252, 27];

/** Answers `ui-load-3d` with the real chunk's global, as the runtime's `load3d` hook does */
function answerWith(chunk: unknown): () => void {
    const listener = (event: Event): void => {
        (event as CustomEvent<{ respond: (result: Promise<unknown>) => void }>).detail.respond(Promise.resolve(chunk));
    };
    document.addEventListener('ui-load-3d', listener);
    return () => document.removeEventListener('ui-load-3d', listener);
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
 * Waits for `data-render="ready"` and reads the centre and a corner pixel at that moment: in the same task as the frame,
 * since the drawing buffer is not kept once the frame is shown. `act` makes the change that is waited for
 */
function readyPixels(mounted: MountedComponent | (() => MountedComponent), act?: (mounted: MountedComponent) => void): Promise<{ centre: number[]; corner: number[]; mounted: MountedComponent }> {
    return new Promise((resolve, reject) => {
        const target = typeof mounted === 'function' ? mounted() : mounted;
        const timer = setTimeout(() => reject(new Error(`the scene is still ${target.element.getAttribute('data-render')}`)), 5000);
        let changed = act === undefined;
        const observer = new MutationObserver(() => {
            if (!changed || target.element.getAttribute('data-render') !== 'ready') return;
            observer.disconnect();
            clearTimeout(timer);
            resolve({ centre: pixelOf(target.element, 0.5, 0.5), corner: pixelOf(target.element, 0.02, 0.02), mounted: target });
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

/** The channels of a CSS colour, drawn on a 2D canvas */
function rgbOf(css: string): number[] {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) throw new Error('No 2D canvas');
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
}

const scene = (color: string, own: Record<string, unknown> = {}): Record<string, unknown> => ({
    background: '#0000ff',
    environment: 'none',
    ...own,
    children: {
        eye: { component: 'camera', position: [0, 0, 5], target: [0, 0, 0] },
        sun: { component: 'light', kind: 'directional', position: [0, 0, 10], target: [0, 0, 0] },
        box: { component: 'mesh', geometry: { kind: 'box' }, material: { color } }
    }
});

describe.skipIf(script === '')('scene3d with the real 3D renderer chunk (G3.5) in Chromium', () => {
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

    it('should draw a lit mesh on the background and be ready after the first frame', async () => {
        // Arrange
        remove = answerWith(chunk);
        const spy = vi.spyOn(report, 'error');

        // Act
        const { centre, corner, mounted } = await readyPixels(() => mountComponent('scene3d', scene('#ff0000')));

        // Assert
        expectColor(centre, LIT_RED);
        expectColor(corner, [0, 0, 255]);
        expect(mounted.element.hasAttribute('data-fallback')).toBe(false);
        expect(spy).not.toHaveBeenCalled();
    });

    it('should redraw when a node property changes, and clear the node when it is removed', async () => {
        // Arrange
        remove = answerWith(chunk);
        const { mounted } = await readyPixels(() => mountComponent('scene3d', scene('#ff0000')));

        // Act
        const green = await readyPixels(mounted, (target) => target.store.set('$.app.children.box.material.color', '#00ff00'));
        const gone = await readyPixels(mounted, (target) => target.store.delete('$.app.children.box' as never));

        // Assert
        expectColor(green.centre, LIT_GREEN);
        expectColor(gone.centre, [0, 0, 255]);
    });

    it('should redraw when the scene background changes, and use the scene3d.background token when unset', async () => {
        // Arrange
        remove = answerWith(chunk);
        const { mounted } = await readyPixels(() => mountComponent('scene3d', scene('#ff0000')));

        // Act
        const changed = await readyPixels(mounted, (target) => target.store.set('$.app.background', '#00ff00'));
        const unset = await readyPixels(mounted, (target) => target.store.set('$.app.background', ''));

        // Assert
        const box = mounted.element.shadowRoot?.querySelector('.scene') as HTMLElement;
        expectColor(changed.corner, [0, 255, 0]);
        expectColor(unset.corner, rgbOf(getComputedStyle(box).backgroundColor));
    });

    it('should recolour the background and a token-coloured light on a dark mode switch, with no state write (G3.5b)', async () => {
        // Arrange: no background (the scene3d.background token), and a white box lit by an ambient light of the accent colour
        remove = answerWith(chunk);
        const own = (accent: string) => ({
            children: {
                eye: { component: 'camera', position: [0, 0, 5], target: [0, 0, 0] },
                fill: { component: 'light', kind: 'ambient', color: accent },
                box: { component: 'mesh', geometry: { kind: 'box' }, material: { color: '#ffffff' } }
            }
        });
        const { mounted, corner, centre } = await readyPixels(() => mountComponent('scene3d', { ...own('{color.accent.base}'), environment: 'none' }));
        const box = mounted.element.shadowRoot?.querySelector('.scene') as HTMLElement;
        const light = { background: rgbOf(getComputedStyle(box).backgroundColor), accent: rgbOf(getComputedStyle(mounted.element).getPropertyValue('--ui-color-accent-base').trim()) };
        const writes = vi.fn();
        mounted.store.on(['$.app', '$.app.$all'], writes);

        // Act
        const dark = await readyPixels(mounted, (target) => target.setTheme('mode', 'dark'));

        // Assert: the drawn colours are the dark theme's, and the scene's state was not written
        const darkBackground = rgbOf(getComputedStyle(box).backgroundColor);
        const darkAccent = rgbOf(getComputedStyle(mounted.element).getPropertyValue('--ui-color-accent-base').trim());
        expect(darkBackground).not.toEqual(light.background);
        expectColor(corner, light.background);
        expectColor(dark.corner, darkBackground);
        expectColor(centre, light.accent);
        expectColor(dark.centre, darkAccent);
        expect(writes).not.toHaveBeenCalled();
        mounted.store.off(['$.app', '$.app.$all'], writes);
    });

    it('should light the same mesh differently with each environment preset (G3.5b)', async () => {
        // Arrange
        remove = answerWith(chunk);
        const { mounted, centre } = await readyPixels(() => mountComponent('scene3d', { ...scene('#808080'), children: { box: { component: 'mesh', material: { color: '#808080' } } }, environment: 'none' }));

        // Act
        const centres = [centre];
        for (const environment of ['studio', 'daylight', 'neutral']) {
            centres.push((await readyPixels(mounted, (target) => target.store.set('$.app.environment', environment))).centre);
        }

        // Assert: none leaves the unlit box black; every pair differs
        expectColor(centres[0] ?? [], [0, 0, 0]);
        for (const [i, a] of centres.entries()) {
            for (const b of centres.slice(i + 1)) expect(a.slice(0, 3).some((value, channel) => Math.abs(value - (b[channel] ?? 0)) > TOLERANCE), `${a} and ${b}`).toBe(true);
        }
    });

    it('should be pending from a lost context until it is restored, and draw the same picture again (G3.5b)', async () => {
        // Arrange
        remove = answerWith(chunk);
        const { mounted, centre } = await readyPixels(() => mountComponent('scene3d', scene('#ff0000')));
        const canvas = mounted.element.shadowRoot?.querySelector('.surface canvas') as HTMLCanvasElement;
        const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
        if (!extension) throw new Error('No WEBGL_lose_context');
        let whileLost: string | null = null;

        // Act: restore a task after the loss (Chromium allows it only once the loss event is dispatched)
        const restored = await readyPixels(mounted, () => {
            canvas.addEventListener('webglcontextlost', () => setTimeout(() => {
                whileLost = mounted.element.getAttribute('data-render');
                extension.restoreContext();
            }, 20), { once: true });
            extension.loseContext();
        });

        // Assert
        expect(whileLost).toBe('pending');
        expectColor(centre, LIT_RED);
        expectColor(restored.centre, LIT_RED);
        expect(mounted.element.hasAttribute('data-fallback')).toBe(false);
    });

    it('should resolve a token colour of a mesh from the theme', async () => {
        // Arrange
        remove = answerWith(chunk);

        // Act
        const { centre, mounted } = await readyPixels(() => mountComponent('scene3d', scene('{color.accent.base}')));

        // Assert: the accent colour, lit head-on, is brighter than black and not the default white
        const accent = rgbOf(getComputedStyle(mounted.element).getPropertyValue('--ui-color-accent-base').trim());
        expect(accent).not.toEqual([255, 255, 255]);
        const brightest = accent.indexOf(Math.max(...accent));
        expect(centre[brightest]).toBeGreaterThan(100);
        expect(centre.slice(0, 3)).not.toEqual([255, 255, 255]);
    });
});
