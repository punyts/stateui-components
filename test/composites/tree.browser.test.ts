import { report } from '@punyts/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};
const BODY = '$.runtime.nodes.app.body';
const rowTemplate = { component: 'text', '<-_text': '$row.label' };

interface Node {
    id: string;
    label: string;
    parentId?: string;
    hasChildren?: boolean;
}

const node = (id: string, parentId?: string): Node => ({ id, label: id.toUpperCase(), ...(parentId === undefined ? {} : { parentId }) });
const family = (): Node[] => [node('a'), node('a1', 'a'), node('a2', 'a'), node('a2x', 'a2'), node('b'), node('b1', 'b')];

const recordList = (mounted: MountedComponent): Element | null => mounted.element.shadowRoot?.querySelector('ui-record-list') ?? null;
const slotElements = (mounted: MountedComponent): HTMLElement[] =>
    Array.from(recordList(mounted)?.shadowRoot?.querySelectorAll<HTMLElement>('.slot') ?? []);
const slotText = (slot: HTMLElement): string => (slot.firstElementChild?.firstElementChild as Element | null)?.shadowRoot?.textContent?.trim() ?? '';
const styleNumber = (slot: HTMLElement, name: string): number =>
    Number(new RegExp(`${name}:\\s*(-?\\d+)`).exec(slot.getAttribute('style') ?? '')?.[1] ?? -1);

/** The visible rows in position order: their text and level */
const shown = (mounted: MountedComponent): [string, number][] =>
    slotElements(mounted)
        .filter((slot) => !slot.hidden)
        .sort((a, b) => styleNumber(a, '--sui-index') - styleNumber(b, '--sui-index'))
        .map((slot) => [slotText(slot), styleNumber(slot, '--sui-level')]);

const mountTree = async (
    records: unknown,
    extra: Record<string, unknown> = {},
    window = { first: 0, count: 10 }
): Promise<MountedComponent> => {
    const mounted = mountComponent('tree', { '<-records': '$.data.nodes', row: rowTemplate, ...extra }, { data: { nodes: records } });
    (mounted.element as HTMLElement).style.blockSize = '240px';
    await flush();
    await frames(3);
    mounted.store.set(`${BODY}.window`, window);
    await flush();
    return mounted;
};

