import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';
import type { RecordViewElement } from '../../src/shared/records/recordView.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};
const settle = async (): Promise<void> => {
    await frames(3);
    await flush();
};
const RUNTIME = '$.runtime.nodes.app';

interface Person {
    id: string;
    name: string;
}
const people = (count: number): Person[] => Array.from({ length: count }, (_v, i) => ({ id: `r${i}`, name: `Name ${i}` }));

const rowButton = {
    component: 'button',
    '<-_title': '$row.name',
    on: { press: { command: 'set', target: '$.data.picked', value: '$row.id' } }
};

const shadow = (mounted: MountedComponent): ShadowRoot => mounted.element.shadowRoot as ShadowRoot;
const scroller = (mounted: MountedComponent): HTMLElement => shadow(mounted).querySelector<HTMLElement>('.list') as HTMLElement;
const slots = (mounted: MountedComponent): HTMLElement[] => Array.from(shadow(mounted).querySelectorAll<HTMLElement>('.slot'));
const shownSlots = (mounted: MountedComponent): HTMLElement[] => slots(mounted).filter((slot) => !slot.hidden);
const positionOf = (slot: HTMLElement): number => Number(/--sui-index:\s*(-?\d+)/.exec(slot.getAttribute('style') ?? '')?.[1] ?? -1);
const slotAt = (mounted: MountedComponent, position: number): HTMLElement | undefined =>
    shownSlots(mounted).find((slot) => positionOf(slot) === position);
const activePosition = (mounted: MountedComponent): number | undefined => {
    const slot = shadow(mounted).activeElement?.closest<HTMLElement>('.slot');
    return slot === null || slot === undefined ? undefined : positionOf(slot);
};
const rowHeight = (mounted: MountedComponent): number => parseFloat(getComputedStyle(shownSlots(mounted)[0] as HTMLElement).height);
const windowOf = (mounted: MountedComponent): { first: number; count: number } => mounted.store.get<{ first: number; count: number }>(`${RUNTIME}.window`);
const press = (slot: HTMLElement): void => {
    const button = (slot.querySelector('sui-node')?.firstElementChild as Element).shadowRoot?.querySelector('button') as HTMLButtonElement;
    button.click();
};
const keyDown = (target: HTMLElement, key: string): void => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }));
};

const mountList = async (count: number, extra: Record<string, unknown> = {}, height = 240): Promise<MountedComponent> => {
    const mounted = mountComponent(
        'recordList',
        { '<-records': '$.data.records', row: rowButton, ...extra },
        { data: { records: people(count), picked: '', chosen: 'r5', many: ['r1', 'r2'] } }
    );
    (mounted.element as HTMLElement).style.blockSize = `${height}px`;
    await settle();
    return mounted;
};

