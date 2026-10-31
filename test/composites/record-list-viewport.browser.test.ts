import { afterEach, describe, expect, it, vi } from 'vitest';
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

interface Person {
    id: string;
    name: string;
}
const people = (count: number): Person[] => Array.from({ length: count }, (_v, i) => ({ id: `r${i}`, name: `Name ${i}` }));
const rowTemplate = { component: 'text', '<-_text': '$row.name' };

const shadow = (mounted: MountedComponent): ShadowRoot => mounted.element.shadowRoot as ShadowRoot;
const scroller = (mounted: MountedComponent): HTMLElement => shadow(mounted).querySelector<HTMLElement>('.list') as HTMLElement;
const slots = (mounted: MountedComponent): HTMLElement[] => Array.from(shadow(mounted).querySelectorAll<HTMLElement>('.slot'));
const shownSlots = (mounted: MountedComponent): HTMLElement[] => slots(mounted).filter((slot) => !slot.hidden);
const position = (slot: HTMLElement): number => Number(/--sui-index:\s*(-?\d+)/.exec(slot.getAttribute('style') ?? '')?.[1] ?? -1);
const textOf = (slot: HTMLElement): string => (slot.firstElementChild?.firstElementChild as Element | null)?.shadowRoot?.textContent?.trim() ?? '';
const rowHeightOf = (root: ParentNode): number => parseFloat(getComputedStyle(root.querySelector('.slot:not([hidden])') as HTMLElement).height);
const rowHeight = (mounted: MountedComponent): number => rowHeightOf(shadow(mounted));
const windowOf = (mounted: MountedComponent): { first: number; count: number } => {
    const value = mounted.store.get<{ first: number; count: number }>(`${RUNTIME}.window`);
    return { first: value.first, count: value.count };
};

const mountList = async (count: number, height: number | undefined, extra: Record<string, unknown> = {}): Promise<MountedComponent> => {
    const mounted = mountComponent('recordList', { '<-records': '$.data.records', row: rowTemplate, ...extra }, { data: { records: people(count) } });
    if (height !== undefined) (mounted.element as HTMLElement).style.blockSize = `${height}px`;
    await settle();
    return mounted;
};

const findList = (root: ParentNode): Element | undefined => {
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        if (candidate.localName === 'ui-record-list') return candidate;
        const inner = candidate.shadowRoot ? findList(candidate.shadowRoot) : undefined;
        if (inner) return inner;
    }
    return undefined;
};

