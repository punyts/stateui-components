import { report } from '@punyts/core';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';
import { isScene3dChunk } from '../../src/shared/scene3d/load.js';
import type { Scene3dChunk } from '../../src/shared/scene3d/load.js';

/*
 * `label3d` through the real 3D renderer chunk (G3.6b of the graphics epic 3): the label's text is drawn in the theme's
 * text colour when it sets none, and a dark mode switch recolours it with no state write.
 */

/** The owner's tolerance for pixels drawn by software WebGL: 12 per channel */
const TOLERANCE = 12;
/** The built chunk of `../stateui-3d` (test/globalSetup.ts); empty when the workspace has not built it */
const script = inject('chunk3dScript');
/** A mid grey background, on which both the light and the dark theme's text colour show */
const GREY = '#808080';

/** Answers `ui-load-3d` with the real chunk's global, as the runtime's `load3d` hook does */
function answerWith(chunk: unknown): () => void {
    const listener = (event: Event): void => {
        (event as CustomEvent<{ respond: (result: Promise<unknown>) => void }>).detail.respond(Promise.resolve(chunk));
    };
    document.addEventListener('ui-load-3d', listener);
    return () => document.removeEventListener('ui-load-3d', listener);
}

/** The channels of a CSS colour, drawn on a 2D canvas */
function rgbOf(css: string): number[] {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) throw new Error('No 2D canvas');
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
}

/** The number of pixels of the scene's canvas within the tolerance of a colour, read in the task of the frame */
function countOf(element: Element, colour: readonly number[]): number {
    const canvas = element.shadowRoot?.querySelector('.surface canvas') as HTMLCanvasElement | null;
    const gl = canvas?.getContext('webgl2');
    if (!canvas || !gl) throw new Error('No WebGL canvas in the scene');
    const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
    let found = 0;
    for (let at = 0; at < data.length; at += 4) {
        if (colour.every((value, channel) => Math.abs((data[at + channel] ?? 0) - value) <= TOLERANCE)) found += 1;
    }
    return found;
}

/**
 * Waits for `data-render="ready"` and counts the pixels of each colour `colours` gives at that moment (the drawing
 * buffer is not kept after the frame). `act` makes the change that is waited for
 */
function readyCounts(
    mounted: MountedComponent | (() => MountedComponent),
    colours: (mounted: MountedComponent) => Record<string, readonly number[]>,
    act?: (mounted: MountedComponent) => void
): Promise<{ counts: Record<string, number>; mounted: MountedComponent }> {
    return new Promise((resolve, reject) => {
        const target = typeof mounted === 'function' ? mounted() : mounted;
        const timer = setTimeout(() => reject(new Error(`the scene is still ${target.element.getAttribute('data-render')}`)), 5000);
        let changed = act === undefined;
        const observer = new MutationObserver(() => {
            if (!changed || target.element.getAttribute('data-render') !== 'ready') return;
            observer.disconnect();
            clearTimeout(timer);
            const counts: Record<string, number> = {};
            for (const [name, colour] of Object.entries(colours(target))) counts[name] = countOf(target.element, colour);
            resolve({ counts, mounted: target });
        });
        observer.observe(target.element, { attributes: true, attributeFilter: ['data-render'] });
        if (act !== undefined) {
            act(target);
            changed = true;
        }
    });
}

/** The theme's text colour on the element, as channels */
const textColour = (mounted: MountedComponent): number[] => rgbOf(getComputedStyle(mounted.element).getPropertyValue('--ui-color-text-base').trim());

describe.skipIf(script === '')('scene3d label3d with the real 3D renderer chunk (G3.6b) in Chromium', () => {
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

    const scene = (label: Record<string, unknown>): Record<string, unknown> => ({
        background: GREY,
        environment: 'none',
        children: {
            eye: { component: 'camera', position: [0, 0, 5], target: [0, 0, 0] },
            tag: { component: 'label3d', fontSize: 1, ...label }
        }
    });

    it('should draw the text in the theme text colour, and recolour it on a dark mode switch with no state write', async () => {
        // Arrange
        remove = answerWith(chunk);
        const spy = vi.spyOn(report, 'error');
        const { counts: light, mounted } = await readyCounts(() => mountComponent('scene3d', scene({ _text: 'WWWW' })), (target) => ({ text: textColour(target) }));
        const lightText = textColour(mounted);
        const writes = vi.fn();
        mounted.store.on(['$.app', '$.app.$all'], writes);

        // Act
        const { counts: dark } = await readyCounts(mounted, () => ({ light: lightText, dark: textColour(mounted) }), (target) => target.setTheme('mode', 'dark'));

        // Assert: the dark text colour differs from the light one, and is what the label shows now
        expect(textColour(mounted)).not.toEqual(lightText);
        expect(light.text).toBeGreaterThan(100);
        expect(dark.dark).toBeGreaterThan(light.text * 0.5);
        expect(dark.light).toBeLessThan(light.text * 0.1);
        expect(writes).not.toHaveBeenCalled();
        expect(spy).not.toHaveBeenCalled();
        mounted.store.off(['$.app', '$.app.$all'], writes);
    });

    it('should draw a label in its own colour, a new text when _text changes, and nothing for an empty _text', async () => {
        // Arrange
        remove = answerWith(chunk);
        const spy = vi.spyOn(report, 'error');
        const red = { red: [255, 0, 0] };
        const { counts: short, mounted } = await readyCounts(() => mountComponent('scene3d', scene({ _text: 'I', color: '#ff0000' })), () => red);

        // Act
        const { counts: long } = await readyCounts(mounted, () => red, (target) => target.store.set('$.app.children.tag._text', 'WWWW'));
        const { counts: empty } = await readyCounts(mounted, () => red, (target) => target.store.set('$.app.children.tag._text', ''));

        // Assert
        expect(short.red).toBeGreaterThan(10);
        expect(long.red).toBeGreaterThan(short.red * 3);
        expect(empty.red).toBe(0);
        expect(spy).not.toHaveBeenCalled();
    });
});
