/** The only colour a colour field stores: `#` and six hexadecimal digits */
export const HEX_COLOR = /^#[0-9a-f]{6}$/iu;

/** The rule a colour field reports for text that is not a `#rrggbb` colour; its own controller raises it */
export const COLOR_RULE = 'pattern';

/** True when `value` is a `#rrggbb` colour, in either case */
export function isHexColor(value: unknown): value is string {
    return typeof value === 'string' && HEX_COLOR.test(value);
}

/**
 * The stored form of what a person typed: trimmed, with the `#` added when it was left out, three digits written out as
 * six (`#abc` is `#aabbcc`) and in lower case. Text that is none of these is returned trimmed, so validation reports it
 */
export function normalizeHex(text: string): string {
    const trimmed = text.trim();
    const digits = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
    if (/^[0-9a-f]{6}$/iu.test(digits)) return `#${digits.toLowerCase()}`;
    if (/^[0-9a-f]{3}$/iu.test(digits)) return `#${Array.from(digits.toLowerCase(), (digit) => digit + digit).join('')}`;
    return trimmed;
}
