/** The formats a `numberField` shows and parses: `percent` is a 0 to 1 value, shown and typed as a percentage */
export const NUMBER_INPUT_FORMATS = ['number', 'percent', 'currency'] as const;

export type NumberInputFormat = (typeof NUMBER_INPUT_FORMATS)[number];

export interface NumberInputOptions {
    /** `number` when it is not one of `NUMBER_INPUT_FORMATS` */
    format?: string;
    /** A BCP 47 language tag, normally `$.locale`; an unusable tag falls back to `en` */
    locale?: string;
    /** An ISO 4217 code for `currency`; without one a `currency` value is a plain number */
    currency?: string;
}

const FALLBACK_LOCALE = 'en';
/** Wide enough that a locale with a minimum grouping size above 3 digits still shows its group separator */
const PROBE = -1234567.5;
const MINUS_SIGNS = /^[−‐‑‒–—-]/u;
const WHITESPACE = /[\s  ]/gu;
const FRACTION_DIGITS: Readonly<Record<string, number>> = { number: 10, percent: 8 };

/** What a locale writes a number with: its separators, its digits and the marks around a currency or percent value */
interface Symbols {
    group: string;
    decimal: string;
    minus: string;
    digits: readonly string[];
    marks: readonly string[];
}

const create = (locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat | undefined => {
    for (const candidate of [locale, FALLBACK_LOCALE]) {
        try {
            return new Intl.NumberFormat(candidate, options);
        } catch {
            continue;
        }
    }
    return undefined;
};

const styleOf = (options: NumberInputOptions): Intl.NumberFormatOptions => {
    if (options.format === 'percent') return { style: 'percent' };
    if (options.format === 'currency' && options.currency) return { style: 'currency', currency: options.currency };
    return {};
};

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

function symbolsOf(options: NumberInputOptions): Symbols | undefined {
    const locale = options.locale || FALLBACK_LOCALE;
    const style = styleOf(options);
    const styled = create(locale, style);
    const numeric = create(locale, { useGrouping: true, minimumFractionDigits: 1 });
    const plain = create(locale, { useGrouping: false });
    if (!styled || !numeric || !plain) return undefined;
    const parts = numeric.formatToParts(PROBE);
    const part = (type: string): string => parts.find((candidate) => candidate.type === type)?.value ?? '';
    const marks = styled.formatToParts(PROBE).filter((candidate) => candidate.type === 'currency' || candidate.type === 'percentSign').map((candidate) => candidate.value);
    if (options.format === 'currency' && options.currency) marks.push(options.currency);
    return {
        group: part('group').replace(WHITESPACE, ''),
        decimal: part('decimal') || '.',
        minus: part('minusSign') || '-',
        digits: Array.from({ length: 10 }, (_unused, digit) => plain.format(digit)),
        marks
    };
}

/** Writes the digits of `text` as ASCII digits, whatever digits the locale uses */
function asciiDigits(text: string, digits: readonly string[]): string {
    let result = text;
    digits.forEach((digit, index) => {
        if (digit !== String(index)) result = result.split(digit).join(String(index));
    });
    return result;
}

/**
 * Reads what a user typed in a number field the way the locale writes it: `1.234,5` in `de`, `1,234.5` in `en`. A
 * currency symbol or code (`currency`) and a percent sign (`percent`) may be left out or kept, white space is ignored,
 * and a leading minus (the locale's or an ASCII hyphen) or plus is read. The group separator must sit between groups of
 * three digits, so `1,23` in `en` is not a number. A `percent` entry is divided by 100 (`50` is `0.5`). Returns
 * `undefined` for empty or unparseable text
 */
export function parseNumberInput(text: string, options: NumberInputOptions = {}): number | undefined {
    const symbols = symbolsOf(options);
    if (!symbols) return undefined;
    let rest = asciiDigits(text.replace(WHITESPACE, ''), symbols.digits);
    for (const mark of symbols.marks) rest = rest.split(mark).join('');
    let negative = false;
    if (rest.startsWith(symbols.minus) || MINUS_SIGNS.test(rest)) {
        negative = true;
        rest = rest.startsWith(symbols.minus) ? rest.slice(symbols.minus.length) : rest.slice(1);
    } else if (rest.startsWith('+')) {
        rest = rest.slice(1);
    }
    const group = symbols.group === '' ? '' : escape(symbols.group);
    const integer = group === '' ? '\\d*' : `(?:\\d{1,3}(?:${group}\\d{3})+|\\d*)`;
    const match = new RegExp(`^(${integer})(?:${escape(symbols.decimal)}(\\d*))?$`, 'u').exec(rest);
    if (!match) return undefined;
    const grouped = match[1] ?? '';
    const whole = symbols.group === '' ? grouped : grouped.split(symbols.group).join('');
    const fraction = match[2] ?? '';
    if (whole === '' && fraction === '') return undefined;
    const magnitude = Number(`${whole === '' ? '0' : whole}${fraction === '' ? '' : `.${fraction}`}`);
    if (!Number.isFinite(magnitude)) return undefined;
    const scaled = options.format === 'percent' ? Number((magnitude / 100).toPrecision(12)) : magnitude;
    return negative && scaled !== 0 ? -scaled : scaled;
}

/**
 * Shows a number for editing in the locale: `1.234,5` in `de`, `50 %` for a `percent` value of `0.5`, a currency with
 * its symbol. Unlike `formatValue` it keeps the digits a user may have typed (up to 10 decimals, 8 for a percent; a
 * currency keeps the currency's own). Returns an empty string for anything that is not a finite number
 */
export function formatNumberInput(value: unknown, options: NumberInputOptions = {}): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '';
    const style = styleOf(options);
    const digits = FRACTION_DIGITS[options.format ?? 'number'];
    const formatter = create(options.locale || FALLBACK_LOCALE, style.style === 'currency' || digits === undefined ? style : { ...style, maximumFractionDigits: digits });
    return formatter?.format(value) ?? String(value);
}
