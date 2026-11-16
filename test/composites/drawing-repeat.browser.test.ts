import { report } from '@punyts/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent, MountOptions, NodeState } from '../harness/createMountComponent.js';

const ROOT = '$.app.children';
const REPEAT = `${ROOT}.seats`;

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Waits until the drawing says it is drawn (`data-render="ready"`), at most 50 frames */
async function drawn(mounted: MountedComponent): Promise<void> {
    await Promise.resolve();
    for (let at = 0; at < 50; at += 1) {
        if (mounted.element.getAttribute('data-render') === 'ready') return;
        await frame();
    }
    throw new Error(`the drawing is still ${mounted.element.getAttribute('data-render')}`);
}

async function mountDrawing(node: NodeState, options: MountOptions = {}): Promise<MountedComponent> {
    const mounted = mountComponent('drawing', node, options);
    await drawn(mounted);
    return mounted;
}

/** A seat template: its position and fill linked from the record */
const seat = { component: 'rect', width: 8, height: 8, '<-x': '$row.x', '<-y': '$row.y', '<-fill': '$row.fill' };

/** `count` seat records keyed `s<n>`, in a grid of 50 a row */
const seats = (count: number): Record<string, { x: number; y: number; fill: string }> =>
    Object.fromEntries(Array.from({ length: count }, (_value, index) => [`s${index}`, { x: (index % 50) * 10, y: Math.floor(index / 50) * 10, fill: '#000000' }]));

/** A drawing with one repeat over `$.data.seats` */
const mountSeats = (records: unknown, row: unknown = seat): Promise<MountedComponent> =>
    mountDrawing(
        { viewBox: { x: 0, y: 0, width: 500, height: 500 }, children: { seats: { component: 'drawRepeat', '<-records': '$.data.seats', row } } },
        { data: { seats: records } }
    );

const repeatOf = (mounted: MountedComponent): SVGElement => {
    const found = mounted.element.shadowRoot?.querySelector<SVGElement>(`[data-shape-path="${REPEAT}"]`);
    if (!found) throw new Error('no element for the repeat');
    return found;
};

const copies = (mounted: MountedComponent): SVGElement[] => Array.from(repeatOf(mounted).children) as SVGElement[];

const copyAt = (mounted: MountedComponent, key: string): SVGElement => {
    const found = mounted.element.shadowRoot?.querySelector<SVGElement>(`[data-shape-path="${REPEAT}.rows.${key}"]`);
    if (!found) throw new Error(`no element for the copy ${key}`);
    return found;
};

/** Every DOM change under the repeat while `act` runs and the drawing redraws */
async function changesDuring(mounted: MountedComponent, act: () => void): Promise<MutationRecord[]> {
    const changes: MutationRecord[] = [];
    const watcher = new MutationObserver((records) => changes.push(...records));
    watcher.observe(repeatOf(mounted), { attributes: true, childList: true, subtree: true, characterData: true });
    act();
    await drawn(mounted);
    changes.push(...watcher.takeRecords());
    watcher.disconnect();
    return changes;
}

const calls = (spy: { mock: { calls: unknown[][] } }, code: string): unknown[][] =>
    spy.mock.calls.filter((call) => (call[1] as { code?: string } | undefined)?.code === code);

