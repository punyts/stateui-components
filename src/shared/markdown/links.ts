/**
 * Link target safety. A link in Markdown never navigates, but its target travels in the `press` event to an application
 * that may act on it, so only three kinds of target are kept: `#` fragments, relative in-app targets and `https:`.
 * Everything else (`javascript:`, `data:`, `http:`, `mailto:`, `file:`, protocol-relative `//host`, any other scheme,
 * and any spelling that hides a scheme with control characters, whitespace or entities) is refused. No regular
 * expressions: the target is scanned once
 */

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    colon: ':',
    Tab: '\t',
    NewLine: '\n',
    lpar: '(',
    rpar: ')',
    sol: '/',
    bsol: '\\',
    num: '#',
    period: '.',
    comma: ',',
    semi: ';',
    equals: '=',
    quest: '?',
    excl: '!'
};

const ENTITY_WINDOW = 32;
const BACKSLASH = 92;
const AMPERSAND = 38;

export const isAsciiPunctuation = (code: number): boolean => (code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96) || (code >= 123 && code <= 126);

const isHexDigit = (code: number): boolean => (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
const isDecimalDigit = (code: number): boolean => code >= 48 && code <= 57;

const codePointOf = (digits: string, radix: number): string => {
    const value = Number.parseInt(digits, radix);
    if (!Number.isFinite(value) || value === 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return '�';
    return String.fromCodePoint(value);
};

/** The text an entity stands for (`&amp;`, `&#106;`, `&#x6A;`), or undefined when `body` (between `&` and `;`) is none */
const entityText = (body: string): string | undefined => {
    if (body.length === 0) return undefined;
    if (body.charCodeAt(0) === 35) {
        const hex = body.charCodeAt(1) === 120 || body.charCodeAt(1) === 88;
        const digits = body.slice(hex ? 2 : 1);
        if (digits.length === 0 || digits.length > 8) return undefined;
        for (let at = 0; at < digits.length; at++) if (!(hex ? isHexDigit : isDecimalDigit)(digits.charCodeAt(at))) return undefined;
        return codePointOf(digits, hex ? 16 : 10);
    }
    return Object.hasOwn(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : undefined;
};

/** Backslash escapes of ASCII punctuation and the known entities, resolved the way a Markdown link target is read */
export function decodeTarget(raw: string): string {
    let out = '';
    let from = 0;
    for (let at = 0; at < raw.length; at++) {
        const code = raw.charCodeAt(at);
        if (code === BACKSLASH && isAsciiPunctuation(raw.charCodeAt(at + 1))) {
            out += raw.slice(from, at) + (raw[at + 1] as string);
            at++;
            from = at + 1;
        } else if (code === AMPERSAND) {
            const limit = Math.min(raw.length, at + 2 + ENTITY_WINDOW);
            let end = at + 1;
            while (end < limit && raw.charCodeAt(end) !== 59) end++;
            const decoded = end < limit ? entityText(raw.slice(at + 1, end)) : undefined;
            if (decoded !== undefined) {
                out += raw.slice(from, at) + decoded;
                at = end;
                from = end + 1;
            }
        }
    }
    return out + raw.slice(from);
}

const isUnsafeCharacter = (code: number): boolean =>
    code <= 0x20 ||
    (code >= 0x7f && code <= 0xa0) ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff;

/**
 * The target a link keeps, or undefined when the link must become plain text. The target is read as Markdown reads it
 * (entities and backslash escapes resolved) and then checked; the result is the resolved target
 */
export function safeHref(target: string): string | undefined {
    const resolved = decodeTarget(target);
    if (resolved === '') return undefined;
    for (let at = 0; at < resolved.length; at++) if (isUnsafeCharacter(resolved.charCodeAt(at))) return undefined;
    if (resolved.charCodeAt(0) === 35) return resolved;
    let colon = -1;
    let end = resolved.length;
    for (let at = 0; at < resolved.length; at++) {
        const code = resolved.charCodeAt(at);
        if (code === 58) {
            colon = at;
            end = at;
            break;
        }
        if (code === 47 || code === 63 || code === 35) {
            end = at;
            break;
        }
    }
    if (colon >= 0) {
        const hasHost = resolved.startsWith('//', colon + 1) && resolved.length > colon + 3;
        return resolved.slice(0, colon).toLowerCase() === 'https' && hasHost ? resolved : undefined;
    }
    const first = resolved.charCodeAt(0);
    if (first === BACKSLASH) return undefined;
    if (first === 47 && (resolved.charCodeAt(1) === 47 || resolved.charCodeAt(1) === BACKSLASH)) return undefined;
    if (resolved.slice(0, end).includes('&')) return undefined;
    return resolved;
}
