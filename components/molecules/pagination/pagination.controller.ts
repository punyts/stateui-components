import type { ControllerContext } from '@punyts/stateui';
import { pageCount, pageRange } from '../shared/nav/pageRange.js';

type Entry = Record<string, unknown>;

interface PageEntry {
    kind: 'page' | 'gap';
    page: number;
    current: boolean;
    name: string;
}

const whole = (value: unknown, fallback: number, min: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= min ? Math.floor(value) : fallback;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Paging for data a server pages: the pages are `ceil(total / pageSize)` (at least one). The runtime properties `pages`,
 * `current` (`page` clamped into the range, never written back) and `entries` (the first and last page, the current page
 * with `siblings` pages each side, and gaps; `src/shared/nav/pageRange.ts`) are drawn from `page`, `pageSize`, `total` and
 * `siblings`, and the buttons name each page with `_page` (`Page {page}`). A press on a page, previous or next writes
 * `page` and raises `change` (`{ page, pageSize }`). With `pageSizes` a `select` atom (bound to the runtime `sizes`) lets
 * the user pick the page size; the pick writes `pageSize` and sets `page` back to 1 in the same `change`. `compact` shows
 * previous, next and the position only
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const sizeValuePath = `${basePath}.sizes.value`;

    const pageSize = (): number => whole(read('pageSize'), 10, 1);
    const pages = (): number => pageCount(read('total'), pageSize());
    const current = (): number => Math.min(pages(), whole(read('page'), 1, 1));

    const sizeList = (): number[] => {
        const list = read('pageSizes');
        const sizes = Array.isArray(list) ? (list as unknown[]).filter((size): size is number => typeof size === 'number' && Number.isInteger(size) && size >= 1) : [];
        if (sizes.length > 0 && !sizes.includes(pageSize())) sizes.push(pageSize());
        return [...new Set(sizes)].sort((a, b) => a - b);
    };

    let drawnSizes = '';
    const drawSizes = (): void => {
        const sizes = sizeList();
        if (sizes.length === 0) return;
        const options: Record<string, Entry> = {};
        for (const size of sizes) options[String(size)] = { _label: String(size) };
        const node = {
            options,
            optionValue: 'value',
            optionLabel: 'label',
            multiple: false,
            disabled: false,
            required: false,
            value: String(pageSize()),
            size: 'sm',
            _label: text(read('_pageSize'))
        };
        const signature = JSON.stringify(node);
        if (signature === drawnSizes && read('sizes.value') === node.value) return;
        drawnSizes = signature;
        store.set(`${basePath}.sizes`, node);
    };

    const draw = (): void => {
        const count = pages();
        const now = current();
        const template = text(read('_page'));
        const entries: Record<string, PageEntry> = {};
        pageRange(now, count, whole(read('siblings'), 1, 0)).forEach((slot, index) => {
            entries[`p${index}`] =
                slot.kind === 'page'
                    ? { kind: 'page', page: slot.page, current: slot.page === now, name: template.replace('{page}', String(slot.page)) }
                    : { kind: 'gap', page: 0, current: false, name: '' };
        });
        store.set(`${basePath}.pages`, count);
        store.set(`${basePath}.current`, now);
        store.set(`${basePath}.entries`, entries);
        drawSizes();
    };

    let scheduled = false;
    const schedule = (): void => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            draw();
        });
    };
    const watched = ['page', 'pageSize', 'total', 'siblings', 'pageSizes', 'pageSizes.$all', '_page', '_pageSize'].map((name) => `${basePath}.${name}`);
    watched.push('$.locale');
    store.on(watched, schedule);
    draw();

    const raise = (page: number, size: number): void => {
        element.dispatchEvent(new CustomEvent('change', { detail: { page, pageSize: size }, bubbles: true, composed: true }));
    };
    const goTo = (page: number): void => {
        const next = Math.min(pages(), Math.max(1, page));
        if (next === current()) return;
        store.set(`${basePath}.page`, next);
        draw();
        raise(next, pageSize());
    };

    const onSize = (): void => {
        const chosen = Number(read('sizes.value'));
        if (!Number.isInteger(chosen) || chosen < 1 || chosen === pageSize()) return;
        store.set(`${basePath}.pageSize`, chosen);
        store.set(`${basePath}.page`, 1);
        draw();
        raise(1, chosen);
    };
    store.on([sizeValuePath], onSize);

    return {
        //the select raises its own `change` (the picked key); this component raises its own once the size is written
        onSizeEvent: (event: Event) => event.stopPropagation(),
        onPrevious: () => goTo(current() - 1),
        onNext: () => goTo(current() + 1),
        onPage: (event: Event) => {
            const page = Number((event.currentTarget as HTMLElement | null)?.dataset['page']);
            if (Number.isInteger(page)) goTo(page);
        },
        dispose: () => {
            store.off(watched, schedule);
            store.off([sizeValuePath], onSize);
        }
    };
}
