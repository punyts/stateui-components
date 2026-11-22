/**
 * Fractional order keys: strings of base-62 digits compared as plain strings, where a key can always be made between any
 * two others, so inserting a block writes only that block. A key never ends in `0`, the lowest digit, so there is always
 * room below it. The digits are in ASCII order (`0-9`, `A-Z`, `a-z`), so `<` on the strings is the order
 */

export const ORDER_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const digitOf = (key: string, at: number): number => ORDER_DIGITS.indexOf(key.charAt(at));

/** Whether a string is an order key: base-62 digits, not empty, not ending in `0` */
export function isOrderKey(key: string): boolean {
    if (key === '' || key.endsWith('0')) return false;
    for (let at = 0; at < key.length; at++) if (digitOf(key, at) === -1) return false;
    return true;
}

/** A key between `a` and `b` (both valid order keys, `a < b`), where `a` empty means the lowest and `b` undefined the highest */
function midpoint(a: string, b: string | undefined): string {
    if (b !== undefined) {
        let shared = 0;
        while ((a.charAt(shared) || '0') === b.charAt(shared)) shared++;
        if (shared > 0) return b.slice(0, shared) + midpoint(a.slice(shared), b.slice(shared));
    }
    const low = a === '' ? 0 : digitOf(a, 0);
    const high = b === undefined ? ORDER_DIGITS.length : digitOf(b, 0);
    if (high - low > 1) return ORDER_DIGITS.charAt(Math.round((low + high) / 2));
    if (b !== undefined && b.length > 1) return b.slice(0, 1);
    return ORDER_DIGITS.charAt(low) + midpoint(a.slice(1), undefined);
}

/**
 * A key that sorts after `before` and before `after`. Either may be undefined for the start or the end. A key that is not
 * an order key is read as missing, and two keys out of order give a key after `before`
 */
export function orderBetween(before?: string, after?: string): string {
    const a = before !== undefined && isOrderKey(before) ? before : '';
    let b = after !== undefined && isOrderKey(after) ? after : undefined;
    if (b !== undefined && a !== '' && a >= b) b = undefined;
    return midpoint(a, b);
}

/** `count` keys in rising order, all of one length and ending in the middle digit, for a value built at once */
export function orderKeys(count: number): string[] {
    if (count <= 0) return [];
    let width = 1;
    while (ORDER_DIGITS.length ** width < count) width++;
    const keys: string[] = [];
    for (let index = 0; index < count; index++) {
        let digits = '';
        let rest = index;
        for (let place = 0; place < width; place++) {
            digits = ORDER_DIGITS.charAt(rest % ORDER_DIGITS.length) + digits;
            rest = Math.floor(rest / ORDER_DIGITS.length);
        }
        keys.push(`${digits}V`);
    }
    return keys;
}
