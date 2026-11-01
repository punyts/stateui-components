import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};
/** Frames for the resize observers, the height map, the scroll correction and the pool refresh to settle */
const settle = async (): Promise<void> => {
    await frames(6);
    await flush();
};
const ESTIMATE = 60;

interface Card {
    id: string;
    lines: number;
}
const LINES = [3, 9, 5, 12, 4, 7, 10, 6];
/** Cards of eight different heights, in a repeating order */
const cards = (count: number): Card[] => Array.from({ length: count }, (_v, i) => ({ id: `c${i}`, lines: LINES[(i * 3) % LINES.length] as number }));
const rowTemplate = { component: 'skeleton', shape: 'text', '<-lines': '$row.lines' };

const shadow = (mounted: MountedComponent): ShadowRoot => mounted.element.shadowRoot as ShadowRoot;
const scroller = (mounted: MountedComponent): HTMLElement => shadow(mounted).querySelector<HTMLElement>('.grid') as HTMLElement;
const slots = (mounted: MountedComponent): HTMLElement[] => Array.from(shadow(mounted).querySelectorAll<HTMLElement>('.slot'));
const shownSlots = (mounted: MountedComponent): HTMLElement[] => slots(mounted).filter((slot) => !slot.hidden);
const custom = (slot: HTMLElement, name: string): number => Number(new RegExp(`${name}:\\s*(-?[\\d.]+)`).exec(slot.getAttribute('style') ?? '')?.[1] ?? Number.NaN);
const columnsOf = (mounted: MountedComponent): number => mounted.store.get<number>('$.app.colCount');
const positionOf = (mounted: MountedComponent, slot: HTMLElement): number => custom(slot, '--sui-row') * columnsOf(mounted) + custom(slot, '--sui-col');
const slotAtPosition = (mounted: MountedComponent, position: number): HTMLElement | undefined => shownSlots(mounted).find((slot) => positionOf(mounted, slot) === position);
const screenTop = (mounted: MountedComponent, slot: HTMLElement): number => slot.getBoundingClientRect().top - scroller(mounted).getBoundingClientRect().top;
const contentHeight = (mounted: MountedComponent): number => mounted.store.get<number>('$.app.contentHeight');
const rowsHeight = (mounted: MountedComponent): number => (shadow(mounted).querySelector('.rows') as HTMLElement).getBoundingClientRect().height;
const windowOf = (mounted: MountedComponent): { first: number; count: number } => mounted.store.get<{ first: number; count: number }>('$.runtime.nodes.app.window');

const mountGrid = async (records: Card[], width: number, height: number, extra: Record<string, unknown> = {}): Promise<MountedComponent> => {
    const mounted = mountComponent('recordGrid', { '<-records': '$.data.records', row: rowTemplate, ...extra }, { data: { records } });
    const host = mounted.element as HTMLElement;
    host.style.display = 'block';
    host.style.inlineSize = `${width}px`;
    host.style.blockSize = `${height}px`;
    host.style.setProperty('--ui-recordgrid-itemmin', '200px');
    host.style.setProperty('--ui-recordgrid-itemheight', `${ESTIMATE}px`);
    await settle();
    return mounted;
};

/** A card that is fully inside the viewport, with its position and where it is */
const reference = (mounted: MountedComponent): { position: number; top: number } => {
    const height = scroller(mounted).clientHeight;
    const inside = shownSlots(mounted)
        .map((slot) => ({ position: positionOf(mounted, slot), top: screenTop(mounted, slot), height: slot.getBoundingClientRect().height }))
        .filter((candidate) => candidate.top >= 0 && candidate.top + candidate.height <= height)
        .sort((a, b) => a.top - b.top || a.position - b.position);
    const middle = inside[Math.floor(inside.length / 2)];
    if (middle === undefined) throw new Error('no card is fully inside the viewport');
    return { position: middle.position, top: middle.top };
};
const topOf = (mounted: MountedComponent, position: number): number => {
    const slot = slotAtPosition(mounted, position);
    if (slot === undefined) throw new Error(`no slot shows position ${position}`);
    return screenTop(mounted, slot);
};

