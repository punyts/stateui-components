import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};

const SALES = [
    { month: 'Jan', revenue: 1000, cost: 400 },
    { month: 'Feb', revenue: 2000, cost: 900 },
    { month: 'Mar', revenue: 3000, cost: 1200 },
    { month: 'Apr', revenue: 4000, cost: 2000 }
];
const SERIES = { revenue: { field: 'revenue', _label: 'Revenue' }, cost: { field: 'cost', _label: 'Cost' } };

const svgOf = (mounted: MountedComponent): SVGSVGElement => mounted.element.shadowRoot?.querySelector('svg') as SVGSVGElement;
const marks = (mounted: MountedComponent, selector: string): SVGElement[] => Array.from(svgOf(mounted).querySelectorAll<SVGElement>(selector));
const num = (element: Element, name: string): number => Number(element.getAttribute(name));

const mountChart = async (extra: Record<string, unknown> = {}, options: Parameters<typeof mountComponent>[2] = {}, width = 480): Promise<MountedComponent> => {
    const mounted = mountComponent(
        'chart',
        { x: 'month', series: SERIES, '<-records': '$.data.sales', _title: 'Sales', ...extra },
        { data: { sales: SALES.map((row) => ({ ...row })) }, ...options }
    );
    (mounted.element as HTMLElement).style.inlineSize = `${width}px`;
    await flush();
    await frames(3);
    return mounted;
};

