import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};
const settle = async (): Promise<void> => {
    await frames(3);
    await flush();
};
const CURRENT = '$.runtime.nodes.app.current';

interface Person {
    id: string;
    name: string;
}
const people = (count: number): Person[] => Array.from({ length: count }, (_v, i) => ({ id: `p${i}`, name: `Name ${i}` }));
const rowTemplate = { component: 'text', '<-_text': '$row.name' };

const body = (mounted: MountedComponent): HTMLElement => mounted.element.shadowRoot?.querySelector('ui-record-list') as HTMLElement;
const inner = (mounted: MountedComponent): ShadowRoot => body(mounted).shadowRoot as ShadowRoot;
const shownSlots = (mounted: MountedComponent): HTMLElement[] =>
    Array.from(inner(mounted).querySelectorAll<HTMLElement>('.slot')).filter((slot) => !slot.hidden);
const positionOf = (slot: HTMLElement): number => Number(/--sui-index:\s*(-?\d+)/.exec(slot.getAttribute('style') ?? '')?.[1] ?? -1);
const slotAt = (mounted: MountedComponent, position: number): HTMLElement =>
    shownSlots(mounted).find((slot) => positionOf(slot) === position) as HTMLElement;
const selectedPositions = (mounted: MountedComponent): number[] =>
    shownSlots(mounted)
        .filter((slot) => slot.getAttribute('aria-selected') === 'true')
        .map(positionOf)
        .sort((a, b) => a - b);
const activePosition = (mounted: MountedComponent): number | undefined => {
    const slot = inner(mounted).activeElement?.closest<HTMLElement>('.slot');
    return slot === null || slot === undefined ? undefined : positionOf(slot);
};
const keyDown = (target: HTMLElement, key: string): void => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }));
};
const doubleClick = (target: HTMLElement): void => {
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }));
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

const mountList = async (selectable: string, picked: unknown = '', extra: Record<string, unknown> = {}): Promise<MountedComponent> => {
    const mounted = mountComponent(
        'list',
        { '<-items': '$.data.people', '<-selected': '$.data.picked', row: rowTemplate, selectable, ...extra },
        { data: { people: people(40), picked } }
    );
    (mounted.element as HTMLElement).style.blockSize = '240px';
    await settle();
    return mounted;
};

