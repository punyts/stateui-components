import { report } from '@punyts/core';
import type { ControllerContext } from '@punyts/stateui';
import { buildScene } from '../shared/chart/chart.js';
import { readCategories, readKeys, readRows, readSeries, readValues } from '../shared/chart/data.js';
import { primitivePath, sceneToTree } from '../shared/chart/drawingTree.js';
import { POINT_KEYS, pointAfter, tabStop } from '../shared/chart/navigate.js';
import { CHART_TYPES, px, seriesClass } from '../shared/chart/scene.js';
import type { ChartInput, ChartType, Point } from '../shared/chart/scene.js';
import type { ViewBox } from '../shared/drawing/geometry.js';
import { createDrawingRenderer, drawingIssueError } from '../shared/drawing/render.js';
import type { DrawingIssue, DrawingRenderer } from '../shared/drawing/render.js';
import '../shared/drawing/svgRenderer.js';
import { createDataTable, tableModel } from '../shared/chart/table.js';
import type { DataTable } from '../shared/chart/table.js';
import { createPopover } from '../shared/popover/popover.js';
import type { PopoverHandle } from '../shared/popover/popover.js';
import { formatValue } from '../shared/format/format.js';
import { isUnrendered } from '../shared/records/viewport.js';

const text = (value: unknown, fallback = ''): string => (typeof value === 'string' && value !== '' ? value : fallback);
const TIP_ANCHOR = '--chart-point';

/** The scene's `viewBox` (`0 0 <width> <height>`) as the box the renderer writes back unchanged */
const viewBoxOf = (value: string): ViewBox => {
    const [x = 0, y = 0, width = 0, height = 0] = value.split(' ').map(Number);
    return { x, y, width, height };
};

interface LegendItem {
    key: string;
    label: string;
    color: string;
    hidden: boolean;
}

