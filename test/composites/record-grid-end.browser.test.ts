import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const frames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};
/** Frames for the resize observers, the height map, the scroll to the end and the pool refresh to settle */
const settle = async (): Promise<void> => {
    await frames(8);
    await new Promise((resolve) => setTimeout(resolve, 0));
};
const ESTIMATE = 60;

interface Card {
    id: string;
    lines: number;
}
const LINES = [3, 9, 5, 12, 4, 7, 10, 6];
const cards = (count: number): Card[] => Array.from({ length: count }, (_v, i) => ({ id: `c${i}`, lines: LINES[(i * 3) % LINES.length] as number }));
const rowTemplate = { component: 'skeleton', shape: 'text', '<-lines': '$row.lines' };

interface GridElement extends Element {
    commands?: { scrollTo?: (value: unknown) => void; scrollToEnd?: () => void };
}
const scroller = (mounted: MountedComponent): HTMLElement => (mounted.element.shadowRoot as ShadowRoot).querySelector<HTMLElement>('.grid') as HTMLElement;
/** How far the view is from the end of the content, in pixels */
const gap = (mounted: MountedComponent): number => scroller(mounted).scrollHeight - scroller(mounted).clientHeight - scroller(mounted).scrollTop;
const atEnd = (mounted: MountedComponent): boolean => mounted.store.get<boolean>('$.app.atEnd');
const commands = (mounted: MountedComponent): NonNullable<GridElement['commands']> => (mounted.element as GridElement).commands as NonNullable<GridElement['commands']>;

const mountGrid = async (records: Card[], extra: Record<string, unknown> = {}, height = 400): Promise<MountedComponent> => {
    const mounted = mountComponent('recordGrid', { '<-records': '$.data.records', row: rowTemplate, ...extra }, { data: { records } });
    const host = mounted.element as HTMLElement;
    host.style.display = 'block';
    host.style.inlineSize = '300px';
    host.style.blockSize = `${height}px`;
    host.style.setProperty('--ui-recordgrid-itemmin', '200px');
    host.style.setProperty('--ui-recordgrid-itemheight', `${ESTIMATE}px`);
    await settle();
    return mounted;
};

describe('recordGrid scrolling by command and following the end in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should scroll to the end on scrollToEnd, also while the heights of the rows above are still estimates', async () => {
        // Arrange
        const mounted = await mountGrid(cards(2000));
        expect(scroller(mounted).scrollTop).toBe(0);

        // Act
        commands(mounted).scrollToEnd?.();
        await settle();

        // Assert
        expect(gap(mounted)).toBeLessThanOrEqual(2);
        expect(atEnd(mounted)).toBe(true);
    });

    it('should keep the end in view after scrollToEnd while a record is added, until the user scrolls away', async () => {
        // Arrange
        const mounted = await mountGrid(cards(300));
        commands(mounted).scrollToEnd?.();
        await settle();

        // Act
        mounted.store.set('$.data.records.300', { id: 'c300', lines: 14 });
        await settle();

        // Assert
        expect(gap(mounted)).toBeLessThanOrEqual(2);
        scroller(mounted).scrollTop -= 300;
        await settle();
        const top = scroller(mounted).scrollTop;
        mounted.store.set('$.data.records.301', { id: 'c301', lines: 14 });
        await settle();
        expect(atEnd(mounted)).toBe(false);
        expect(Math.abs(scroller(mounted).scrollTop - top)).toBeLessThan(1.5);
    });

    it('should put the row of the record at the top on scrollTo and reject a key no record has', async () => {
        // Arrange
        const mounted = await mountGrid(cards(500));

        // Act
        commands(mounted).scrollTo?.('c40');
        await settle();

        // Assert
        const slot = Array.from((mounted.element.shadowRoot as ShadowRoot).querySelectorAll<HTMLElement>('.slot')).find((candidate) => !candidate.hidden && /--sui-row:\s*40\b/.test(candidate.getAttribute('style') ?? ''));
        expect(slot).toBeDefined();
        expect(Math.abs((slot as HTMLElement).getBoundingClientRect().top - scroller(mounted).getBoundingClientRect().top)).toBeLessThan(1.5);
        expect(atEnd(mounted)).toBe(false);
        expect(() => commands(mounted).scrollTo?.('missing')).toThrow(/no record has the key "missing"/);
    });

    it('should stay at the end with follow while records are added and the last record grows, and not move when the user has scrolled up', async () => {
        // Arrange
        const mounted = await mountGrid(cards(40), { follow: true });
        expect(gap(mounted)).toBeLessThanOrEqual(2);

        // Act and Assert: records are added
        for (let i = 40; i < 46; i++) {
            mounted.store.set(`$.data.records.${i}`, { id: `c${i}`, lines: 8 });
            await settle();
            expect(gap(mounted), `added ${i}`).toBeLessThanOrEqual(2);
        }

        // Act and Assert: the last record grows
        mounted.store.set('$.data.records.45.lines', 20);
        await settle();
        expect(gap(mounted)).toBeLessThanOrEqual(2);

        // Act and Assert: the user scrolls up, then records arrive
        scroller(mounted).scrollTop = 200;
        await settle();
        expect(atEnd(mounted)).toBe(false);
        mounted.store.set('$.data.records.46', { id: 'c46', lines: 8 });
        mounted.store.set('$.data.records.45.lines', 30);
        await settle();
        expect(Math.abs(scroller(mounted).scrollTop - 200)).toBeLessThan(1.5);
        expect(atEnd(mounted)).toBe(false);
    });

    it('should follow the end again once the user scrolls back to it', async () => {
        // Arrange
        const mounted = await mountGrid(cards(40), { follow: true });
        scroller(mounted).scrollTop = 100;
        await settle();
        expect(atEnd(mounted)).toBe(false);

        // Act
        scroller(mounted).scrollTop = scroller(mounted).scrollHeight;
        await settle();
        mounted.store.set('$.data.records.40', { id: 'c40', lines: 12 });
        await settle();

        // Assert
        expect(atEnd(mounted)).toBe(true);
        expect(gap(mounted)).toBeLessThanOrEqual(2);
    });

    it('should stay at the end with follow when the viewport is made smaller', async () => {
        // Arrange
        const mounted = await mountGrid(cards(60), { follow: true });
        expect(gap(mounted)).toBeLessThanOrEqual(2);

        // Act
        (mounted.element as HTMLElement).style.blockSize = '200px';
        await settle();

        // Assert
        expect(gap(mounted)).toBeLessThanOrEqual(2);
        expect(atEnd(mounted)).toBe(true);
    });

    it('should not move without follow when records are added at the end', async () => {
        // Arrange
        const mounted = await mountGrid(cards(40));
        scroller(mounted).scrollTop = scroller(mounted).scrollHeight;
        await settle();

        // Act
        mounted.store.set('$.data.records.40', { id: 'c40', lines: 12 });
        await settle();

        // Assert
        expect(gap(mounted)).toBeGreaterThan(20);
    });
});
