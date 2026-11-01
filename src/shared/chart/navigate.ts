import type { Point } from './scene.js';

/** The keys that move between data points */
export const POINT_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'] as const;

/**
 * The id of the point a key moves to from the point `from`, or `undefined` when the key does not move there. Left and
 * Right (swapped in right-to-left text) go to the previous and next category of the same series; Up and Down go to the
 * previous and next series at the same category; Home and End go to the first and last category of the series. In a
 * `ring` (a donut, whose points are slices of one series) all four arrows step round the slices. Moves stop at the ends
 */
export function pointAfter(points: readonly Point[], from: string, key: string, options: { rtl?: boolean; ring?: boolean } = {}): string | undefined {
    const current = points.find((point) => point.id === from);
    if (current === undefined) return undefined;
    const sameSeries = points.filter((point) => point.series === current.series).sort((a, b) => a.index - b.index);
    const place = sameSeries.findIndex((point) => point.id === from);
    const forward = options.rtl === true ? 'ArrowLeft' : 'ArrowRight';
    const backward = options.rtl === true ? 'ArrowRight' : 'ArrowLeft';
    const ring = options.ring === true;
    if (key === forward || (ring && key === 'ArrowDown')) return sameSeries[place + 1]?.id;
    if (key === backward || (ring && key === 'ArrowUp')) return sameSeries[place - 1]?.id;
    if (key === 'Home') return sameSeries[0]?.id;
    if (key === 'End') return sameSeries[sameSeries.length - 1]?.id;
    if (key === 'ArrowUp' || key === 'ArrowDown') {
        const step = key === 'ArrowDown' ? 1 : -1;
        const best = points.filter((point) => point.index === current.index && point.series === current.series + step);
        return best[0]?.id;
    }
    return undefined;
}

/** The id of the point that is the tab stop: the one that holds the focus when it is still shown, otherwise the first point */
export function tabStop(points: readonly Point[], preferred: string | undefined): string | undefined {
    if (preferred !== undefined && points.some((point) => point.id === preferred)) return preferred;
    return points[0]?.id;
}
