/** The fewest and the most boxes a code has, and the count when `length` is not usable */
export const MIN_PIN_LENGTH = 4;
export const MAX_PIN_LENGTH = 8;
export const DEFAULT_PIN_LENGTH = 6;

/** The number of boxes: `length` when it is a whole number from 4 to 8, else 6 */
export function pinLength(value: unknown): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= MIN_PIN_LENGTH && value <= MAX_PIN_LENGTH ? value : DEFAULT_PIN_LENGTH;
}

/** The characters of `text` a box takes, in order: digits, and with `alphanumeric` also the letters A to Z in either case */
export function pinChars(text: string, alphanumeric: boolean): string {
    return text.replace(alphanumeric ? /[^0-9A-Za-z]/g : /[^0-9]/g, '');
}

/** The value after `chars` are typed into box `index`: they replace what is there from that box on (never past the first empty box), cut at `length` */
export function typeAt(value: string, index: number, chars: string, length: number): string {
    const start = Math.min(Math.max(0, index), value.length);
    return (value.slice(0, start) + chars + value.slice(start + chars.length)).slice(0, length);
}

/** The value without the character of box `index` (the boxes after it move up one); the value itself when that box is empty */
export function deleteAt(value: string, index: number): string {
    if (index < 0 || index >= value.length) return value;
    return value.slice(0, index) + value.slice(index + 1);
}

/** The box that takes the next character: the first empty one, or the last when all are full */
export function currentBox(value: string, length: number): number {
    return Math.min(value.length, length - 1);
}

/** The box an arrow, Home or End moves to from `index`; Left and Right are swapped in right-to-left text. Undefined for any other key */
export function boxForKey(key: string, index: number, value: string, length: number, rtl: boolean): number | undefined {
    const last = currentBox(value, length);
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (key === forward) return Math.min(index + 1, last);
    if (key === back) return Math.max(index - 1, 0);
    if (key === 'Home') return 0;
    if (key === 'End') return last;
    return undefined;
}
