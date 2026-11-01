import type { ControllerContext } from '@punyts/stateui';
import { CARTESIAN_TYPES, buildScene } from '../shared/chart/geometry.js';
import type { CartesianType } from '../shared/chart/geometry.js';
import { readCategories, readRows, readSeries, readValues } from '../shared/chart/data.js';
import { createSvgScene } from '../shared/chart/svgScene.js';
import type { SvgScene } from '../shared/chart/svgScene.js';
import { formatValue } from '../shared/format/format.js';

const text = (value: unknown, fallback = ''): string => (typeof value === 'string' && value !== '' ? value : fallback);

/**
 * Draws the records as SVG (`createElementNS`) in the view's `svg`, which has `role="group"`, is labelled by `_title` and
 * described by `_description`. The size comes from a `ResizeObserver` on the plot; scales, ticks and marks come from
 * `src/shared/chart/` (`scale.ts`, `geometry.ts`), and tick labels from the shared formatter for `$.locale`. Series
 * colours are `color.data.categorical.1` to `8` in key order (the classes `s1` to `s8`).
 *
 * A drawing is a list of primitives with stable ids, so a data change recomputes the scene and writes only the
 * attributes that differ: one changed value touches its mark (and a line's path), not the others. A change of the series
 * (a key added, removed or pointed at another field), of `type` or of `stacked` clears the SVG and draws it again. Nothing
 * reads layout: the size is the observer's, and the margins are estimated from the label text
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const recordsPath = `${basePath}.records`;
    let disposed = false;
    let scheduled = false;
    let width = 0;
    let height = 0;
    let svgScene: SvgScene | undefined;
    let observer: ResizeObserver | undefined;
    let structure = '';

    const draw = (): void => {
        scheduled = false;
        if (disposed || svgScene === undefined) return;
        const rows = readRows(read('records'));
        const specs = readSeries(read('series'));
        const type: CartesianType = CARTESIAN_TYPES.find((candidate) => candidate === read('type')) ?? 'bar';
        const stacked = read('stacked') === true;
        const next = `${type}|${stacked}|${specs.map((spec) => `${spec.key}:${spec.field}`).join(',')}`;
        if (next !== structure) {
            structure = next;
            svgScene.clear();
        }
        const options = { format: text(read('format'), 'number'), currency: text(read('currency')), locale: text(store.get<unknown>('$.locale')) };
        svgScene.draw(
            buildScene({
                type,
                categories: readCategories(rows, text(read('x'), 'x')),
                series: specs.map((spec) => ({ key: spec.key, values: readValues(rows, spec.field) })),
                stacked,
                width,
                height,
                format: (value) => formatValue(value, options)
            })
        );
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
    const propertyPaths = ['type', 'x', 'series', 'series.$all', 'stacked', 'format', 'currency'].map((name) => `${basePath}.${name}`).concat('$.locale');
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
        const root = element.shadowRoot;
        const svg = root?.querySelector('svg');
        const plot = root?.querySelector('.plot');
        if (!svg || !plot) {
            if (attempts > 0) queueMicrotask(() => start(attempts - 1));
            return;
        }
        svgScene = createSvgScene(svg);
        observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                width = entry.contentRect.width;
                height = entry.contentRect.height;
            }
            schedule();
        });
        observer.observe(plot);
        schedule();
    };
    queueMicrotask(() => start(8));

    return {
        dispose: () => {
            disposed = true;
            observer?.disconnect();
            store.off(watchedRecords, schedule);
            store.off(propertyPaths, onShape);
            svgScene?.clear();
        }
    };
}
