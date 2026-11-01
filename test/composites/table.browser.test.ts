import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';
import { formatValue } from '../../src/shared/format/format.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};
/** Frames for the alias, the resize observer, the window write and the pool refresh to settle */
const settle = async (): Promise<void> => {
    await flush();
    await frames(3);
    await flush();
};

interface Order {
    id: string;
    customer: string;
    total: number;
    status: string;
}
const orders = (count: number): Order[] =>
    Array.from({ length: count }, (_v, i) => ({ id: `o${i}`, customer: `Customer ${i}`, total: 10 + i, status: i % 2 === 0 ? 'open' : 'paid' }));

const COLUMNS = Object.freeze({
    customer: { _title: 'Customer', field: 'customer', width: '2fr' },
    total: { _title: 'Total', field: 'total', width: '120px', align: 'end' },
    status: { _title: 'Status', field: 'status', width: '20%' }
});

const shadow = (mounted: MountedComponent): ShadowRoot => mounted.element.shadowRoot as ShadowRoot;
const heads = (mounted: MountedComponent): HTMLElement[] => Array.from(shadow(mounted).querySelectorAll<HTMLElement>('.head'));
const titles = (mounted: MountedComponent): string[] => heads(mounted).map((head) => head.textContent?.trim() ?? '');
const body = (mounted: MountedComponent): HTMLElement => shadow(mounted).querySelector<HTMLElement>('ui-record-list') as HTMLElement;
const scroller = (mounted: MountedComponent): HTMLElement => body(mounted).shadowRoot?.querySelector<HTMLElement>('.list') as HTMLElement;
const positionOf = (slot: HTMLElement): number => Number(/--sui-index:\s*(-?\d+)/.exec(slot.getAttribute('style') ?? '')?.[1] ?? -1);
const rows = (mounted: MountedComponent): HTMLElement[] =>
    Array.from(body(mounted).shadowRoot?.querySelectorAll<HTMLElement>('.slot') ?? [])
        .filter((slot) => !slot.hidden)
        .sort((a, b) => positionOf(a) - positionOf(b));
const rowElement = (slot: HTMLElement): HTMLElement => slot.querySelector('sui-node')?.firstElementChild as HTMLElement;
const cells = (slot: HTMLElement): HTMLElement[] => Array.from(rowElement(slot).shadowRoot?.querySelectorAll<HTMLElement>('.cell') ?? []);
const cellText = (cell: HTMLElement | undefined): string => cell?.querySelector('.text')?.textContent?.trim() ?? '';
const cellNode = (cell: HTMLElement | undefined): HTMLElement | undefined => (cell?.querySelector('sui-node')?.firstElementChild as HTMLElement | null) ?? undefined;
const columnTexts = (mounted: MountedComponent, index: number): string[] => rows(mounted).map((slot) => cellText(cells(slot)[index]));
const emptyText = (mounted: MountedComponent): string | undefined => shadow(mounted).querySelector('.empty-text')?.textContent?.trim();

const mountTable = async (
    extra: Record<string, unknown> = {},
    data: Record<string, unknown> = { orders: orders(5) },
    height = 300,
    options: Record<string, unknown> = {}
): Promise<MountedComponent> => {
    const mounted = mountComponent('table', { '<-items': '$.data.orders', columns: COLUMNS, ...extra }, { data, ...options });
    (mounted.element as HTMLElement).style.blockSize = `${height}px`;
    await settle();
    return mounted;
};

