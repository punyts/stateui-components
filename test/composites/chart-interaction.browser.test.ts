import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

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
const SERIES = { revenue: { field: 'revenue', _label: 'Revenue' }, cost: { field: 'cost', _label: 'Cost' } };
const SHARES = [
    { kind: 'Food', amount: 50 },
    { kind: 'Rent', amount: 30 },
    { kind: 'Fun', amount: 20 }
];

const root = (mounted: MountedComponent): ShadowRoot => mounted.element.shadowRoot as ShadowRoot;
const all = <T extends Element>(mounted: MountedComponent, selector: string): T[] => Array.from(root(mounted).querySelectorAll<T>(selector));
const one = <T extends Element>(mounted: MountedComponent, selector: string): T => root(mounted).querySelector<T>(selector) as T;
const mark = (mounted: MountedComponent, id: string): SVGElement => one<SVGElement>(mounted, `[data-point="${id}"]`);
const focused = (mounted: MountedComponent): string | null => root(mounted).activeElement?.getAttribute('data-point') ?? null;
const tip = (mounted: MountedComponent): HTMLElement => one<HTMLElement>(mounted, '.tip');
const tipOpen = (mounted: MountedComponent): boolean => tip(mounted).matches(':popover-open');

const mountBars = async (extra: Record<string, unknown> = {}, options: Parameters<typeof mountComponent>[2] = {}): Promise<MountedComponent> => {
    const mounted = mountComponent(
        'chart',
        { x: 'month', series: SERIES, '<-records': '$.data.sales', _title: 'Sales', ...extra },
        { data: { sales: SALES.map((row) => ({ ...row })), shares: SHARES.map((row) => ({ ...row })) }, ...options }
    );
    (mounted.element as HTMLElement).style.inlineSize = '480px';
    (mounted.element as HTMLElement).style.display = 'block';
    (mounted.element as HTMLElement).style.padding = '80px 20px 20px';
    await settle();
    return mounted;
};

const mountDonut = (extra: Record<string, unknown> = {}, options: Parameters<typeof mountComponent>[2] = {}): Promise<MountedComponent> =>
    mountBars({ type: 'donut', x: 'kind', series: { spend: { field: 'amount', _label: 'Spend' } }, '<-records': '$.data.shares', _title: 'Spending', ...extra }, options);

describe('chart donut in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should draw one arc per record, coloured with the data tokens, and the total in the centre', async () => {
        // Arrange and Act
        const mounted = await mountDonut();
        const slices = all<SVGElement>(mounted, 'path.slice');

        // Assert
        expect(slices).toHaveLength(3);
        expect(new Set(slices.map((slice) => getComputedStyle(slice).fill)).size).toBe(3);
        expect(one(mounted, 'text.total').textContent).toBe('100');
        expect(one(mounted, 'text.total-label').textContent).toBe('Total');
        expect(all(mounted, 'rect.bar')).toHaveLength(0);
    });

    it('should name each arc with its value and share', async () => {
        // Arrange and Act
        const mounted = await mountDonut();

        // Assert
        expect(mark(mounted, 'slice:1').getAttribute('aria-label')).toBe('Rent: 30 (30%)');
    });

    it('should update the arcs and the total when the data changes', async () => {
        // Arrange
        const mounted = await mountDonut();
        const before = mark(mounted, 'slice:0').getAttribute('d');

        // Act
        mounted.store.set('$.data.shares.0.amount', 150 as never);
        await settle();

        // Assert
        expect(one(mounted, 'text.total').textContent).toBe('200');
        expect(mark(mounted, 'slice:0').getAttribute('d')).not.toBe(before);
    });

    it('should list the slices in the legend and hide one when its entry is pressed', async () => {
        // Arrange
        const mounted = await mountDonut();

        // Assert
        expect(all(mounted, '.legend .label').map((label) => label.textContent)).toEqual(['Food', 'Rent', 'Fun']);

        // Act
        all<HTMLButtonElement>(mounted, '.entry')[1]?.click();
        await settle();

        // Assert
        expect(all(mounted, 'path.slice')).toHaveLength(2);
        expect(one(mounted, 'text.total').textContent).toBe('70');
        expect(mounted.store.get<string[]>('$.app.hiddenSeries')).toEqual(['Rent']);
        expect(all<HTMLButtonElement>(mounted, '.entry')[1]?.getAttribute('aria-pressed')).toBe('false');
    });
});