describe('recordGrid measured row heights in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should place every item at the offset its measured height gives, with no gap and no overlap', async () => {
        // Arrange and Act
        const mounted = await mountGrid(cards(500), 300, 400);

        // Assert
        expect(columnsOf(mounted)).toBe(1);
        const visible = shownSlots(mounted).sort((a, b) => positionOf(mounted, a) - positionOf(mounted, b));
        expect(visible.length).toBeGreaterThan(3);
        const heights = new Set(visible.map((slot) => Math.round(slot.getBoundingClientRect().height)));
        expect(heights.size).toBeGreaterThan(2);
        for (let i = 1; i < visible.length; i++) {
            const previous = visible[i - 1] as HTMLElement;
            const next = visible[i] as HTMLElement;
            expect(screenTop(mounted, next) - screenTop(mounted, previous)).toBeCloseTo(previous.getBoundingClientRect().height, 0);
        }
    });

    it('should use the tallest item of a row as the row height when there are several columns', async () => {
        // Arrange and Act
        const mounted = await mountGrid(cards(200), 440, 400);

        // Assert
        expect(columnsOf(mounted)).toBe(2);
        const rows = new Map<number, HTMLElement[]>();
        for (const slot of shownSlots(mounted)) rows.set(custom(slot, '--sui-row'), [...(rows.get(custom(slot, '--sui-row')) ?? []), slot]);
        const ordered = [...rows.entries()].sort((a, b) => a[0] - b[0]);
        expect(ordered.length).toBeGreaterThan(3);
        for (let i = 1; i < ordered.length; i++) {
            const tallest = Math.max(...(ordered[i - 1] as [number, HTMLElement[]])[1].map((slot) => slot.getBoundingClientRect().height));
            const gap = screenTop(mounted, (ordered[i] as [number, HTMLElement[]])[1][0] as HTMLElement) - screenTop(mounted, (ordered[i - 1] as [number, HTMLElement[]])[1][0] as HTMLElement);
            expect(gap).toBeCloseTo(tallest, 0);
        }
    });

    it('should keep the visible cards in place while the user scrolls up through rows that were never measured', async () => {
        // Arrange
        const mounted = await mountGrid(cards(2000), 440, 400);
        scroller(mounted).scrollTop = 4000;
        await settle();

        // Act and Assert
        for (let step = 0; step < 14; step++) {
            const before = reference(mounted);
            scroller(mounted).scrollTop -= 45;
            await settle();
            expect(Math.abs(topOf(mounted, before.position) - before.top - 45), `step ${step}`).toBeLessThan(1.5);
        }
    });

    it('should keep the visible cards in place when an item above the window grows', async () => {
        // Arrange
        const mounted = await mountGrid(cards(2000), 440, 400);
        scroller(mounted).scrollTop = 4000;
        await settle();
        const columns = columnsOf(mounted);
        const above = windowOf(mounted).first - 2 * columns;
        expect(slotAtPosition(mounted, above)).toBeDefined();
        const before = reference(mounted);
        const scrollBefore = scroller(mounted).scrollTop;

        // Act
        mounted.store.set(`$.data.records.${above}.lines`, 18);
        mounted.store.set(`$.data.records.${above + 1}.lines`, 18);
        await settle();

        // Assert
        expect(scroller(mounted).scrollTop).toBeGreaterThan(scrollBefore);
        expect(Math.abs(topOf(mounted, before.position) - before.top)).toBeLessThan(1.5);
    });

    it('should keep the visible cards in place when an image above the window loads late and the item grows', async () => {
        // Arrange
        const mounted = await mountGrid(cards(2000), 440, 400);
        scroller(mounted).scrollTop = 4000;
        await settle();
        const columns = columnsOf(mounted);
        const above = windowOf(mounted).first - columns;
        const before = reference(mounted);
        mounted.store.set(`$.data.records.${above}.lines`, 2);
        mounted.store.set(`$.data.records.${above + 1}.lines`, 2);
        await settle();
        const settled = reference(mounted);

        // Act
        await new Promise((resolve) => setTimeout(resolve, 250));
        mounted.store.set(`$.data.records.${above}.lines`, 16);
        mounted.store.set(`$.data.records.${above + 1}.lines`, 16);
        await settle();

        // Assert
        expect(Math.abs(topOf(mounted, settled.position) - settled.top)).toBeLessThan(1.5);
        expect(before.position).toBeGreaterThanOrEqual(0);
    });

    it('should leave scrollTop alone when an item in the window grows', async () => {
        // Arrange
        const mounted = await mountGrid(cards(2000), 440, 400);
        scroller(mounted).scrollTop = 4000;
        await settle();
        const scrollBefore = scroller(mounted).scrollTop;
        const first = windowOf(mounted).first;
        const heightBefore = rowsHeight(mounted);

        // Act
        mounted.store.set(`$.data.records.${first}.lines`, 18);
        mounted.store.set(`$.data.records.${first + 1}.lines`, 18);
        await settle();

        // Assert
        expect(scroller(mounted).scrollTop).toBe(scrollBefore);
        expect(rowsHeight(mounted)).not.toBe(heightBefore);
    });

    it('should make the scroll height the sum of the measured and the estimated rows', async () => {
        // Arrange and Act
        const mounted = await mountGrid(cards(1000), 300, 400);

        // Assert
        expect(contentHeight(mounted)).toBeCloseTo(rowsHeight(mounted), 0);
        expect(contentHeight(mounted)).toBeGreaterThan(1000 * ESTIMATE);
        const measured = shownSlots(mounted).reduce((sum, slot) => sum + slot.getBoundingClientRect().height, 0);
        expect(measured).toBeGreaterThan(0);
        expect(contentHeight(mounted)).toBeLessThan(1000 * 330);
    });

    it('should keep the scrollbar stable within one item height while scrolling', async () => {
        // Arrange
        const mounted = await mountGrid(cards(1000), 300, 400);
        const tallest = 18 * 40;
        const heights: number[] = [scroller(mounted).scrollHeight];

        // Act
        for (let step = 1; step <= 40; step++) {
            scroller(mounted).scrollTop = step * 50;
            await settle();
            heights.push(scroller(mounted).scrollHeight);
        }

        // Assert
        for (let i = 1; i < heights.length; i++) {
            expect(Math.abs((heights[i] as number) - (heights[i - 1] as number)), `step ${i}`).toBeLessThan(tallest);
        }
        const biggest = Math.max(...shownSlots(mounted).map((slot) => slot.getBoundingClientRect().height));
        expect(Math.max(...heights.slice(1).map((height, i) => Math.abs(height - (heights[i] as number))))).toBeLessThanOrEqual(2 * biggest);
    });

    it('should keep the height of each record when the array reorders', async () => {
        // Arrange
        const records = cards(60);
        const mounted = await mountGrid(records, 300, 400);
        //only the records that were shown are measured, so the reorder keeps to them: the rest still count as the estimate
        const measured = shownSlots(mounted).length;
        expect(measured).toBeGreaterThan(3);
        const before = new Map(shownSlots(mounted).map((slot) => [positionOf(mounted, slot), slot.getBoundingClientRect().height]));

        // Act
        mounted.store.set('$.data.records', [...records.slice(0, measured).reverse(), ...records.slice(measured)]);
        await flush();

        // Assert
        //before any new measurement, each of those records sits where the heights measured before put it
        const visible = shownSlots(mounted).sort((a, b) => positionOf(mounted, a) - positionOf(mounted, b));
        let top = 0;
        for (let position = 0; position < measured; position++) {
            const slot = visible.find((candidate) => positionOf(mounted, candidate) === position) as HTMLElement;
            expect(screenTop(mounted, slot), `position ${position}`).toBeCloseTo(top, 0);
            top += before.get(measured - 1 - position) as number;
        }
        await settle();
        const after = shownSlots(mounted).sort((a, b) => positionOf(mounted, a) - positionOf(mounted, b));
        for (let i = 1; i < after.length; i++) {
            expect(screenTop(mounted, after[i] as HTMLElement) - screenTop(mounted, after[i - 1] as HTMLElement)).toBeCloseTo((after[i - 1] as HTMLElement).getBoundingClientRect().height, 0);
        }
    });

    it('should measure a record again when its slot is recycled to a record of the same height', async () => {
        // Arrange
        const same = Array.from({ length: 400 }, (_v, i) => ({ id: `c${i}`, lines: 6 }));
        const mounted = await mountGrid(same, 300, 400);
        const height = shownSlots(mounted)[0]?.getBoundingClientRect().height as number;
        expect(height).toBeGreaterThan(ESTIMATE);

        // Act
        scroller(mounted).scrollTop = ESTIMATE * 150;
        await settle();

        // Assert
        const visible = shownSlots(mounted).sort((a, b) => positionOf(mounted, a) - positionOf(mounted, b));
        expect(visible.length).toBeGreaterThan(3);
        for (let i = 1; i < visible.length; i++) {
            const previous = visible[i - 1] as HTMLElement;
            expect(screenTop(mounted, visible[i] as HTMLElement) - screenTop(mounted, previous)).toBeCloseTo(height, 0);
        }
    });
});
