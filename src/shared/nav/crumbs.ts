/** One place in a breadcrumb trail: an item, or the one menu that holds the items that do not fit */
export type CrumbSlot = { readonly kind: 'item'; readonly key: string } | { readonly kind: 'more'; readonly keys: readonly string[] };

/** The fewest visible items a trail can have: the first and the last */
export const MIN_VISIBLE = 2;
export const DEFAULT_MAX_VISIBLE = 4;

/** The key of the current item: `current` when it names an item, otherwise the last key */
export function currentKey(keys: readonly string[], current: unknown): string {
    return typeof current === 'string' && keys.includes(current) ? current : (keys[keys.length - 1] ?? '');
}

/**
 * Lays a trail out in at most `maxVisible` visible items. A trail that fits is every item. A longer one keeps the first
 * item and the last `maxVisible - 1` items, and puts the items between in one `more` slot. The current item is never
 * collapsed: when it is before the last `maxVisible - 1`, every item from it on stays visible. `maxVisible` is read as a whole number of at least 2 (the first and the last), and 4
 * when it is not a number
 */
export function planCrumbs(keys: readonly string[], current: string, maxVisible: unknown): CrumbSlot[] {
    const limit = typeof maxVisible === 'number' && Number.isFinite(maxVisible) ? Math.max(MIN_VISIBLE, Math.floor(maxVisible)) : DEFAULT_MAX_VISIBLE;
    if (keys.length <= limit) return keys.map((key) => ({ kind: 'item', key }));
    const currentIndex = keys.indexOf(current);
    let tail = keys.length - (limit - 1);
    if (currentIndex > 0 && currentIndex < tail) tail = currentIndex;
    const slots: CrumbSlot[] = [];
    const hidden: string[] = [];
    let placed = false;
    keys.forEach((key, index) => {
        if (index === 0 || index >= tail) {
            slots.push({ kind: 'item', key });
            return;
        }
        hidden.push(key);
        if (placed) return;
        placed = true;
        slots.push({ kind: 'more', keys: hidden });
    });
    return slots;
}
