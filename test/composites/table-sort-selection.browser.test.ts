import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};
const settle = async (): Promise<void> => {
    await flush();
    await frames(3);
    await flush();
};
const CURRENT = '$.runtime.nodes.app.current';

interface Order {
    id: string;
    customer: string;
    total: number;
}
const orders = (): Order[] => [
    { id: 'o0', customer: 'Pear', total: 30 },
    { id: 'o1', customer: 'Apple', total: 10 },
    { id: 'o2', customer: 'Fig', total: 20 },
    { id: 'o3', customer: 'Kiwi', total: 50 },
    { id: 'o4', customer: 'Date', total: 40 }
];

const COLUMNS = Object.freeze({
    customer: { _title: 'Customer', field: 'customer', sortable: true },
    total: { _title: 'Total', field: 'total', align: 'end', sortable: true },
    note: { _title: 'Note', field: 'note' }
});

const shadow = (mounted: MountedComponent): ShadowRoot => mounted.element.shadowRoot as ShadowRoot;
const heads = (mounted: MountedComponent): HTMLElement[] => Array.from(shadow(mounted).querySelectorAll<HTMLElement>('.head'));
const sortButton = (mounted: MountedComponent, key: string): HTMLButtonElement | null =>
    shadow(mounted).querySelector<HTMLButtonElement>(`.head[data-key="${key}"] button`);
const body = (mounted: MountedComponent): HTMLElement => shadow(mounted).querySelector<HTMLElement>('ui-record-list') as HTMLElement;
const positionOf = (slot: HTMLElement): number => Number(/--sui-index:\s*(-?\d+)/.exec(slot.getAttribute('style') ?? '')?.[1] ?? -1);
const rows = (mounted: MountedComponent): HTMLElement[] =>
    Array.from(body(mounted).shadowRoot?.querySelectorAll<HTMLElement>('.slot') ?? [])
        .filter((slot) => !slot.hidden)
        .sort((a, b) => positionOf(a) - positionOf(b));
const cellText = (slot: HTMLElement, index: number): string => {
    const row = slot.querySelector('sui-node')?.firstElementChild as HTMLElement;
    return row.shadowRoot?.querySelectorAll<HTMLElement>('.cell')[index]?.querySelector('.text')?.textContent?.trim() ?? '';
};
const customers = (mounted: MountedComponent): string[] => rows(mounted).map((slot) => cellText(slot, 0));
const selectedPositions = (mounted: MountedComponent): number[] =>
    rows(mounted)
        .filter((slot) => slot.getAttribute('aria-selected') === 'true')
        .map(positionOf);
const keyDown = (target: HTMLElement, key: string): void => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }));
};
const command = (mounted: MountedComponent, name: string): void => {
    (mounted.element as Element & { commands: Record<string, (value?: unknown) => void> }).commands[name]?.();
};
const events = (mounted: MountedComponent, name: string): unknown[] => {
    const seen: unknown[] = [];
    mounted.element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};
const picked = (mounted: MountedComponent): unknown => {
    const value = mounted.store.get<unknown>('$.data.picked');
    return Array.isArray(value) ? [...(value as unknown[])] : value;
};
const dataIds = (mounted: MountedComponent): string[] => mounted.store.get<Order[]>('$.data.orders').map((order) => order.id);

const mountTable = async (extra: Record<string, unknown> = {}, picks: unknown = ''): Promise<MountedComponent> => {
    const mounted = mountComponent(
        'table',
        { '<-items': '$.data.orders', '<-selected': '$.data.picked', columns: COLUMNS, ...extra },
        { data: { orders: orders(), picked: picks } }
    );
    (mounted.element as HTMLElement).style.blockSize = '300px';
    await settle();
    return mounted;
};

