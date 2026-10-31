/** The rules a field checks, in the order it checks them; `error` holds the name of the first that fails */
export const FIELD_RULES = ['required', 'minLength', 'maxLength', 'min', 'max', 'pattern'] as const;

export type FieldRule = (typeof FIELD_RULES)[number];

/** The settings the rules read from a field's node. `min` and `max` are a number or a string; an empty string means unset */
export interface FieldSettings {
    required: boolean;
    /** 0 means no minimum */
    minLength: number;
    /** 0 means no maximum */
    maxLength: number;
    min: unknown;
    max: unknown;
    /** A name from `NAMED_PATTERNS` or a regular expression; empty means none */
    pattern: string;
}

/** The closed list of names `pattern` accepts besides a regular expression; each matches the whole value */
export const NAMED_PATTERNS: Readonly<Record<string, RegExp>> = Object.freeze({
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/u,
    url: /^https?:\/\/[^\s/$.?#][^\s]*$/iu,
    integer: /^[+-]?\d+$/u,
    decimal: /^[+-]?\d+(?:\.\d+)?$/u,
    tel: /^\+?\d[\d\s().-]{3,18}\d$/u,
    alphanumeric: /^[\p{L}\p{N}]+$/u
});

const compiled = new Map<string, RegExp | null>();

/** The expression a `pattern` stands for: a named one, or the regular expression matched against the whole value (null when it does not compile) */
export function patternOf(pattern: string): RegExp | null {
    if (Object.hasOwn(NAMED_PATTERNS, pattern)) return NAMED_PATTERNS[pattern] as RegExp;
    const cached = compiled.get(pattern);
    if (cached !== undefined) return cached;
    let expression: RegExp | null;
    try {
        expression = new RegExp(`^(?:${pattern})$`, 'u');
    } catch {
        expression = null;
    }
    compiled.set(pattern, expression);
    return expression;
}

const isEmpty = (value: unknown): boolean =>
    value === undefined || value === null || value === '' || value === false || (Array.isArray(value) && value.length === 0);

const isSet = (bound: unknown): boolean => bound !== undefined && bound !== null && bound !== '';

/** True when `value` is below `min` or above `max`: numbers compare as numbers, a string bound compares the text (ISO dates sort that way) */
function beyond(value: unknown, bound: unknown, direction: 'below' | 'above'): boolean {
    if (!isSet(bound)) return false;
    if (typeof bound === 'number') {
        const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
        if (Number.isNaN(number)) return true;
        return direction === 'below' ? number < bound : number > bound;
    }
    const text = String(value);
    return direction === 'below' ? text < String(bound) : text > String(bound);
}

/**
 * The name of the first rule the value fails, or an empty string. Rules run in `FIELD_RULES` order. An empty value
 * fails only `required`: the other rules judge what was typed
 */
export function failingRule(value: unknown, settings: FieldSettings): FieldRule | '' {
    if (isEmpty(value)) return settings.required ? 'required' : '';
    const length = typeof value === 'string' || Array.isArray(value) ? value.length : 0;
    if (settings.minLength > 0 && length < settings.minLength) return 'minLength';
    if (settings.maxLength > 0 && length > settings.maxLength) return 'maxLength';
    if (beyond(value, settings.min, 'below')) return 'min';
    if (beyond(value, settings.max, 'above')) return 'max';
    if (settings.pattern !== '') {
        const expression = patternOf(settings.pattern);
        if (expression === null || typeof value !== 'string' || !expression.test(value)) return 'pattern';
    }
    return '';
}
