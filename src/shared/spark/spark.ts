/** The drawing box of the view's svg (`viewBox="0 0 100 32"`, stretched to the element) and the room kept for the line's ends */
const WIDTH = 100;
const HEIGHT = 32;
const INSET = 2;
const BAR_GAP = 0.2;
const MIN_BAR = 0.5;
const DECIMALS = 2;

const px = (value: number): string => String(Number(value.toFixed(DECIMALS)));

export interface SparkBar {
    readonly x: string;
    readonly y: string;
    readonly width: string;
    readonly height: string;
    readonly negative: boolean;
}

export interface SparkShape {
    /** The path of the line through the values, left to right */
    readonly line: string;
    /** The line closed down to the bottom, for `type: "area"` */
    readonly area: string;
    /** A bar per value from the zero line, keyed `b0`, `b1`… (not integer-like, so the order holds) */
    readonly bars: Readonly<Record<string, SparkBar>>;
}

/** The numbers of a `values` list; anything that is not a finite number is left out */
export const sparkValues = (value: unknown): number[] =>
    Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry)) : [];

/**
 * The shapes of a sparkline in the 100 × 32 box. The line and area span the values' own range (a flat list sits in
 * the middle); the bars span the range with zero in it, so a bar grows up or down from zero
 */
export function sparkShape(values: readonly number[]): SparkShape {
    if (values.length === 0) return { line: '', area: '', bars: {} };
    const low = Math.min(...values);
    const high = Math.max(...values);
    const y = (value: number, from: number, to: number): number => (to > from ? HEIGHT - INSET - ((value - from) / (to - from)) * (HEIGHT - INSET * 2) : HEIGHT / 2);
    const x = (at: number): number => (values.length === 1 ? WIDTH / 2 : (at / (values.length - 1)) * WIDTH);
    const points = values.map((value, at) => [x(at), y(value, low, high)] as const);
    const line = points.map(([left, top], at) => `${at === 0 ? 'M' : 'L'}${px(left)} ${px(top)}`).join(' ');
    const first = points[0] as readonly [number, number];
    const last = points[points.length - 1] as readonly [number, number];
    const area = `${line} L${px(last[0])} ${HEIGHT} L${px(first[0])} ${HEIGHT} Z`;
    const barLow = Math.min(low, 0);
    const barHigh = Math.max(high, 0);
    const zero = y(0, barLow, barHigh);
    const slot = WIDTH / values.length;
    const bars: Record<string, SparkBar> = {};
    values.forEach((value, at) => {
        const top = y(value, barLow, barHigh);
        bars[`b${at}`] = {
            x: px(at * slot + (slot * BAR_GAP) / 2),
            y: px(Math.min(top, zero)),
            width: px(slot * (1 - BAR_GAP)),
            height: px(Math.max(Math.abs(zero - top), MIN_BAR)),
            negative: value < 0
        };
    });
    return { line, area, bars };
}

/** The `_summary` template with its placeholders filled; an unknown placeholder stays as written */
export const fillSummary = (template: string, fields: Readonly<Record<string, string>>): string => template.replace(/\{(\w+)\}/g, (whole, name: string) => fields[name] ?? whole);