describe('drawing drawRepeat with the SVG renderer in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
        vi.restoreAllMocks();
    });

    it('should draw one element per record of 1,000, keyed rows.<recordKey> with the kind of the template', async () => {
        // Act
        const mounted = await mountSeats(seats(1000));

        // Assert
        const drawnCopies = copies(mounted);
        expect(repeatOf(mounted).localName).toBe('g');
        expect(repeatOf(mounted).getAttribute('data-shape-kind')).toBe('drawRepeat');
        expect(drawnCopies).toHaveLength(1000);
        expect(drawnCopies.every((copy) => copy.localName === 'rect' && copy.getAttribute('data-shape-kind') === 'rect')).toBe(true);
        expect(drawnCopies.map((copy) => copy.getAttribute('data-shape-path'))).toEqual(Array.from({ length: 1000 }, (_value, index) => `${REPEAT}.rows.s${index}`));
        expect(copyAt(mounted, 's51').getAttribute('x')).toBe('10');
        expect(copyAt(mounted, 's51').getAttribute('y')).toBe('10');
        expect(copyAt(mounted, 's51').getAttribute('width')).toBe('8');
    });

    it('should change only the element of a changed record, add only the added one and remove only the removed one', async () => {
        // Arrange
        const mounted = await mountSeats(seats(1000));
        const before = copies(mounted);

        // Act
        const changed = await changesDuring(mounted, () => mounted.store.set('$.data.seats.s7.x', 333));
        const added = await changesDuring(mounted, () => mounted.store.set('$.data.seats.extra', { x: 1, y: 2, fill: '#000000' }));
        const removed = await changesDuring(mounted, () => mounted.store.delete('$.data.seats.s3' as never));

        // Assert
        expect(changed.map((change) => [change.type, change.attributeName, (change.target as Element).getAttribute('data-shape-path')])).toEqual([
            ['attributes', 'x', `${REPEAT}.rows.s7`]
        ]);
        expect(copyAt(mounted, 's7').getAttribute('x')).toBe('333');
        expect(added).toHaveLength(1);
        expect(added[0]?.type).toBe('childList');
        expect(Array.from(added[0]!.addedNodes).map((node) => (node as Element).getAttribute('data-shape-path'))).toEqual([`${REPEAT}.rows.extra`]);
        expect(added[0]?.removedNodes).toHaveLength(0);
        expect(removed).toHaveLength(1);
        expect(Array.from(removed[0]!.removedNodes).map((node) => (node as Element).getAttribute('data-shape-path'))).toEqual([`${REPEAT}.rows.s3`]);
        expect(removed[0]?.addedNodes).toHaveLength(0);
        const after = new Set(copies(mounted));
        expect(before.filter((copy) => copy.getAttribute('data-shape-path') !== `${REPEAT}.rows.s3`).every((copy) => after.has(copy))).toBe(true);
        expect(after.size).toBe(1000);
    });

    it('should draw the first 2,000 of 2,500 records and report the cap once', async () => {
        // Arrange
        const error = vi.spyOn(report, 'error').mockImplementation(() => undefined);

        // Act
        const mounted = await mountSeats(seats(2500));
        mounted.store.set('$.data.seats.s0.x', 5);
        await drawn(mounted);

        // Assert
        const drawnCopies = copies(mounted);
        expect(drawnCopies).toHaveLength(2000);
        expect(drawnCopies[1999]?.getAttribute('data-shape-path')).toBe(`${REPEAT}.rows.s1999`);
        expect(copyAt(mounted, 's0').getAttribute('x')).toBe('5');
        const caps = calls(error, 'SUI-RUN-CAP');
        expect(caps).toHaveLength(1);
        expect(caps[0]?.[1]).toMatchObject({ code: 'SUI-RUN-CAP', path: REPEAT });
        expect(String(caps[0]?.[0])).toContain('2500');
        expect(String(caps[0]?.[0])).toContain('2000');
    });

    it('should colour each copy from its record through <-fill from $row.fill', async () => {
        // Act
        const mounted = await mountSeats({
            a: { x: 0, y: 0, fill: '#ff0000' },
            b: { x: 10, y: 0, fill: '{color.accent.base}' },
            c: { x: 20, y: 0, fill: 'rgb(0, 0, 255)' }
        });
        (mounted.element as HTMLElement).style.setProperty('--ui-color-accent-base', 'rgb(1, 2, 3)');

        // Assert
        expect(['a', 'b', 'c'].map((key) => copyAt(mounted, key).getAttribute('fill'))).toEqual(['#ff0000', 'var(--ui-color-accent-base)', 'rgb(0, 0, 255)']);
        expect(getComputedStyle(copyAt(mounted, 'a')).fill).toBe('rgb(255, 0, 0)');
        expect(getComputedStyle(copyAt(mounted, 'b')).fill).toBe('rgb(1, 2, 3)');

        // Act
        mounted.store.set('$.data.seats.c.fill', '#00ff00');
        await drawn(mounted);

        // Assert
        expect(copyAt(mounted, 'c').getAttribute('fill')).toBe('#00ff00');
    });

    it('should draw nothing and report nothing for an empty or a missing record set', async () => {
        // Arrange
        const error = vi.spyOn(report, 'error').mockImplementation(() => undefined);

        // Act
        const empty = await mountSeats({});
        const list = await mountSeats([]);
        const missing = await mountDrawing({ children: { seats: { component: 'drawRepeat', row: seat } } });

        // Assert
        expect(copies(empty)).toHaveLength(0);
        expect(copies(list)).toHaveLength(0);
        expect(copies(missing)).toHaveLength(0);
        expect(error).not.toHaveBeenCalled();
    });
});
