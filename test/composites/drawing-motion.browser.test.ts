import { report } from '@punyts/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent, MountOptions, NodeState } from '../harness/createMountComponent.js';

const ROOT = '$.app.children';

/** The drawings are 200 by 100 CSS pixels with a 100 by 50 `viewBox`, so a drawing unit is two pixels */
const SCALE = 2;
const VIEW_BOX = { x: 0, y: 0, width: 100, height: 50 };

/** A transition long enough to be seen part way through in a few frames */
const DURATION = 600;

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Waits until the drawing says it is drawn (`data-render="ready"`), at most `frames` frames */
async function drawn(mounted: MountedComponent, frames = 50): Promise<void> {
    await Promise.resolve();
    for (let at = 0; at < frames; at += 1) {
        if (mounted.element.getAttribute('data-render') === 'ready') return;
        await frame();
    }
    throw new Error(`the drawing is still ${mounted.element.getAttribute('data-render')}`);
}

type Renderer = 'svg' | 'canvas';

/** Mounts a drawing at 200 by 100 CSS pixels on a renderer and waits until it is drawn */
async function mountDrawing(renderer: Renderer, node: NodeState, options: MountOptions = {}): Promise<MountedComponent> {
    const mounted = mountComponent('drawing', { renderer, viewBox: VIEW_BOX, ...node }, options);
    mounted.host.style.width = '200px';
    (mounted.element as HTMLElement).style.setProperty('--ui-drawing-height', '100px');
    await drawn(mounted);
    return mounted;
}

/** An interactive dot (so canvas gives it a proxy placed over its bounds) at `cx` with a linear-ish transition */
const dot = (cx: number, transition: Record<string, unknown> | undefined = { duration: DURATION, easing: 'standard' }): NodeState => ({
    component: 'circle',
    cx,
    cy: 25,
    r: 5,
    interactive: true,
    _label: 'Dot',
    ...(transition === undefined ? {} : { transition })
});

/**
 * The `cx` on screen in drawing units: the SVG element's attribute, or for canvas the centre of the proxy button the
 * renderer places over the shape's bounds in every frame it draws
 */
function cxOf(mounted: MountedComponent, renderer: Renderer): number {
    const element = mounted.element.shadowRoot?.querySelector<HTMLElement>(`[data-shape-path="${ROOT}.a"]`);
    if (!element) throw new Error('no element for the dot');
    if (renderer === 'svg') return Number(element.getAttribute('cx'));
    return (Number.parseFloat(element.style.left) + Number.parseFloat(element.style.width) / 2) / SCALE;
}

/** Counts the animation frames asked for from now on, still asking for them */
function countFrames(): { count(): number } {
    let count = 0;
    const original = window.requestAnimationFrame.bind(window);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        count += 1;
        return original(callback);
    });
    return { count: () => count };
}

/** Waits for a time with timers, not frames, so nothing asks for a frame while it waits */
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