describe('chart legend in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should list the series labels, pressed by default', async () => {
        // Arrange and Act
        const mounted = await mountBars();

        // Assert
        expect(all(mounted, '.legend .label').map((label) => label.textContent)).toEqual(['Revenue', 'Cost']);
        expect(all<HTMLButtonElement>(mounted, '.entry').map((entry) => entry.getAttribute('aria-pressed'))).toEqual(['true', 'true']);
        expect(root(mounted).querySelector('.legend')?.getAttribute('aria-label')).toBe('Legend');
    });

    it('should hide and show a series when its entry is pressed, without recolouring the other', async () => {
        // Arrange
        const mounted = await mountBars();
        const costColour = getComputedStyle(one(mounted, 'rect.bar[data-series="cost"]')).fill;

        // Act
        all<HTMLButtonElement>(mounted, '.entry')[0]?.click();
        await settle();

        // Assert
        expect(all(mounted, 'rect.bar[data-series="revenue"]')).toHaveLength(0);
        expect(all(mounted, 'rect.bar[data-series="cost"]')).toHaveLength(3);
        expect(getComputedStyle(one(mounted, 'rect.bar[data-series="cost"]')).fill).toBe(costColour);
        expect(all<HTMLButtonElement>(mounted, '.entry')[0]?.getAttribute('aria-pressed')).toBe('false');

        // Act
        all<HTMLButtonElement>(mounted, '.entry')[0]?.click();
        await settle();

        // Assert
        expect(all(mounted, 'rect.bar')).toHaveLength(6);
        expect(mounted.store.get<string[]>('$.app.hiddenSeries')).toEqual([]);
    });

    it('should hide a series the application writes to hiddenSeries', async () => {
        // Arrange
        const mounted = await mountBars({ hiddenSeries: ['cost'] });

        // Assert
        expect(all(mounted, 'rect.bar[data-series="cost"]')).toHaveLength(0);
        expect(all<HTMLButtonElement>(mounted, '.entry')[1]?.getAttribute('aria-pressed')).toBe('false');
    });

    it('should leave the legend out for none and put it beside the chart for end', async () => {
        // Arrange
        const none = await mountBars({ legend: 'none' });
        const end = await mountBars({ legend: 'end' });

        // Assert
        expect(all(none, '.legend')).toHaveLength(0);
        expect(getComputedStyle(one(end, '.body')).flexDirection).toBe('row');
    });
});

