/** The formats a component shows a number in: `stat` and, later, the `table` and `descriptionList` columns */
export const VALUE_FORMATS = ['number', 'percent', 'currency', 'duration'] as const;

export type ValueFormat = (typeof VALUE_FORMATS)[number];

export interface FormatOptions {
    /** How the value is shown; `number` when it is not one of `VALUE_FORMATS` */
    format?: string;
    /** A BCP 47 language tag, normally `$.locale`; an unusable tag falls back to `en` */
    locale?: string;
    /** An ISO 4217 code, used by `currency`; without one a `currency` value is shown as a plain number */
    currency?: string;
    /** Writes a `+` before a positive value (a `-` is always written), as a change from one value to another is shown */
    signed?: boolean;
    /** Fixes the digits after the decimal separator (0 to 20) for `number`, `percent` and `currency`; without it a number keeps the locale's own, a percent up to one and a currency its own (usually two). Ignored by `duration` */
    fractionDigits?: number;
}

const FALLBACK_LOCALE = 'en';
const MAX_FRACTION_DIGITS = 20;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/** The number a value stands for: a finite number, or text that is one; anything else (empty, null, NaN) is `undefined` */
export function toNumber(value: unknown): number | undefined {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

/** A formatter for `locale` with `options`; an unusable locale or option set is retried with the fallback locale, then gives `undefined` */
function createFormatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat | undefined {
    for (const candidate of [locale, FALLBACK_LOCALE]) {
        try {
            return new Intl.NumberFormat(candidate, options);
        } catch {
            continue;
        }
    }
    return undefined;
}

/** The `Intl` options that fix the fraction digits, or `undefined` when `value` is not an integer from 0 to 20 */
function fixedDigits(value: number | undefined): { minimumFractionDigits: number; maximumFractionDigits: number } | undefined {
    if (value === undefined || !Number.isInteger(value) || value < 0 || value > MAX_FRACTION_DIGITS) return undefined;
    return { minimumFractionDigits: value, maximumFractionDigits: value };
}

function formatDuration(seconds: number, locale: string, signed: boolean): string {
    const whole = Math.round(Math.abs(seconds));
    const hours = Math.floor(whole / SECONDS_PER_HOUR);
    const minutes = Math.floor((whole % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    const rest = whole % SECONDS_PER_MINUTE;
    const plain = createFormatter(locale, { useGrouping: false });
    const pair = createFormatter(locale, { useGrouping: false, minimumIntegerDigits: 2 });
    const text = (formatter: Intl.NumberFormat | undefined, part: number): string => formatter?.format(part) ?? String(part);
    const clock =
        hours > 0
            ? `${text(plain, hours)}:${text(pair, minutes)}:${text(pair, rest)}`
            : `${text(plain, minutes)}:${text(pair, rest)}`;
    if (seconds < 0 && whole > 0) return `-${clock}`;
    return signed && whole > 0 ? `+${clock}` : clock;
}

/**
 * Formats a value for display with `Intl` in the given locale: `number` as the locale writes numbers, `percent` from a
 * 0 to 1 value (up to one decimal), `currency` with the ISO 4217 `currency` code, and `duration` from seconds as
 * `m:ss`, or `h:mm:ss` from one hour. Returns an empty string when the value is not a number, so the caller decides
 * what an empty value looks like
 */
export function formatValue(value: unknown, options: FormatOptions = {}): string {
    const amount = toNumber(value);
    if (amount === undefined) return '';
    const locale = options.locale || FALLBACK_LOCALE;
    const signDisplay = options.signed === true ? 'exceptZero' : 'auto';
    const digits = fixedDigits(options.fractionDigits);
    if (options.format === 'duration') return formatDuration(amount, locale, options.signed === true);
    const formatter =
        options.format === 'percent'
            ? createFormatter(locale, { style: 'percent', ...(digits ?? { maximumFractionDigits: 1 }), signDisplay })
            : options.format === 'currency' && options.currency
              ? createFormatter(locale, { style: 'currency', currency: options.currency, ...digits, signDisplay })
              : undefined;
    return (formatter ?? createFormatter(locale, { ...digits, signDisplay }))?.format(amount) ?? String(amount);
}
