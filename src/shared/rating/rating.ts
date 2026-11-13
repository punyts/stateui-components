/** The number of stars when `max` is not a whole number from 1 to `MAX_STARS` */
export const DEFAULT_STARS = 5;

/** The most stars a rating draws */
export const MAX_STARS = 10;

/** The number of stars a `max` stands for: a whole number from 1 to `MAX_STARS`, else `DEFAULT_STARS` */
export function starsOf(max: unknown): number {
    return typeof max === 'number' && Number.isInteger(max) && max >= 1 && max <= MAX_STARS ? max : DEFAULT_STARS;
}

/** The rating a value stands for: a whole number from 0 to `stars`, rounded; anything that is not a number is 0 */
export function ratingOf(value: unknown, stars: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.min(stars, Math.max(0, Math.round(value)));
}

/**
 * The rating a key gives, or `undefined` for a key the rating does not handle. The arrows step by one (in right-to-left
 * text Left and Right swap, so the key pointing to the end still raises the rating), Home gives 0, End gives `stars`, a
 * digit key gives that number when it is not above `stars`, and every result stays from 0 to `stars`
 */
export function ratingForKey(key: string, rating: number, stars: number, rtl = false): number | undefined {
    const clamp = (next: number): number => Math.min(stars, Math.max(0, next));
    switch (key) {
        case 'ArrowUp':
            return clamp(rating + 1);
        case 'ArrowDown':
            return clamp(rating - 1);
        case 'ArrowRight':
            return clamp(rating + (rtl ? -1 : 1));
        case 'ArrowLeft':
            return clamp(rating + (rtl ? 1 : -1));
        case 'Home':
            return 0;
        case 'End':
            return stars;
        default:
            return /^\d$/u.test(key) && Number(key) <= stars ? Number(key) : undefined;
    }
}