describe('chart tooltip and keyboard in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should show the values of a point in a popover while the pointer is on it', async () => {
        // Arrange
        const mounted = await mountBars();

        // Act
        await userEvent.hover(mark(mounted, 'bar:revenue:1'));
        await flush();

        // Assert
        expect(tipOpen(mounted)).toBe(true);
        expect(tip(mounted).querySelector('.tip-title')?.textContent).toBe('Feb');
        expect(Array.from(tip(mounted).querySelectorAll('.tip-row')).map((row) => row.textContent)).toEqual(['Revenue2,000', 'Cost900']);
        expect(tip(mounted).querySelector('.tip-row.current')?.textContent).toBe('Revenue2,000');

        // Act
        await userEvent.unhover(mark(mounted, 'bar:revenue:1'));
        await flush();

        // Assert
        expect(tipOpen(mounted)).toBe(false);
    });

    it('should place the tooltip next to the point it shows', async () => {
        // Arrange
        const mounted = await mountBars();

        // Act
        await userEvent.hover(mark(mounted, 'bar:revenue:2'));
        await flush();
        const bar = mark(mounted, 'bar:revenue:2').getBoundingClientRect();
        const box = tip(mounted).getBoundingClientRect();

        // Assert
        expect(box.bottom).toBeLessThanOrEqual(bar.top + 1);
        expect(Math.abs(box.left + box.width / 2 - (bar.left + bar.width / 2))).toBeLessThan(box.width);
    });

    it('should show the tooltip of a donut slice with its value and share', async () => {
        // Arrange
        const mounted = await mountDonut();

        // Act
        mark(mounted, 'slice:2').focus();
        await flush();

        // Assert
        expect(tipOpen(mounted)).toBe(true);
        expect(tip(mounted).querySelector('.tip-title')?.textContent).toBe('Fun');
        expect(Array.from(tip(mounted).querySelectorAll('.tip-row')).map((row) => row.textContent)).toEqual(['Spend20', 'Share20%']);
    });

    it('should make one mark the tab stop and show its tooltip when it takes focus', async () => {
        // Arrange
        const mounted = await mountBars();
        const stops = all<SVGElement>(mounted, '[data-point]').filter((candidate) => candidate.getAttribute('tabindex') === '0');

        // Act
        stops[0]?.focus();
        await flush();

        // Assert
        expect(stops.map((stop) => stop.getAttribute('data-point'))).toEqual(['bar:revenue:0']);
        expect(tipOpen(mounted)).toBe(true);
        expect(tip(mounted).querySelector('.tip-title')?.textContent).toBe('Jan');
    });

    it('should move between points with the arrow keys, Home and End', async () => {
        // Arrange
        const mounted = await mountBars();
        mark(mounted, 'bar:revenue:0').focus();

        // Act and Assert
        await userEvent.keyboard('{ArrowRight}');
        expect(focused(mounted)).toBe('bar:revenue:1');
        await userEvent.keyboard('{ArrowRight}');
        expect(focused(mounted)).toBe('bar:revenue:2');
        await userEvent.keyboard('{ArrowRight}');
        expect(focused(mounted)).toBe('bar:revenue:2');
        await userEvent.keyboard('{ArrowDown}');
        expect(focused(mounted)).toBe('bar:cost:2');
        await userEvent.keyboard('{ArrowUp}');
        expect(focused(mounted)).toBe('bar:revenue:2');
        await userEvent.keyboard('{Home}');
        expect(focused(mounted)).toBe('bar:revenue:0');
        await userEvent.keyboard('{End}');
        expect(focused(mounted)).toBe('bar:revenue:2');
        await userEvent.keyboard('{ArrowLeft}');
        expect(focused(mounted)).toBe('bar:revenue:1');
        expect(tip(mounted).querySelector('.tip-title')?.textContent).toBe('Feb');
    });

    it('should move the tab stop with the focus', async () => {
        // Arrange
        const mounted = await mountBars();
        mark(mounted, 'bar:revenue:0').focus();

        // Act
        await userEvent.keyboard('{ArrowRight}');
        const stops = all<SVGElement>(mounted, '[data-point]').filter((candidate) => candidate.getAttribute('tabindex') === '0');

        // Assert
        expect(stops.map((stop) => stop.getAttribute('data-point'))).toEqual(['bar:revenue:1']);
    });

    it('should step round the slices of a donut with the arrow keys', async () => {
        // Arrange
        const mounted = await mountDonut();
        mark(mounted, 'slice:0').focus();

        // Act and Assert
        await userEvent.keyboard('{ArrowRight}');
        expect(focused(mounted)).toBe('slice:1');
        await userEvent.keyboard('{ArrowDown}');
        expect(focused(mounted)).toBe('slice:2');
        await userEvent.keyboard('{ArrowUp}');
        expect(focused(mounted)).toBe('slice:1');
    });

    it('should close the tooltip on Escape and when the focus leaves the marks', async () => {
        // Arrange
        const mounted = await mountBars();
        mark(mounted, 'bar:revenue:0').focus();
        await flush();

        // Act
        await userEvent.keyboard('{Escape}');
        await flush();

        // Assert
        expect(tipOpen(mounted)).toBe(false);

        // Act
        mark(mounted, 'bar:revenue:1').focus();
        await flush();
        (root(mounted).activeElement as HTMLElement).blur();
        await flush();

        // Assert
        expect(tipOpen(mounted)).toBe(false);
    });

    it('should keep the tab stop on a point that exists when its series is hidden', async () => {
        // Arrange
        const mounted = await mountBars();
        mark(mounted, 'bar:revenue:1').focus();
        await flush();

        // Act
        all<HTMLButtonElement>(mounted, '.entry')[0]?.click();
        await settle();
        const stops = all<SVGElement>(mounted, '[data-point]').filter((candidate) => candidate.getAttribute('tabindex') === '0');

        // Assert
        expect(stops.map((stop) => stop.getAttribute('data-point'))).toEqual(['bar:cost:0']);
    });
});

