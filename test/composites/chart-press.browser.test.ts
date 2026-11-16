import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent, MountOptions } from '../harness/createMountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};
const settle = async (): Promise<void> => {
    await flush();
    await frames(4);
};

const SALES = [
    { month: 'Jan', revenue: 1000, cost: 400 },
    { month: 'Feb', revenue: 2000, cost: 900 },
    { month: 'Mar', revenue: 3000, cost: 1200 }
];
/** The same months as a keyed map whose key order is not alphabetical */
const SALES_BY_KEY = { q3: { ...SALES[2] }, q1: { ...SALES[0] }, q2: { ...SALES[1] } };
const SERIES = { revenue: { field: 'revenue', _label: 'Revenue' }, cost: { field: 'cost', _label: 'Cost' } };
const SHARES = [
    { kind: 'Food', amount: 50 },
    { kind: 'Rent', amount: 30 },
    { kind: 'Fun', amount: 20 }
];

/** An `on` entry that marks the press in the state and hands the payload to the host, which writes it to `$.data.ui.opened` */
const ON_PRESS = {
    press: [
        { command: 'set', target: '$.data.ui.pressed', value: true },
        { command: 'emit', target: 'open' }
    ]
};

interface Mounted extends MountedComponent {
    /** The `detail` of every `press` the chart raised, in order */
    readonly presses: unknown[];
}

const root = (mounted: MountedComponent): ShadowRoot => mounted.element.shadowRoot as ShadowRoot;
const all = <T extends Element>(mounted: MountedComponent, selector: string): T[] => Array.from(root(mounted).querySelectorAll<T>(selector));
const svgOf = (mounted: MountedComponent): SVGSVGElement => root(mounted).querySelector<SVGSVGElement>('.plot > svg') as SVGSVGElement;
const mark = (mounted: MountedComponent, id: string): SVGElement => {
    const found = root(mounted).querySelector<SVGElement>(`[data-point="${id}"]`);
    if (!found) throw new Error(`no mark ${id}`);
    return found;
};

/**
 * Clicks a donut slice inside its ring: the middle of its bounding box can fall in the hole, so the point is half way
 * between a point on its outer arc and one on its inner arc
 */
const clickSlice = async (mounted: MountedComponent, id: string): Promise<void> => {
    const slice = mark(mounted, id) as SVGPathElement;
    const length = slice.getTotalLength();
    const outer = slice.getPointAtLength(length * 0.2);
    const inner = slice.getPointAtLength(length * 0.7);
    const matrix = slice.getScreenCTM() as DOMMatrix;
    const at = new DOMPoint((outer.x + inner.x) / 2, (outer.y + inner.y) / 2).matrixTransform(matrix);
    const box = slice.getBoundingClientRect();
    await userEvent.click(slice, { position: { x: at.x - box.left, y: at.y - box.top } });
};

async function mountChart(extra: Record<string, unknown> = {}, data: Record<string, unknown> = {}, options: MountOptions = {}): Promise<Mounted> {
    const holder: { mounted?: MountedComponent } = {};
    const mounted = mountComponent(
        'chart',
        { x: 'month', series: SERIES, '<-records': '$.data.sales', _title: 'Sales', on: ON_PRESS, ...extra },
        {
            data: { sales: SALES.map((row) => ({ ...row })), shares: SHARES.map((row) => ({ ...row })), ui: { pressed: false, opened: null }, ...data },
            ...options,
            // A copy: the store keeps the object it is given and writes the next one into it
            hooks: { onEmit: (_name, payload) => void holder.mounted?.store.set('$.data.ui.opened', structuredClone(payload) as never) }
        }
    );
    holder.mounted = mounted;
    (mounted.element as HTMLElement).style.inlineSize = '480px';
    (mounted.element as HTMLElement).style.display = 'block';
    (mounted.element as HTMLElement).style.padding = '80px 20px 20px';
    const presses: unknown[] = [];
    mounted.element.addEventListener('press', (event) => presses.push(structuredClone((event as CustomEvent).detail)));
    await settle();
    return Object.assign(mounted, { presses });
}

const mountDonut = (extra: Record<string, unknown> = {}, data: Record<string, unknown> = {}): Promise<Mounted> =>
    mountChart({ type: 'donut', x: 'kind', series: { spend: { field: 'amount', _label: 'Spend' } }, '<-records': '$.data.shares', _title: 'Spending', ...extra }, data);

