import { afterEach, describe, expect, it } from 'vitest';
import { buildScene } from '../../src/shared/chart/chart.js';
import { formatOnce, readCategories, readValues } from '../../src/shared/chart/data.js';
import { interactiveMarks, sceneToTree } from '../../src/shared/chart/drawingTree.js';
import type { ChartInput } from '../../src/shared/chart/scene.js';
import type { CanvasDrawingRenderer } from '../../src/shared/drawing/canvasRenderer.js';
import '../../src/shared/drawing/canvasRenderer.js';
import { createDrawingRenderer } from '../../src/shared/drawing/render.js';
import type { DrawingRenderer } from '../../src/shared/drawing/render.js';
import '../../src/shared/drawing/svgRenderer.js';
import { formatValue } from '../../src/shared/format/format.js';
import { medianMsAsync } from '../harness/medianMs.js';
import { mountComponent } from '../harness/mountComponent.js';

// A timing test: it runs on its own (`npm run test:perf`, files one at a time), not in the parallel browser run,
// where other files share the machine and its 1,500 ms ceiling measures the load, not the chart.

describe('chart of 10 series by 5,000 points', () => {
    afterEach(() => mountComponent.unmountAll());

    const SERIES_COUNT = 10;
    const POINTS = 5000;
    const WIDTH = 960;
    const HEIGHT = 320;
    const FIELDS = 'abcdefghij'.split('');
    const records = Array.from({ length: POINTS }, (_, at) => {
        const row: Record<string, unknown> = { x: at };
        // Short names and two-digit values keep the data under the document's data limit (512 KiB)
        for (let s = 0; s < SERIES_COUNT; s += 1) row[FIELDS[s] as string] = Math.round(50 + 45 * Math.sin(at / 50 + s));
        return row;
    });
    const series = Object.fromEntries(Array.from({ length: SERIES_COUNT }, (_, s) => [FIELDS[s] as string, { field: FIELDS[s] as string, _label: `Series ${s}` }]));

    /** The chart's input as its controller makes it: the same rows, series and a value format memoised for the draw */
    const inputOf = (): ChartInput => ({
        type: 'line',
        categories: readCategories(records, 'x'),
        series: FIELDS.map((field, s) => ({ key: field, label: `Series ${s}`, values: readValues(records, field) })),
        stacked: false,
        width: WIDTH,
        height: HEIGHT,
        format: formatOnce((value) => formatValue(value, { format: 'number' })),
        percent: (share) => formatValue(share, { format: 'percent' }),
        hidden: new Set(),
        texts: { total: 'Total', category: 'Category', value: 'Value', share: 'Share' }
    });

    /** One mounted chart from its mount to the moment it sets `data-render="ready"` (the renderer says it is drawn) */
    const mountToReady = async (renderer: 'svg' | 'canvas'): Promise<HTMLElement> => {
        const mounted = mountComponent('chart', { renderer, type: 'line', x: 'x', series, '<-records': '$.data.big', legend: 'none' }, { data: { big: records } });
        const host = mounted.element as HTMLElement;
        host.style.inlineSize = `${WIDTH}px`;
        host.style.display = 'block';
        await new Promise<void>((resolve, reject) => {
            const observer = new MutationObserver(() => {
                if (host.getAttribute('data-render') !== 'ready') return;
                observer.disconnect();
                clearTimeout(timer);
                resolve();
            });
            const timer = setTimeout(() => {
                observer.disconnect();
                reject(new Error(`the chart is still ${host.getAttribute('data-render')}`));
            }, 30_000);
            observer.observe(host, { attributes: true, attributeFilter: ['data-render'] });
        });
        return host;
    };

    /**
     * The median of five first draws of the chart's pipeline: scene, shape tree, interactive marks, and the renderer's
     * update and paint, each on a fresh renderer made ready beforehand (the G1.6 budget test's method, where the
     * renderer's setup is not part of a draw; the one before is disposed first, so the document holds one drawing). The
     * SVG draw of the same scene is timed beside it
     */
    const medianFirstDraw = async (kind: 'svg' | 'canvas'): Promise<number> => {
        const viewBox = { x: 0, y: 0, width: WIDTH, height: HEIGHT };
        let current: { host: HTMLElement; renderer: DrawingRenderer } | undefined;
        const release = (): void => {
            current?.renderer.dispose();
            current?.host.remove();
            current = undefined;
        };
        const prepare = async (): Promise<void> => {
            release();
            const host = document.createElement('div');
            host.style.width = `${WIDTH}px`;
            host.style.height = `${HEIGHT}px`;
            document.body.append(host);
            const renderer = createDrawingRenderer(host, { renderer: kind, viewBox, reducedMotion: () => false, readProperty: () => undefined, onEvent: () => undefined });
            renderer.update([]);
            await renderer.drawn();
            current = { host, renderer };
        };
        const draw = async (): Promise<void> => {
            const renderer = current?.renderer as DrawingRenderer;
            const { shapes } = sceneToTree(buildScene(inputOf()));
            if (kind === 'canvas') {
                renderer.update(interactiveMarks(shapes));
                (renderer as CanvasDrawingRenderer).paint();
            } else renderer.update(shapes);
        };
        const median = await medianMsAsync(draw, 5, 1, prepare);
        release();
        return median;
    };

    it('should draw on canvas with data-render ready and every mark a proxy, the median of five first draws under 1,500 ms', async () => {
        // Act
        const canvas = await medianFirstDraw('canvas');
        const svg = await medianFirstDraw('svg');
        const host = await mountToReady('canvas');
        const proxies = host.shadowRoot?.querySelectorAll('.proxies > button').length;
        const ready = host.getAttribute('data-render');
        const canvasReady = await medianMsAsync(async () => void (await mountToReady('canvas')), 3, 0, () => mountComponent.unmountAll());
        const svgReady = await medianMsAsync(async () => void (await mountToReady('svg')), 3, 1, () => mountComponent.unmountAll());
        console.log(
            `chart 10 x 5,000 line, median first draw: canvas ${Math.round(canvas)} ms, svg ${Math.round(svg)} ms;` +
                ` mount to data-render ready: canvas ${Math.round(canvasReady)} ms, svg ${Math.round(svgReady)} ms`
        );

        // Assert
        expect(ready).toBe('ready');
        expect(proxies).toBe(SERIES_COUNT * POINTS);
        expect(canvas).toBeLessThan(1500);
    }, 180_000);
});