describe('table sort in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should sort ascending on the first press of a sortable header and descending on the second, raising sort', async () => {
        // Arrange
        const mounted = await mountTable();
        const raised = events(mounted, 'sort');
        const before = customers(mounted);

        // Act
        sortButton(mounted, 'customer')?.click();
        await settle();
        const ascending = customers(mounted);
        sortButton(mounted, 'customer')?.click();
        await settle();

        // Assert
        expect(before).toEqual(['Pear', 'Apple', 'Fig', 'Kiwi', 'Date']);
        expect(ascending).toEqual(['Apple', 'Date', 'Fig', 'Kiwi', 'Pear']);
        expect(customers(mounted)).toEqual(['Pear', 'Kiwi', 'Fig', 'Date', 'Apple']);
        expect(raised).toEqual([
            { sortBy: 'customer', sortDir: 'asc' },
            { sortBy: 'customer', sortDir: 'desc' }
        ]);
        expect(mounted.store.get<string>('$.app.sortBy')).toBe('customer');
        expect(mounted.store.get<string>('$.app.sortDir')).toBe('desc');
        expect(dataIds(mounted)).toEqual(['o0', 'o1', 'o2', 'o3', 'o4']);
    });

    it('should start ascending when another column is pressed after a descending sort', async () => {
        // Arrange
        const mounted = await mountTable({ sortBy: 'customer', sortDir: 'desc' });
        const raised = events(mounted, 'sort');

        // Act
        sortButton(mounted, 'total')?.click();
        await settle();

        // Assert
        expect(raised).toEqual([{ sortBy: 'total', sortDir: 'asc' }]);
        expect(rows(mounted).map((slot) => cellText(slot, 1))).toEqual(['10', '20', '30', '40', '50']);
    });

    it('should set aria-sort on sortable headers only and move it with the sort', async () => {
        // Arrange
        const mounted = await mountTable();
        const sorts = (): (string | null)[] => heads(mounted).map((head) => head.getAttribute('aria-sort'));
        const before = sorts();

        // Act
        sortButton(mounted, 'total')?.click();
        await settle();
        const ascending = sorts();
        sortButton(mounted, 'total')?.click();
        await settle();

        // Assert
        expect(before).toEqual(['none', 'none', null]);
        expect(ascending).toEqual(['none', 'ascending', null]);
        expect(sorts()).toEqual(['none', 'descending', null]);
        expect(sortButton(mounted, 'note')).toBeNull();
    });

    it('should sort from sortBy and sortDir set in state, and re-sort after a data change', async () => {
        // Arrange
        const mounted = await mountTable({ sortBy: 'total', sortDir: 'desc' });
        const before = customers(mounted);

        // Act
        mounted.store.set('$.data.orders.1.total', 99);
        await settle();
        const afterChange = customers(mounted);
        mounted.store.get<Order[]>('$.data.orders').push({ id: 'o5', customer: 'Plum', total: 60 });
        await settle();

        // Assert
        expect(before).toEqual(['Kiwi', 'Date', 'Pear', 'Fig', 'Apple']);
        expect(afterChange).toEqual(['Apple', 'Kiwi', 'Date', 'Pear', 'Fig']);
        expect(customers(mounted)).toEqual(['Apple', 'Plum', 'Kiwi', 'Date', 'Pear', 'Fig']);
        expect(dataIds(mounted)).toEqual(['o0', 'o1', 'o2', 'o3', 'o4', 'o5']);
    });

    it('should keep the arrow of the sorted column only', async () => {
        // Arrange
        const mounted = await mountTable({ sortBy: 'total', sortDir: 'desc' });
        const arrows = (): string[] => heads(mounted).map((head) => head.querySelector('.arrow')?.textContent?.trim() ?? '');

        // Act and Assert
        expect(arrows()).toEqual(['', '▼', '']);
        sortButton(mounted, 'total')?.click();
        await settle();
        expect(arrows()).toEqual(['', '▲', '']);
    });

    it('should leave a column that is not sortable or has no field alone', async () => {
        // Arrange
        const mounted = await mountTable({ columns: { a: { _title: 'A', field: 'customer' }, b: { _title: 'B', sortable: true } } });
        const raised = events(mounted, 'sort');

        // Act
        shadow(mounted).querySelector<HTMLElement>('.head[data-key="a"] .title')?.click();
        await settle();

        // Assert
        expect(shadow(mounted).querySelectorAll('.head button')).toHaveLength(0);
        expect(raised).toEqual([]);
        expect(customers(mounted)).toEqual(['Pear', 'Apple', 'Fig', 'Kiwi', 'Date']);
    });
});

