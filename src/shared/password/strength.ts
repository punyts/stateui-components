/** The levels of a password's strength, weakest first */
export const STRENGTH_LEVELS = ['weak', 'fair', 'good', 'strong'] as const;
export type StrengthLevel = (typeof STRENGTH_LEVELS)[number];

export interface Strength {
    /** 0 for an empty password, else 1 (weak) to 4 (strong) */
    readonly score: number;
    /** The level the score names, empty for an empty password */
    readonly level: StrengthLevel | '';
}

/** Whether every character is the same, or each is one more or one less than the one before (`aaaa`, `1234`, `dcba`) */
function isRun(text: string): boolean {
    if (text.length < 3) return false;
    const codes = Array.from(text, (character) => character.codePointAt(0) as number);
    const step = (codes[1] as number) - (codes[0] as number);
    if (Math.abs(step) > 1) return false;
    return codes.every((code, index) => index === 0 || code - (codes[index - 1] as number) === step);
}

/**
 * A hint of how hard a password is to guess, from its length and the kinds of characters it mixes (lower case, upper
 * case, digits, others). It is a hint for the person typing, not a policy: an app enforces its own rules with
 * `minLength` and `pattern`, and the server its own. Each of 8, 12 and 16 characters adds a point, and so does mixing
 * three kinds; a password of one repeated or running character is weak whatever its length. The password is only
 * measured: it is never kept or reported
 */
export function passwordStrength(password: string): Strength {
    if (password === '') return { score: 0, level: '' };
    const length = Array.from(password).length;
    const kinds = [/\p{Ll}/u, /\p{Lu}/u, /\p{Nd}/u, /[^\p{L}\p{Nd}]/u].filter((kind) => kind.test(password)).length;
    let points = 0;
    if (length >= 8) points++;
    if (length >= 12) points++;
    if (length >= 16) points++;
    if (kinds >= 3) points++;
    const score = isRun(password) ? 1 : Math.min(4, Math.max(1, points));
    return { score, level: STRENGTH_LEVELS[score - 1] as StrengthLevel };
}
