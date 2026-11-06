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
    { month: 'Mar', revenue: 3000, cost: 1200 }
];
const SERIES = { revenue: { field: 'revenue', _label: 'Revenue' }, cost: { field: 'cost', _label: 'Cost' } };
const SHARES = [
    { kind: 'Food', amount: 50 },
    { kind: 'Rent', amount: 30 },
    { kind: 'Fun', amount: 20 }
];

type ChartKind = 'bar' | 'line' | 'area' | 'donut';

/** One element of a layer as written: its name, its attributes and its text */
type Written = readonly [tag: string, attrs: Readonly<Record<string, string>>, text: string];

interface Captured {
    readonly viewBox: string;
    readonly elements: readonly Written[];
}

/**
 * What the old SVG scene (`src/shared/chart/svgScene.ts`, removed in G2.2 of the graphics epic 2) wrote for these
 * fixtures at 400 pixels wide: every element of the `grid`, `axes` and `marks` layers in order, captured from the
 * chart before the switch to the drawing renderer
 */
const BEFORE: Readonly<Record<ChartKind, Captured>> = {
    bar: {
        viewBox: '0 0 400 216',
        elements: [
            ['line', { class: 'gridline zero', x1: '49', x2: '388', y1: '192', y2: '192' }, ''],
            ['line', { class: 'gridline', x1: '49', x2: '388', y1: '130.67', y2: '130.67' }, ''],
            ['line', { class: 'gridline', x1: '49', x2: '388', y1: '69.33', y2: '69.33' }, ''],
            ['line', { class: 'gridline', x1: '49', x2: '388', y1: '8', y2: '8' }, ''],
            ['text', { class: 'tick y', x: '41', y: '192', dy: '0.32em' }, '0'],
            ['text', { class: 'tick y', x: '41', y: '130.67', dy: '0.32em' }, '1,000'],
            ['text', { class: 'tick y', x: '41', y: '69.33', dy: '0.32em' }, '2,000'],
            ['text', { class: 'tick y', x: '41', y: '8', dy: '0.32em' }, '3,000'],
            ['line', { class: 'baseline', x1: '49', x2: '388', y1: '192', y2: '192' }, ''],
            ['text', { class: 'tick x', x: '112.56', y: '210' }, 'Jan'],
            ['text', { class: 'tick x', x: '218.5', y: '210' }, 'Feb'],
            ['text', { class: 'tick x', x: '324.44', y: '210' }, 'Mar'],
            ['rect', { class: 'bar s1', x: '70.19', y: '130.67', width: '42.38', height: '61.33', 'data-series': 'revenue', 'data-index': '0', role: 'img', 'aria-label': 'Revenue, Jan: 1,000', tabindex: '0', 'data-point': 'bar:revenue:0' }, ''],
            ['rect', { class: 'bar s1', x: '176.13', y: '69.33', width: '42.38', height: '122.67', 'data-series': 'revenue', 'data-index': '1', role: 'img', 'aria-label': 'Revenue, Feb: 2,000', tabindex: '-1', 'data-point': 'bar:revenue:1' }, ''],
            ['rect', { class: 'bar s1', x: '282.06', y: '8', width: '42.38', height: '184', 'data-series': 'revenue', 'data-index': '2', role: 'img', 'aria-label': 'Revenue, Mar: 3,000', tabindex: '-1', 'data-point': 'bar:revenue:2' }, ''],
            ['rect', { class: 'bar s2', x: '112.56', y: '167.47', width: '42.38', height: '24.53', 'data-series': 'cost', 'data-index': '0', role: 'img', 'aria-label': 'Cost, Jan: 400', tabindex: '-1', 'data-point': 'bar:cost:0' }, ''],
            ['rect', { class: 'bar s2', x: '218.5', y: '136.8', width: '42.38', height: '55.2', 'data-series': 'cost', 'data-index': '1', role: 'img', 'aria-label': 'Cost, Feb: 900', tabindex: '-1', 'data-point': 'bar:cost:1' }, ''],
            ['rect', { class: 'bar s2', x: '324.44', y: '118.4', width: '42.38', height: '73.6', 'data-series': 'cost', 'data-index': '2', role: 'img', 'aria-label': 'Cost, Mar: 1,200', tabindex: '-1', 'data-point': 'bar:cost:2' }, '']
        ]
    },
    line: {
        viewBox: '0 0 400 216',
        elements: [
            ['line', { class: 'gridline zero', x1: '49', x2: '388', y1: '192', y2: '192' }, ''],
            ['line', { class: 'gridline', x1: '49', x2: '388', y1: '130.67', y2: '130.67' }, ''],
            ['line', { class: 'gridline', x1: '49', x2: '388', y1: '69.33', y2: '69.33' }, ''],
            ['line', { class: 'gridline', x1: '49', x2: '388', y1: '8', y2: '8' }, ''],
            ['text', { class: 'tick y', x: '41', y: '192', dy: '0.32em' }, '0'],
            ['text', { class: 'tick y', x: '41', y: '130.67', dy: '0.32em' }, '1,000'],
            ['text', { class: 'tick y', x: '41', y: '69.33', dy: '0.32em' }, '2,000'],
            ['text', { class: 'tick y', x: '41', y: '8', dy: '0.32em' }, '3,000'],
            ['line', { class: 'baseline', x1: '49', x2: '388', y1: '192', y2: '192' }, ''],
            ['text', { class: 'tick x', x: '105.5', y: '210' }, 'Jan'],
            ['text', { class: 'tick x', x: '218.5', y: '210' }, 'Feb'],
            ['text', { class: 'tick x', x: '331.5', y: '210' }, 'Mar'],
            ['path', { class: 'line s1', d: 'M105.5 130.67 L218.5 69.33 L331.5 8', 'data-series': 'revenue' }, ''],
            ['circle', { class: 'dot s1', cx: '105.5', cy: '130.67', r: '3', 'data-series': 'revenue', 'data-index': '0', role: 'img', 'aria-label': 'Revenue, Jan: 1,000', tabindex: '0', 'data-point': 'dot:revenue:0' }, ''],
            ['circle', { class: 'dot s1', cx: '218.5', cy: '69.33', r: '3', 'data-series': 'revenue', 'data-index': '1', role: 'img', 'aria-label': 'Revenue, Feb: 2,000', tabindex: '-1', 'data-point': 'dot:revenue:1' }, ''],
            ['circle', { class: 'dot s1', cx: '331.5', cy: '8', r: '3', 'data-series': 'revenue', 'data-index': '2', role: 'img', 'aria-label': 'Revenue, Mar: 3,000', tabindex: '-1', 'data-point': 'dot:revenue:2' }, ''],
            ['path', { class: 'line s2', d: 'M105.5 167.47 L218.5 136.8 L331.5 118.4', 'data-series': 'cost' }, ''],
            ['circle', { class: 'dot s2', cx: '105.5', cy: '167.47', r: '3', 'data-series': 'cost', 'data-index': '0', role: 'img', 'aria-label': 'Cost, Jan: 400', tabindex: '-1', 'data-point': 'dot:cost:0' }, ''],
            ['circle', { class: 'dot s2', cx: '218.5', cy: '136.8', r: '3', 'data-series': 'cost', 'data-index': '1', role: 'img', 'aria-label': 'Cost, Feb: 900', tabindex: '-1', 'data-point': 'dot:cost:1' }, ''],
            ['circle', { class: 'dot s2', cx: '331.5', cy: '118.4', r: '3', 'data-series': 'cost', 'data-index': '2', role: 'img', 'aria-label': 'Cost, Mar: 1,200', tabindex: '-1', 'data-point': 'dot:cost:2' }, '']
        ]
    },
    area: {
        viewBox: '0 0 400 216',
        elements: [
            ['line', { class: 'gridline zero', x1: '49', x2: '388', y1: '192', y2: '192' }, ''],
            ['line', { class: 'gridline', x1: '49', x2: '388', y1: '130.67', y2: '130.67' }, ''],
            ['line', { class: 'gridline', x1: '49', x2: '388', y1: '69.33', y2: '69.33' }, ''],
            ['line', { class: 'gridline', x1: '49', x2: '388', y1: '8', y2: '8' }, ''],
            ['text', { class: 'tick y', x: '41', y: '192', dy: '0.32em' }, '0'],
            ['text', { class: 'tick y', x: '41', y: '130.67', dy: '0.32em' }, '1,000'],
            ['text', { class: 'tick y', x: '41', y: '69.33', dy: '0.32em' }, '2,000'],
            ['text', { class: 'tick y', x: '41', y: '8', dy: '0.32em' }, '3,000'],
            ['line', { class: 'baseline', x1: '49', x2: '388', y1: '192', y2: '192' }, ''],
            ['text', { class: 'tick x', x: '105.5', y: '210' }, 'Jan'],
            ['text', { class: 'tick x', x: '218.5', y: '210' }, 'Feb'],
            ['text', { class: 'tick x', x: '331.5', y: '210' }, 'Mar'],
            ['path', { class: 'area s1', d: 'M105.5 130.67 L218.5 69.33 L331.5 8 L331.5 192 L218.5 192 L105.5 192 Z', 'data-series': 'revenue' }, ''],
            ['path', { class: 'line s1', d: 'M105.5 130.67 L218.5 69.33 L331.5 8', 'data-series': 'revenue' }, ''],
            ['circle', { class: 'dot s1', cx: '105.5', cy: '130.67', r: '3', 'data-series': 'revenue', 'data-index': '0', role: 'img', 'aria-label': 'Revenue, Jan: 1,000', tabindex: '0', 'data-point': 'dot:revenue:0' }, ''],
            ['circle', { class: 'dot s1', cx: '218.5', cy: '69.33', r: '3', 'data-series': 'revenue', 'data-index': '1', role: 'img', 'aria-label': 'Revenue, Feb: 2,000', tabindex: '-1', 'data-point': 'dot:revenue:1' }, ''],
            ['circle', { class: 'dot s1', cx: '331.5', cy: '8', r: '3', 'data-series': 'revenue', 'data-index': '2', role: 'img', 'aria-label': 'Revenue, Mar: 3,000', tabindex: '-1', 'data-point': 'dot:revenue:2' }, ''],
            ['path', { class: 'area s2', d: 'M105.5 167.47 L218.5 136.8 L331.5 118.4 L331.5 192 L218.5 192 L105.5 192 Z', 'data-series': 'cost' }, ''],
            ['path', { class: 'line s2', d: 'M105.5 167.47 L218.5 136.8 L331.5 118.4', 'data-series': 'cost' }, ''],
            ['circle', { class: 'dot s2', cx: '105.5', cy: '167.47', r: '3', 'data-series': 'cost', 'data-index': '0', role: 'img', 'aria-label': 'Cost, Jan: 400', tabindex: '-1', 'data-point': 'dot:cost:0' }, ''],
            ['circle', { class: 'dot s2', cx: '218.5', cy: '136.8', r: '3', 'data-series': 'cost', 'data-index': '1', role: 'img', 'aria-label': 'Cost, Feb: 900', tabindex: '-1', 'data-point': 'dot:cost:1' }, ''],
            ['circle', { class: 'dot s2', cx: '331.5', cy: '118.4', r: '3', 'data-series': 'cost', 'data-index': '2', role: 'img', 'aria-label': 'Cost, Mar: 1,200', tabindex: '-1', 'data-point': 'dot:cost:2' }, '']
        ]
    },
    donut: {
        viewBox: '0 0 400 216',
        elements: [
            ['text', { class: 'total', x: '200', y: '102' }, '100'],
            ['text', { class: 'total-label', x: '200', y: '114.6', dy: '1em' }, 'Total'],
            ['path', { class: 'slice s1', d: 'M200 8 A100 100 0 0 1 200 208 L200 168 A60 60 0 0 0 200 48 Z', 'data-series': 'spend', 'data-index': '0', role: 'img', 'aria-label': 'Food: 50 (50%)', tabindex: '0', 'data-point': 'slice:0' }, ''],
            ['path', { class: 'slice s2', d: 'M200 208 A100 100 0 0 1 104.89 77.1 L142.94 89.46 A60 60 0 0 0 200 168 Z', 'data-series': 'spend', 'data-index': '1', role: 'img', 'aria-label': 'Rent: 30 (30%)', tabindex: '-1', 'data-point': 'slice:1' }, ''],
            ['path', { class: 'slice s3', d: 'M104.89 77.1 A100 100 0 0 1 200 8 L200 48 A60 60 0 0 0 142.94 89.46 Z', 'data-series': 'spend', 'data-index': '2', role: 'img', 'aria-label': 'Fun: 20 (20%)', tabindex: '-1', 'data-point': 'slice:2' }, '']
        ]
    }
};