describe('chart press in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should run the on entry of press for a click on a bar, with the record key and the series as the payload', async () => {
        // Arrange
        const mounted = await mountChart({ interactive: true });

        // Act
        await userEvent.click(mark(mounted, 'bar:cost:1'));

        // Assert
        expect(mounted.store.get('$.data.ui.pressed')).toBe(true);
        expect(mounted.store.get('$.data.ui.opened')).toEqual({ key: '1', series: 'cost' });
        expect(mounted.presses).toEqual([{ key: '1', series: 'cost' }]);
    });

    it('should keep the marks images with one tab stop when the chart is interactive', async () => {
        // Act
        const mounted = await mountChart({ interactive: true });

        // Assert
        const marks = all<SVGElement>(mounted, '[data-point]');
        expect(marks).toHaveLength(6);
        expect(new Set(marks.map((each) => each.getAttribute('role')))).toEqual(new Set(['img']));
        expect(marks.filter((each) => each.getAttribute('tabindex') === '0')).toHaveLength(1);
        expect(all(mounted, '[role="button"]')).toHaveLength(0);
        expect(getComputedStyle(mark(mounted, 'bar:revenue:0')).cursor).toBe('pointer');
    });

    it('should press a line point', async () => {
        // Arrange
        const mounted = await mountChart({ interactive: true, type: 'line' });

        // Act
        await userEvent.click(mark(mounted, 'dot:revenue:2'));

        // Assert
        expect(mounted.store.get('$.data.ui.opened')).toEqual({ key: '2', series: 'revenue' });
    });

    it('should name the record of a keyed map by its key, in the order of the map', async () => {
        // Arrange
        const mounted = await mountChart({ interactive: true }, { sales: structuredClone(SALES_BY_KEY) });

        // Act
        await userEvent.click(mark(mounted, 'bar:revenue:0'));
        await userEvent.click(mark(mounted, 'bar:cost:2'));

        // Assert
        expect(mounted.presses).toEqual([
            { key: 'q3', series: 'revenue' },
            { key: 'q2', series: 'cost' }
        ]);
        expect(mounted.store.get('$.data.ui.opened')).toEqual({ key: 'q2', series: 'cost' });
    });

    it('should press a donut slice with its record key and the series', async () => {
        // Arrange
        const mounted = await mountDonut({ interactive: true });

        // Act
        await clickSlice(mounted, 'slice:1');

        // Assert
        expect(mounted.store.get('$.data.ui.pressed')).toBe(true);
        expect(mounted.store.get('$.data.ui.opened')).toEqual({ key: '1', series: 'spend' });
    });

    it('should press a donut slice of keyed records by its key', async () => {
        // Arrange
        const mounted = await mountDonut({ interactive: true }, { shares: { food: { ...SHARES[0] }, rent: { ...SHARES[1] }, fun: { ...SHARES[2] } } });

        // Act
        await clickSlice(mounted, 'slice:2');

        // Assert
        expect(mounted.presses).toEqual([{ key: 'fun', series: 'spend' }]);
    });

    it('should press the focused mark with Enter and with Space, once per key press', async () => {
        // Arrange
        const mounted = await mountChart({ interactive: true });
        mark(mounted, 'bar:revenue:0').focus();

        // Act
        await userEvent.keyboard('{Enter}');
        await userEvent.keyboard('{ArrowRight}');
        await userEvent.keyboard(' ');

        // Assert
        expect(mounted.presses).toEqual([
            { key: '0', series: 'revenue' },
            { key: '1', series: 'revenue' }
        ]);
        expect(mounted.store.get('$.data.ui.opened')).toEqual({ key: '1', series: 'revenue' });
    });

    it('should stop the page from acting on Enter and Space it pressed a mark with', async () => {
        // Arrange
        const mounted = await mountChart({ interactive: true });
        const target = mark(mounted, 'bar:cost:0');
        const prevented: boolean[] = [];
        mounted.element.addEventListener('keydown', (event) => prevented.push(event.defaultPrevented));

        // Act
        for (const key of ['Enter', ' ']) target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }));

        // Assert
        expect(prevented).toEqual([true, true]);
        expect(mounted.presses).toHaveLength(2);
    });

    it('should leave a hidden series with no pressable marks and report the right key and series for a visible one', async () => {
        // Arrange
        const mounted = await mountChart({ interactive: true });
        await userEvent.click(root(mounted).querySelector('.entry[data-key="revenue"]') as HTMLElement);
        await settle();

        // Act
        await userEvent.click(mark(mounted, 'bar:cost:2'));

        // Assert
        expect(all(mounted, '[data-point][data-series="revenue"]')).toHaveLength(0);
        expect(all(mounted, '[data-series="revenue"]')).toHaveLength(0);
        expect(mounted.presses).toEqual([{ key: '2', series: 'cost' }]);
        expect(mounted.store.get('$.data.ui.opened')).toEqual({ key: '2', series: 'cost' });
    });

    it('should report the record key of a slice after another slice was hidden', async () => {
        // Arrange
        const mounted = await mountDonut({ interactive: true });
        await userEvent.click(root(mounted).querySelector('.entry[data-key="Food"]') as HTMLElement);
        await settle();

        // Act
        await clickSlice(mounted, 'slice:2');

        // Assert
        expect(root(mounted).querySelector('[data-point="slice:0"]')).toBeNull();
        expect(mounted.presses).toEqual([{ key: '2', series: 'spend' }]);
    });

    it('should raise nothing and add nothing when interactive is not set', async () => {
        // Arrange
        const plain = await mountChart();
        const plainSvg = svgOf(plain).outerHTML;
        const target = mark(plain, 'bar:cost:1');

        // Act
        await userEvent.click(target);
        target.focus();
        await userEvent.keyboard('{Enter}');
        await userEvent.keyboard(' ');

        // Assert
        expect(plain.presses).toEqual([]);
        expect(plain.store.get('$.data.ui.pressed')).toBe(false);
        expect(plain.store.get('$.data.ui.opened')).toBeNull();
        expect(plain.element.hasAttribute('interactive')).toBe(false);
        expect(all(plain, '[role="button"]')).toHaveLength(0);
        expect(getComputedStyle(target).cursor).not.toBe('pointer');
        mountComponent.unmountAll();
        // An interactive chart of the same data draws the same svg: interactive adds no element and no attribute to it
        const interactive = await mountChart({ interactive: true });
        expect(svgOf(interactive).outerHTML).toBe(plainSvg);
    });

    it('should stop raising press when interactive is turned off at run time', async () => {
        // Arrange
        const mounted = await mountChart({ interactive: true });
        mounted.store.set('$.app.interactive', false as never);
        await settle();

        // Act
        await userEvent.click(mark(mounted, 'bar:revenue:1'));

        // Assert
        expect(mounted.presses).toEqual([]);
        expect(mounted.element.hasAttribute('interactive')).toBe(false);
    });

    it('should follow a records change: a press names the record whose value the mark now shows', async () => {
        // Arrange
        const mounted = await mountChart({ interactive: true }, { sales: structuredClone(SALES_BY_KEY) });
        mounted.store.set('$.data.sales.q0', { month: 'Dec', revenue: 500, cost: 100 } as never);
        await settle();
        const december = all<SVGElement>(mounted, '[data-point^="bar:revenue:"]').find((each) => each.getAttribute('aria-label')?.includes('Dec'));
        if (december === undefined) throw new Error('no December bar');

        // Act
        await userEvent.click(december);

        // Assert
        expect(mounted.presses).toEqual([{ key: 'q0', series: 'revenue' }]);
        expect(mounted.store.get(`$.data.sales.${(mounted.presses[0] as { key: string }).key}.month`)).toBe('Dec');
    });

    it('should keep the role and the labels the chart gives its svg through redraws', async () => {
        // Arrange
        const mounted = await mountChart({ interactive: true, _description: 'Monthly sales' });

        // Act
        mounted.store.set('$.data.sales.0.revenue', 4000 as never);
        (mounted.element as HTMLElement).style.inlineSize = '400px';
        await settle();
        await settle();
        mounted.store.set('$.app.type', 'line' as never);
        await settle();

        // Assert
        const svg = svgOf(mounted);
        expect(svg.getAttribute('role')).toBe('group');
        expect(svg.getAttribute('aria-labelledby')).toBe('title');
        expect(svg.getAttribute('aria-describedby')).toBe('description');
        expect(svg.getAttribute('viewBox')).toMatch(/^0 0 \d/);
    });
});
