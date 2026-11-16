import { report } from '@punyts/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../src/shared/drawing/canvasRenderer.js';
import '../../src/shared/drawing/svgRenderer.js';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent, MountOptions } from '../harness/createMountComponent.js';

// G2.4b of the graphics epic 2: the chart's `transition` tweens its marks when the records change, in SVG and canvas

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Waits for a time with timers, not frames, so nothing asks for a frame while it waits */
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until the chart says its drawing is on screen (`data-render="ready"`), at most `limit` frames */
async function ready(mounted: MountedComponent, limit = 120): Promise<void> {
    await wait(0);
    for (let at = 0; at < limit; at += 1) {
        if (mounted.element.getAttribute('data-render') === 'ready') return;
        await frame();
    }
    throw new Error(`the chart is still ${mounted.element.getAttribute('data-render')}`);
}

type Renderer = 'svg' | 'canvas';

const SALES = [
    { month: 'Jan', revenue: 1000, cost: 400 },
    { month: 'Feb', revenue: 2000, cost: 900 },
    { month: 'Mar', revenue: 3000, cost: 1200 }
];
const SERIES = { revenue: { field: 'revenue', _label: 'Revenue' }, cost: { field: 'cost', _label: 'Cost' } };

/** Long enough to be seen part way through in a few frames */
const TRANSITION = { duration: 600, easing: 'standard' };

async function mountChart(renderer: Renderer, extra: Record<string, unknown> = {}, options: MountOptions = {}): Promise<MountedComponent> {
    const mounted = mountComponent(
        'chart',
        { renderer, x: 'month', series: SERIES, '<-records': '$.data.sales', _title: 'Sales', ...extra },
        { data: { sales: SALES.map((row) => ({ ...row })) }, ...options }
    );
    (mounted.element as HTMLElement).style.inlineSize = '480px';
    (mounted.element as HTMLElement).style.display = 'block';
    await ready(mounted);
    return mounted;
}

/** The mark of a point: the SVG element, or on canvas the proxy button the renderer places over it in every frame it paints */
function markOf(mounted: MountedComponent, renderer: Renderer, id: string): Element {
    const selector = renderer === 'svg' ? `.plot > svg [data-point="${id}"]` : `.proxies > button[data-point="${id}"]`;
    const found = mounted.element.shadowRoot?.querySelector(selector);
    if (!found) throw new Error(`no mark ${id}`);
    return found;
}

/** A bar's height: the rect's attribute in drawing units, or its proxy's height in CSS pixels */
const heightOf = (mounted: MountedComponent, renderer: Renderer, id: string): number => {
    const mark = markOf(mounted, renderer, id);
    return renderer === 'svg' ? Number(mark.getAttribute('height')) : Number.parseFloat((mark as HTMLElement).style.height);
};

/** A point's centre height: the circle's `cy`, or the middle of its proxy */
const cyOf = (mounted: MountedComponent, renderer: Renderer, id: string): number => {
    const mark = markOf(mounted, renderer, id);
    if (renderer === 'svg') return Number(mark.getAttribute('cy'));
    const style = (mark as HTMLElement).style;
    return Number.parseFloat(style.top) + Number.parseFloat(style.height) / 2;
};

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

/** The values of a measure over a number of frames */
async function over(frames: number, measure: () => number): Promise<number[]> {
    const seen: number[] = [];
    for (let at = 0; at < frames; at += 1) {
        await frame();
        seen.push(measure());
    }
    return seen;
}

const isBetween = (value: number, a: number, b: number): boolean => value > Math.min(a, b) + 0.5 && value < Math.max(a, b) - 0.5;

