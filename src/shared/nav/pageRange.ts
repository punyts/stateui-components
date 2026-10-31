/** One place in the page list: a page number, or the gap that stands for the pages left out */
export type PageSlot = { readonly kind: 'page'; readonly page: number } | { readonly kind: 'gap'; readonly from: number; readonly to: number };

/** How many pages of `total` records fit `pageSize` per page; at least 1, so an empty list still has its first page */
export function pageCount(total: unknown, pageSize: unknown): number {
    const size = typeof pageSize === 'number' && Number.isFinite(pageSize) && pageSize >= 1 ? Math.floor(pageSize) : 1;
    const count = typeof total === 'number' && Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
    return Math.max(1, Math.ceil(count / size));
}

const range = (from: number, to: number): PageSlot[] => Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => ({ kind: 'page', page: from + index }));

/**
 * The pages to list: the first, the last, the current page and `siblings` pages each side of it. Pages left out become a
 * `gap`; a gap never stands for a single page (that page is listed instead), so the list is `2 * siblings + 5` places
 * long on every page of a long trail and does not change length while the user steps. `page` is clamped into the range
 */
export function pageRange(page: number, pages: number, siblings: number): PageSlot[] {
    const count = Math.max(1, Math.floor(pages));
    const current = Math.min(count, Math.max(1, Math.floor(page)));
    const side = Math.max(0, Math.floor(siblings));
    if (count <= 2 * side + 5) return range(1, count);
    const left = Math.max(current - side, 1);
    const right = Math.min(current + side, count);
    const gapLeft = left > 3;
    const gapRight = right < count - 2;
    if (!gapLeft && gapRight) {
        const edge = 3 + 2 * side;
        return [...range(1, edge), { kind: 'gap', from: edge + 1, to: count - 1 }, { kind: 'page', page: count }];
    }
    if (gapLeft && !gapRight) {
        const edge = count - (2 + 2 * side);
        return [{ kind: 'page', page: 1 }, { kind: 'gap', from: 2, to: edge - 1 }, ...range(edge, count)];
    }
    return [{ kind: 'page', page: 1 }, { kind: 'gap', from: 2, to: left - 1 }, ...range(left, right), { kind: 'gap', from: right + 1, to: count - 1 }, { kind: 'page', page: count }];
}