describe('chart data table in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    const rows = (mounted: MountedComponent): string[][] =>
        all<HTMLTableRowElement>(mounted, '.data tr').map((row) => Array.from(row.children).map((cell) => cell.textContent ?? ''));

    it('should hold the values of the chart in a table that is hidden from view', async () => {
        // Arrange and Act
        const mounted = await mountBars();
        const data = one<HTMLElement>(mounted, '.data');

        // Assert
        expect(rows(mounted)).toEqual([
            ['Category', 'Revenue', 'Cost'],
            ['Jan', '1,000', '400'],
            ['Feb', '2,000', '900'],
            ['Mar', '3,000', '1,200']
        ]);
        expect(one(mounted, '.data caption').textContent).toBe('Sales');
        expect(data.getBoundingClientRect().width).toBeLessThanOrEqual(1);
        expect(all(mounted, '.data thead th[scope="col"]')).toHaveLength(3);
        expect(all(mounted, '.data tbody th[scope="row"]')).toHaveLength(3);
    });

    it('should follow the data, and keep the table cells it does not need to change', async () => {
        // Arrange
        const mounted = await mountBars();
        const untouched = all<HTMLElement>(mounted, '.data td')[0] as HTMLElement;
        const touched = new Set<Node>();
        const observer = new MutationObserver((records) => records.forEach((record) => touched.add(record.target)));
        observer.observe(one(mounted, '.data'), { childList: true, characterData: true, subtree: true });

        // Act
        mounted.store.set('$.data.sales.1.cost', 950 as never);
        await settle();
        observer.disconnect();

        // Assert
        expect(rows(mounted)[2]).toEqual(['Feb', '2,000', '950']);
        expect(touched.has(untouched)).toBe(false);

        // Act
        mounted.store.set('$.data.sales.3', { month: 'Apr', revenue: 4000, cost: 2000 } as never);
        await settle();

        // Assert
        expect(rows(mounted)[4]).toEqual(['Apr', '4,000', '2,000']);
    });

    it('should keep a series the legend hid in the table', async () => {
        // Arrange
        const mounted = await mountBars();

        // Act
        all<HTMLButtonElement>(mounted, '.entry')[0]?.click();
        await settle();

        // Assert
        expect(rows(mounted)[0]).toEqual(['Category', 'Revenue', 'Cost']);
    });

    it('should hold the value and the share of a donut', async () => {
        // Arrange and Act
        const mounted = await mountDonut();

        // Assert
        expect(rows(mounted)).toEqual([
            ['Category', 'Value', 'Share'],
            ['Food', '50', '50%'],
            ['Rent', '30', '30%'],
            ['Fun', '20', '20%']
        ]);
    });
});

describe('chart German labels in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should translate the legend label, the table headers and the donut total, and format values for German', async () => {
        // Arrange
        const mounted = await mountDonut({ '<-records': '$.data.big' }, { locale: 'de', data: { big: [{ kind: 'A', amount: 1500 }, { kind: 'B', amount: 2500 }] } });

        // Assert
        expect(root(mounted).querySelector('.legend')?.getAttribute('aria-label')).toBe('Legende');
        expect(one(mounted, 'text.total-label').textContent).toBe('Gesamt');
        expect(one(mounted, 'text.total').textContent).toBe('4.000');
        expect(all<HTMLElement>(mounted, '.data thead th').map((cell) => cell.textContent)).toEqual(['Kategorie', 'Wert', 'Anteil']);
        expect((mark(mounted, 'slice:0').getAttribute('aria-label') ?? '').replace(/\s/g, ' ')).toBe('A: 1.500 (37,5 %)');
    });

    it('should show series labels from a German overlay in the legend and the tooltip', async () => {
        // Arrange
        const mounted = await mountBars({}, { locales: { de: { series: { revenue: { _label: 'Umsatz' }, cost: { _label: 'Kosten' } } } } });

        // Act
        mounted.setLocale('de');
        await settle();
        await userEvent.hover(mark(mounted, 'bar:revenue:0'));
        await flush();

        // Assert
        expect(all(mounted, '.legend .label').map((label) => label.textContent)).toEqual(['Umsatz', 'Kosten']);
        expect(mark(mounted, 'bar:revenue:0').getAttribute('aria-label')).toBe('Umsatz, Jan: 1.000');
        expect(Array.from(tip(mounted).querySelectorAll('.tip-row')).map((row) => row.textContent)).toEqual(['Umsatz1.000', 'Kosten400']);
        expect(all<HTMLElement>(mounted, '.data thead th').map((cell) => cell.textContent)).toEqual(['Kategorie', 'Umsatz', 'Kosten']);
    });
});