for (const renderer of ['svg', 'canvas'] as const) {
    describe(`chart transition with the ${renderer} renderer in Chromium`, () => {
        beforeEach(() => {
            vi.spyOn(report, 'error').mockImplementation(() => undefined);
        });

        afterEach(() => {
            mountComponent.unmountAll();
            vi.restoreAllMocks();
        });

        it('should tween a bar between its old and new height when the records change, pending until it has arrived', async () => {
            // Arrange
            const mounted = await mountChart(renderer, { transition: TRANSITION });
            const id = 'bar:revenue:0';
            const before = heightOf(mounted, renderer, id);

            // Act
            mounted.store.set('$.data.sales.0.revenue', 2800 as never);
            const seen = await over(6, () => heightOf(mounted, renderer, id));
            const pending = mounted.element.getAttribute('data-render');
            await ready(mounted);
            const after = heightOf(mounted, renderer, id);

            // Assert: it grew without jumping to the end, never shrinking, and arrived
            expect(after).toBeGreaterThan(before + 10);
            expect(seen.some((value) => isBetween(value, before, after))).toBe(true);
            for (let at = 1; at < seen.length; at += 1) expect(seen[at]!).toBeGreaterThanOrEqual(seen[at - 1]! - 1e-6);
            expect(pending).toBe('pending');
        });

        it('should tween a line point between its old and new place', async () => {
            // Arrange
            const mounted = await mountChart(renderer, { type: 'line', transition: TRANSITION });
            const id = 'dot:cost:2';
            const before = cyOf(mounted, renderer, id);

            // Act
            mounted.store.set('$.data.sales.2.cost', 2900 as never);
            const seen = await over(6, () => cyOf(mounted, renderer, id));
            await ready(mounted);
            const after = cyOf(mounted, renderer, id);

            // Assert
            expect(after).toBeLessThan(before - 10);
            expect(seen.some((value) => isBetween(value, before, after))).toBe(true);
        });

        it('should start a records change mid-tween from the current geometry and end at the new one', async () => {
            // Arrange
            const mounted = await mountChart(renderer, { transition: TRANSITION });
            const id = 'bar:revenue:0';
            const start = heightOf(mounted, renderer, id);
            mounted.store.set('$.data.sales.0.revenue', 3000 as never);
            await over(8, () => 0);
            const where = heightOf(mounted, renderer, id);

            // Act
            mounted.store.set('$.data.sales.0.revenue', 500 as never);
            await wait(0);
            const first = heightOf(mounted, renderer, id);
            await ready(mounted);
            const end = heightOf(mounted, renderer, id);

            // Assert: it was part way up, turned back from there (not from the start or the first target), and ended low
            expect(where).toBeGreaterThan(start + 1);
            expect(first).toBeCloseTo(where, 0);
            expect(end).toBeLessThan(start);
        });

        it('should redraw without a tween when the series, type or stacked change', async () => {
            // Arrange
            const mounted = await mountChart(renderer, { transition: TRANSITION });

            // Act: each change is drawn at once, in the same task as the change
            mounted.store.set('$.app.stacked', true as never);
            await wait(0);
            const stackedNow = heightOf(mounted, renderer, 'bar:cost:2');
            await ready(mounted);
            const stackedEnd = heightOf(mounted, renderer, 'bar:cost:2');

            mounted.store.set('$.app.series.cost', { field: 'revenue', _label: 'Cost' } as never);
            await wait(0);
            const seriesNow = heightOf(mounted, renderer, 'bar:cost:2');
            await ready(mounted);
            const seriesEnd = heightOf(mounted, renderer, 'bar:cost:2');

            mounted.store.set('$.app.type', 'line' as never);
            await wait(0);
            const typeNow = cyOf(mounted, renderer, 'dot:revenue:1');
            await ready(mounted);
            const typeEnd = cyOf(mounted, renderer, 'dot:revenue:1');

            // Assert
            expect(stackedNow).toBe(stackedEnd);
            expect(seriesNow).toBe(seriesEnd);
            expect(typeNow).toBe(typeEnd);
        });

        it('should jump with the reduced overlay, asking for no frame of its own, where full motion asks for many', async () => {
            // Arrange
            const full = await mountChart(renderer, { transition: TRANSITION });
            const reduced = await mountChart(renderer, { transition: TRANSITION }, { motion: 'reduced' });
            const id = 'bar:revenue:0';

            // Act
            const reducedFrames = countFrames();
            reduced.store.set('$.data.sales.0.revenue', 2800 as never);
            await wait(0);
            const reducedNow = heightOf(reduced, renderer, id);
            await wait(300);
            const reducedCount = reducedFrames.count();
            vi.mocked(window.requestAnimationFrame).mockRestore();

            const fullFrames = countFrames();
            full.store.set('$.data.sales.0.revenue', 2800 as never);
            await wait(300);
            const fullCount = fullFrames.count();
            await ready(full);

            // Assert: the new height at once and at most the one frame the renderer asks to say it is drawn (as without
            // transition), where the same change in full motion asks for a frame per step of its tween
            expect(reducedNow).toBe(heightOf(reduced, renderer, id));
            expect(reducedNow).toBe(heightOf(full, renderer, id));
            expect(reducedCount).toBeLessThanOrEqual(1);
            expect(fullCount).toBeGreaterThan(5);
            expect(reduced.element.getAttribute('data-render')).toBe('ready');
        });

        it('should stop a running tween at its end when the reduced overlay is switched on', async () => {
            // Arrange
            const mounted = await mountChart(renderer, { transition: { duration: 5000, easing: 'standard' } });
            const id = 'bar:revenue:0';
            mounted.store.set('$.data.sales.0.revenue', 2800 as never);
            await over(4, () => 0);

            // Act
            mounted.setTheme('motion', 'reduced');
            await ready(mounted, 10);
            const end = heightOf(mounted, renderer, id);
            const frames = countFrames();
            await wait(200);
            const asked = frames.count();
            vi.mocked(window.requestAnimationFrame).mockRestore();

            // Assert: at the end, and nothing more is asked for
            const plain = await mountChart(renderer, {}, { data: { sales: SALES.map((row, at) => (at === 0 ? { ...row, revenue: 2800 } : { ...row })) } });
            expect(end).toBe(heightOf(plain, renderer, id));
            expect(asked).toBe(0);
        });

        it('should draw a chart without transition as before: the new geometry at once and no frames beyond the renderer\'s', async () => {
            // Arrange
            const mounted = await mountChart(renderer, { type: 'line' });
            const id = 'dot:revenue:1';
            const before = cyOf(mounted, renderer, id);

            // Act
            const frames = countFrames();
            mounted.store.set('$.data.sales.1.revenue', 100 as never);
            await wait(0);
            const now = cyOf(mounted, renderer, id);
            await wait(300);

            // Assert: one draw, one frame for the renderer to say it is on screen
            expect(now).toBeGreaterThan(before + 10);
            expect(cyOf(mounted, renderer, id)).toBe(now);
            expect(frames.count()).toBeLessThanOrEqual(1);
            expect(mounted.element.getAttribute('data-render')).toBe('ready');
        });
    });
}

describe('chart transition of a donut in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
        vi.restoreAllMocks();
    });

    it('should tween the arcs of the slices: part way the slice is neither the old nor the new one', async () => {
        // Arrange
        const mounted = await mountChart('svg', { type: 'donut', series: { revenue: SERIES.revenue }, transition: TRANSITION });
        const d = (): string => markOf(mounted, 'svg', 'slice:0').getAttribute('d') ?? '';
        const before = d();

        // Act
        mounted.store.set('$.data.sales.0.revenue', 6000 as never);
        const seen: string[] = [];
        for (let at = 0; at < 6; at += 1) {
            await frame();
            seen.push(d());
        }
        await ready(mounted);
        const after = d();

        // Assert
        expect(after).not.toBe(before);
        expect(seen.some((value) => value !== before && value !== after)).toBe(true);
    });
});