describe('table columns, cells and rows in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should render the header and the cells of each row in the key order of columns, and follow a reorder', async () => {
        // Arrange
        const mounted = await mountTable();
        const before = titles(mounted);
        const firstRow = cells(rows(mounted)[0] as HTMLElement).map((cell) => cell.dataset['key']);
        const firstColumn = columnTexts(mounted, 0);

        // Act
        mounted.store.replace('$.app.columns', { status: COLUMNS.status, customer: COLUMNS.customer, total: COLUMNS.total });
        await settle();

        // Assert
        expect(before).toEqual(['Customer', 'Total', 'Status']);
        expect(firstRow).toEqual(['customer', 'total', 'status']);
        expect(firstColumn).toEqual(['Customer 0', 'Customer 1', 'Customer 2', 'Customer 3', 'Customer 4']);
        expect(titles(mounted)).toEqual(['Status', 'Customer', 'Total']);
        expect(cells(rows(mounted)[0] as HTMLElement).map((cell) => cell.dataset['key'])).toEqual(['status', 'customer', 'total']);
        expect(columnTexts(mounted, 1)).toEqual(['Customer 0', 'Customer 1', 'Customer 2', 'Customer 3', 'Customer 4']);
    });

    it('should update only the changed cell on a data change', async () => {
        // Arrange
        const mounted = await mountTable();
        const elements = rows(mounted).map((slot) => cells(slot));

        // Act
        mounted.store.set('$.data.orders.2.customer', 'Changed');
        await settle();

        // Assert
        expect(columnTexts(mounted, 0)).toEqual(['Customer 0', 'Customer 1', 'Changed', 'Customer 3', 'Customer 4']);
        expect(columnTexts(mounted, 1)).toEqual(['10', '11', '12', '13', '14']);
        expect(rows(mounted).map((slot) => cells(slot))).toEqual(elements);
    });

    it('should render a cell node per row with $row links: a badge and a button', async () => {
        // Arrange and Act
        const mounted = await mountTable({
            columns: {
                customer: COLUMNS.customer,
                status: { _title: 'Status', cell: { component: 'badge', '<-_text': '$row.status' } },
                actions: { _title: '', width: 'auto', cell: { component: 'button', variant: 'ghost', '<-_title': '$row.customer' } }
            }
        });

        // Assert
        const badges = rows(mounted).map((slot) => cellNode(cells(slot)[1]));
        const buttons = rows(mounted).map((slot) => cellNode(cells(slot)[2]));
        expect(badges.every((badge) => badge?.localName === 'ui-badge')).toBe(true);
        expect(badges.map((badge) => badge?.shadowRoot?.textContent?.trim())).toEqual(['open', 'paid', 'open', 'paid', 'open']);
        expect(buttons.map((button) => button?.shadowRoot?.querySelector('button')?.textContent?.trim())).toEqual([
            'Customer 0',
            'Customer 1',
            'Customer 2',
            'Customer 3',
            'Customer 4'
        ]);
    });

    it('should delete the record of the row when a cell button presses with on.press delete $row', async () => {
        // Arrange
        const mounted = await mountTable({
            columns: {
                customer: COLUMNS.customer,
                actions: { _title: '', cell: { component: 'button', _title: 'Delete', on: { press: { command: 'delete', target: '$row' } } } }
            }
        });
        const button = cellNode(cells(rows(mounted)[1] as HTMLElement)[1])?.shadowRoot?.querySelector('button') as HTMLButtonElement;

        // Act
        button.click();
        await settle();

        // Assert
        expect(mounted.store.get<Order[]>('$.data.orders').map((order) => order.id)).toEqual(['o0', 'o2', 'o3', 'o4']);
        expect(columnTexts(mounted, 0)).toEqual(['Customer 0', 'Customer 2', 'Customer 3', 'Customer 4']);
    });

    it('should show each format through the shared formatter for the locale', async () => {
        // Arrange
        const row = { id: 'a', amount: 1234.5, ratio: 0.256, price: 99.5, seconds: 3725 };
        const columns = {
            amount: { _title: 'Amount', field: 'amount', format: 'number' },
            ratio: { _title: 'Ratio', field: 'ratio', format: 'percent' },
            price: { _title: 'Price', field: 'price', format: 'currency', currency: 'EUR' },
            seconds: { _title: 'Time', field: 'seconds', format: 'duration' }
        };

        // Act
        const mounted = await mountTable({ columns }, { orders: [row] });
        const english = cells(rows(mounted)[0] as HTMLElement).map(cellText);
        mounted.setLocale('de');
        await settle();

        // Assert
        expect(english).toEqual([
            formatValue(1234.5, { format: 'number', locale: 'en' }),
            formatValue(0.256, { format: 'percent', locale: 'en' }),
            formatValue(99.5, { format: 'currency', currency: 'EUR', locale: 'en' }),
            '1:02:05'
        ]);
        expect(english[0]).toBe('1,234.5');
        expect(english[1]).toBe('25.6%');
        expect(cells(rows(mounted)[0] as HTMLElement).map(cellText)).toEqual([
            formatValue(1234.5, { format: 'number', locale: 'de' }),
            formatValue(0.256, { format: 'percent', locale: 'de' }),
            formatValue(99.5, { format: 'currency', currency: 'EUR', locale: 'de' }),
            '1:02:05'
        ]);
    });

    it('should stripe the odd rows only when striped', async () => {
        // Arrange
        const plain = await mountTable();
        const plainColours = rows(plain).map((slot) => getComputedStyle(rowElement(slot).shadowRoot?.querySelector('.row') as HTMLElement).backgroundColor);

        // Act
        plain.store.set('$.app.striped', true);
        await settle();

        // Assert
        const striped = rows(plain).map((slot) => getComputedStyle(rowElement(slot).shadowRoot?.querySelector('.row') as HTMLElement).backgroundColor);
        expect(new Set(plainColours).size).toBe(1);
        expect(striped[0]).toBe(plainColours[0]);
        expect(striped[1]).not.toBe(plainColours[0]);
        expect(striped[2]).toBe(striped[0]);
        expect(striped[3]).toBe(striped[1]);
    });

    it('should line the header cells up with the row cells while the body shows a scrollbar', async () => {
        // Arrange and Act
        const mounted = await mountTable({}, { orders: orders(200) }, 240);
        const list = scroller(mounted);

        // Assert
        expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
        expect(getComputedStyle(list).scrollbarGutter).toBe('stable');
        expect(getComputedStyle(shadow(mounted).querySelector('.header') as HTMLElement).scrollbarGutter).toBe('stable');
        const headBoxes = heads(mounted).map((head) => head.getBoundingClientRect());
        for (const slot of rows(mounted).slice(0, 3)) {
            const boxes = cells(slot).map((cell) => cell.getBoundingClientRect());
            expect(boxes).toHaveLength(3);
            boxes.forEach((box, i) => {
                expect(box.left).toBeCloseTo((headBoxes[i] as DOMRect).left, 0);
                expect(box.right).toBeCloseTo((headBoxes[i] as DOMRect).right, 0);
            });
        }
        expect((headBoxes[1] as DOMRect).width).toBeCloseTo(120, 0);
    });

    it('should align the header title and the cells of an end column to the end', async () => {
        // Arrange and Act
        const mounted = await mountTable();

        // Assert
        const head = heads(mounted)[1] as HTMLElement;
        const cell = cells(rows(mounted)[0] as HTMLElement)[1] as HTMLElement;
        const text = cell.querySelector('.text') as HTMLElement;
        expect(getComputedStyle(head).textAlign).toBe('end');
        expect(text.getBoundingClientRect().right).toBeCloseTo(cell.getBoundingClientRect().right - parseFloat(getComputedStyle(cell).paddingRight), 0);
    });

    it('should use the table, row, columnheader and cell roles', async () => {
        // Arrange and Act
        const mounted = await mountTable();

        // Assert
        expect(mounted.element.getAttribute('role')).toBe('table');
        expect(mounted.element.getAttribute('aria-rowcount')).toBe('6');
        expect(shadow(mounted).querySelector('.head-row')?.getAttribute('role')).toBe('row');
        expect(shadow(mounted).querySelector('.head-row')?.getAttribute('aria-rowindex')).toBe('1');
        expect(heads(mounted).every((head) => head.getAttribute('role') === 'columnheader')).toBe(true);
        expect(body(mounted).getAttribute('role')).toBe('rowgroup');
        expect(body(mounted).hasAttribute('aria-rowcount')).toBe(false);
        expect(rows(mounted).every((slot) => slot.getAttribute('role') === 'row')).toBe(true);
        expect(rows(mounted).map((slot) => slot.getAttribute('aria-rowindex'))).toEqual(['2', '3', '4', '5', '6']);
        expect(rows(mounted).every((slot) => cells(slot).every((cell) => cell.getAttribute('role') === 'cell'))).toBe(true);
    });

    it('should take the row height from the table density', async () => {
        // Arrange
        const mounted = await mountTable({ density: 'comfortable' });
        const comfortable = rows(mounted)[0]?.getBoundingClientRect().height ?? 0;

        // Act
        mounted.store.set('$.app.density', 'compact');
        await settle();

        // Assert
        expect(rows(mounted)[0]?.getBoundingClientRect().height ?? 0).toBeCloseTo(comfortable * 0.75, 1);
    });

    it('should show _empty with no items, and the empty node instead when it is set', async () => {
        // Arrange
        const plain = await mountTable({}, { orders: [] });
        const plainText = emptyText(plain);
        mountComponent.unmountAll();

        // Act
        const slotted = await mountTable({ empty: { component: 'emptyState', _title: 'Nothing yet' } }, { orders: [] });

        // Assert
        expect(plainText).toBe('No records');
        expect(emptyText(slotted)).toBeUndefined();
        expect(shadow(slotted).querySelector('.empty ui-empty-state')).not.toBeNull();
    });

    it('should hide the empty text once an item is added', async () => {
        // Arrange
        const mounted = await mountTable({}, { orders: [] });

        // Act
        mounted.store.get<Order[]>('$.data.orders').push({ id: 'n', customer: 'New', total: 1, status: 'open' });
        await settle();

        // Assert
        expect(emptyText(mounted)).toBeUndefined();
        expect(columnTexts(mounted, 0)).toEqual(['New']);
    });

    it('should translate the column titles and leave the cell data as it is', async () => {
        // Arrange
        const mounted = await mountTable({}, { orders: orders(2) }, 300, {
            locales: { de: { columns: { customer: { _title: 'Kunde' }, total: { _title: 'Summe' }, status: { _title: 'Status' } } } }
        });

        // Act
        mounted.setLocale('de');
        await settle();

        // Assert
        expect(titles(mounted)).toEqual(['Kunde', 'Summe', 'Status']);
        expect(columnTexts(mounted, 0)).toEqual(['Customer 0', 'Customer 1']);
    });

    it('should translate _empty', async () => {
        // Arrange
        const mounted = await mountTable({}, { orders: [] });

        // Act
        mounted.setLocale('de');
        await settle();

        // Assert
        expect(emptyText(mounted)).toBe('Keine Einträge');
    });
});