describe('recordList selection, focus and row commands in Chromium', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        mountComponent.unmountAll();
    });

    it('should locate a record by key, the empty record for a missing key, and the new path after an insert', async () => {
        // Arrange
        const mounted = await mountList(50);
        const locate = (key: string): string => (mounted.element as RecordViewElement).locate?.(key) as string;

        // Act
        const before = locate('r3');
        const missing = locate('nope');
        mounted.store.get<Person[]>('$.data.records').unshift({ id: 'front', name: 'Front' });
        await settle();

        // Assert
        expect(before).toBe('$.app.records.3');
        expect(missing).toBe('$.runtime.empty');
        expect(locate('r3')).toBe('$.app.records.4');
        expect(locate('front')).toBe('$.app.records.0');
    });

    it('should keep a selection by key while its slot is recycled', async () => {
        // Arrange
        const mounted = await mountList(500, { role: 'listbox', '<-selected': '$.data.chosen' });
        const selectedPositions = (): number[] => shownSlots(mounted).filter((slot) => slot.hasAttribute('data-selected')).map(positionOf);

        // Act and Assert
        expect(selectedPositions()).toEqual([5]);
        expect(slotAt(mounted, 5)?.getAttribute('aria-selected')).toBe('true');
        expect(slotAt(mounted, 4)?.getAttribute('aria-selected')).toBe('false');

        scroller(mounted).scrollTop = rowHeight(mounted) * 300;
        await settle();
        expect(selectedPositions()).toEqual([]);

        scroller(mounted).scrollTop = 0;
        await settle();
        expect(selectedPositions()).toEqual([5]);

        mounted.store.set('$.data.chosen', 'r7');
        await settle();
        expect(selectedPositions()).toEqual([7]);
    });

    it('should select several keys from a list and leave aria-selected off outside the listbox role', async () => {
        // Arrange and Act
        const listbox = await mountList(30, { role: 'listbox', '<-selected': '$.data.many' });
        const plain = await mountList(30, { '<-selected': '$.data.many' });

        // Assert
        expect(shownSlots(listbox).filter((slot) => slot.hasAttribute('data-selected')).map(positionOf).sort()).toEqual([1, 2]);
        expect(shownSlots(plain).filter((slot) => slot.hasAttribute('data-selected')).map(positionOf).sort()).toEqual([1, 2]);
        expect(shownSlots(plain).every((slot) => !slot.hasAttribute('aria-selected'))).toBe(true);
    });

    it('should make exactly one slot the tab stop, before and after scrolling', async () => {
        // Arrange
        const mounted = await mountList(500);
        const stops = (): number[] => shownSlots(mounted).filter((slot) => slot.getAttribute('tabindex') === '0').map(positionOf);

        // Act and Assert
        expect(stops()).toEqual([0]);
        scroller(mounted).scrollTop = rowHeight(mounted) * 200;
        await settle();
        expect(stops()).toEqual([windowOf(mounted).first]);
    });

    it('should move the focus by position with the arrows, Home, End, PageDown and PageUp across the window edge', async () => {
        // Arrange
        const mounted = await mountList(500);
        slotAt(mounted, 0)?.focus();
        await flush();
        const visible = windowOf(mounted).count;

        // Act and Assert
        for (let i = 1; i <= visible + 3; i++) {
            keyDown(shadow(mounted).activeElement as HTMLElement, 'ArrowDown');
            await flush();
            expect(activePosition(mounted)).toBe(i);
        }
        expect(windowOf(mounted).first).toBeGreaterThan(0);
        keyDown(shadow(mounted).activeElement as HTMLElement, 'ArrowUp');
        await flush();
        expect(activePosition(mounted)).toBe(visible + 2);

        keyDown(shadow(mounted).activeElement as HTMLElement, 'End');
        await settle();
        expect(activePosition(mounted)).toBe(499);
        expect(windowOf(mounted).first + windowOf(mounted).count).toBeGreaterThanOrEqual(499);

        keyDown(shadow(mounted).activeElement as HTMLElement, 'PageUp');
        await settle();
        expect(activePosition(mounted)).toBe(499 - (visible - 1));

        keyDown(shadow(mounted).activeElement as HTMLElement, 'Home');
        await settle();
        expect(activePosition(mounted)).toBe(0);
        expect(scroller(mounted).scrollTop).toBe(0);

        keyDown(shadow(mounted).activeElement as HTMLElement, 'PageDown');
        await settle();
        expect(activePosition(mounted)).toBe(visible - 1);
    });

    it('should keep the focus on a slot whose record scrolls out of the window and give it back on return', async () => {
        // Arrange
        const mounted = await mountList(500);
        const focused = slotAt(mounted, 2) as HTMLElement;
        focused.focus();
        await flush();

        // Act
        scroller(mounted).scrollTop = rowHeight(mounted) * 300;
        await settle();

        // Assert
        expect(shadow(mounted).activeElement?.closest('.slot')).toBe(focused);
        expect(positionOf(focused)).toBe(2);
        expect(slots(mounted).length).toBeLessThanOrEqual(30);
        expect(shownSlots(mounted).filter((slot) => positionOf(slot) >= 290).length).toBeGreaterThan(0);
        expect(shownSlots(mounted).filter((slot) => slot !== focused && positionOf(slot) === 2)).toHaveLength(0);

        scroller(mounted).scrollTop = 0;
        await settle();
        expect(shadow(mounted).activeElement?.closest('.slot')).toBe(focused);
        expect(positionOf(focused)).toBe(2);
        expect(shownSlots(mounted).filter((slot) => positionOf(slot) === 2)).toHaveLength(1);
    });

    it('should release the pin and move the focus to the neighbouring row when the focused record is deleted', async () => {
        // Arrange
        const mounted = await mountList(500);
        slotAt(mounted, 3)?.focus();
        await flush();

        // Act
        mounted.store.delete('$.data.records.3');
        await settle();

        // Assert
        expect(activePosition(mounted)).toBe(3);
        const now = slotAt(mounted, 3) as HTMLElement;
        expect(shadow(mounted).activeElement?.closest('.slot')).toBe(now);
        expect((now.querySelector('sui-node')?.firstElementChild as Element).shadowRoot?.textContent).toContain('Name 4');
    });

    it('should move the focus to the previous row when the focused last record is deleted', async () => {
        // Arrange
        const mounted = await mountList(8);
        slotAt(mounted, 7)?.focus();
        await flush();

        // Act
        mounted.store.delete('$.data.records.7');
        await settle();

        // Assert
        expect(activePosition(mounted)).toBe(6);
    });

    it('should scroll to a record far down with scrollTo and report an unknown key without moving', async () => {
        // Arrange
        const mounted = await mountList(2000);
        const commands = (mounted.element as RecordViewElement).commands;
        const height = rowHeight(mounted);

        // Act
        commands?.scrollTo?.('r1500');
        await settle();

        // Assert
        expect(scroller(mounted).scrollTop).toBeCloseTo(1500 * height, 0);
        expect(windowOf(mounted).first).toBe(1500);
        expect(slotAt(mounted, 1500)).toBeDefined();
        const top = scroller(mounted).scrollTop;
        expect(() => commands?.scrollTo?.('missing')).toThrow('missing');
        await settle();
        expect(scroller(mounted).scrollTop).toBe(top);
    });

    it('should show skeleton rows over the visible rows and aria-busy while loading, and the rows again after', async () => {
        // Arrange
        const mounted = await mountList(100);
        const placeholders = (): Element[] => Array.from(shadow(mounted).querySelectorAll('.placeholder'));
        expect(placeholders()).toHaveLength(0);
        expect(mounted.element.hasAttribute('aria-busy')).toBe(false);

        // Act
        mounted.store.set('$.app.loading', true);
        await settle();

        // Assert
        expect(placeholders()).toHaveLength(windowOf(mounted).count);
        expect(placeholders()[0]?.querySelector('ui-skeleton')).not.toBeNull();
        expect(mounted.element.getAttribute('aria-busy')).toBe('true');
        expect(getComputedStyle(shownSlots(mounted)[0] as HTMLElement).visibility).toBe('hidden');

        mounted.store.set('$.app.loading', false);
        await settle();
        expect(placeholders()).toHaveLength(0);
        expect(mounted.element.hasAttribute('aria-busy')).toBe(false);
        expect(getComputedStyle(shownSlots(mounted)[0] as HTMLElement).visibility).toBe('visible');
    });

    it('should show skeleton rows for a loading list that has no records yet', async () => {
        // Arrange and Act
        const mounted = await mountList(0, { loading: true });

        // Assert
        expect(shadow(mounted).querySelectorAll('.placeholder').length).toBeGreaterThan(0);
    });

    it('should write the id of the row a button sits in, before and after the slot is recycled', async () => {
        // Arrange
        const mounted = await mountList(500);

        // Act
        press(slotAt(mounted, 2) as HTMLElement);
        await flush();
        const before = mounted.store.get<string>('$.data.picked');
        const slot = slotAt(mounted, 2) as HTMLElement;
        scroller(mounted).scrollTop = rowHeight(mounted) * 300;
        await settle();
        const recycled = shownSlots(mounted).find((candidate) => positionOf(candidate) === 302) as HTMLElement;
        press(recycled);
        await flush();

        // Assert
        expect(before).toBe('r2');
        expect(slot.isConnected).toBe(true);
        expect(mounted.store.get<string>('$.data.picked')).toBe('r302');
    });
});
