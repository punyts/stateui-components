import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';
import type { RecordViewElement } from '../../src/shared/records/recordView.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};
const settle = async (): Promise<void> => {
    await flush();
    await frames(3);
    await flush();
};
const RUNTIME = '$.runtime.nodes.app';
const TOTAL = 10000;

interface Item {
    id: string;
    name: string;
}
const item = (position: number): Item => ({ id: `k${position}`, name: `Name ${position}` });
/** A map keyed by position holding the records of `count` positions from `first` */
const window = (first: number, count: number): Record<string, Item> => {
    const map: Record<string, Item> = {};
    for (let position = first; position < first + count; position++) map[String(position)] = item(position);
    return map;
};
const rowTemplate = { component: 'text', '<-_text': '$row.name' };

const positionOf = (slot: HTMLElement): number => Number(/--sui-index:\s*(-?\d+)/.exec(slot.getAttribute('style') ?? '')?.[1] ?? -1);
const recordListOf = (mounted: MountedComponent): HTMLElement =>
    mounted.element.localName === 'ui-record-list' ? (mounted.element as HTMLElement) : (mounted.element.shadowRoot?.querySelector('ui-record-list') as HTMLElement);
const inner = (mounted: MountedComponent): ShadowRoot => recordListOf(mounted).shadowRoot as ShadowRoot;
const shownSlots = (mounted: MountedComponent): HTMLElement[] =>
    Array.from(inner(mounted).querySelectorAll<HTMLElement>('.slot'))
        .filter((slot) => !slot.hidden)
        .sort((a, b) => positionOf(a) - positionOf(b));
const slotText = (slot: HTMLElement): string => (slot.querySelector('sui-node')?.firstElementChild as Element | null)?.shadowRoot?.textContent?.trim() ?? '';
const pendingPositions = (mounted: MountedComponent): number[] => shownSlots(mounted).filter((slot) => slot.hasAttribute('data-pending')).map(positionOf);
const loadedTexts = (mounted: MountedComponent): Map<number, string> => {
    const map = new Map<number, string>();
    for (const slot of shownSlots(mounted)) if (!slot.hasAttribute('data-pending')) map.set(positionOf(slot), slotText(slot));
    return map;
};
const scroller = (mounted: MountedComponent): HTMLElement => inner(mounted).querySelector<HTMLElement>('.list') as HTMLElement;
const rowsBox = (mounted: MountedComponent): HTMLElement => inner(mounted).querySelector<HTMLElement>('.rows') as HTMLElement;
const events = (mounted: MountedComponent, name: string): unknown[] => {
    const seen: unknown[] = [];
    mounted.element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};
const ids = (value: unknown): string[] => {
    if (Array.isArray(value)) return (value as Item[]).map((entry) => entry.id);
    return Object.entries(value as Record<string, Item>)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([, entry]) => entry.id);
};

/** The source writing records at positions, one store write each */
const write = (mounted: MountedComponent, records: Record<string, Item>): void => {
    for (const [position, record] of Object.entries(records)) mounted.store.set(`$.data.rows.${position}`, record);
};

const mountView = async (
    component: string,
    props: Record<string, unknown>,
    data: Record<string, unknown>,
    height = 240
): Promise<MountedComponent> => {
    //a document refuses integer-like keys, so a map keyed by position starts empty and the source writes it at runtime
    const initial = data['rows'];
    const positional = initial !== null && typeof initial === 'object' && !Array.isArray(initial) ? (initial as Record<string, Item>) : undefined;
    const mounted = mountComponent(component, props, { data: { picked: [], chosen: '', ...(positional === undefined ? data : { ...data, rows: {} }) } });
    if (positional !== undefined) write(mounted, positional);
    (mounted.element as HTMLElement).style.blockSize = `${height}px`;
    await settle();
    return mounted;
};