describe('chart in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should draw a bar per series and record, in an SVG group labelled by the title', async () => {
        // Arrange and Act
        const mounted = await mountChart({ _description: 'Revenue and cost by month' });
        const svg = svgOf(mounted);
        const root = mounted.element.shadowRoot as ShadowRoot;

        // Assert
        expect(marks(mounted, 'rect.bar')).toHaveLength(8);
        expect(svg.getAttribute('role')).toBe('group');
        expect(root.getElementById(svg.getAttribute('aria-labelledby') as string)?.textContent).toBe('Sales');
        expect(root.getElementById(svg.getAttribute('aria-describedby') as string)?.textContent).toBe('Revenue and cost by month');
        expect(svg.hasAttribute('width')).toBe(false);
        expect(marks(mounted, 'text.tick.x').map((tick) => tick.textContent)).toEqual(['Jan', 'Feb', 'Mar', 'Apr']);
    });

    it('should not describe the chart when there is no description', async () => {
        // Arrange and Act
        const mounted = await mountChart();

        // Assert
        expect(svgOf(mounted).hasAttribute('aria-describedby')).toBe(false);
    });

    it('should draw lines with a point per value for the line type, and no bars', async () => {
        // Arrange and Act
        const mounted = await mountChart({ type: 'line' });

        // Assert
        expect(marks(mounted, 'path.line')).toHaveLength(2);
        expect(marks(mounted, 'circle.dot')).toHaveLength(8);
        expect(marks(mounted, 'path.area')).toHaveLength(0);
        expect(marks(mounted, 'rect.bar')).toHaveLength(0);
    });

    it('should fill under the lines for the area type', async () => {
        // Arrange and Act
        const mounted = await mountChart({ type: 'area' });

        // Assert
        expect(marks(mounted, 'path.area')).toHaveLength(2);
        expect(marks(mounted, 'path.line')).toHaveLength(2);
        expect(marks(mounted, 'path.area')[0]?.getAttribute('d')).toMatch(/Z$/);
    });

    it('should stack the bars of a record on one another when stacked', async () => {
        // Arrange
        const side = await mountChart();
        const sideX = marks(side, 'rect.bar').map((bar) => num(bar, 'x'));
        side.dispose();

        // Act
        const mounted = await mountChart({ stacked: true });
        const bars = marks(mounted, 'rect.bar');
        const first = bars.find((bar) => bar.dataset['series'] === 'revenue' && bar.dataset['index'] === '0') as SVGElement;
        const second = bars.find((bar) => bar.dataset['series'] === 'cost' && bar.dataset['index'] === '0') as SVGElement;

        // Assert
        expect(new Set(sideX).size).toBe(8);
        expect(num(first, 'x')).toBe(num(second, 'x'));
        expect(num(second, 'y') + num(second, 'height')).toBeCloseTo(num(first, 'y'), 1);
    });

    it('should colour the series with the categorical data tokens in key order', async () => {
        // Arrange and Act
        const mounted = await mountChart();
        const fill = (series: string): string => getComputedStyle(marks(mounted, `rect.bar[data-series="${series}"]`)[0] as SVGElement).fill;
        const token = (name: string): string => {
            const probe = document.createElement('div');
            probe.style.color = `var(${name})`;
            (mounted.element.shadowRoot as ShadowRoot).append(probe);
            const colour = getComputedStyle(probe).color;
            probe.remove();
            return colour;
        };

        // Assert
        expect(fill('revenue')).toBe(token('--ui-color-data-categorical-1'));
        expect(fill('cost')).toBe(token('--ui-color-data-categorical-2'));
        expect(fill('revenue')).not.toBe(fill('cost'));
    });

    it('should use the dark data colours in dark mode', async () => {
        // Arrange
        const mounted = await mountChart();
        const bar = marks(mounted, 'rect.bar')[0] as SVGElement;
        const light = getComputedStyle(bar).fill;

        // Act
        mounted.setTheme('mode', 'dark');
        await flush();
        await frames(2);

        // Assert
        expect(getComputedStyle(bar).fill).not.toBe(light);
    });

    it('should redraw to the new size when the container is resized', async () => {
        // Arrange
        const mounted = await mountChart({}, {}, 480);
        const before = marks(mounted, 'rect.bar').map((bar) => num(bar, 'x'));
        const viewBox = svgOf(mounted).getAttribute('viewBox');

        // Act
        (mounted.element as HTMLElement).style.inlineSize = '240px';
        await frames(4);
        await flush();
        const after = marks(mounted, 'rect.bar').map((bar) => num(bar, 'x'));

        // Assert
        expect(viewBox).toMatch(/^0 0 480 /);
        expect(svgOf(mounted).getAttribute('viewBox')).toMatch(/^0 0 240 /);
        expect(Math.max(...after)).toBeLessThan(Math.max(...before));
    });

    it('should write only the mark of a changed value when the data changes', async () => {
        // Arrange
        const mounted = await mountChart();
        const touched = new Set<Element>();
        const observer = new MutationObserver((records) => records.forEach((record) => touched.add(record.target as Element)));
        observer.observe(svgOf(mounted), { attributes: true, childList: true, characterData: true, subtree: true });
        const target = marks(mounted, 'rect.bar[data-series="revenue"][data-index="1"]')[0] as SVGElement;
        const before = num(target, 'height');

        // Act
        mounted.store.set('$.data.sales.1.revenue', 2500 as never);
        await flush();
        await frames(2);
        observer.disconnect();

        // Assert
        expect(num(target, 'height')).toBeGreaterThan(before);
        expect([...touched]).toEqual([target]);
    });

    it('should touch only the point and the line of a series when a value of a line chart changes', async () => {
        // Arrange
        const mounted = await mountChart({ type: 'line' });
        const touched = new Set<Element>();
        const observer = new MutationObserver((records) => records.forEach((record) => touched.add(record.target as Element)));
        observer.observe(svgOf(mounted), { attributes: true, childList: true, characterData: true, subtree: true });

        // Act
        mounted.store.set('$.data.sales.2.cost', 1100 as never);
        await flush();
        await frames(2);
        observer.disconnect();

        // Assert
        expect([...touched].map((element) => element.localName + '.' + element.getAttribute('data-series')).sort()).toEqual(['circle.cost', 'path.cost']);
    });

    it('should draw a new series, and drop a removed one, by drawing the chart again', async () => {
        // Arrange
        const mounted = await mountChart();

        // Act
        mounted.store.set('$.app.series.profit', { field: 'revenue', _label: 'Profit' } as never);
        await flush();
        await frames(2);

        // Assert
        expect(marks(mounted, 'rect.bar[data-series="profit"]')).toHaveLength(4);
        expect(marks(mounted, 'rect.bar')).toHaveLength(12);

        // Act
        mounted.store.delete('$.app.series.cost');
        await flush();
        await frames(2);

        // Assert
        expect(marks(mounted, 'rect.bar[data-series="cost"]')).toHaveLength(0);
        expect(marks(mounted, 'rect.bar')).toHaveLength(8);
    });

    it('should add the marks of a record that is added to the data', async () => {
        // Arrange
        const mounted = await mountChart();

        // Act
        mounted.store.set('$.data.sales.4', { month: 'May', revenue: 5000, cost: 1 } as never);
        await flush();
        await frames(2);

        // Assert
        expect(marks(mounted, 'rect.bar')).toHaveLength(10);
        expect(marks(mounted, 'text.tick.x').map((tick) => tick.textContent)).toContain('May');
    });

    it('should format the value axis for the locale: German groups thousands with a dot', async () => {
        // Arrange
        const english = await mountChart();
        const labels = (mounted: MountedComponent): string[] => marks(mounted, 'text.tick.y').map((tick) => tick.textContent ?? '');

        // Assert
        expect(labels(english)).toContain('4,000');

        // Act
        english.setLocale('de');
        await flush();
        await frames(2);

        // Assert
        expect(labels(english)).toContain('4.000');
        expect(labels(english)).not.toContain('4,000');
    });

    it('should format the value axis as currency in the locale and keep a title that is set', async () => {
        // Arrange and Act
        const mounted = await mountChart({ format: 'currency', currency: 'EUR' }, { locale: 'de' });
        const title = mounted.element.shadowRoot?.querySelector('.title')?.textContent;

        // Assert
        expect(marks(mounted, 'text.tick.y').map((tick) => tick.textContent).some((label) => /^4\.000,00\s€$/.test(label ?? ''))).toBe(true);
        expect(title).toBe('Sales');
    });

    it('should show the German default title when no title is set', async () => {
        // Arrange
        const mounted = mountComponent('chart', { x: 'month', series: SERIES, '<-records': '$.data.sales' }, { data: { sales: SALES }, locale: 'de' });
        await flush();

        // Assert
        expect(mounted.element.shadowRoot?.querySelector('.title')?.textContent).toBe('Diagramm');
    });

    it('should draw axes and no marks for a chart without records', async () => {
        // Arrange and Act
        const mounted = await mountChart({ '<-records': '$.data.empty' }, { data: { empty: [] } });

        // Assert
        expect(marks(mounted, 'rect.bar')).toHaveLength(0);
        expect(marks(mounted, 'line.gridline').length).toBeGreaterThan(0);
    });

    it('should draw records given as a keyed map in key order', async () => {
        // Arrange and Act
        const mounted = await mountChart({ '<-records': '$.data.byKey' }, { data: { byKey: { a: { month: 'A', revenue: 1, cost: 2 }, b: { month: 'B', revenue: 3, cost: 4 } } } });

        // Assert
        expect(marks(mounted, 'text.tick.x').map((tick) => tick.textContent)).toEqual(['A', 'B']);
        expect(marks(mounted, 'rect.bar')).toHaveLength(4);
    });

    it('should remove its marks on dispose', async () => {
        // Arrange
        const mounted = await mountChart();
        const svg = svgOf(mounted);

        // Act
        mounted.dispose();

        // Assert
        expect(svg.querySelectorAll('rect').length).toBe(0);
    });
});