/** Geometry attributes, compared as numbers (the renderer writes them through its own number formatting) */
const GEOMETRY = ['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2'];

/** The text offsets of the old scene as the `dominant-baseline` the renderer writes: the one listed difference */
const BASELINE_OF_DY: Readonly<Record<string, string>> = { '0.32em': 'middle', '1em': 'hanging' };

/**
 * Attributes the renderer adds that the old scene did not write: its own path and kind, the paint that replaced the
 * `s1`..`s8` classes and the mark stylesheet rules, and the text anchor and baseline it always writes
 */
const ADDED = new Set(['data-shape-path', 'data-shape-kind', 'fill', 'stroke', 'stroke-width', 'opacity', 'stroke-linecap', 'stroke-linejoin', 'text-anchor', 'dominant-baseline']);

/** Bars, areas, points and slices take the series colour as their fill; a line as its stroke */
const PAINTED_BY: Readonly<Record<string, 'fill' | 'stroke'>> = { bar: 'fill', area: 'fill', dot: 'fill', slice: 'fill', line: 'stroke' };

const mountChart = async (type: ChartKind): Promise<MountedComponent> => {
    const properties =
        type === 'donut'
            ? { type, x: 'kind', series: { spend: { field: 'amount', _label: 'Spend' } }, '<-records': '$.data.shares', _title: 'Spending' }
            : { type, x: 'month', series: SERIES, '<-records': '$.data.sales', _title: 'Sales' };
    const mounted = mountComponent('chart', properties, { data: { sales: SALES.map((row) => ({ ...row })), shares: SHARES.map((row) => ({ ...row })) } });
    (mounted.element as HTMLElement).style.inlineSize = '400px';
    await flush();
    await frames(4);
    return mounted;
};

