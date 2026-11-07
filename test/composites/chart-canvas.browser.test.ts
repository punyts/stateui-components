import { report } from '@punyts/core';
import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/shared/drawing/canvasRenderer.js';
import '../../src/shared/drawing/svgRenderer.js';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent, MountOptions } from '../harness/createMountComponent.js';

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Waits until the chart says its drawing is on screen (`data-render="ready"`), at most `limit` frames */
async function ready(mounted: MountedComponent, limit = 120): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let at = 0; at < limit; at += 1) {
        if (mounted.element.getAttribute('data-render') === 'ready') return;
        await frame();
    }
    throw new Error(`the chart is still ${mounted.element.getAttribute('data-render')}`);
}

const SALES = [
    { month: 'Jan', revenue: 1000, cost: 400 },
    { month: 'Feb', revenue: 2000, cost: 900 },
    { month: 'Mar', revenue: 3000, cost: 1200 }
];
const SERIES = { revenue: { field: 'revenue', _label: 'Revenue' }, cost: { field: 'cost', _label: 'Cost' } };

const ON_PRESS = { press: [{ command: 'set', target: '$.data.ui.pressed', value: true }] };

const root = (mounted: MountedComponent): ShadowRoot => mounted.element.shadowRoot as ShadowRoot;
const all = <T extends Element>(mounted: MountedComponent, selector: string): T[] => Array.from(root(mounted).querySelectorAll<T>(selector));
const one = <T extends Element>(mounted: MountedComponent, selector: string): T => {
    const found = root(mounted).querySelector<T>(selector);
    if (!found) throw new Error(`no ${selector}`);
    return found;
};
const canvasOf = (mounted: MountedComponent): HTMLCanvasElement => one<HTMLCanvasElement>(mounted, '.plot > canvas');
const proxy = (mounted: MountedComponent, id: string): HTMLButtonElement => one<HTMLButtonElement>(mounted, `.proxies > button[data-point="${id}"]`);
const focused = (mounted: MountedComponent): string | null => root(mounted).activeElement?.getAttribute('data-point') ?? null;
const tip = (mounted: MountedComponent): HTMLElement => one<HTMLElement>(mounted, '.tip');
const tipOpen = (mounted: MountedComponent): boolean => tip(mounted).matches(':popover-open');
const tableRows = (mounted: MountedComponent): string[][] =>
    all<HTMLTableRowElement>(mounted, '.data tr').map((row) => Array.from(row.cells).map((cell) => cell.textContent ?? ''));

/** The centre of a mark in CSS pixels from the canvas's top left corner: the middle of its proxy's box */
function centreOf(mounted: MountedComponent, id: string): { x: number; y: number } {
    const style = proxy(mounted, id).style;
    return { x: parseFloat(style.left) + parseFloat(style.width) / 2, y: parseFloat(style.top) + parseFloat(style.height) / 2 };
}

/** The RGBA of the bitmap at a point in CSS pixels */
function pixel(mounted: MountedComponent, x: number, y: number): number[] {
    const canvas = canvasOf(mounted);
    const ratio = canvas.width / canvas.clientWidth;
    return Array.from(canvas.getContext('2d')!.getImageData(Math.floor(x * ratio), Math.floor(y * ratio), 1, 1).data);
}

/** The RGBA a theme token's colour paints, read from the canvas's computed style and painted on a canvas of its own */
function tokenColour(mounted: MountedComponent, name: string): number[] {
    const value = getComputedStyle(canvasOf(mounted)).getPropertyValue(name).trim();
    expect(value).not.toBe('');
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    const ctx = probe.getContext('2d')!;
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data);
}

const calls = (spy: { mock: { calls: unknown[][] } }, code: string): unknown[][] =>
    spy.mock.calls.filter((call) => (call[1] as { code?: string } | undefined)?.code === code);

interface Mounted extends MountedComponent {
    /** The `detail` of every `press` the chart raised, in order */
    readonly presses: unknown[];
}

async function mountChart(extra: Record<string, unknown> = {}, options: MountOptions = {}): Promise<Mounted> {
    const mounted = mountComponent(
        'chart',
        { renderer: 'canvas', x: 'month', series: SERIES, '<-records': '$.data.sales', _title: 'Sales', ...extra },
        { data: { sales: SALES.map((row) => ({ ...row })), ui: { pressed: false } }, ...options }
    );
    (mounted.element as HTMLElement).style.inlineSize = '480px';
    (mounted.element as HTMLElement).style.display = 'block';
    (mounted.element as HTMLElement).style.padding = '80px 20px 20px';
    const presses: unknown[] = [];
    mounted.element.addEventListener('press', (event) => presses.push(structuredClone((event as CustomEvent).detail)));
    await ready(mounted);
    return Object.assign(mounted, { presses });
}

