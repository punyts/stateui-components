import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const settle = async (): Promise<void> => {
    for (let i = 0; i < 3; i++) await frame();
    await flush();
};
const ORDER = '$.runtime.nodes.app.order';

interface Line {
    id: string;
    qty: number;
    description: string;
}

const lines = (): Line[] => [
    { id: 'a', qty: 3, description: 'Pear' },
    { id: 'b', qty: 1, description: 'Apple' },
    { id: 'c', qty: 2, description: 'Fig' },
    { id: 'd', qty: 5, description: 'Kiwi' }
];
const rowTemplate = { component: 'text', '<-_text': '$row.description' };

const inner = (mounted: MountedComponent): ShadowRoot =>
    (mounted.element.shadowRoot?.querySelector('ui-record-list') as Element).shadowRoot as ShadowRoot;
const positionOf = (slot: HTMLElement): number => Number(/--sui-index:\s*(-?\d+)/.exec(slot.getAttribute('style') ?? '')?.[1] ?? -1);
const slotText = (slot: HTMLElement): string => (slot.firstElementChild?.firstElementChild as Element | null)?.shadowRoot?.textContent?.trim() ?? '';

/** The text shown at each position from 0 */
const shown = (mounted: MountedComponent, count: number): string[] => {
    const map = new Map<number, string>();
    for (const slot of Array.from(inner(mounted).querySelectorAll<HTMLElement>('.slot'))) if (!slot.hidden) map.set(positionOf(slot), slotText(slot));
    return Array.from({ length: count }, (_v, i) => map.get(i) ?? '');
};
const order = (mounted: MountedComponent): unknown => {
    const value = mounted.store.get<unknown>(ORDER);
    return Array.isArray(value) ? [...(value as string[])] : value;
};
const dataIds = (mounted: MountedComponent): string[] => mounted.store.get<Line[]>('$.data.order.lines').map((line) => line.id);
const orderWrites = (mounted: MountedComponent): string[] => {
    const writes: string[] = [];
    mounted.store.on(ORDER, (path) => writes.push(path));
    return writes;
};

const mountList = async (items: unknown, extra: Record<string, unknown> = {}): Promise<MountedComponent> => {
    const mounted = mountComponent(
        'list',
        { '<-items': '$.data.order.lines', row: rowTemplate, ...extra },
        { data: { order: { lines: items } } }
    );
    (mounted.element as HTMLElement).style.blockSize = '400px';
    await settle();
    return mounted;
};

