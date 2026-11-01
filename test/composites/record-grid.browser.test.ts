import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};
/** Frames for the resize observer, the window write and the pool refresh to settle */
const settle = async (): Promise<void> => {
    await frames(3);
    await flush();
};
const RUNTIME = '$.runtime.nodes.app';
const ITEM_MIN = 200;
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
const custom = (slot: HTMLElement, name: string): number => Number(new RegExp(`${name}:\\s*(-?\\d+)`).exec(slot.getAttribute('style') ?? '')?.[1] ?? Number.NaN);
const textOf = (slot: HTMLElement): string => (slot.firstElementChild?.firstElementChild as Element | null)?.shadowRoot?.textContent?.trim() ?? '';
const windowOf = (mounted: MountedComponent): { first: number; count: number } => mounted.store.get<{ first: number; count: number }>(`${RUNTIME}.window`);
const columnsOf = (mounted: MountedComponent): number => mounted.store.get<number>('$.app.colCount');

const mountGrid = async (count: number, width: number, height: number, extra: Record<string, unknown> = {}): Promise<MountedComponent> => {
    const mounted = mountComponent('recordGrid', { '<-records': '$.data.records', row: rowTemplate, ...extra }, { data: { records: cards(count) } });
    const host = mounted.element as HTMLElement;
    host.style.display = 'block';
    host.style.inlineSize = `${width}px`;
    host.style.blockSize = `${height}px`;
    host.style.setProperty('--ui-recordgrid-itemmin', `${ITEM_MIN}px`);
    host.style.setProperty('--ui-recordgrid-itemheight', `${ITEM_HEIGHT}px`);
    await settle();
    return mounted;
};
const resize = async (mounted: MountedComponent, width: number, height?: number): Promise<void> => {
    const host = mounted.element as HTMLElement;
    host.style.inlineSize = `${width}px`;
    if (height !== undefined) host.style.blockSize = `${height}px`;
    await settle();
};