describe('recordList positioning and observer in Chromium', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        mountComponent.unmountAll();
    });

    it('should show the records under the scroll offset at the right offsets', async () => {
        // Arrange
        const mounted = await mountList(10_000, 240);
        const height = rowHeight(mounted);

        // Act
        scroller(mounted).scrollTop = height * 500 + height / 2;
        await settle();

        // Assert
        const view = scroller(mounted).getBoundingClientRect();
        const visible = shownSlots(mounted).filter((slot) => {
            const box = slot.getBoundingClientRect();
            return box.bottom > view.top && box.top < view.bottom;
        });
        expect(windowOf(mounted).first).toBe(500);
        expect(visible.length).toBeGreaterThanOrEqual(Math.floor(240 / height));
        for (const slot of visible) {
            expect(textOf(slot)).toBe(`Name ${position(slot)}`);
            expect(slot.getBoundingClientRect().top - view.top).toBeCloseTo(position(slot) * height - scroller(mounted).scrollTop, 0);
        }
        expect(slots(mounted).length).toBeLessThanOrEqual(200);
    });

    it('should size the scroll content from the count and the row height by CSS alone', async () => {
        // Arrange
        const mounted = await mountList(1000, 240);
        const rows = shadow(mounted).querySelector('.rows') as HTMLElement;

        // Act and Assert
        expect(rows.getBoundingClientRect().height).toBeCloseTo(1000 * rowHeight(mounted), 0);
    });

    it('should follow a viewport resize', async () => {
        // Arrange
        const mounted = await mountList(1000, 200);
        const height = rowHeight(mounted);
        const before = windowOf(mounted);

        // Act
        (mounted.element as HTMLElement).style.blockSize = '600px';
        await settle();

        // Assert
        expect(before.count).toBe(Math.ceil(200 / height));
        expect(windowOf(mounted).count).toBe(Math.ceil(600 / height));
        expect(shownSlots(mounted).length).toBeGreaterThanOrEqual(windowOf(mounted).count);
    });

    it('should read the scroll offset once per frame however many scroll events come', async () => {
        // Arrange
        const mounted = await mountList(1000, 200);
        const element = scroller(mounted);
        const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop') as PropertyDescriptor;
        let reads = 0;
        Object.defineProperty(element, 'scrollTop', {
            configurable: true,
            get: () => {
                reads += 1;
                return (descriptor.get as () => number).call(element);
            },
            set: (value: number) => (descriptor.set as (value: number) => void).call(element, value)
        });
        const raf = vi.spyOn(globalThis, 'requestAnimationFrame');

        // Act
        for (let i = 0; i < 6; i++) element.dispatchEvent(new Event('scroll'));
        await frames(2);

        // Assert
        expect(reads).toBe(1);
        expect(raf.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('should re-flow the rows when the recordlist row token is written', async () => {
        // Arrange
        const mounted = await mountList(100, 400);
        const before = rowHeight(mounted);

        // Act
        mounted.store.set('$.theme.tokens.recordlist.row', '60px');
        await settle();

        // Assert
        expect(before).not.toBe(60);
        expect(rowHeight(mounted)).toBe(60);
        expect(windowOf(mounted).count).toBe(Math.ceil(400 / 60));
    });

    it('should scale the row height by the density of a container', async () => {
        // Arrange
        const mounted = mountComponent(
            'panel',
            { density: 'comfortable', children: { list: { component: 'recordList', '<-records': '$.data.records', row: rowTemplate } } },
            { data: { records: people(50) } }
        );
        await settle();
        const target = findList(shadow(mounted)) as HTMLElement;
        target.style.blockSize = '300px';
        await settle();
        const comfortable = rowHeightOf(target.shadowRoot as ShadowRoot);

        // Act
        mounted.store.set('$.app.density', 'compact');
        await settle();

        // Assert
        expect(rowHeightOf(target.shadowRoot as ShadowRoot)).toBeCloseTo(comfortable * 0.75, 1);
    });

    it('should never read layout while rendering', async () => {
        // Arrange
        const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect');
        const computed = vi.spyOn(window, 'getComputedStyle');
        const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get');

        // Act
        const mounted = await mountList(500, 200);
        mounted.store.set('$.data.records.2.name', 'Changed');
        mounted.store.get<Person[]>('$.data.records').push({ id: 'x', name: 'X' });
        await settle();

        // Assert
        expect(rect).not.toHaveBeenCalled();
        expect(computed).not.toHaveBeenCalled();
        expect(offsetHeight).not.toHaveBeenCalled();
    });

    it('should raise range once for each change of the window, with the record count', async () => {
        // Arrange
        const mounted = await mountList(1000, 200);
        const ranges: unknown[] = [];
        mounted.element.addEventListener('range', (event) => ranges.push((event as CustomEvent).detail));
        const height = rowHeight(mounted);

        // Act
        scroller(mounted).scrollTop = height * 40;
        await settle();
        const afterMove = ranges.length;
        scroller(mounted).scrollTop = height * 40 + 1;
        await settle();

        // Assert
        expect(afterMove).toBe(1);
        expect(ranges[0]).toMatchObject({ first: 40, total: 1000 });
        expect(ranges.length).toBeLessThanOrEqual(2);
    });

    it('should keep a stable scrollbar gutter on the scrolling body', async () => {
        // Arrange
        const mounted = await mountList(10, 200);

        // Act and Assert
        expect(getComputedStyle(scroller(mounted)).scrollbarGutter).toBe('stable');
    });
});

describe('recordList accessibility in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should give list slots aria-setsize and aria-posinset that follow the window', async () => {
        // Arrange
        const mounted = await mountList(1000, 200);
        const height = rowHeight(mounted);

        // Act
        scroller(mounted).scrollTop = height * 300;
        await settle();

        // Assert
        expect(mounted.element.getAttribute('role')).toBe('list');
        expect(shownSlots(mounted).length).toBeGreaterThan(0);
        for (const slot of shownSlots(mounted)) {
            expect(slot.getAttribute('role')).toBe('listitem');
            expect(slot.getAttribute('aria-setsize')).toBe('1000');
            expect(slot.getAttribute('aria-posinset')).toBe(String(position(slot) + 1));
            expect(slot.hasAttribute('aria-rowindex')).toBe(false);
        }
        expect(mounted.element.hasAttribute('aria-rowcount')).toBe(false);
    });

    it('should give listbox slots the option role', async () => {
        // Arrange and Act
        const mounted = await mountList(20, 200, { role: 'listbox' });

        // Assert
        expect(mounted.element.getAttribute('role')).toBe('listbox');
        expect(shownSlots(mounted).every((slot) => slot.getAttribute('role') === 'option' && slot.hasAttribute('aria-posinset'))).toBe(true);
    });

    it('should bind aria-rowcount on the host and aria-rowindex on each slot for a table', async () => {
        // Arrange
        const mounted = await mountList(1000, 200, { role: 'table' });
        const height = rowHeight(mounted);

        // Act
        scroller(mounted).scrollTop = height * 120;
        await settle();
        mounted.store.get<Person[]>('$.data.records').pop();
        await settle();

        // Assert
        expect(mounted.element.getAttribute('role')).toBe('table');
        expect(mounted.element.getAttribute('aria-rowcount')).toBe('999');
        for (const slot of shownSlots(mounted)) {
            expect(slot.getAttribute('role')).toBe('row');
            expect(slot.getAttribute('aria-rowindex')).toBe(String(position(slot) + 1));
            expect(slot.hasAttribute('aria-setsize')).toBe(false);
            expect(slot.hasAttribute('aria-posinset')).toBe(false);
        }
    });
});