/**
 * Draws the records through the SVG renderer of the drawing model (`createDrawingRenderer`, G2.2 of the graphics epic 2):
 * the scene (`buildScene`) becomes a shape tree (`sceneToTree`) that the renderer draws into an `svg` it adds to the
 * plot (the template parser makes every element HTML, so an `svg` in the view would not draw). The controller gives
 * that `svg` `role="group"`, labels it by `_title` and describes it by `_description`; the renderer writes only its
 * own attributes there, among them the `viewBox`, which the chart gives it as `0 0 <width> <height>`. The size comes
 * from a `ResizeObserver` on the plot; scales, ticks and marks come from `src/shared/chart/` (`scale.ts`,
 * `geometry.ts`, `donut.ts`), and labels from the shared formatter for `$.locale`. Series colours are the tokens
 * `color.data.categorical.1` to `8` in key order, written by the tree as paint; a donut colours its slices.
 *
 * Shapes have stable paths from the primitive ids, so a data change recomputes the scene and the renderer writes only the
 * attributes that differ: one changed value touches its own mark. A change of the series, of `type` or of `stacked`
 * clears the drawing and draws it again. Nothing reads layout: the size is the observer's, and the margins are estimated
 * from the label text.
 *
 * `type: "donut"` draws the first series as arcs with the total in the centre. The legend (`legend`: `bottom`, `end`,
 * `none`) lists the series (the slices of a donut); pressing an entry writes its key (a donut: the slice label) to or
 * from `hiddenSeries`, and the chart draws without it. Every bar, point and slice is a mark with `role="img"` and a name:
 * one is the tab stop, the arrow keys move between marks (Left and Right between categories, Up and Down between series,
 * Home and End to the ends), and hovering or focusing a mark shows its values in a tooltip drawn with the shared popover
 * code, anchored by custom properties on an element in the plot (an SVG mark cannot be a CSS anchor). A visually hidden
 * `table` with all the values follows the data.
 *
 * With `interactive` (G2.4 of the graphics epic 2) a click on a mark, or Enter or Space while it has focus, raises
 * `press` on the element with `detail: { key, series }`: the key of the mark's record (an array's index as a string, a
 * keyed map's key, as `readKeys` gives them) and the series key (a donut's slice: its record and the first series).
 * The chart raises it itself instead of making its shapes `interactive`, so the marks keep `role="img"`, their names
 * and the single tab stop. A hidden series draws no marks, so it has nothing to press. Without `interactive` a mark
 * raises nothing
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const recordsPath = `${basePath}.records`;
    const hiddenPath = `${basePath}.hiddenSeries`;
    const itemsPath = `${basePath}.legendItems`;
    let disposed = false;
    let scheduled = false;
    let width = 0;
    let height = 0;
    let renderer: DrawingRenderer | undefined;
    let viewBox: ViewBox = { x: 0, y: 0, width: 0, height: 0 };
    let svgElement: SVGSVGElement | undefined;
    let dataTable: DataTable | undefined;
    let popover: PopoverHandle | undefined;
    let observer: ResizeObserver | undefined;
    let structure = '';
    let points = new Map<string, Point>();
    let ordered: Point[] = [];
    let active: string | undefined;
    let stop: { id: string; element: SVGElement } | undefined;
    let tipFor: string | undefined;
    let legendJson = '';
    /** The record key of each category position (a mark's `data-index`), from the last draw */
    let recordKeys: string[] = [];

    const part = (selector: string): HTMLElement | null => element.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
    const rtl = (): boolean => getComputedStyle(element).direction === 'rtl';
    /** The element of the mark of a point id, as the renderer drew it */
    const markOf = (id: string): SVGElement | undefined => renderer?.elementOf(primitivePath({ id, layer: 'marks' })) as SVGElement | undefined;
    const readHidden = (): Set<string> => new Set((Array.isArray(read('hiddenSeries')) ? (read('hiddenSeries') as unknown[]) : []).filter((item): item is string => typeof item === 'string'));

    /** Moves the single tab stop to the point `id` (or the first point when it is gone); only the two marks involved are written */
    const syncStop = (): void => {
        if (renderer === undefined) return;
        const id = tabStop(ordered, active);
        const target = id === undefined ? undefined : markOf(id);
        if (stop === undefined ? target === undefined : stop.id === id && stop.element === target) return;
        if (stop !== undefined && stop.element.isConnected) stop.element.setAttribute('tabindex', '-1');
        stop = id === undefined || target === undefined ? undefined : { id, element: target };
        stop?.element.setAttribute('tabindex', '0');
    };

    const fillTip = (point: Point): void => {
        const tip = part('.tip');
        if (!tip) return;
        const document = tip.ownerDocument;
        const title = document.createElement('div');
        title.className = 'tip-title';
        title.textContent = point.title;
        const rows = point.rows.map((row) => {
            const line = document.createElement('div');
            line.className = row.current ? 'tip-row current' : 'tip-row';
            if (row.colour !== '') {
                const swatch = document.createElement('span');
                swatch.className = 'tip-swatch';
                swatch.dataset['color'] = row.colour;
                line.append(swatch);
            }
            const label = document.createElement('span');
            label.textContent = row.label;
            const value = document.createElement('span');
            value.className = 'tip-value';
            value.textContent = row.value;
            line.append(label, value);
            return line;
        });
        tip.replaceChildren(title, ...rows);
    };
    const showTip = (id: string): void => {
        const point = points.get(id);
        const anchor = part('.anchor');
        if (point === undefined || anchor === null || popover === undefined) return;
        anchor.style.setProperty('--sui-ax', `${px(point.x)}px`);
        anchor.style.setProperty('--sui-ay', `${px(point.y)}px`);
        fillTip(point);
        tipFor = id;
        popover.open();
    };
    const hideTip = (): void => {
        tipFor = undefined;
        popover?.close();
    };

    const legendOf = (input: ChartInput, hidden: ReadonlySet<string>): LegendItem[] =>
        input.type === 'donut'
            ? input.categories.map((label, at) => ({ key: label, label, color: seriesClass(at), hidden: hidden.has(label) }))
            : input.series.map((entry, at) => ({ key: entry.key, label: entry.label, color: seriesClass(at), hidden: hidden.has(entry.key) }));

    const draw = (): void => {
        scheduled = false;
        if (disposed || renderer === undefined) return;
        const records = read('records');
        const rows = readRows(records);
        recordKeys = readKeys(records);
        const specs = readSeries(read('series'));
        const type: ChartType = CHART_TYPES.find((candidate) => candidate === read('type')) ?? 'bar';
        const stacked = read('stacked') === true;
        const next = `${type}|${stacked}|${specs.map((spec) => `${spec.key}:${spec.field}`).join(',')}`;
        if (next !== structure) {
            structure = next;
            renderer.update([]);
            stop = undefined;
        }
        const digits = read('fractionDigits');
        const shareOptions = { format: text(read('format'), 'number'), currency: text(read('currency')), locale: text(store.get<unknown>('$.locale')) };
        const options = typeof digits === 'number' ? { ...shareOptions, fractionDigits: digits } : shareOptions;
        const hidden = readHidden();
        const input: ChartInput = {
            type,
            categories: readCategories(rows, text(read('x'), 'x')),
            series: specs.map((spec) => ({ key: spec.key, label: spec.label, values: readValues(rows, spec.field) })),
            stacked,
            width,
            height,
            format: (value) => formatValue(value, options),
            percent: (share) => formatValue(share, { ...shareOptions, format: 'percent' }),
            hidden,
            texts: { total: text(read('_total')), category: text(read('_category')), value: text(read('_value')), share: text(read('_share')) }
        };
        const description = text(read('_description'));
        if (description === '') svgElement?.removeAttribute('aria-describedby');
        else svgElement?.setAttribute('aria-describedby', 'description');
        const scene = buildScene(input);
        viewBox = viewBoxOf(scene.viewBox);
        renderer.update(sceneToTree(scene).shapes);
        ordered = [...scene.points];
        points = new Map(scene.points.map((point) => [point.id, point]));
        syncStop();
        if (tipFor !== undefined) {
            if (points.has(tipFor)) showTip(tipFor);
            else hideTip();
        }
        dataTable?.draw(text(read('_title')), tableModel(input));
        const items = legendOf(input, hidden);
        const json = JSON.stringify(items);
        if (json !== legendJson) {
            legendJson = json;
            store.set(itemsPath, Object.fromEntries(items.map((item, at) => [String(at), item])));
        }
    };
    const schedule = (): void => {
        if (scheduled || disposed) return;
        scheduled = true;
        queueMicrotask(draw);
    };

    const recordPaths = (): string[] => [
        recordsPath,
        `${recordsPath}.$every`,
        ...[text(read('x'), 'x'), ...readSeries(read('series')).map((spec) => spec.field)].map((field) => `${recordsPath}.$every.${field}`)
    ];
    const propertyPaths = ['type', 'x', 'series', 'series.$all', 'stacked', 'format', 'currency', 'fractionDigits', 'hiddenSeries', 'hiddenSeries.$all', '_title', '_description', '_total', '_category', '_value', '_share']
        .map((name) => `${basePath}.${name}`)
        .concat('$.locale');
    let watchedRecords = recordPaths();
    const onShape = (): void => {
        store.off(watchedRecords, schedule);
        watchedRecords = recordPaths();
        store.on(watchedRecords, schedule);
        schedule();
    };
    store.on(watchedRecords, schedule);
    store.on(propertyPaths, onShape);

    //the view is drawn once the controller has returned, so the SVG and the observer start in the next microtask
    const start = (attempts: number): void => {
        if (disposed) return;
        const plot = part('.plot');
        const tip = part('.tip');
        const data = part('.data');
        if (!plot || !tip || !data) {
            if (attempts > 0) queueMicrotask(() => start(attempts - 1));
            return;
        }
        renderer = createDrawingRenderer(plot, {
            renderer: 'svg',
            get viewBox(): ViewBox {
                return viewBox;
            },
            reducedMotion: () => false,
            readProperty: () => undefined,
            onEvent: () => undefined,
            onIssue: (issue: DrawingIssue) => {
                const error = drawingIssueError(issue);
                report.error(error.message, { code: error.code, path: basePath });
            }
        });
        const svg = plot.querySelector<SVGSVGElement>(':scope > svg');
        if (svg !== null) {
            //first in the plot as before, so the anchor and the tip follow it
            plot.prepend(svg);
            svg.setAttribute('role', 'group');
            svg.setAttribute('aria-labelledby', 'title');
            for (const [type, handler] of Object.entries(handlers)) svg.addEventListener(type, handler as EventListener);
            svgElement = svg;
        }
        dataTable = createDataTable(data);
        popover = createPopover({ element: tip, placement: 'top', anchor: TIP_ANCHOR, onDismiss: () => (tipFor = undefined) });
        observer = new ResizeObserver((entries) => {
            //a hidden chart (a section or tab not shown) keeps its last drawing instead of redrawing at no size and again when shown
            const shown = entries.filter((entry) => !isUnrendered(entry));
            if (shown.length === 0) return;
            for (const entry of shown) {
                width = entry.contentRect.width;
                height = entry.contentRect.height;
            }
            //the redraw can change the layout (the legend), so it waits for the next frame instead of looping inside the observer
            requestAnimationFrame(schedule);
        });
        observer.observe(plot);
        schedule();
    };
    queueMicrotask(() => start(8));

    const pointOf = (target: EventTarget | null): string | undefined => {
        const mark = target instanceof Element ? target.closest('[data-point]') : null;
        return mark?.getAttribute('data-point') ?? undefined;
    };

    /** Raises `press` for the mark `target` is in, when the chart is `interactive`; true when it raised one */
    const press = (target: EventTarget | null): boolean => {
        if (read('interactive') !== true) return false;
        const mark = target instanceof Element ? target.closest('[data-point]') : null;
        const series = mark?.getAttribute('data-series') ?? null;
        const index = mark?.getAttribute('data-index') ?? null;
        const key = index === null ? undefined : recordKeys[Number(index)];
        if (series === null || key === undefined) return false;
        element.dispatchEvent(new CustomEvent('press', { detail: { key, series }, bubbles: true, composed: true }));
        return true;
    };

    const handlers = {
        click: (event: MouseEvent) => {
            press(event.target);
        },
        pointerover: (event: PointerEvent) => {
            const id = pointOf(event.target);
            if (id !== undefined) showTip(id);
        },
        pointerout: (event: PointerEvent) => {
            if (pointOf(event.relatedTarget) !== undefined) return;
            const focused = element.shadowRoot?.activeElement;
            if (focused instanceof Element && focused.hasAttribute('data-point')) showTip(focused.getAttribute('data-point') as string);
            else hideTip();
        },
        focusin: (event: FocusEvent) => {
            const id = pointOf(event.target);
            if (id === undefined) return;
            active = id;
            syncStop();
            showTip(id);
        },
        focusout: (event: FocusEvent) => {
            if (pointOf(event.relatedTarget) === undefined) hideTip();
        },
        keydown: (event: KeyboardEvent) => {
            if ((event.key === 'Enter' || event.key === ' ') && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey) {
                //Space would scroll the page and Enter could submit a form around the chart
                if (press(event.target)) event.preventDefault();
                return;
            }
            if (event.altKey || event.ctrlKey || event.metaKey || !(POINT_KEYS as readonly string[]).includes(event.key)) return;
            const from = pointOf(event.target);
            if (from === undefined) return;
            event.preventDefault();
            const next = pointAfter(ordered, from, event.key, { rtl: rtl(), ring: read('type') === 'donut' });
            if (next !== undefined) markOf(next)?.focus();
        }
    };

    return {
        onLegend: (event: MouseEvent) => {
            const key = (event.currentTarget as HTMLElement | null)?.dataset['key'];
            if (key === undefined) return;
            const hidden = readHidden();
            if (!hidden.delete(key)) hidden.add(key);
            store.set(hiddenPath, [...hidden]);
        },
        dispose: () => {
            disposed = true;
            observer?.disconnect();
            store.off(watchedRecords, schedule);
            store.off(propertyPaths, onShape);
            if (svgElement) for (const [type, handler] of Object.entries(handlers)) svgElement.removeEventListener(type, handler as EventListener);
            popover?.dispose();
            dataTable?.clear();
            //every shape is removed first, so nothing is left in the svg the renderer takes away
            renderer?.update([]);
            renderer?.dispose();
        }
    };
}