const svgOf = (mounted: MountedComponent): SVGSVGElement => mounted.element.shadowRoot?.querySelector('svg') as SVGSVGElement;

/** The computed colour of a custom property of the theme, read through a probe in the chart's shadow root */
const tokenColour = (mounted: MountedComponent, name: string): string => {
    const probe = document.createElement('div');
    probe.style.color = `var(${name})`;
    (mounted.element.shadowRoot as ShadowRoot).append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
};

describe('chart parity with the old SVG scene in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it.each(['bar', 'line', 'area', 'donut'] as const)('should write the same elements and attributes for a %s chart', async (type) => {
        // Arrange
        const before = BEFORE[type];

        // Act
        const mounted = await mountChart(type);
        const svg = svgOf(mounted);
        const after = Array.from(svg.querySelectorAll('g.layer > *'));

        // Assert
        expect(svg.getAttribute('viewBox')).toBe(before.viewBox);
        expect(after.map((element) => element.localName)).toEqual(before.elements.map(([tag]) => tag));
        before.elements.forEach(([, attrs, text], at) => {
            const element = after[at] as Element;
            const where = `${type} element ${at} (${attrs['class']})`;
            expect(element.textContent, where).toBe(text);
            for (const [name, value] of Object.entries(attrs)) {
                if (name === 'class') {
                    const words = value.split(' ');
                    const series = words.find((word) => /^s\d+$/.test(word));
                    expect(element.getAttribute('class'), where).toBe(words.filter((word) => word !== series).join(' '));
                    if (series !== undefined) {
                        const paint = PAINTED_BY[words[0] as string] as 'fill' | 'stroke';
                        expect(element.getAttribute(paint), where).toBe(`var(--ui-color-data-categorical-${series.slice(1)})`);
                    }
                } else if (name === 'dy') {
                    // The one listed difference: `dy` is written as `dominant-baseline`
                    expect(element.hasAttribute('dy'), where).toBe(false);
                    expect(element.getAttribute('dominant-baseline'), where).toBe(BASELINE_OF_DY[value]);
                } else if (GEOMETRY.includes(name)) {
                    expect(Number(element.getAttribute(name)), `${where} ${name}`).toBe(Number(value));
                } else {
                    expect(element.getAttribute(name), `${where} ${name}`).toBe(value);
                }
            }
            const added = Array.from(element.attributes)
                .map((attr) => attr.name)
                .filter((name) => !Object.hasOwn(attrs, name) && !ADDED.has(name));
            expect(added, where).toEqual([]);
        });
    });

    it('should fill a bar with the first data token, and stroke a focused mark with the focus ring', async () => {
        // Arrange
        const mounted = await mountChart('bar');
        const bar = svgOf(mounted).querySelector<SVGElement>('[data-point="bar:revenue:0"]') as SVGElement;

        // Act
        const fill = getComputedStyle(bar).fill;
        bar.focus();
        await frames(1);

        // Assert
        expect(fill).toBe(tokenColour(mounted, '--ui-color-data-categorical-1'));
        expect(bar.matches(':focus-visible')).toBe(true);
        expect(getComputedStyle(bar).stroke).toBe(tokenColour(mounted, '--ui-color-focus'));
    });
});