describe('chart on canvas in Chromium', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        mountComponent.unmountAll();
    });

    it('should draw the bars on a canvas in their series token colours, with no svg', async () => {
        // Arrange and Act
        const mounted = await mountChart();

        // Assert
        expect(all(mounted, '.plot > svg')).toHaveLength(0);
        const revenue = centreOf(mounted, 'bar:revenue:2');
        const cost = centreOf(mounted, 'bar:cost:1');
        expect(pixel(mounted, revenue.x, revenue.y)).toEqual(tokenColour(mounted, '--ui-color-data-categorical-1'));
        expect(pixel(mounted, cost.x, cost.y)).toEqual(tokenColour(mounted, '--ui-color-data-categorical-2'));
        // Above the shortest bar there is no bar colour
        const box = proxy(mounted, 'bar:revenue:0').style;
        const shortest = centreOf(mounted, 'bar:revenue:0');
        expect(pixel(mounted, shortest.x, parseFloat(box.top) - 6)).not.toEqual(tokenColour(mounted, '--ui-color-data-categorical-1'));
        expect(mounted.element.getAttribute('data-render')).toBe('ready');
    });

    it('should give each mark a proxy named as the SVG mark, an image with one tab stop, in a group labelled by the title', async () => {
        // Arrange
        const svg = await mountChart({ renderer: 'svg' });
        const names = all<SVGElement>(svg, '[data-point]').map((mark) => [mark.getAttribute('data-point'), mark.getAttribute('aria-label')]);

        // Act
        const mounted = await mountChart();

        // Assert
        const proxies = all<HTMLButtonElement>(mounted, '.proxies > button');
        expect(proxies.map((each) => [each.getAttribute('data-point'), each.getAttribute('aria-label')])).toEqual(names);
        expect(new Set(proxies.map((each) => each.getAttribute('role')))).toEqual(new Set(['img']));
        expect(proxies.filter((each) => each.getAttribute('tabindex') === '0')).toHaveLength(1);
        expect(proxies.filter((each) => each.getAttribute('tabindex') === '-1')).toHaveLength(proxies.length - 1);
        const group = one(mounted, '.proxies');
        expect(group.getAttribute('role')).toBe('group');
        expect(group.getAttribute('aria-labelledby')).toBe('title');
        expect(canvasOf(mounted).getAttribute('aria-hidden')).toBe('true');
    });

    it('should show the tooltip of the bar under the pointer and hide it when the pointer leaves', async () => {
        // Arrange
        const mounted = await mountChart();
        const at = centreOf(mounted, 'bar:revenue:1');

        // Act
        await userEvent.hover(canvasOf(mounted), { position: at });
        await frame();

        // Assert
        expect(tipOpen(mounted)).toBe(true);
        expect(tip(mounted).querySelector('.tip-title')?.textContent).toBe('Feb');
        expect(tip(mounted).querySelector('.tip-row.current')?.textContent).toBe('Revenue2,000');

        // Act
        await userEvent.unhover(canvasOf(mounted));
        await frame();

        // Assert
        expect(tipOpen(mounted)).toBe(false);
    });

    it('should move focus across the proxies with the arrow keys and show the focused mark in the tooltip', async () => {
        // Arrange
        const mounted = await mountChart();
        const stop = one<HTMLButtonElement>(mounted, '.proxies > button[tabindex="0"]');

        // Act
        stop.focus();
        await userEvent.keyboard('{ArrowRight}');

        // Assert
        expect(focused(mounted)).toBe('bar:revenue:1');
        expect(proxy(mounted, 'bar:revenue:1').getAttribute('tabindex')).toBe('0');
        expect(all(mounted, '.proxies > button[tabindex="0"]')).toHaveLength(1);
        expect(tipOpen(mounted)).toBe(true);
        expect(tip(mounted).querySelector('.tip-title')?.textContent).toBe('Feb');

        // Act
        await userEvent.keyboard('{ArrowDown}');
        await userEvent.keyboard('{End}');

        // Assert
        expect(focused(mounted)).toBe('bar:cost:2');
    });

    it('should raise press with the record key and series for a click on a bar, a proxy click and Enter', async () => {
        // Arrange
        const mounted = await mountChart({ interactive: true, on: ON_PRESS });

        // Act
        await userEvent.click(canvasOf(mounted), { position: centreOf(mounted, 'bar:cost:1') });
        proxy(mounted, 'bar:revenue:0').click();
        proxy(mounted, 'bar:revenue:2').focus();
        await userEvent.keyboard('{Enter}');

        // Assert
        expect(mounted.presses).toEqual([
            { key: '1', series: 'cost' },
            { key: '0', series: 'revenue' },
            { key: '2', series: 'revenue' }
        ]);
        expect(mounted.store.get('$.data.ui.pressed')).toBe(true);
    });

    it('should raise nothing for a click on a bar when the chart is not interactive', async () => {
        // Arrange
        const mounted = await mountChart({ on: ON_PRESS });

        // Act
        await userEvent.click(canvasOf(mounted), { position: centreOf(mounted, 'bar:cost:1') });
        proxy(mounted, 'bar:cost:1').focus();
        await userEvent.keyboard('{Enter}');

        // Assert
        expect(mounted.presses).toEqual([]);
        expect(mounted.store.get('$.data.ui.pressed')).toBe(false);
    });

    it('should have the same data table rows as the SVG chart', async () => {
        // Arrange
        const svg = await mountChart({ renderer: 'svg' });

        // Act
        const mounted = await mountChart();

        // Assert
        expect(tableRows(mounted).length).toBeGreaterThan(1);
        expect(tableRows(mounted)).toEqual(tableRows(svg));
    });

    it('should leave out the proxies of a hidden series and draw it again when shown', async () => {
        // Arrange
        const mounted = await mountChart();

        // Act
        one<HTMLButtonElement>(mounted, '.entry[data-key="cost"]').click();
        await ready(mounted);

        // Assert
        expect(mounted.store.get('$.app.hiddenSeries')).toEqual(['cost']);
        expect(all<HTMLButtonElement>(mounted, '.proxies > button').map((each) => each.getAttribute('data-point'))).toEqual(['bar:revenue:0', 'bar:revenue:1', 'bar:revenue:2']);

        // Act
        one<HTMLButtonElement>(mounted, '.entry[data-key="cost"]').click();
        await ready(mounted);

        // Assert
        expect(all(mounted, '.proxies > button')).toHaveLength(6);
    });

    it('should keep the legend and the data table and report one SUI-RUN-DRAW when the browser gives no canvas context', async () => {
        // Arrange
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
        const error = vi.spyOn(report, 'error').mockImplementation(() => undefined);

        // Act
        const mounted = await mountChart();
        mounted.store.set('$.data.sales.0.revenue', 1500 as never);
        await ready(mounted);

        // Assert
        const reports = calls(error, 'SUI-RUN-DRAW');
        expect(reports).toHaveLength(1);
        expect(String(reports[0]?.[0])).toContain('canvas context');
        expect(all(mounted, '.legend .entry')).toHaveLength(2);
        expect(tableRows(mounted).length).toBeGreaterThan(1);
    });

    it('should swap the renderer at run time and keep the legend state', async () => {
        // Arrange
        const mounted = await mountChart({ renderer: 'svg' });
        one<HTMLButtonElement>(mounted, '.entry[data-key="cost"]').click();
        await ready(mounted);

        // Act
        mounted.store.set('$.app.renderer', 'canvas' as never);
        await ready(mounted);

        // Assert
        expect(all(mounted, '.plot > svg')).toHaveLength(0);
        expect(all(mounted, '.plot > canvas')).toHaveLength(1);
        expect(mounted.store.get('$.app.hiddenSeries')).toEqual(['cost']);
        expect(one(mounted, '.entry[data-key="cost"]').getAttribute('aria-pressed')).toBe('false');
        expect(all(mounted, '.proxies > button')).toHaveLength(3);
        const at = centreOf(mounted, 'bar:revenue:2');
        expect(pixel(mounted, at.x, at.y)).toEqual(tokenColour(mounted, '--ui-color-data-categorical-1'));

        // Act
        mounted.store.set('$.app.renderer', 'svg' as never);
        await ready(mounted);

        // Assert
        expect(all(mounted, '.plot > canvas')).toHaveLength(0);
        expect(all(mounted, '.proxies')).toHaveLength(0);
        expect(all(mounted, '.plot > svg [data-point]')).toHaveLength(3);
        expect(one(mounted, '.plot > svg').getAttribute('role')).toBe('group');
        expect(one(mounted, '.entry[data-key="cost"]').getAttribute('aria-pressed')).toBe('false');
    });
});