for (const renderer of ['svg', 'canvas'] as const) {
    describe(`drawing motion with the ${renderer} renderer in Chromium`, () => {
        beforeEach(() => {
            vi.spyOn(report, 'error').mockImplementation(() => undefined);
        });

        afterEach(() => {
            mountComponent.unmountAll();
            vi.restoreAllMocks();
        });

        it('should tween a cx over time when it changes, staying pending until it has arrived', async () => {
            // Arrange
            const mounted = await mountDrawing(renderer, { children: { a: dot(10) } });
            const start = cxOf(mounted, renderer);

            // Act
            mounted.store.set(`${ROOT}.a.cx`, 90);
            const seen: number[] = [];
            for (let at = 0; at < 6; at += 1) {
                await frame();
                seen.push(cxOf(mounted, renderer));
            }
            const pending = mounted.element.getAttribute('data-render');
            await drawn(mounted, 120);

            // Assert: it left 10, moved forward without jumping to 90, and arrived at 90
            expect(start).toBeCloseTo(10, 1);
            const between = seen.filter((value) => value > 10.5 && value < 89.5);
            expect(between.length).toBeGreaterThan(0);
            for (let at = 1; at < seen.length; at += 1) expect(seen[at]!).toBeGreaterThanOrEqual(seen[at - 1]! - 1e-6);
            expect(pending).toBe('pending');
            expect(cxOf(mounted, renderer)).toBeCloseTo(90, 1);
        });

        it('should start a new value mid-tween from where the shape is', async () => {
            // Arrange
            const mounted = await mountDrawing(renderer, { children: { a: dot(10) } });
            mounted.store.set(`${ROOT}.a.cx`, 90);
            for (let at = 0; at < 6; at += 1) await frame();
            const midway = cxOf(mounted, renderer);

            // Act: back to 10
            mounted.store.set(`${ROOT}.a.cx`, 10);
            await frame();
            await frame();
            const after = cxOf(mounted, renderer);
            await drawn(mounted, 120);

            // Assert: no jump to either end, then home
            expect(midway).toBeGreaterThan(10.5);
            expect(after).toBeGreaterThan(10.5);
            expect(after).toBeLessThanOrEqual(midway + 1e-6);
            expect(cxOf(mounted, renderer)).toBeCloseTo(10, 1);
        });

        it('should jump a shape without transition', async () => {
            // Arrange
            const mounted = await mountDrawing(renderer, { children: { a: dot(10, undefined) } });

            // Act
            mounted.store.set(`${ROOT}.a.cx`, 90);
            await drawn(mounted);

            // Assert
            expect(cxOf(mounted, renderer)).toBeCloseTo(90, 1);
        });

        it('should jump with the reduced motion overlay, mounted with it or switched to it later', async () => {
            // Arrange
            const reducedAtMount = await mountDrawing(renderer, { children: { a: dot(10) } }, { motion: 'reduced' });
            const switched = await mountDrawing(renderer, { children: { a: dot(10) } });

            // Act
            switched.setTheme('motion', 'reduced');
            await drawn(switched);
            for (const mounted of [reducedAtMount, switched]) mounted.store.set(`${ROOT}.a.cx`, 90);
            await Promise.resolve();
            await frame();
            await frame();

            // Assert: on screen at the new value after the first frame, and ready
            for (const mounted of [reducedAtMount, switched]) {
                expect(cxOf(mounted, renderer)).toBeCloseTo(90, 1);
                expect(mounted.element.getAttribute('data-render')).toBe('ready');
            }
        });

        it('should tween again once the full motion overlay is back', async () => {
            // Arrange
            const mounted = await mountDrawing(renderer, { children: { a: dot(10) } }, { motion: 'reduced' });
            mounted.setTheme('motion', 'full');
            await drawn(mounted);

            // Act
            mounted.store.set(`${ROOT}.a.cx`, 90);
            await frame();
            await frame();
            await frame();

            // Assert
            expect(cxOf(mounted, renderer)).toBeLessThan(89.5);
            await drawn(mounted, 120);
            expect(cxOf(mounted, renderer)).toBeCloseTo(90, 1);
        });

        it('should ask for no animation frame while the drawing is at rest, a transition included', async () => {
            // Arrange
            const mounted = await mountDrawing(renderer, { children: { a: dot(10), b: { component: 'rect', x: 50, y: 10, width: 20, height: 20, fill: '#336699', transition: { duration: 200 } } } });
            mounted.store.set(`${ROOT}.a.cx`, 30);
            await drawn(mounted, 120);
            const frames = countFrames();

            // Act
            await wait(150);

            // Assert
            expect(frames.count()).toBe(0);
        });

        it('should show a dragged shape with transition where it was dropped, not tween it back and forth', async () => {
            // Arrange
            const node = { component: 'rect', x: 10, y: 10, width: 20, height: 10, interactive: true, draggable: 'both', _label: 'Seat', transition: { duration: DURATION } };
            const mounted = await mountDrawing(renderer, { children: { a: node } });
            const root = mounted.element.shadowRoot!;
            const target = renderer === 'svg' ? root.querySelector(`svg [data-shape-path="${ROOT}.a"]`)! : root.querySelector('.surface > canvas')!;
            const box = (root.querySelector('.surface') as HTMLElement).getBoundingClientRect();
            const pointer = (type: string, x: number, y: number): void => {
                const init = { bubbles: true, composed: true, cancelable: true, clientX: box.left + x * SCALE, clientY: box.top + y * SCALE, pointerId: 7, button: 0, buttons: 1, pointerType: 'mouse', isPrimary: true };
                target.dispatchEvent(new PointerEvent(type, init));
            };
            const xOnScreen = (): number => {
                const element = root.querySelector<HTMLElement>(`[data-shape-path="${ROOT}.a"]`)!;
                return renderer === 'svg' ? Number(element.getAttribute('x')) : Number.parseFloat(element.style.left) / SCALE;
            };

            // Act: drag the seat by 40 units to the right and release
            pointer('pointerdown', 20, 15);
            pointer('pointermove', 40, 15);
            pointer('pointermove', 60, 15);
            await frame();
            await frame();
            pointer('pointerup', 60, 15);
            await Promise.resolve();
            await frame();
            const afterRelease = xOnScreen();

            // Assert: written once, shown at the drop at once, and nothing left to tween
            expect(mounted.store.get(`${ROOT}.a.x`)).toBe(50);
            expect(afterRelease).toBeCloseTo(50, 1);
            await drawn(mounted);
            expect(xOnScreen()).toBeCloseTo(50, 1);
        });

        it('should tween a fill colour', async () => {
            // Arrange
            const mounted = await mountDrawing(renderer, { children: { a: { ...dot(50), fill: '#000000' } } });

            // Act
            mounted.store.set(`${ROOT}.a.fill`, '#ff0000');
            for (let at = 0; at < 6; at += 1) await frame();
            const midway = renderer === 'svg' ? mounted.element.shadowRoot!.querySelector(`[data-shape-path="${ROOT}.a"]`)!.getAttribute('fill') : 'n/a';
            await drawn(mounted, 120);

            // Assert: SVG shows an in-between rgba() literal, then the value written; canvas ends on red at the dot's centre
            if (renderer === 'svg') {
                expect(midway).toMatch(/^rgba\(\d+, 0, 0, 1\)$/);
                expect(mounted.element.shadowRoot!.querySelector(`[data-shape-path="${ROOT}.a"]`)!.getAttribute('fill')).toBe('#ff0000');
            } else {
                const canvas = mounted.element.shadowRoot!.querySelector('canvas')!;
                const ratio = canvas.width / 200;
                const [r, g, b] = canvas.getContext('2d')!.getImageData(Math.round(100 * ratio), Math.round(50 * ratio), 1, 1).data;
                expect([r, g, b]).toEqual([255, 0, 0]);
            }
        });
    });
}