describe('list selection and current in Chromium', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        mountComponent.unmountAll();
    });

    it('should use the list role with no selection, listbox otherwise, and set aria-multiselectable, setsize and posinset', async () => {
        // Arrange and Act
        const none = await mountList('none');
        const single = await mountList('single');
        const multi = await mountList('multi', []);

        // Assert
        expect(body(none).getAttribute('role')).toBe('list');
        expect(body(none).hasAttribute('aria-multiselectable')).toBe(false);
        expect(slotAt(none, 0).getAttribute('role')).toBe('listitem');
        expect(body(single).getAttribute('role')).toBe('listbox');
        expect(body(single).getAttribute('aria-multiselectable')).toBe('false');
        expect(slotAt(single, 0).getAttribute('role')).toBe('option');
        expect(body(multi).getAttribute('role')).toBe('listbox');
        expect(body(multi).getAttribute('aria-multiselectable')).toBe('true');
        for (const mounted of [none, single, multi]) {
            expect(slotAt(mounted, 3).getAttribute('aria-setsize')).toBe('40');
            expect(slotAt(mounted, 3).getAttribute('aria-posinset')).toBe('4');
        }
    });

    it('should select one row on a press or Space in single mode, replacing the selection, and raise select', async () => {
        // Arrange
        const mounted = await mountList('single');
        const raised = events(mounted, 'select');

        // Act and Assert
        slotAt(mounted, 2).click();
        await settle();
        expect(picked(mounted)).toBe('p2');
        expect(selectedPositions(mounted)).toEqual([2]);

        keyDown(slotAt(mounted, 5), ' ');
        await settle();
        expect(picked(mounted)).toBe('p5');
        expect(selectedPositions(mounted)).toEqual([5]);
        expect(raised).toEqual([['p2'], ['p5']]);
    });

    it('should toggle rows on a press in multi mode', async () => {
        // Arrange
        const mounted = await mountList('multi', []);
        const raised = events(mounted, 'select');

        // Act
        slotAt(mounted, 1).click();
        slotAt(mounted, 4).click();
        keyDown(slotAt(mounted, 6), ' ');
        slotAt(mounted, 1).click();
        await settle();

        // Assert
        expect(picked(mounted)).toEqual(['p4', 'p6']);
        expect(selectedPositions(mounted)).toEqual([4, 6]);
        expect(raised).toEqual([['p1'], ['p1', 'p4'], ['p1', 'p4', 'p6'], ['p4', 'p6']]);
    });

    it('should not select with no selectable mode', async () => {
        // Arrange
        const mounted = await mountList('none');

        // Act
        slotAt(mounted, 1).click();
        keyDown(slotAt(mounted, 2), ' ');
        await settle();

        // Assert
        expect(picked(mounted)).toBe('');
    });

    it('should show a selected written to $.data and write a selection back to $.data', async () => {
        // Arrange
        const mounted = await mountList('single', 'p3');
        const before = selectedPositions(mounted);

        // Act and Assert
        mounted.store.set('$.data.picked', 'p7');
        await settle();
        expect(before).toEqual([3]);
        expect(selectedPositions(mounted)).toEqual([7]);
        expect(mounted.store.get<string>(`${CURRENT}.name`)).toBe('Name 7');

        slotAt(mounted, 1).click();
        await settle();
        expect(mounted.store.get<string>('$.data.picked')).toBe('p1');
        expect(mounted.store.get<string>('$.app.selected')).toBe('p1');
    });

    it('should raise activate with the key on Enter and on a double press', async () => {
        // Arrange
        const mounted = await mountList('single');
        const raised = events(mounted, 'activate');

        // Act
        keyDown(slotAt(mounted, 3), 'Enter');
        doubleClick(slotAt(mounted, 8));
        await settle();

        // Assert
        expect(raised).toEqual(['p3', 'p8']);
    });

    it('should select every record with selectAll in multi mode only, and clear with clearSelection', async () => {
        // Arrange
        const multi = await mountList('multi', ['p1']);
        const single = await mountList('single', 'p1');
        const raised = events(multi, 'select');

        // Act and Assert
        command(multi, 'selectAll');
        await settle();
        expect(picked(multi)).toEqual(people(40).map((person) => person.id));
        expect(selectedPositions(multi).length).toBe(shownSlots(multi).length);

        command(single, 'selectAll');
        await settle();
        expect(picked(single)).toBe('p1');

        command(multi, 'clearSelection');
        command(single, 'clearSelection');
        await settle();
        expect(picked(multi)).toEqual([]);
        expect(picked(single)).toBe('');
        expect(selectedPositions(multi)).toEqual([]);
        expect(raised).toHaveLength(2);
    });

    it('should move the focus by position with the arrow keys', async () => {
        // Arrange
        const mounted = await mountList('single');
        slotAt(mounted, 0).focus();
        await flush();

        // Act
        keyDown(inner(mounted).activeElement as HTMLElement, 'ArrowDown');
        await flush();
        keyDown(inner(mounted).activeElement as HTMLElement, 'ArrowDown');
        await flush();
        keyDown(inner(mounted).activeElement as HTMLElement, 'ArrowUp');
        await flush();

        // Assert
        expect(activePosition(mounted)).toBe(1);
    });

    it('should point current at the selected record and re-point it when another row is selected', async () => {
        // Arrange
        const mounted = await mountList('single', 'p2');
        const before = mounted.store.get<string>(`${CURRENT}.name`);

        // Act
        slotAt(mounted, 5).click();
        await settle();

        // Assert
        expect(before).toBe('Name 2');
        expect(mounted.store.get<string>(`${CURRENT}.name`)).toBe('Name 5');
        expect(mounted.store.get<string>('$.app.current.name')).toBe('Name 5');
        expect(mounted.store.set(`${CURRENT}.name`, 'Renamed')).toBe(true);
        expect(mounted.store.get<string>('$.data.people.5.name')).toBe('Renamed');
    });

    it('should keep current on the selected record when records are inserted before it', async () => {
        // Arrange
        const mounted = await mountList('single', 'p2');

        // Act
        mounted.store.get<Person[]>('$.data.people').unshift({ id: 'new', name: 'New' });
        await settle();

        // Assert
        expect(mounted.store.get<string>(`${CURRENT}.name`)).toBe('Name 2');
    });

    it('should fall back to the empty record when the selection is cleared, and refuse a write into current', async () => {
        // Arrange
        const mounted = await mountList('single', 'p4');
        const before = mounted.store.get<string>(`${CURRENT}.name`);

        // Act
        command(mounted, 'clearSelection');
        await settle();
        const written = mounted.store.set(`${CURRENT}.name`, 'Ghost');

        // Assert
        expect(before).toBe('Name 4');
        expect(mounted.store.get<unknown>(CURRENT)).toEqual({});
        expect(written).toBe(false);
        expect(mounted.store.get<unknown>('$.runtime.empty')).toEqual({});
    });

    it('should point current at the empty record while nothing is selected and in multi mode', async () => {
        // Arrange and Act
        const none = await mountList('single');
        const multi = await mountList('multi', ['p1']);

        // Assert
        expect(none.store.get<unknown>(CURRENT)).toEqual({});
        expect(none.store.set(`${CURRENT}.name`, 'x')).toBe(false);
        expect(multi.store.get<unknown>(CURRENT)).toEqual({});
    });
});
