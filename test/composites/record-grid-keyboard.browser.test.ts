import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};
const settle = async (): Promise<void> => {
    await frames(4);
    await flush();
};
const ITEM_HEIGHT = 100;

interface Card {
    id: string;
    name: string;
}
const cards = (count: number): Card[] => Array.from({ length: count }, (_v, i) => ({ id: `c${i}`, name: `Card ${i}` }));
const rowTemplate = { component: 'text', '<-_text': '$row.name' };

const shadow = (mounted: MountedComponent): ShadowRoot => mounted.element.shadowRoot as ShadowRoot;
const scroller = (mounted: MountedComponent): HTMLElement => shadow(mounted).querySelector<HTMLElement>('.grid') as HTMLElement;
const slots = (mounted: MountedComponent): HTMLElement[] => Array.from(shadow(mounted).querySelectorAll<HTMLElement>('.slot'));
const shownSlots = (mounted: MountedComponent): HTMLElement[] => slots(mounted).filter((slot) => !slot.hidden);
const custom = (slot: HTMLElement, name: string): number => Number(new RegExp(`${name}:\\s*(-?[\\d.]+)`).exec(slot.getAttribute('style') ?? '')?.[1] ?? Number.NaN);
const columnsOf = (mounted: MountedComponent): number => mounted.store.get<number>('$.app.colCount');
const positionOf = (mounted: MountedComponent, slot: HTMLElement): number => custom(slot, '--sui-row') * columnsOf(mounted) + custom(slot, '--sui-col');
const textOf = (slot: HTMLElement): string => (slot.firstElementChild?.firstElementChild as Element | null)?.shadowRoot?.textContent?.trim() ?? '';
const slotAtPosition = (mounted: MountedComponent, position: number): HTMLElement | undefined => shownSlots(mounted).find((slot) => positionOf(mounted, slot) === position);
const active = (mounted: MountedComponent): HTMLElement | undefined => shadow(mounted).activeElement?.closest<HTMLElement>('.slot') ?? undefined;
/** The record the focused slot shows, as the number in its name */
const focusedCard = (mounted: MountedComponent): number => {
    const slot = active(mounted);
    if (slot === undefined) return -1;
    return Number(/\d+/.exec(textOf(slot))?.[0] ?? -1);
};

const mountGrid = async (count: number, width: number, height: number): Promise<MountedComponent> => {
    const mounted = mountComponent('recordGrid', { '<-records': '$.data.records', row: rowTemplate }, { data: { records: cards(count) } });
    const host = mounted.element as HTMLElement;
    host.style.display = 'block';
    host.style.inlineSize = `${width}px`;
    host.style.blockSize = `${height}px`;
    host.style.setProperty('--ui-recordgrid-itemmin', '200px');
    host.style.setProperty('--ui-recordgrid-itemheight', `${ITEM_HEIGHT}px`);
    await settle();
    return mounted;
};
const focusPosition = async (mounted: MountedComponent, position: number): Promise<void> => {
    (slotAtPosition(mounted, position) as HTMLElement).focus();
    await settle();
};
const press = async (mounted: MountedComponent, key: string, modifiers: { ctrlKey?: boolean } = {}): Promise<void> => {
    const target = active(mounted) as HTMLElement;
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true, ...modifiers }));
    await settle();
};