describe('list sort in Chromium', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        mountComponent.unmountAll();
    });

    it('should show the records in data order with no sort field and write no order', async () => {
        // Arrange and Act
        const mounted = await mountList(lines());

        // Assert
        expect(order(mounted)).toBeUndefined();
        expect(shown(mounted, 4)).toEqual(['Pear', 'Apple', 'Fig', 'Kiwi']);
    });

    it('should sort by a field ascending and descending without reordering the data array', async () => {
        // Arrange
        const mounted = await mountList(lines(), { sortBy: 'qty' });
        const ascending = shown(mounted, 4);

        // Act
        mounted.store.set('$.app.sortDir', 'desc');
        await settle();

        // Assert
        expect(ascending).toEqual(['Apple', 'Fig', 'Pear', 'Kiwi']);
        expect(order(mounted)).toEqual(['d', 'a', 'c', 'b']);
        expect(shown(mounted, 4)).toEqual(['Kiwi', 'Pear', 'Fig', 'Apple']);
        expect(dataIds(mounted)).toEqual(['a', 'b', 'c', 'd']);
        expect(mounted.store.get<unknown>('$.app.body.order')).toEqual(['d', 'a', 'c', 'b']);
    });

    it('should sort by text, switch the sort field and go back to data order when it is cleared', async () => {
        // Arrange
        const mounted = await mountList(lines(), { sortBy: 'description' });
        const byText = shown(mounted, 4);

        // Act and Assert
        mounted.store.set('$.app.sortBy', 'qty');
        await settle();
        expect(byText).toEqual(['Apple', 'Fig', 'Kiwi', 'Pear']);
        expect(shown(mounted, 4)).toEqual(['Apple', 'Fig', 'Pear', 'Kiwi']);

        mounted.store.set('$.app.sortBy', '');
        await settle();
        expect(order(mounted)).toBeUndefined();
        expect(shown(mounted, 4)).toEqual(['Pear', 'Apple', 'Fig', 'Kiwi']);
    });

    it('should re-sort once after the sort field of items changes', async () => {
        // Arrange
        const mounted = await mountList(lines(), { sortBy: 'qty' });
        const writes = orderWrites(mounted);

        // Act
        mounted.store.set('$.data.order.lines.3.qty', 0);
        mounted.store.set('$.data.order.lines.0.qty', 0.5);
        await settle();

        // Assert
        expect(writes).toHaveLength(1);
        expect(shown(mounted, 4)).toEqual(['Kiwi', 'Pear', 'Apple', 'Fig']);
        expect(dataIds(mounted)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('should not recompute when a field that is not the sort field changes', async () => {
        // Arrange
        const mounted = await mountList(lines(), { sortBy: 'qty' });
        const writes = orderWrites(mounted);

        // Act
        mounted.store.set('$.data.order.lines.1.description', 'Green apple');
        await settle();

        // Assert
        expect(writes).toHaveLength(0);
        expect(shown(mounted, 4)).toEqual(['Green apple', 'Fig', 'Pear', 'Kiwi']);
    });

    it('should keep the sort when items are added and removed', async () => {
        // Arrange
        const mounted = await mountList(lines(), { sortBy: 'qty' });
        const array = (): Line[] => mounted.store.get<Line[]>('$.data.order.lines');

        // Act and Assert
        array().push({ id: 'e', qty: 0, description: 'Date' });
        await settle();
        expect(shown(mounted, 5)).toEqual(['Date', 'Apple', 'Fig', 'Pear', 'Kiwi']);

        array().splice(1, 1);
        await settle();
        expect(shown(mounted, 5)).toEqual(['Date', 'Fig', 'Pear', 'Kiwi', '']);
        expect(dataIds(mounted)).toEqual(['a', 'c', 'd', 'e']);

        mounted.store.set('$.data.order.lines', [
            { id: 'x', qty: 9, description: 'Xigua' },
            { id: 'y', qty: 4, description: 'Yuzu' }
        ]);
        await settle();
        expect(shown(mounted, 2)).toEqual(['Yuzu', 'Xigua']);
    });

    it('should keep current on the selected record when the sort changes', async () => {
        // Arrange
        const mounted = mountComponent(
            'list',
            { '<-items': '$.data.order.lines', '<-selected': '$.data.picked', row: rowTemplate, selectable: 'single', sortBy: 'qty' },
            { data: { order: { lines: lines() }, picked: 'c' } }
        );
        await settle();

        // Act
        mounted.store.set('$.app.sortDir', 'desc');
        await settle();

        // Assert
        expect(mounted.store.get<string>('$.runtime.nodes.app.current.description')).toBe('Fig');
    });

    it('should recompute the order of 10,000 records in under 50 ms', async () => {
        // Arrange
        const many = Array.from({ length: 10_000 }, (_v, i) => ({ id: `r${i}`, qty: (i * 7919) % 10_007, description: `Line ${i}` }));
        const mounted = await mountList(many, { sortBy: 'qty' });
        const timings: number[] = [];
        await frame();

        // Act: in one frame, callbacks run in the order they were requested: the start mark, the list's recompute, the
        // end mark. The fastest of three runs is kept, so other test files running in parallel do not skew the timing
        for (const direction of ['desc', 'asc', 'desc']) {
            let started = 0;
            let ended = 0;
            requestAnimationFrame(() => {
                started = performance.now();
            });
            mounted.store.set('$.app.sortDir', direction);
            requestAnimationFrame(() => {
                ended = performance.now();
            });
            await frame();
            await flush();
            timings.push(ended - started);
        }

        // Assert
        const keys = mounted.store.get<string[]>(ORDER);
        expect(keys).toHaveLength(10_000);
        const qtyOf = (key: string): number => many[Number(key.slice(1))]?.qty ?? -1;
        expect(qtyOf(String(keys[0]))).toBe(Math.max(...many.map((line) => line.qty)));
        expect(Array.from(keys).every((key, i, all) => i === 0 || qtyOf(String(all[i - 1])) >= qtyOf(key))).toBe(true);
        expect(Math.min(...timings)).toBeLessThan(50);
    });
});