describe('table height in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    const rowHeight = (mounted: MountedComponent): number => (rows(mounted)[0] as HTMLElement).getBoundingClientRect().height;
    const mountAuto = async (count: number): Promise<MountedComponent> => {
        const mounted = await mountTable({}, { orders: orders(count) });
        (mounted.element as HTMLElement).style.blockSize = '';
        await settle();
        return mounted;
    };

    it('should grow to its rows where it has no definite height', async () => {
        // Arrange and Act
        const mounted = await mountAuto(11);

        // Assert
        expect(rows(mounted)).toHaveLength(11);
        expect(scroller(mounted).clientHeight).toBeCloseTo(rowHeight(mounted) * 11, 0);
        expect(scroller(mounted).scrollHeight).toBe(scroller(mounted).clientHeight);
    });

    it('should keep the height of three rows with fewer rows and no definite height', async () => {
        // Arrange and Act
        const mounted = await mountAuto(1);

        // Assert
        expect(scroller(mounted).clientHeight).toBeCloseTo(rowHeight(mounted) * 3, 0);
    });

    it('should fill a definite height and scroll the rows that do not fit', async () => {
        // Arrange and Act
        const mounted = await mountTable({}, { orders: orders(1000) }, 300);
        const header = shadow(mounted).querySelector<HTMLElement>('.header') as HTMLElement;

        // Assert
        expect(scroller(mounted).getBoundingClientRect().height).toBeCloseTo(300 - header.getBoundingClientRect().height, 0);
        expect(scroller(mounted).scrollHeight).toBeGreaterThan(scroller(mounted).clientHeight);
        expect(rows(mounted).length).toBeLessThan(40);
    });

    it('should fill a definite height that is taller than its rows', async () => {
        // Arrange and Act
        const mounted = await mountTable({}, { orders: orders(2) }, 300);
        const header = shadow(mounted).querySelector<HTMLElement>('.header') as HTMLElement;

        // Assert
        expect(scroller(mounted).getBoundingClientRect().height).toBeCloseTo(300 - header.getBoundingClientRect().height, 0);
    });

    it('should stop growing at the viewport height and render only the rows in view', async () => {
        // Arrange and Act
        const mounted = await mountAuto(1000);

        // Assert
        expect(scroller(mounted).getBoundingClientRect().height).toBeLessThanOrEqual(window.innerHeight);
        expect(scroller(mounted).scrollHeight).toBeGreaterThan(scroller(mounted).clientHeight);
        expect(rows(mounted).length).toBeLessThan(Math.ceil(window.innerHeight / rowHeight(mounted)) + 20);
    });
});
