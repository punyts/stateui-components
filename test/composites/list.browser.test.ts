import { report } from '@punyts/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};
const BODY = '$.runtime.nodes.app.body';

interface Line {
    id: string;
    description?: string;
}

const lines = (count: number): Line[] => Array.from({ length: count }, (_v, i) => ({ id: `l${i}`, description: `Line ${i}` }));
const texts = (from: number, count: number): string[] => Array.from({ length: count }, (_v, i) => `Line ${from + i}`);
const rowTemplate = { component: 'text', '<-_text': '$row.description' };

const recordList = (mounted: MountedComponent): Element | null => mounted.element.shadowRoot?.querySelector('ui-record-list') ?? null;
const slotElements = (mounted: MountedComponent): HTMLElement[] =>
    Array.from(recordList(mounted)?.shadowRoot?.querySelectorAll<HTMLElement>('.slot') ?? []);
const slotText = (slot: HTMLElement): string => (slot.firstElementChild?.firstElementChild as Element | null)?.shadowRoot?.textContent?.trim() ?? '';
const slotPosition = (slot: HTMLElement): number => Number(/--sui-index:\s*(-?\d+)/.exec(slot.getAttribute('style') ?? '')?.[1] ?? -1);

/** The text shown at each position from 0, '' where nothing is shown */
const shown = (mounted: MountedComponent, count: number): string[] => {
    const map = new Map<number, string>();
    for (const slot of slotElements(mounted)) if (!slot.hidden) map.set(slotPosition(slot), slotText(slot));
    return Array.from({ length: count }, (_v, i) => map.get(i) ?? '');
};
const emptyText = (mounted: MountedComponent): string | undefined =>
    mounted.element.shadowRoot?.querySelector('.empty .text')?.textContent?.trim();
const emptyNode = (mounted: MountedComponent): Element | null => mounted.element.shadowRoot?.querySelector('.empty ui-empty-state') ?? null;

const mountList = async (
    items: unknown,
    extra: Record<string, unknown> = {},
    options: { locale?: string } = {}
): Promise<MountedComponent> => {
    const mounted = mountComponent('list', { '<-items': '$.data.order.lines', row: rowTemplate, ...extra }, { data: { order: { lines: items } }, ...options });
    await flush();
    await frames(3);
    mounted.store.set(`${BODY}.window`, { first: 0, count: 10 });
    await flush();
    return mounted;
};