describe('record views with paged data (total) in Chromium', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        mountComponent.unmountAll();
    });

    it('should size the scroll area and the accessibility counts from total and show skeleton rows for positions with no record', async () => {
        // Arrange and Act
        const mounted = await mountView(
            'recordList',
            { '<-records': '$.data.rows', '<-total': '$.data.total', row: rowTemplate },
            { rows: window(0, 50), total: TOTAL }
        );
        const first = shownSlots(mounted)[0] as HTMLElement;

        // Assert
        expect(mounted.store.get('$.app.count')).toBe(TOTAL);
        expect(rowsBox(mounted).style.getPropertyValue('--sui-count')).toBe(String(TOTAL));
        expect(first.getAttribute('aria-setsize')).toBe(String(TOTAL));
        expect(first.getAttribute('aria-posinset')).toBe('1');
        expect(slotText(first)).toBe('Name 0');
        expect(pendingPositions(mounted)).toEqual([]);
        expect(parseFloat(getComputedStyle(rowsBox(mounted)).height)).toBeGreaterThan(TOTAL * 20);
    });

    it('should set aria-rowcount from total for the table role', async () => {
        // Arrange and Act
        const mounted = await mountView(
            'recordList',
            { '<-records': '$.data.rows', '<-total': '$.data.total', row: rowTemplate, role: 'table' },
            { rows: window(0, 50), total: TOTAL }
        );

        // Assert
        expect(mounted.element.getAttribute('aria-rowcount')).toBe(String(TOTAL));
        expect(shownSlots(mounted)[0]?.getAttribute('aria-rowindex')).toBe('1');
    });

    it('should raise range with the total, show pending rows in a later window and fill them when the source writes the records', async () => {
        // Arrange
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const mounted = await mountView(
            'recordList',
            { '<-records': '$.data.rows', '<-total': '$.data.total', row: rowTemplate },
            { rows: window(0, 50), total: TOTAL }
        );
        const ranges = events(mounted, 'range') as { first: number; count: number; total: number }[];

        // Act
        scroller(mounted).scrollTop = 5000 * parseFloat(getComputedStyle(shownSlots(mounted)[0] as HTMLElement).height);
        await settle();

        // Assert: nothing is loaded there, so every shown row is pending and links to the empty record
        const last = ranges[ranges.length - 1] as { first: number; count: number; total: number };
        expect(last.total).toBe(TOTAL);
        expect(last.first).toBeGreaterThanOrEqual(4990);
        const shown = shownSlots(mounted);
        expect(shown.length).toBeGreaterThan(0);
        expect(pendingPositions(mounted)).toEqual(shown.map(positionOf));
        const slotIndex = Number(shown[0]?.dataset['slot']);
        expect(mounted.store.get(`${RUNTIME}.slots.${slotIndex}.row`)).toEqual(mounted.store.get('$.runtime.empty'));
        expect(slotText(shown[0] as HTMLElement)).toBe('');

        // Act: the source fills the window that range named
        write(mounted, window(last.first, last.count + 10));
        await settle();

        // Assert
        expect(pendingPositions(mounted).filter((position) => position >= last.first && position < last.first + last.count)).toEqual([]);
        expect(loadedTexts(mounted).get(last.first)).toBe(`Name ${last.first}`);
        const filled = shownSlots(mounted).find((slot) => positionOf(slot) === last.first) as HTMLElement;
        expect(mounted.store.get(`${RUNTIME}.slots.${Number(filled.dataset['slot'])}.row.name`)).toBe(`Name ${last.first}`);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should show a record that arrives for a pending position in the same slot', async () => {
        // Arrange
        const mounted = await mountView(
            'recordList',
            { '<-records': '$.data.rows', '<-total': '$.data.total', row: rowTemplate },
            { rows: window(0, 2), total: TOTAL }
        );
        expect(pendingPositions(mounted).length).toBeGreaterThan(0);
        const target = Math.min(...pendingPositions(mounted));

        // Act
        write(mounted, { [String(target)]: item(target) });
        await settle();

        // Assert
        expect(pendingPositions(mounted)).not.toContain(target);
        expect(loadedTexts(mounted).get(target)).toBe(`Name ${target}`);
    });

    it('should read an array of records by position and show the rest as pending', async () => {
        // Arrange and Act
        const mounted = await mountView(
            'recordList',
            { '<-records': '$.data.rows', '<-total': '$.data.total', row: rowTemplate },
            { rows: Array.from({ length: 3 }, (_v, i) => item(i)), total: TOTAL }
        );

        // Assert
        expect([...loadedTexts(mounted).values()]).toEqual(['Name 0', 'Name 1', 'Name 2']);
        expect(Math.min(...pendingPositions(mounted))).toBe(3);
        expect(mounted.store.get('$.app.count')).toBe(TOTAL);
    });

    it('should ignore order while total is set', async () => {
        // Arrange and Act
        const mounted = await mountView(
            'recordList',
            { '<-records': '$.data.rows', '<-total': '$.data.total', '<-order': '$.data.order', row: rowTemplate },
            { rows: window(0, 50), total: TOTAL, order: ['k3', 'k2', 'k1'] }
        );

        // Assert
        expect(mounted.store.get('$.app.count')).toBe(TOTAL);
        expect([...loadedTexts(mounted).values()].slice(0, 3)).toEqual(['Name 0', 'Name 1', 'Name 2']);
    });

    it('should locate loaded records, give the empty record for a missing one and follow the key after a re-sort at the source', async () => {
        // Arrange
        const mounted = await mountView(
            'recordList',
            { '<-records': '$.data.rows', '<-total': '$.data.total', '<-selected': '$.data.chosen', row: rowTemplate, role: 'listbox' },
            { rows: window(0, 50), total: TOTAL, chosen: 'k1' }
        );
        const locate = (key: string): string => (mounted.element as RecordViewElement).locate?.(key) as string;
        const selectedTexts = (): string[] => shownSlots(mounted).filter((slot) => slot.hasAttribute('data-selected')).map(slotText);

        // Assert before
        expect(locate('k1')).toBe('$.app.records.1');
        expect(locate('k9000')).toBe('$.runtime.empty');
        expect(selectedTexts()).toEqual(['Name 1']);

        // Act: the source re-sorts the first four positions
        write(mounted, { '0': item(3), '1': item(2), '2': item(1), '3': item(0) });
        await settle();

        // Assert: the key moved from position 1 to position 2 and the selection followed it
        expect(locate('k1')).toBe('$.app.records.2');
        expect(locate('k3')).toBe('$.app.records.0');
        expect(locate('k4')).toBe('$.app.records.4');
        expect(selectedTexts()).toEqual(['Name 1']);
        const selectedSlot = shownSlots(mounted).find((slot) => slot.hasAttribute('data-selected')) as HTMLElement;
        expect(positionOf(selectedSlot)).toBe(2);
    });

    it('should drop a record from the index when the source clears its position', async () => {
        // Arrange
        const mounted = await mountView(
            'recordList',
            { '<-records': '$.data.rows', '<-total': '$.data.total', row: rowTemplate },
            { rows: window(0, 10), total: TOTAL }
        );
        const locate = (key: string): string => (mounted.element as RecordViewElement).locate?.(key) as string;

        // Act
        mounted.store.delete('$.data.rows.4');
        await settle();

        // Assert
        expect(locate('k4')).toBe('$.runtime.empty');
        expect(pendingPositions(mounted)).toContain(4);
    });

    it('should list only the loaded records as keys', async () => {
        // Arrange and Act
        const mounted = await mountView(
            'recordList',
            { '<-records': '$.data.rows', '<-total': '$.data.total', row: rowTemplate },
            { rows: window(0, 50), total: TOTAL }
        );
        const keys = (mounted.element as RecordViewElement).recordKeys?.() ?? [];

        // Assert
        expect(keys).toHaveLength(50);
        expect(keys[0]).toBe('k0');
        expect(keys[49]).toBe('k49');
    });

    it('should behave as unpaged again when total is removed', async () => {
        // Arrange
        const mounted = await mountView(
            'recordList',
            { '<-records': '$.data.rows', '<-total': '$.data.total', row: rowTemplate },
            { rows: window(0, 5), total: TOTAL }
        );

        // Act
        mounted.store.delete('$.data.total');
        await settle();

        // Assert
        expect(mounted.store.get('$.app.count')).toBe(5);
        expect(pendingPositions(mounted)).toEqual([]);
    });

    describe('list', () => {
        const mountList = (extra: Record<string, unknown> = {}, rows: unknown = window(0, 50)): Promise<MountedComponent> =>
            mountView('list', { '<-items': '$.data.rows', '<-total': '$.data.total', row: rowTemplate, ...extra }, { rows, total: TOTAL });

        it('should show total as the count and skeleton rows, and select only loaded records with selectAll', async () => {
            // Arrange
            const mounted = await mountList({ selectable: 'multi', '<-selected': '$.data.picked' });

            // Act
            (mounted.element as Element & { commands: Record<string, () => void> }).commands['selectAll']?.();
            await settle();

            // Assert
            expect(rowsBox(mounted).style.getPropertyValue('--sui-count')).toBe(String(TOTAL));
            expect(pendingPositions(mounted)).toEqual([]);
            expect(mounted.store.get<string[]>('$.data.picked')).toHaveLength(50);
        });

        it('should raise sort for a sortBy and sortDir change, compute no order and leave the data alone', async () => {
            // Arrange
            const mounted = await mountList();
            const sorts = events(mounted, 'sort');
            const before = ids(mounted.store.get('$.data.rows'));

            // Act
            mounted.store.set('$.app.sortDir', 'desc');
            mounted.store.set('$.app.sortBy', 'name');
            await settle();

            // Assert
            expect(sorts).toEqual([{ sortBy: 'name', sortDir: 'desc' }]);
            expect(mounted.store.get('$.runtime.nodes.app.order')).toBeUndefined();
            expect(ids(mounted.store.get('$.data.rows'))).toEqual(before);
            expect(loadedTexts(mounted).get(0)).toBe('Name 0');
        });

        it('should keep current on the selected record after a re-sort at the source', async () => {
            // Arrange
            const mounted = await mountList({ selectable: 'single', '<-selected': '$.data.chosen' });
            mounted.store.set('$.data.chosen', 'k1');
            await settle();
            expect(mounted.store.get('$.runtime.nodes.app.current.name')).toBe('Name 1');

            // Act
            write(mounted, { '0': item(3), '1': item(2), '2': item(1), '3': item(0) });
            await settle();

            // Assert
            expect(mounted.store.get('$.runtime.nodes.app.current.name')).toBe('Name 1');
            expect(mounted.store.get('$.runtime.nodes.app.current.id')).toBe('k1');
        });

        it('should point current at the empty record while the selected record is not loaded', async () => {
            // Arrange
            const mounted = await mountList({ selectable: 'single', '<-selected': '$.data.chosen' }, window(0, 5));
            mounted.store.set('$.data.chosen', 'k900');
            await settle();

            // Assert: not loaded
            expect(mounted.store.get('$.runtime.nodes.app.current.name')).toBeUndefined();

            // Act: the source loads it
            write(mounted, { '900': item(900) });
            await settle();

            // Assert
            expect(mounted.store.get('$.runtime.nodes.app.current.name')).toBe('Name 900');
        });
    });

    describe('table', () => {
        const COLUMNS = Object.freeze({ name: { _title: 'Name', field: 'name', sortable: true } });
        const mountTable = (rows: unknown = window(0, 50)): Promise<MountedComponent> =>
            mountView('table', { '<-items': '$.data.rows', '<-total': '$.data.total', columns: COLUMNS }, { rows, total: TOTAL });

        it('should take aria-rowcount from total plus the header row and show skeleton rows', async () => {
            // Arrange and Act
            const mounted = await mountTable(window(0, 3));
            const body = mounted.element.shadowRoot?.querySelector('ui-record-list') as HTMLElement;
            const slots = Array.from(body.shadowRoot?.querySelectorAll<HTMLElement>('.slot') ?? []).filter((slot) => !slot.hidden);

            // Assert
            expect(mounted.element.getAttribute('aria-rowcount')).toBe(String(TOTAL + 1));
            expect(slots.some((slot) => slot.hasAttribute('data-pending'))).toBe(true);
        });

        it('should raise sort from a sortable header, compute no order and leave the data order alone', async () => {
            // Arrange
            const mounted = await mountTable();
            const sorts = events(mounted, 'sort');
            const before = ids(mounted.store.get('$.data.rows'));
            const button = mounted.element.shadowRoot?.querySelector<HTMLButtonElement>('.head[data-key="name"] button') as HTMLButtonElement;

            // Act
            button.click();
            await settle();
            button.click();
            await settle();

            // Assert
            expect(sorts).toEqual([
                { sortBy: 'name', sortDir: 'asc' },
                { sortBy: 'name', sortDir: 'desc' }
            ]);
            expect(mounted.store.get('$.runtime.nodes.app.order')).toBeUndefined();
            expect(ids(mounted.store.get('$.data.rows'))).toEqual(before);
        });
    });
});