describe('table selection in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should select one row on a press or Space in single mode, mark aria-selected and raise select', async () => {
        // Arrange
        const mounted = await mountTable({ selectable: 'single' });
        const raised = events(mounted, 'select');

        // Act
        rows(mounted)[2]?.click();
        await settle();
        const first = picked(mounted);
        keyDown(rows(mounted)[4] as HTMLElement, ' ');
        await settle();

        // Assert
        expect(first).toBe('o2');
        expect(picked(mounted)).toBe('o4');
        expect(selectedPositions(mounted)).toEqual([4]);
        expect(rows(mounted).every((slot) => slot.getAttribute('aria-selected') !== null)).toBe(true);
        expect(raised).toEqual([['o2'], ['o4']]);
    });

    it('should toggle rows in multi mode', async () => {
        // Arrange
        const mounted = await mountTable({ selectable: 'multi' }, []);
        const raised = events(mounted, 'select');

        // Act
        rows(mounted)[1]?.click();
        rows(mounted)[3]?.click();
        rows(mounted)[1]?.click();
        await settle();

        // Assert
        expect(picked(mounted)).toEqual(['o3']);
        expect(selectedPositions(mounted)).toEqual([3]);
        expect(raised).toEqual([['o1'], ['o1', 'o3'], ['o3']]);
    });

    it('should not select with selectable none and set no aria-selected', async () => {
        // Arrange
        const mounted = await mountTable();

        // Act
        rows(mounted)[1]?.click();
        keyDown(rows(mounted)[2] as HTMLElement, ' ');
        await settle();

        // Assert
        expect(picked(mounted)).toBe('');
        expect(rows(mounted).every((slot) => slot.getAttribute('aria-selected') === null)).toBe(true);
    });

    it('should not select when the press is on a header', async () => {
        // Arrange
        const mounted = await mountTable({ selectable: 'single' });

        // Act
        heads(mounted)[2]?.click();
        sortButton(mounted, 'customer')?.click();
        await settle();

        // Assert
        expect(picked(mounted)).toBe('');
    });

    it('should show a selected written to $.data and write a selection back to it', async () => {
        // Arrange
        const mounted = await mountTable({ selectable: 'single' }, 'o3');
        const before = selectedPositions(mounted);

        // Act
        mounted.store.set('$.data.picked', 'o1');
        await settle();
        const moved = selectedPositions(mounted);
        rows(mounted)[0]?.click();
        await settle();

        // Assert
        expect(before).toEqual([3]);
        expect(moved).toEqual([1]);
        expect(mounted.store.get<string>('$.data.picked')).toBe('o0');
        expect(mounted.store.get<string>('$.app.selected')).toBe('o0');
    });

    it('should raise activate with the key on Enter and on a double press', async () => {
        // Arrange
        const mounted = await mountTable({ selectable: 'single' });
        const raised = events(mounted, 'activate');

        // Act
        keyDown(rows(mounted)[3] as HTMLElement, 'Enter');
        (rows(mounted)[1] as HTMLElement).dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }));
        await settle();

        // Assert
        expect(raised).toEqual(['o3', 'o1']);
    });

    it('should select every record with selectAll in multi mode only, and clear with clearSelection', async () => {
        // Arrange
        const multi = await mountTable({ selectable: 'multi' }, ['o1']);
        const single = await mountTable({ selectable: 'single' }, 'o1');
        const raised = events(multi, 'select');

        // Act and Assert
        command(multi, 'selectAll');
        await settle();
        expect(picked(multi)).toEqual(['o0', 'o1', 'o2', 'o3', 'o4']);
        expect(selectedPositions(multi)).toEqual([0, 1, 2, 3, 4]);

        command(single, 'selectAll');
        await settle();
        expect(picked(single)).toBe('o1');

        command(multi, 'clearSelection');
        command(single, 'clearSelection');
        await settle();
        expect(picked(multi)).toEqual([]);
        expect(picked(single)).toBe('');
        expect(selectedPositions(multi)).toEqual([]);
        expect(raised).toHaveLength(2);
    });

    it('should select every record in the sorted display order with selectAll', async () => {
        // Arrange
        const mounted = await mountTable({ selectable: 'multi', sortBy: 'total', sortDir: 'asc' }, []);

        // Act
        command(mounted, 'selectAll');
        await settle();

        // Assert
        expect(picked(mounted)).toEqual(['o1', 'o2', 'o0', 'o4', 'o3']);
    });

    it('should keep the selected record selected, on its new row, after a sort', async () => {
        // Arrange
        const mounted = await mountTable({ selectable: 'single' }, 'o3');
        const before = selectedPositions(mounted);

        // Act
        sortButton(mounted, 'customer')?.click();
        await settle();
        const ascending = selectedPositions(mounted);
        sortButton(mounted, 'customer')?.click();
        await settle();

        // Assert
        expect(before).toEqual([3]);
        expect(ascending).toEqual([3]);
        expect(customers(mounted)[selectedPositions(mounted)[0] as number]).toBe('Kiwi');
        expect(selectedPositions(mounted)).toEqual([1]);
        expect(picked(mounted)).toBe('o3');
    });

    it('should keep a multi selection on the same records after a sort', async () => {
        // Arrange
        const mounted = await mountTable({ selectable: 'multi' }, ['o1', 'o4']);

        // Act
        sortButton(mounted, 'total')?.click();
        await settle();

        // Assert
        expect(selectedPositions(mounted)).toEqual([0, 3]);
        expect(picked(mounted)).toEqual(['o1', 'o4']);
    });

    it('should point current at the selected record and at the empty record after clearSelection', async () => {
        // Arrange
        const mounted = await mountTable({ selectable: 'single' }, 'o2');
        const before = mounted.store.get<string>(`${CURRENT}.customer`);

        // Act
        rows(mounted)[3]?.click();
        await settle();
        const moved = mounted.store.get<string>('$.app.current.customer');
        command(mounted, 'clearSelection');
        await settle();

        // Assert
        expect(before).toBe('Fig');
        expect(moved).toBe('Kiwi');
        expect(mounted.store.get<unknown>(CURRENT)).toEqual({});
        expect(mounted.store.set(`${CURRENT}.customer`, 'Ghost')).toBe(false);
    });

    it('should leave a press on a button in a cell to the button', async () => {
        // Arrange
        const mounted = await mountTable({
            selectable: 'single',
            columns: {
                ...COLUMNS,
                act: { _title: 'Act', cell: { component: 'button', _title: 'Go' } }
            }
        });

        // Act
        const row = rows(mounted)[1] as HTMLElement;
        const rowElement = row.querySelector('sui-node')?.firstElementChild as HTMLElement;
        const button = rowElement.shadowRoot?.querySelector('.cell:last-child sui-node')?.firstElementChild?.shadowRoot?.querySelector('button') as HTMLElement;
        button.click();
        await settle();

        // Assert
        expect(picked(mounted)).toBe('');
    });
});