describe('list in Chromium', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        mountComponent.unmountAll();
    });

    it('should render the row template for the records of $.data.order.lines through a recordList body', async () => {
        // Arrange and Act
        const mounted = await mountList(lines(4));

        // Assert
        expect(recordList(mounted)).not.toBeNull();
        expect(shown(mounted, 4)).toEqual(texts(0, 4));
        expect(mounted.store.get<number>('$.app.body.count')).toBe(4);
        expect(emptyText(mounted)).toBeUndefined();
    });

    it('should show the window of its record view as its own window property', async () => {
        const mounted = await mountList(lines(40));

        expect(mounted.store.get<unknown>('$.app.window')).toEqual({ first: 0, count: 10 });
    });

    it('should show paged items that are written after it mounted, as logic writes them', async () => {
        // Arrange
        const mounted = mountComponent('list', { row: rowTemplate }, { data: {} });
        await flush();
        await frames(3);

        // Act
        mounted.store.set('$.app.items', { 0: { id: 'l0', description: 'Line 0' }, 1: { id: 'l1', description: 'Line 1' } });
        mounted.store.set('$.app.total', 2);
        await flush();
        await frames(3);

        // Assert
        expect(mounted.store.get<number>('$.app.body.count')).toBe(2);
        expect(shown(mounted, 2)).toEqual(texts(0, 2));
    });

    it('should draw a line under each row only when divided', async () => {
        // Arrange
        const plain = await mountList(lines(2));
        const divided = await mountList(lines(2), { divided: true });

        // Act
        const shadowOf = (mounted: MountedComponent): string => getComputedStyle(slotElements(mounted)[0] as HTMLElement).boxShadow;

        // Assert
        expect(shadowOf(plain)).toBe('none');
        expect(shadowOf(divided)).not.toBe('none');
    });

    it('should pass items, key and total to the recordList and mount without a reported error', async () => {
        // Arrange
        const reported: unknown[] = [];
        vi.spyOn(report, 'error').mockImplementation((...args: unknown[]) => {
            reported.push(args);
        });
        const items = [{ code: 'a', description: 'Alpha' }, { code: 'b', description: 'Beta' }];

        // Act
        const mounted = await mountList(items, { key: 'code', total: 2, density: 'compact', divided: true });

        // Assert
        expect(mounted.store.get<unknown>('$.app.body.records')).toEqual(items);
        expect(mounted.store.get<string>('$.app.body.key')).toBe('code');
        expect(mounted.store.get<number>('$.app.body.total')).toBe(2);
        expect(shown(mounted, 2)).toEqual(['Alpha', 'Beta']);
        expect(mounted.element.hasAttribute('divided')).toBe(true);
        expect(mounted.element.getAttribute('density')).toBe('compact');
        expect(reported).toEqual([]);
    });

    it('should update only the slot of the record whose linked field changed', async () => {
        // Arrange
        const mounted = await mountList(lines(5));
        const touched: string[] = [];
        mounted.store.on(`${BODY}.slots.$all`, (path) => touched.push(path));

        // Act
        mounted.store.set('$.data.order.lines.2.description', 'Changed');
        await flush();

        // Assert
        expect(shown(mounted, 5)).toEqual(['Line 0', 'Line 1', 'Changed', 'Line 3', 'Line 4']);
        expect(touched.length).toBeGreaterThan(0);
        expect(touched.every((path) => path.startsWith(`${BODY}.slots.2.`))).toBe(true);
    });

    it('should show nothing for a record with no description and update when the field is added', async () => {
        // Arrange
        const mounted = await mountList([{ id: 'a' }, { id: 'b', description: 'Bea' }]);
        const before = shown(mounted, 2);

        // Act
        mounted.store.set('$.data.order.lines.0.description', 'Ada');
        await flush();

        // Assert
        expect(before).toEqual(['', 'Bea']);
        expect(shown(mounted, 2)).toEqual(['Ada', 'Bea']);
    });

    it('should re-point the slots when items are added, removed and reordered, with no node per item', async () => {
        // Arrange
        const mounted = await mountList(lines(3));
        const slots = slotElements(mounted);
        const array = (): Line[] => mounted.store.get<Line[]>('$.data.order.lines');

        // Act and Assert
        array().push({ id: 'new', description: 'New' });
        await flush();
        expect(shown(mounted, 5)).toEqual([...texts(0, 3), 'New', '']);

        array().shift();
        await flush();
        expect(shown(mounted, 4)).toEqual(['Line 1', 'Line 2', 'New', '']);
        expect(mounted.store.get<number>('$.app.body.count')).toBe(3);

        array().reverse();
        await flush();
        expect(shown(mounted, 3)).toEqual(['New', 'Line 2', 'Line 1']);

        expect(slotElements(mounted)).toHaveLength(slots.length);
        expect(slotElements(mounted).every((slot, i) => slot === slots[i])).toBe(true);
        expect(Object.keys(mounted.store.get<Record<string, unknown>>(`${BODY}.slots`))).toHaveLength(slots.length);
    });

    it('should show _empty when there are no items and no empty slot, and hide it when an item arrives', async () => {
        // Arrange
        const mounted = await mountList([]);
        const before = emptyText(mounted);

        // Act
        mounted.store.get<Line[]>('$.data.order.lines').push({ id: 'a', description: 'First' });
        await flush();

        // Assert
        expect(before).toBe('No items');
        expect(emptyText(mounted)).toBeUndefined();
        expect(shown(mounted, 1)).toEqual(['First']);
    });

    it('should show _empty when items is not set at all', async () => {
        // Arrange and Act
        const mounted = mountComponent('list', { row: rowTemplate, _empty: 'Nothing to show' });
        await flush();

        // Assert
        expect(emptyText(mounted)).toBe('Nothing to show');
        expect(slotElements(mounted).filter((slot) => !slot.hidden)).toHaveLength(0);
    });

    it('should show the empty node instead of _empty when the empty slot is set', async () => {
        // Arrange and Act
        const mounted = await mountList([], { empty: { component: 'emptyState', _title: 'No order lines' } });

        // Assert
        expect(emptyText(mounted)).toBeUndefined();
        expect(emptyNode(mounted)?.shadowRoot?.querySelector('.title')?.textContent?.trim()).toBe('No order lines');
    });

    it('should show the German _empty from the de locale overlay', async () => {
        // Arrange
        const mounted = await mountList([]);

        // Act
        mounted.setLocale('de');
        await flush();

        // Assert
        expect(emptyText(mounted)).toBe('Keine Einträge');
    });

    it('should remove its links to the body when it is unmounted', async () => {
        // Arrange
        const mounted = await mountList(lines(2));
        const unlink = vi.spyOn(mounted.store, 'unlink');

        // Act
        mounted.dispose();

        // Assert
        const unlinked = unlink.mock.calls.map(([path]) => String(path));
        expect(unlinked).toEqual(expect.arrayContaining(['$.app.body.records', '$.app.body.row', '$.app.body.key', '$.app.body.total']));
    });

    it('should size its rows from rowHeight: md by default, sm shorter and lg taller', async () => {
        // Arrange
        const height = async (rowHeight?: string): Promise<number> => {
            const mounted = await mountList(lines(2), rowHeight === undefined ? {} : { rowHeight });
            await frames(2);
            const slot = slotElements(mounted).find((candidate) => !candidate.hidden) as HTMLElement;
            return slot.getBoundingClientRect().height;
        };

        // Act
        const [md, sm, lg] = [await height(), await height('sm'), await height('lg')];

        // Assert
        expect(recordList(await mountList(lines(1), { rowHeight: 'lg' }))?.getAttribute('row-height')).toBe('lg');
        expect(sm).toBeLessThan(md);
        expect(lg).toBeGreaterThan(md);
    });

    it('should make xl rows taller than lg, so a two-line row fits', async () => {
        // Arrange
        const height = async (rowHeight: string): Promise<number> => {
            const mounted = await mountList(lines(2), { rowHeight });
            await frames(2);
            const slot = slotElements(mounted).find((candidate) => !candidate.hidden) as HTMLElement;
            return slot.getBoundingClientRect().height;
        };

        // Act
        const [lg, xl] = [await height('lg'), await height('xl')];

        // Assert
        expect(xl).toBeGreaterThan(lg);
        expect(xl).toBeGreaterThanOrEqual(lg * 1.4);
    });

    it('should take the row height of a recordlist.row theme override written on the list node', async () => {
        // Arrange
        const mounted = await mountList(lines(2), { theme: { recordlist: { row: '80px' } } });
        await frames(2);

        // Act
        const slot = slotElements(mounted).find((candidate) => !candidate.hidden) as HTMLElement;

        // Assert
        expect(slot.getBoundingClientRect().height).toBe(80);
    });
});
