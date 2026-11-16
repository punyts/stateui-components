import type { JsonValue } from '@punyts/stateui-app/core';
import type { Scheduler, Timing } from '../drawing/scheduler.js';
import type { ShapeTree } from '../drawing/tree.js';
import { sectorPath } from './donut.js';
import { px } from './scene.js';
import type { Sector } from './scene.js';

/**
 * The geometry of a mark that can tween: the numbers that move, and the form they fit in. Two geometries tween only
 * when their forms are the same (a line keeps its number of points, a bar stays a bar)
 */
export interface MarkGeometry {
    /** `rect`, `circle`, `sector`, or `d:` and the path data with each number as `#` */
    readonly form: string;
    readonly values: readonly number[];
}

/** The numbers of path data as the scene writes them (`px`: plain decimals, a minus sign) */
const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

const RECT = ['x', 'y', 'width', 'height'] as const;
const CIRCLE = ['cx', 'cy', 'r'] as const;

/** The numeric properties of a shape as geometry, or undefined when one is missing */
function numbers(form: string, properties: Readonly<Record<string, JsonValue>>, names: readonly string[]): MarkGeometry | undefined {
    const values = names.map((name) => properties[name]);
    return values.every((value): value is number => typeof value === 'number' && Number.isFinite(value)) ? { form, values } : undefined;
}

/**
 * The geometry of a mark of the chart's tree: a bar's `x y width height`, a point's `cx cy r`, a slice's start and end
 * angles (from its `sector`), and the numbers of a line's or area's path data. Undefined for anything else
 */
export function geometryOf(shape: ShapeTree, sector?: Sector): MarkGeometry | undefined {
    switch (shape.kind) {
        case 'rect':
            return numbers('rect', shape.properties, RECT);
        case 'circle':
            return numbers('circle', shape.properties, CIRCLE);
        case 'path': {
            if (sector !== undefined) return { form: 'sector', values: [sector.from, sector.to] };
            const d = shape.properties.d;
            if (typeof d !== 'string') return undefined;
            return { form: `d:${d.replace(NUMBER, '#')}`, values: (d.match(NUMBER) ?? []).map(Number) };
        }
        default:
            return undefined;
    }
}

/** The mark with its geometry at `values` (of its own form), everything else as it is */
export function withGeometry(shape: ShapeTree, geometry: MarkGeometry, values: readonly number[], sector?: Sector): ShapeTree {
    const properties: Record<string, JsonValue> = { ...shape.properties };
    if (geometry.form === 'rect' || geometry.form === 'circle') {
        (geometry.form === 'rect' ? RECT : CIRCLE).forEach((name, at) => (properties[name] = values[at] as number));
    } else if (geometry.form === 'sector' && sector !== undefined) {
        properties.d = sectorPath({ ...sector, from: values[0] as number, to: values[1] as number });
    } else if (geometry.form.startsWith('d:')) {
        let at = 0;
        properties.d = geometry.form.slice(2).replace(/#/g, () => px(values[at++] as number));
    }
    return { ...shape, properties };
}

const sameValues = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((value, at) => value === b[at]);

/** The motion of a chart's marks (G2.4b of the graphics epic 2) */
export interface ChartMotion {
    /**
     * Takes the tree of a draw and the sectors of its slices by shape path. With `timing` (a change of the records),
     * every mark whose geometry changed and kept its form tweens from where it is on screen (a running tween from its
     * current value) to its new geometry; without it (any other draw) every mark jumps. Gives the tree to draw now
     */
    apply(shapes: readonly ShapeTree[], sectors: ReadonlyMap<string, Sector>, timing: Timing | undefined): readonly ShapeTree[];
    /** The last tree `apply` took, with every running tween at its current value (the same tree when none runs) */
    current(): readonly ShapeTree[];
    /** Stops every tween: the marks show the last tree */
    stop(): void;
}

/** The marks of a chart tree: the children of its `marks` layer */
const marksOf = (shapes: readonly ShapeTree[]): readonly ShapeTree[] => shapes.find((shape) => shape.kind === 'drawGroup' && shape.key === 'marks')?.children ?? [];

/**
 * Follows the geometry of a chart's marks from draw to draw and runs the changes of a records change through the
 * shared scheduler (G1.8), keyed by shape path. Only the marks move: the axes, ticks and gridlines of the new tree are
 * drawn at once. A mark that is new, or whose form changed (a line with more points), jumps, as does every mark when
 * the scheduler's motion is reduced
 */
export function createChartMotion(scheduler: Scheduler): ChartMotion {
    let previous = new Map<string, MarkGeometry>();
    let target: readonly ShapeTree[] = [];
    let sectorsOf: ReadonlyMap<string, Sector> = new Map();

    const stopAll = (): void => {
        for (const key of [...scheduler.keys()]) scheduler.cancel(key);
    };

    const current = (): readonly ShapeTree[] => {
        if (scheduler.idle) return target;
        return target.map((layer) => {
            if (layer.kind !== 'drawGroup' || layer.key !== 'marks') return layer;
            let changed = false;
            const children = layer.children.map((shape) => {
                const value = scheduler.valueOf(shape.path);
                const geometry = previous.get(shape.path);
                if (value === undefined || typeof value === 'number' || geometry === undefined) return shape;
                changed = true;
                return withGeometry(shape, geometry, value, sectorsOf.get(shape.path));
            });
            return changed ? { ...layer, children } : layer;
        });
    };

    return {
        apply(shapes, sectors, timing) {
            target = shapes;
            sectorsOf = sectors;
            const next = new Map<string, MarkGeometry>();
            for (const shape of marksOf(shapes)) {
                const geometry = geometryOf(shape, sectors.get(shape.path));
                if (geometry === undefined) continue;
                next.set(shape.path, geometry);
                if (timing === undefined) continue;
                const before = previous.get(shape.path);
                if (before === undefined || before.form !== geometry.form || before.values.length !== geometry.values.length) {
                    scheduler.cancel(shape.path);
                } else if (!sameValues(before.values, geometry.values)) {
                    const running = scheduler.valueOf(shape.path);
                    scheduler.tween(shape.path, running ?? before.values, geometry.values, timing);
                }
                // An unchanged geometry keeps a running tween going towards it
            }
            if (timing === undefined) stopAll();
            else for (const key of [...scheduler.keys()]) if (!next.has(key)) scheduler.cancel(key);
            previous = next;
            return current();
        },
        current,
        stop: stopAll
    };
}
