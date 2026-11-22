import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
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
const events = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};

const records = Array.from({ length: 6 }, (_v, i) => ({ id: `r${i}`, name: `Name ${i}`, city: `City ${i}`, notes: `Notes ${i}`, total: i }));

const shadow = (mounted: MountedComponent): ShadowRoot => mounted.element.shadowRoot as ShadowRoot;
const head = (mounted: MountedComponent, key: string): HTMLElement => shadow(mounted).querySelector<HTMLElement>(`.head[data-key="${key}"]`) as HTMLElement;
const handle = (mounted: MountedComponent, key: string): HTMLElement | null => head(mounted, key).querySelector<HTMLElement>('.resize');
const scroller = (mounted: MountedComponent): HTMLElement =>
    shadow(mounted).querySelector('ui-record-list')?.shadowRoot?.querySelector<HTMLElement>('.list') as HTMLElement;
const firstRowCell = (mounted: MountedComponent, key: string): HTMLElement => {
    const slot = Array.from(shadow(mounted).querySelector('ui-record-list')?.shadowRoot?.querySelectorAll<HTMLElement>('.slot') ?? []).find((element) => !element.hidden && /--sui-index:\s*0\b/.test(element.getAttribute('style') ?? ''));
    const row = slot?.querySelector('sui-node')?.firstElementChild;
    return row?.shadowRoot?.querySelector<HTMLElement>(`.cell[data-key="${key}"]`) as HTMLElement;
};
const pointer = (target: Element, type: string, x: number): void => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, clientX: x, clientY: 10, pointerId: 3, button: 0, pointerType: 'mouse', isPrimary: true }));
};

const mountTable = async (columns: Record<string, unknown>, extra: Record<string, unknown> = {}, width = 400): Promise<MountedComponent> => {
    const mounted = mountComponent('table', { '<-items': '$.data.rows', columns, ...extra }, { data: { rows: records } });
    const element = mounted.element as HTMLElement;
    element.style.blockSize = '240px';
    element.style.inlineSize = `${width}px`;
    await settle();
    return mounted;
};

describe('table column resize and pinning in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should show resize handles only when resizable, and write the dragged width on release with columnResize', async () => {
        // Arrange
        const columns = { name: { _title: 'Name', field: 'name', width: '160px' }, city: { _title: 'City', field: 'city' } };
        const plain = await mountTable(columns);
        const withoutHandle = handle(plain, 'name');
        mountComponent.unmountAll();
        const mounted = await mountTable(columns, { resizable: true });
        const resized = events(mounted.element, 'columnResize');
        const grip = handle(mounted, 'name') as HTMLElement;
        const start = grip.getBoundingClientRect().left;

        // Act
        pointer(grip, 'pointerdown', start);
        pointer(grip, 'pointermove', start + 40);
        await flush();
        const during = head(mounted, 'name').getBoundingClientRect().width;
        const storedDuring = mounted.store.get('$.app.columns.name.width');
        pointer(grip, 'pointerup', start + 40);
        await settle();

        // Assert
        expect(withoutHandle).toBeNull();
        expect(grip.getAttribute('role')).toBe('separator');
        expect(Math.round(during)).toBe(200);
        expect(storedDuring).toBe('160px');
        expect(mounted.store.get('$.app.columns.name.width')).toBe('200px');
        expect(resized).toEqual([{ column: 'name', width: '200px' }]);
        expect(Math.round(firstRowCell(mounted, 'name').getBoundingClientRect().width)).toBe(200);
    });

    it('should resize with the arrow keys on a focused handle and stop at the least width', async () => {
        // Arrange
        const mounted = await mountTable({ name: { _title: 'Name', field: 'name', width: '60px' }, city: { _title: 'City', field: 'city' } }, { resizable: true });
        const grip = handle(mounted, 'name') as HTMLElement;

        // Act
        grip.focus();
        await userEvent.keyboard('{ArrowRight}');
        await flush();
        const grown = mounted.store.get('$.app.columns.name.width');
        await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
        await flush();

        // Assert
        expect(grown).toBe('76px');
        expect(mounted.store.get('$.app.columns.name.width')).toBe('48px');
        expect(grip.getAttribute('aria-valuenow')).toBe('48');
    });

    it('should scroll the body and header sideways when the columns are wider than the table, keeping pinned columns in view', async () => {
        // Arrange
        const mounted = await mountTable(
            {
                name: { _title: 'Name', field: 'name', width: '120px', pin: 'start' },
                city: { _title: 'City', field: 'city', width: '300px' },
                notes: { _title: 'Notes', field: 'notes', width: '300px' },
                total: { _title: 'Total', field: 'total', width: '80px', pin: 'end', align: 'end' }
            },
            {},
            400
        );
        const list = scroller(mounted);
        const left = list.getBoundingClientRect().left;
        const before = firstRowCell(mounted, 'city').getBoundingClientRect().left - left;

        // Act
        list.scrollLeft = 200;
        list.dispatchEvent(new Event('scroll'));
        await settle();

        // Assert
        expect(list.scrollWidth).toBeGreaterThan(list.clientWidth);
        expect(Math.round(firstRowCell(mounted, 'city').getBoundingClientRect().left - left)).toBe(Math.round(before - 200));
        expect(Math.round(firstRowCell(mounted, 'name').getBoundingClientRect().left - left)).toBe(0);
        expect(Math.round(head(mounted, 'name').getBoundingClientRect().left - left)).toBe(0);
        expect(Math.round(head(mounted, 'total').getBoundingClientRect().right)).toBe(Math.round(list.getBoundingClientRect().left + list.clientWidth));
        expect(Math.round(list.getBoundingClientRect().left + list.clientWidth - firstRowCell(mounted, 'total').getBoundingClientRect().right)).toBe(0);
        expect((shadow(mounted).querySelector('.header') as HTMLElement).scrollLeft).toBe(200);
        expect(firstRowCell(mounted, 'name').dataset['pin']).toBe('start');
        expect(head(mounted, 'total').dataset['pin']).toBe('end');
    });

    it('should not scroll sideways when the columns fit', async () => {
        // Act
        const mounted = await mountTable({ name: { _title: 'Name', field: 'name', width: '2fr' }, city: { _title: 'City', field: 'city' } });

        // Assert
        const list = scroller(mounted);
        expect(list.scrollWidth).toBe(list.clientWidth);
    });
});
