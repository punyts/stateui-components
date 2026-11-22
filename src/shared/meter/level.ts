export type MeterLevel = 'good' | 'warning' | 'danger';

const LEVELS: readonly MeterLevel[] = ['good', 'warning', 'danger'];

export const numberOr = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/**
 * The level of a value as the HTML `meter` element decides it. `low` and `high` split the range into a low, a middle
 * and a high region (absent, they are `min` and `max`); the region that holds `optimum` (absent, the middle of the
 * range) is good, a region next to it is a warning, and the region two away is danger
 */
export function meterLevel(value: number, min: number, max: number, low?: number, high?: number, optimum?: number): MeterLevel {
    const floor = Math.min(Math.max(low ?? min, min), max);
    const ceiling = Math.min(Math.max(high ?? max, floor), max);
    const region = (at: number): number => (at < floor ? 0 : at > ceiling ? 2 : 1);
    const distance = Math.abs(region(value) - region(optimum ?? (min + max) / 2));
    return LEVELS[distance] as MeterLevel;
}