describe('recordGrid roles and keyboard in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should be a grid of gridcells with row and column indexes and one tab stop', async () => {
        // Arrange and Act
        const mounted = await mountGrid(100, 640, 400);

        // Assert
        const columns = columnsOf(mounted);
        expect(columns).toBe(3);
        expect(mounted.element.getAttribute('role')).toBe('grid');
        expect(mounted.element.getAttribute('aria-rowcount')).toBe(String(Math.ceil(100 / columns)));
        expect(mounted.element.getAttribute('aria-colcount')).toBe(String(columns));
        const visible = shownSlots(mounted);
        expect(visible.length).toBeGreaterThan(columns);
        for (const slot of visible) {
            expect(slot.getAttribute('role')).toBe('gridcell');
            expect(slot.getAttribute('aria-rowindex')).toBe(String(custom(slot, '--sui-row') + 1));
            expect(slot.getAttribute('aria-colindex')).toBe(String(custom(slot, '--sui-col') + 1));
        }
        expect(visible.filter((slot) => slot.tabIndex === 0)).toHaveLength(1);
        expect(positionOf(mounted, visible.find((slot) => slot.tabIndex === 0) as HTMLElement)).toBe(0);
    });

    it('should move the tab stop to the cell that has focus', async () => {
        // Arrange
        const mounted = await mountGrid(100, 640, 400);

        // Act
        await focusPosition(mounted, 4);

        // Assert
        const stops = shownSlots(mounted).filter((slot) => slot.tabIndex === 0);
        expect(stops).toHaveLength(1);
        expect(positionOf(mounted, stops[0] as HTMLElement)).toBe(4);
    });

    it('should move by position with the arrow keys and stop at the ends of a row', async () => {
        // Arrange
        const mounted = await mountGrid(100, 640, 400);
        await focusPosition(mounted, 4);

        // Act and Assert
        await press(mounted, 'ArrowRight');
        expect(focusedCard(mounted)).toBe(5);
        await press(mounted, 'ArrowRight');
        expect(focusedCard(mounted)).toBe(5);
        await press(mounted, 'ArrowLeft');
        expect(focusedCard(mounted)).toBe(4);
        await press(mounted, 'ArrowDown');
        expect(focusedCard(mounted)).toBe(7);
        await press(mounted, 'ArrowUp');
        expect(focusedCard(mounted)).toBe(4);
        await press(mounted, 'ArrowLeft');
        await press(mounted, 'ArrowLeft');
        expect(focusedCard(mounted)).toBe(3);
        await press(mounted, 'ArrowUp');
        await press(mounted, 'ArrowUp');
        expect(focusedCard(mounted)).toBe(0);
    });

    it('should go to the ends of the row with Home and End and to the first and last item with Ctrl+Home and Ctrl+End', async () => {
        // Arrange
        const mounted = await mountGrid(100, 640, 400);
        await focusPosition(mounted, 4);

        // Act and Assert
        await press(mounted, 'End');
        expect(focusedCard(mounted)).toBe(5);
        await press(mounted, 'Home');
        expect(focusedCard(mounted)).toBe(3);
        await press(mounted, 'End', { ctrlKey: true });
        expect(focusedCard(mounted)).toBe(99);
        expect(scroller(mounted).scrollTop).toBeGreaterThan(0);
        const last = active(mounted) as HTMLElement;
        const view = scroller(mounted).getBoundingClientRect();
        expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(view.bottom + 1);
        await press(mounted, 'Home', { ctrlKey: true });
        expect(focusedCard(mounted)).toBe(0);
        expect(scroller(mounted).scrollTop).toBe(0);
    });

    it('should end a short last row at its last item and let Down reach it from the row above', async () => {
        // Arrange
        const mounted = await mountGrid(8, 640, 400);
        await focusPosition(mounted, 5);

        // Act and Assert
        await press(mounted, 'ArrowDown');
        expect(focusedCard(mounted)).toBe(7);
        await press(mounted, 'ArrowDown');
        expect(focusedCard(mounted)).toBe(7);
        await press(mounted, 'ArrowRight');
        expect(focusedCard(mounted)).toBe(7);
        await press(mounted, 'Home');
        expect(focusedCard(mounted)).toBe(6);
        await press(mounted, 'End');
        expect(focusedCard(mounted)).toBe(7);
    });

    it('should keep moving down across the edge of the window, scrolling the target into it first', async () => {
        // Arrange
        const mounted = await mountGrid(500, 640, 400);
        await focusPosition(mounted, 9);
        const view = scroller(mounted).getBoundingClientRect();

        // Act and Assert
        for (let step = 1; step <= 8; step++) {
            await press(mounted, 'ArrowDown');
            expect(focusedCard(mounted)).toBe(9 + 3 * step);
            const box = (active(mounted) as HTMLElement).getBoundingClientRect();
            expect(box.bottom).toBeLessThanOrEqual(view.bottom + 1);
            expect(box.top).toBeGreaterThanOrEqual(view.top - 1);
        }
        expect(scroller(mounted).scrollTop).toBeGreaterThan(0);
        for (let step = 1; step <= 8; step++) {
            await press(mounted, 'ArrowUp');
            const box = (active(mounted) as HTMLElement).getBoundingClientRect();
            expect(box.top).toBeGreaterThanOrEqual(view.top - 1);
        }
        expect(focusedCard(mounted)).toBe(9);
    });

    it('should keep the focused record and move by the new column count after a resize changes it', async () => {
        // Arrange
        const mounted = await mountGrid(500, 640, 400);
        await focusPosition(mounted, 7);
        expect(columnsOf(mounted)).toBe(3);

        // Act
        (mounted.element as HTMLElement).style.inlineSize = '1040px';
        await settle();

        // Assert
        expect(columnsOf(mounted)).toBe(5);
        expect(focusedCard(mounted)).toBe(7);
        await press(mounted, 'ArrowDown');
        expect(focusedCard(mounted)).toBe(12);
        await press(mounted, 'ArrowRight');
        expect(focusedCard(mounted)).toBe(13);
        (mounted.element as HTMLElement).style.inlineSize = '440px';
        await settle();
        expect(columnsOf(mounted)).toBe(2);
        expect(focusedCard(mounted)).toBe(13);
        await press(mounted, 'ArrowUp');
        expect(focusedCard(mounted)).toBe(11);
        expect(shownSlots(mounted).filter((slot) => slot.tabIndex === 0)).toHaveLength(1);
    });

    it('should keep focus on its record when the focused slot scrolls out of the window', async () => {
        // Arrange
        const mounted = await mountGrid(500, 640, 400);
        await focusPosition(mounted, 4);
        const pinned = active(mounted) as HTMLElement;

        // Act
        scroller(mounted).scrollTop = ITEM_HEIGHT * 120;
        await settle();

        // Assert
        expect(mounted.store.get<{ first: number }>('$.runtime.nodes.app.window').first).toBeGreaterThan(300);
        expect(active(mounted)).toBe(pinned);
        expect(focusedCard(mounted)).toBe(4);
        await press(mounted, 'ArrowDown');
        expect(focusedCard(mounted)).toBe(7);
        expect(scroller(mounted).scrollTop).toBeLessThan(ITEM_HEIGHT * 10);
    });

    it('should move focus to the record that takes the place of a deleted focused record', async () => {
        // Arrange
        const mounted = await mountGrid(100, 640, 400);
        await focusPosition(mounted, 4);

        // Act
        mounted.store.delete('$.data.records.4');
        await settle();

        // Assert
        expect(focusedCard(mounted)).toBe(5);
    });

    it('should swap Left and Right in right-to-left text', async () => {
        // Arrange
        const mounted = await mountGrid(100, 640, 400);
        (mounted.element as HTMLElement).dir = 'rtl';
        await settle();
        await focusPosition(mounted, 4);

        // Act and Assert
        await press(mounted, 'ArrowLeft');
        expect(focusedCard(mounted)).toBe(5);
        await press(mounted, 'ArrowRight');
        expect(focusedCard(mounted)).toBe(4);
    });

    it('should leave a key typed in a field inside a cell to the field', async () => {
        // Arrange
        const mounted = await mountGrid(20, 640, 400);
        await focusPosition(mounted, 4);
        const field = document.createElement('input');
        (active(mounted) as HTMLElement).append(field);
        field.focus();

        // Act
        const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true, cancelable: true });
        field.dispatchEvent(event);
        await settle();

        // Assert
        expect(event.defaultPrevented).toBe(false);
        field.remove();
    });
});