describe('tree rendering in Chromium', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        mountComponent.unmountAll();
    });

    it('should show only the roots while nothing is expanded, through a recordList body with the role tree', async () => {
        // Arrange and Act
        const mounted = await mountTree(family());

        // Assert
        expect(recordList(mounted)?.getAttribute('role')).toBe('tree');
        expect(shown(mounted)).toEqual([['A', 0], ['B', 0]]);
        expect(mounted.store.get<number>('$.app.body.count')).toBe(2);
        expect(slotElements(mounted)[0]?.getAttribute('role')).toBe('treeitem');
    });

    it('should show the children of an expanded record after it with their level in --sui-level', async () => {
        // Arrange and Act
        const mounted = await mountTree(family(), { expanded: ['a', 'a2'] });

        // Assert
        expect(shown(mounted)).toEqual([['A', 0], ['A1', 1], ['A2', 1], ['A2X', 2], ['B', 0]]);
    });

    it('should follow a write to expanded, opening and closing records', async () => {
        // Arrange
        const mounted = await mountTree(family());

        // Act
        mounted.store.set('$.app.expanded', ['b'] as never);
        await flush();

        // Assert
        expect(shown(mounted)).toEqual([['A', 0], ['B', 0], ['B1', 1]]);

        // Act
        mounted.store.set('$.app.expanded', ['a', 'b'] as never);
        await flush();

        // Assert
        expect(shown(mounted).map(([text]) => text)).toEqual(['A', 'A1', 'A2', 'B', 'B1']);

        // Act
        mounted.store.set('$.app.expanded', [] as never);
        await flush();

        // Assert
        expect(shown(mounted)).toEqual([['A', 0], ['B', 0]]);
    });

    it('should change only the order when records open or close: the same slots are pointed at other records', async () => {
        // Arrange
        const mounted = await mountTree(family());
        const before = slotElements(mounted);
        const paths = (): string[] => Object.keys(mounted.store.get<Record<string, unknown>>(`${BODY}.slots`));

        // Act
        mounted.store.set('$.app.expanded', ['a', 'a2', 'b'] as never);
        await flush();
        mounted.store.set('$.app.expanded', [] as never);
        await flush();

        // Assert
        expect(slotElements(mounted)).toEqual(before);
        expect(paths()).toHaveLength(before.length);
        expect(mounted.store.get<unknown>('$.runtime.nodes.app.order')).toEqual(['a', 'b']);
    });

    it('should use the order as the keys of the visible rows', async () => {
        // Arrange and Act
        const mounted = await mountTree(family(), { expanded: ['a'] });

        // Assert
        expect(mounted.store.get<unknown>('$.runtime.nodes.app.order')).toEqual(['a', 'a1', 'a2', 'b']);
    });

    it('should draw a record that is added under an expanded parent, and drop one that is removed', async () => {
        // Arrange
        const mounted = await mountTree(family(), { expanded: ['a'] });

        // Act
        mounted.store.set('$.data.nodes', [...family(), node('a3', 'a')] as never);
        await flush();

        // Assert
        expect(shown(mounted).map(([text]) => text)).toEqual(['A', 'A1', 'A2', 'A3', 'B']);

        // Act
        mounted.store.set('$.data.nodes', family().filter((record) => record.id !== 'a1') as never);
        await flush();

        // Assert
        expect(shown(mounted).map(([text]) => text)).toEqual(['A', 'A2', 'B']);
    });

    it('should move a record when its parent field changes', async () => {
        // Arrange
        const mounted = await mountTree(family(), { expanded: ['a', 'b'] });

        // Act
        mounted.store.set('$.data.nodes.1.parentId', 'b' as never);
        await flush();

        // Assert
        expect(shown(mounted)).toEqual([['A', 0], ['A2', 1], ['B', 0], ['A1', 1], ['B1', 1]]);
    });

    it('should read the children of a record from childrenField', async () => {
        // Arrange
        const records = [
            { id: 'root', label: 'Root', kids: ['y', 'x'] },
            { id: 'x', label: 'X' },
            { id: 'y', label: 'Y' }
        ];

        // Act
        const mounted = await mountTree(records, { childrenField: 'kids', expanded: ['root'] });

        // Assert
        expect(shown(mounted)).toEqual([['Root', 0], ['Y', 1], ['X', 1]]);
    });

    it('should read records from a keyed map', async () => {
        // Arrange
        const records = { one: { label: 'One' }, two: { label: 'Two', parentId: 'one' } };

        // Act
        const mounted = await mountTree(records, { expanded: ['one'] });

        // Assert
        expect(shown(mounted)).toEqual([['One', 0], ['Two', 1]]);
    });

    it('should hide a cycle of parent keys, report it once as SUI-RUN and show the rest', async () => {
        // Arrange
        const reported: unknown[][] = [];
        vi.spyOn(report, 'error').mockImplementation((...args: unknown[]) => {
            reported.push(args);
        });
        const records = [node('ok'), node('x', 'y'), node('y', 'x'), node('below', 'x'), node('fine', 'ok')];

        // Act
        const mounted = await mountTree(records, { expanded: ['ok', 'x', 'y'] });
        mounted.store.set('$.app.expanded', ['ok', 'x'] as never);
        await flush();

        // Assert
        expect(shown(mounted)).toEqual([['OK', 0], ['FINE', 1]]);
        expect(reported).toHaveLength(1);
        expect(reported[0]?.[1]).toMatchObject({ code: 'SUI-RUN-BINDING' });
    });

    it('should draw 10,000 nodes with a bounded number of slots', async () => {
        // Arrange
        const records: Node[] = [];
        for (let root = 0; root < 100; root++) {
            records.push(node(`r${root}`));
            for (let child = 0; child < 99; child++) records.push(node(`r${root}c${child}`, `r${root}`));
        }
        const expanded = Array.from({ length: 100 }, (_v, root) => `r${root}`);

        // Act
        const mounted = await mountTree(records, { expanded }, { first: 0, count: 10 });

        // Assert
        expect(mounted.store.get<number>('$.app.body.count')).toBe(10_000);
        expect(slotElements(mounted).length).toBeLessThanOrEqual(20);
        expect(shown(mounted).slice(0, 3)).toEqual([['R0', 0], ['R0C0', 1], ['R0C1', 1]]);

        // Act
        mounted.store.set('$.app.expanded', [] as never);
        await flush();

        // Assert
        expect(mounted.store.get<number>('$.app.body.count')).toBe(100);
        expect(slotElements(mounted).length).toBeLessThanOrEqual(20);
    });

    it('should scale the indent step with the indent property', async () => {
        // Arrange
        const small = await mountTree(family(), { indent: 'sm' });
        const large = await mountTree(family(), { indent: 'lg' });
        const step = (mounted: MountedComponent): number => {
            const probe = document.createElement('div');
            probe.style.paddingInlineStart = 'var(--sui-indent)';
            mounted.element.shadowRoot?.querySelector('.tree')?.append(probe);
            const width = parseFloat(getComputedStyle(probe).paddingInlineStart);
            probe.remove();
            return width;
        };

        // Act and assert
        expect(small.element.getAttribute('indent')).toBe('sm');
        expect(step(small)).toBeLessThan(step(large));
    });
});
