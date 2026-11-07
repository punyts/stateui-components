import type { TickFormatter } from './scale.js';

/** The chart types: the three that share axes, and the donut, which has a ring instead */
export const CHART_TYPES = ['bar', 'line', 'area', 'donut'] as const;

export type ChartType = (typeof CHART_TYPES)[number];

/** How many categorical data colours the theme has: series (or donut slices) past the eighth start again at the first */
export const SERIES_COLORS = 8;

/** The colour class of a series or slice: `s1` to `s8` by position, starting again after the eighth */
export const seriesClass = (position: number): string => `s${(position % SERIES_COLORS) + 1}`;

export interface SeriesInput {
    /** The key of the series in the `series` map */
    readonly key: string;
    /** The text of the series: its legend entry, and its name in a tooltip and the data table */
    readonly label: string;
    readonly values: readonly number[];
}

/** The texts a chart needs besides its data; they are the content properties of the node, so they follow the language */
export interface ChartTexts {
    /** The label under the total in the centre of a donut */
    readonly total: string;
    /** The header of the category column of the data table */
    readonly category: string;
    /** The header of the value column of a donut's data table */
    readonly value: string;
    /** The header of the share column of a donut's data table, and the label of a slice's share in its tooltip */
    readonly share: string;
}

export interface ChartInput {
    readonly type: ChartType;
    readonly categories: readonly string[];
    readonly series: readonly SeriesInput[];
    readonly stacked: boolean;
    readonly width: number;
    readonly height: number;
    /** Formats a value for the value axis, the tooltip and the table; the chart passes the shared formatter for `$.locale` */
    readonly format: TickFormatter;
    /** Formats a share from 0 to 1 */
    readonly percent: TickFormatter;
    /** The series keys, or for a donut the slice labels, that the user hid with the legend */
    readonly hidden: ReadonlySet<string>;
    readonly texts: ChartTexts;
}

/** A ring sector: the centre, the outer and inner radii, and the angles (radians, clockwise from the right) a slice spans */
export interface Sector {
    readonly cx: number;
    readonly cy: number;
    readonly outer: number;
    readonly inner: number;
    readonly from: number;
    readonly to: number;
}

/** One SVG element of a chart: where it lives, what it is and what it looks like. `id` is stable between draws, so a redraw writes only what changed */
export interface Primitive {
    readonly id: string;
    readonly layer: 'grid' | 'axes' | 'marks';
    readonly tag: 'line' | 'text' | 'rect' | 'path' | 'circle';
    readonly className: string;
    readonly attrs: Readonly<Record<string, string>>;
    readonly text?: string;
    /** The sector a donut slice's `d` is drawn from, so a `transition` can tween its angles (G2.4b); not drawn as such */
    readonly sector?: Sector;
}

/** One line of a tooltip: a series (or slice share) and its value, with the colour class of the series */
export interface TipRow {
    readonly label: string;
    readonly value: string;
    /** The colour class (`s1` to `s8`), or empty for a row that has no colour */
    readonly colour: string;
    /** Whether the row is the point itself, as against the other series at the same category */
    readonly current: boolean;
}

/** A data point: a bar, a line or area point, or a slice. The tooltip, the keyboard and the accessible name come from it */
export interface Point {
    /** The id of the mark primitive that draws it */
    readonly id: string;
    /** The place of its series among the shown ones (always 0 for a donut) and of its category among the shown ones */
    readonly series: number;
    readonly index: number;
    /** Where a tooltip points at, in pixels from the top left of the plot */
    readonly x: number;
    readonly y: number;
    readonly title: string;
    readonly rows: readonly TipRow[];
    /** The accessible name of the mark */
    readonly label: string;
}

export interface Scene {
    readonly viewBox: string;
    readonly primitives: readonly Primitive[];
    /** The plot area in pixels: where the axes meet the marks */
    readonly plot: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
    readonly points: readonly Point[];
}

const DECIMALS = 2;

/** A number as written in an SVG attribute: at most two decimals */
export const px = (value: number): string => String(Number(value.toFixed(DECIMALS)));

/** Attributes from numbers and text; numbers are written with `px` */
export const attrs = (values: Record<string, number | string>): Record<string, string> =>
    Object.fromEntries(Object.entries(values).map(([name, value]) => [name, typeof value === 'number' ? px(value) : value]));

export const emptyScene = (width: number, height: number): Scene => ({
    viewBox: `0 0 ${px(Math.max(width, 0))} ${px(Math.max(height, 0))}`,
    primitives: [],
    plot: { left: 0, top: 0, right: 0, bottom: 0 },
    points: []
});

/** What a mark carries so a pointer, the keyboard and a screen reader can reach it: a name, a place in the tab order (the controller picks the one stop) and the point id */
export const markAttrs = (id: string, label: string): Record<string, string> => ({ role: 'img', 'aria-label': label, tabindex: '-1', 'data-point': id });