describe('recordGrid slot pool across and down in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it.each([
        [640, 3],
        [880, 4],
        [1230, 6]
    ])('should lay 10,000 cards out in columns that follow a width of %i px (%i columns)', async (width, expected) => {
        // Arrange and Act
        const mounted = await mountGrid(10_000, width, 400);

        // Assert
        expect(columnsOf(mounted)).toBe(Math.floor((scroller(mounted).clientWidth) / ITEM_MIN));
        expect(columnsOf(mounted)).toBe(expected);
        const columns = columnsOf(mounted);
        const visible = shownSlots(mounted);
        expect(Math.max(...visible.map((slot) => custom(slot, '--sui-col')))).toBe(columns - 1);
        expect(shadow(mounted).querySelector<HTMLElement>('.rows')?.getAttribute('style')).toContain(`--sui-cols: ${columns}`);
        expect(windowOf(mounted)).toEqual({ first: 0, count: columns * Math.ceil(400 / ITEM_HEIGHT) });
    });

    it('should size the scroll content from the rows and the item height by CSS alone', async () => {
        // Arrange and Act
        const mounted = await mountGrid(1000, 700, 400);

        // Assert
        const rows = Math.ceil(1000 / columnsOf(mounted));
        expect(shadow(mounted).querySelector('.rows')?.getBoundingClientRect().height).toBeCloseTo(rows * ITEM_HEIGHT, 0);
    });

    it('should keep the pool size bounded at every width, down to a pool of 200 slots', async () => {
        // Arrange
        const mounted = await mountGrid(10_000, 400, 400);
        const sizes: number[] = [slots(mounted).length];
        const startColumns = columnsOf(mounted);

        // Act
        for (const width of [600, 900, 1400, 2400]) {
            await resize(mounted, width);
            sizes.push(slots(mounted).length);
        }
        await resize(mounted, 2400, 3000);
        sizes.push(slots(mounted).length);

        // Assert
        for (const size of sizes) expect(size).toBeLessThanOrEqual(200);
        const visibleRows = Math.ceil(400 / ITEM_HEIGHT);
        expect(sizes[0]).toBe(startColumns * (visibleRows + 4));
        expect(sizes[sizes.length - 1]).toBe(200);
    });

    it('should size the pool as columns times the visible rows plus the overscan rows', async () => {
        // Arrange and Act
        const mounted = await mountGrid(10_000, 640, 400, { overscan: 1 });

        // Assert
        const columns = columnsOf(mounted);
        expect(slots(mounted).length).toBe(columns * (Math.ceil(400 / ITEM_HEIGHT) + 2));
    });

    it('should keep the slot elements that remain when a resize changes the column count', async () => {
        // Arrange
        const mounted = await mountGrid(10_000, 640, 400);
        const before = slots(mounted);
        const columnsBefore = columnsOf(mounted);

        // Act
        await resize(mounted, 1000);

        // Assert
        const after = slots(mounted);
        expect(columnsOf(mounted)).toBeGreaterThan(columnsBefore);
        expect(after.length).toBeGreaterThan(before.length);
        for (const slot of before) expect(after.includes(slot), slot.dataset['slot']).toBe(true);
        for (const slot of shownSlots(mounted)) {
            expect(custom(slot, '--sui-col')).toBeLessThan(columnsOf(mounted));
            expect(textOf(slot)).toMatch(/^Card \d+$/);
        }
    });

    it('should keep the slot elements that remain when the column count falls', async () => {
        // Arrange
        const mounted = await mountGrid(10_000, 1000, 400);
        const before = slots(mounted);

        // Act
        await resize(mounted, 440);

        // Assert
        const after = slots(mounted);
        expect(columnsOf(mounted)).toBe(2);
        expect(after.length).toBeLessThan(before.length);
        for (const slot of after) expect(before.includes(slot), slot.dataset['slot']).toBe(true);
    });

    it('should show the records in row-major order', async () => {
        // Arrange
        const mounted = await mountGrid(10_000, 700, 400);
        const columns = columnsOf(mounted);

        // Act
        scroller(mounted).scrollTop = ITEM_HEIGHT * 40 + 10;
        await settle();

        // Assert
        const visible = shownSlots(mounted);
        expect(visible.length).toBeGreaterThan(columns);
        for (const slot of visible) {
            const position = custom(slot, '--sui-row') * columns + custom(slot, '--sui-col');
            expect(textOf(slot)).toBe(`Card ${position}`);
        }
        const view = scroller(mounted).getBoundingClientRect();
        const onScreen = visible.filter((slot) => slot.getBoundingClientRect().bottom > view.top && slot.getBoundingClientRect().top < view.bottom);
        expect(onScreen.length).toBeGreaterThanOrEqual(columns * 4);
        const first = onScreen.map((slot) => custom(slot, '--sui-row') * columns + custom(slot, '--sui-col')).sort((a, b) => a - b)[0] as number;
        expect(first).toBe(40 * columns);
        for (const slot of onScreen) {
            const box = slot.getBoundingClientRect();
            const position = custom(slot, '--sui-row') * columns + custom(slot, '--sui-col');
            expect(box.top - view.top).toBeCloseTo(Math.floor(position / columns) * ITEM_HEIGHT - scroller(mounted).scrollTop, 0);
            expect(box.left - view.left).toBeCloseTo((position % columns) * (scroller(mounted).clientWidth / columns), 0);
        }
    });

    it('should recompute the columns when the itemmin token is written', async () => {
        // Arrange
        const mounted = await mountGrid(1000, 800, 400);
        (mounted.element as HTMLElement).style.removeProperty('--ui-recordgrid-itemmin');
        await settle();
        const before = columnsOf(mounted);

        // Act
        mounted.store.set('$.theme.tokens.recordgrid.itemmin', '100px');
        await settle();

        // Assert
        expect(columnsOf(mounted)).toBeGreaterThan(before);
        expect(columnsOf(mounted)).toBe(Math.floor(scroller(mounted).clientWidth / 100));
    });

    it('should keep the first visible card in view when the column count changes', async () => {
        // Arrange
        const mounted = await mountGrid(10_000, 640, 400);
        scroller(mounted).scrollTop = ITEM_HEIGHT * 30;
        await settle();
        const first = windowOf(mounted).first;

        // Act
        await resize(mounted, 1000);

        // Assert
        const columns = columnsOf(mounted);
        expect(windowOf(mounted).first).toBe(Math.floor(first / columns) * columns);
        expect(scroller(mounted).scrollTop).toBeCloseTo(Math.floor(first / columns) * ITEM_HEIGHT, 0);
    });

    it('should show a record added to the data in the next position', async () => {
        // Arrange
        const mounted = await mountGrid(5, 700, 400);
        const columns = columnsOf(mounted);

        // Act
        mounted.store.set('$.data.records.5', { id: 'c5', name: 'Card 5' });
        await settle();

        // Assert
        const added = shownSlots(mounted).find((slot) => textOf(slot) === 'Card 5');
        expect(added).toBeDefined();
        expect(custom(added as HTMLElement, '--sui-row') * columns + custom(added as HTMLElement, '--sui-col')).toBe(5);
        expect(mounted.store.get<number>('$.app.rowCount')).toBe(Math.ceil(6 / columns));
    });
});
