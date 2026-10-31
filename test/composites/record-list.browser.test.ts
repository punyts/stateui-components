import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};
const RUNTIME = '$.runtime.nodes.app';

interface Person {
    id: string;
    name: string;
    title?: string;
}

const people = (count: number): Person[] => Array.from({ length: count }, (_v, i) => ({ id: `r${i}`, name: `Name ${i}` }));
const peopleMap = (count: number): Record<string, Person> => Object.fromEntries(people(count).map((person) => [person.id, person]));

const rowTemplate = { component: 'text', '<-_text': '$row.name' };

const slotElements = (mounted: MountedComponent): HTMLElement[] =>
    Array.from(mounted.element.shadowRoot?.querySelectorAll<HTMLElement>('.slot') ?? []);
const slotText = (slot: HTMLElement): string => (slot.firstElementChild?.firstElementChild as Element | null)?.shadowRoot?.textContent?.trim() ?? '';
const slotPosition = (slot: HTMLElement): number => Number(/--sui-index:\s*(-?\d+)/.exec(slot.getAttribute('style') ?? '')?.[1] ?? -1);

/** The text of each shown position, by position */
const shown = (mounted: MountedComponent): Map<number, string> => {
    const result = new Map<number, string>();
    for (const slot of slotElements(mounted)) {
        if (!slot.hidden) result.set(slotPosition(slot), slotText(slot));
    }
    return result;
};
const textsFrom = (mounted: MountedComponent, first: number, count: number): string[] => {
    const map = shown(mounted);
    return Array.from({ length: count }, (_v, i) => map.get(first + i) ?? '');
};
const names = (from: number, count: number): string[] => Array.from({ length: count }, (_v, i) => `Name ${from + i}`);
const setWindow = async (mounted: MountedComponent, first: number, count: number): Promise<void> => {
    mounted.store.set(`${RUNTIME}.window`, { first, count });
    await flush();
};
const mountList = async (
    records: Person[] | Record<string, Person>,
    extra: Record<string, unknown> = {},
    window = { first: 0, count: 10 },
    data: Record<string, unknown> = {}
): Promise<MountedComponent> => {
    const mounted = mountComponent('recordList', { '<-records': '$.data.records', row: rowTemplate, ...extra }, { data: { records, ...data } });
    await flush();
    await frames(3);
    await setWindow(mounted, window.first, window.count);
    return mounted;
};

describe('recordList in Chromium', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        mountComponent.unmountAll();
    });

    it('should render at most the visible rows plus the overscan as slots for 10,000 records', async () => {
        // Arrange and Act
        const mounted = await mountList(people(10_000), {}, { first: 0, count: 20 });

        // Assert
        expect(slotElements(mounted)).toHaveLength(30);
        expect(textsFrom(mounted, 0, 30)).toEqual(names(0, 30));
        expect(mounted.store.get<number>('$.app.count')).toBe(10_000);
    });

    it('should cap the pool at 200 slots and take the cap from the overscan first', async () => {
        // Arrange and Act
        const tall = await mountList(people(1000), { overscan: 20 }, { first: 0, count: 190 });
        const taller = await mountList(people(1000), {}, { first: 0, count: 300 });

        // Assert
        expect(slotElements(tall)).toHaveLength(200);
        expect(slotElements(taller)).toHaveLength(200);
        expect(textsFrom(tall, 0, 190)).toEqual(names(0, 190));
    });

    it('should accept total and the other articulation without error', async () => {
        // Arrange and Act
        const mounted = await mountList(people(5), { total: 5, rowHeight: 'lg', key: 'id', overscan: 0 });

        // Assert
        expect(slotElements(mounted)).toHaveLength(10);
        expect(textsFrom(mounted, 0, 5)).toEqual(names(0, 5));
        expect(slotElements(mounted).filter((slot) => !slot.hidden)).toHaveLength(5);
    });

    it('should show the right records after the window moves, with no new node, element or listener', async () => {
        // Arrange
        const mounted = await mountList(people(10_000), {}, { first: 0, count: 20 });
        const before = slotElements(mounted);
        const on = vi.spyOn(mounted.store, 'on');
        const off = vi.spyOn(mounted.store, 'off');

        // Act
        for (const first of [1, 7, 100, 4999, 9970]) await setWindow(mounted, first, 20);

        // Assert
        expect(textsFrom(mounted, 9970, 25)).toEqual(names(9970, 25));
        expect(slotElements(mounted)).toHaveLength(30);
        expect(slotElements(mounted).every((slot, i) => slot === before[i])).toBe(true);
        expect(on).not.toHaveBeenCalled();
        expect(off).not.toHaveBeenCalled();
    });

    it('should cost one link write and one index write for each recycled slot', async () => {
        // Arrange
        const mounted = await mountList(people(10_000), {}, { first: 100, count: 20 });
        const link = vi.spyOn(mounted.store, 'link');
        const set = vi.spyOn(mounted.store, 'set');

        // Act
        await setWindow(mounted, 101, 20);

        // Assert
        const indexWrites = set.mock.calls.filter(([path]) => String(path).endsWith('.slotIndex'));
        expect(link.mock.calls).toHaveLength(1);
        expect(String(link.mock.calls[0]?.[0]).endsWith('.row')).toBe(true);
        expect(indexWrites).toHaveLength(1);
    });

    it('should read the keys of the recycled rows only, whatever the length of the array', async () => {
        // Arrange
        const readKeys = async (length: number): Promise<number> => {
            const mounted = await mountList(people(length), {}, { first: 50, count: 20 });
            const get = vi.spyOn(mounted.store, 'get');
            await setWindow(mounted, 53, 20);
            const keyReads = get.mock.calls.filter(([path]) => /\.records\.\d+\.id$/.test(String(path))).length;
            get.mockRestore();
            return keyReads;
        };

        // Act
        const small = await readKeys(100);
        const large = await readKeys(10_000);

        // Assert
        expect(small).toBe(3);
        expect(large).toBe(small);
    });

    it('should patch the slot that shows a changed record and leave the others alone', async () => {
        // Arrange
        const mounted = await mountList(people(10_000), {}, { first: 0, count: 10 });
        const touched: string[] = [];
        mounted.store.on(`${RUNTIME}.slots.$all`, (path) => touched.push(path));

        // Act
        mounted.store.set('$.data.records.9000.name', 'Far away');
        await flush();
        const untouched = touched.length;
        mounted.store.set('$.data.records.3.name', 'Changed');
        await flush();

        // Assert
        expect(untouched).toBe(0);
        expect(textsFrom(mounted, 0, 5)).toEqual(['Name 0', 'Name 1', 'Name 2', 'Changed', 'Name 4']);
    });

    it('should show nothing for a record that lacks the field and update when the field appears', async () => {
        // Arrange
        const records = [{ id: 'a' }, { id: 'b', name: 'Bea' }];
        const mounted = await mountList(records as Person[]);

        // Act
        const before = textsFrom(mounted, 0, 2);
        mounted.store.set('$.data.records.0.name', 'Ada');
        await flush();

        // Assert
        expect(before).toEqual(['', 'Bea']);
        expect(textsFrom(mounted, 0, 2)).toEqual(['Ada', 'Bea']);
    });

    it('should add, remove and reorder the records of an array', async () => {
        // Arrange
        const mounted = await mountList(people(5));
        const read = (): string[] => textsFrom(mounted, 0, 6);

        // Act and Assert
        mounted.store.get<Person[]>('$.data.records').push({ id: 'new', name: 'New' });
        await flush();
        expect(read()).toEqual([...names(0, 5), 'New']);

        mounted.store.get<Person[]>('$.data.records').shift();
        await flush();
        expect(read()).toEqual([...names(1, 4), 'New', '']);
        expect(mounted.store.get<number>('$.app.count')).toBe(5);

        mounted.store.get<Person[]>('$.data.records').reverse();
        await flush();
        expect(read()).toEqual(['New', 'Name 4', 'Name 3', 'Name 2', 'Name 1', '']);

        mounted.store.get<Person[]>('$.data.records').pop();
        await flush();
        expect(read()).toEqual(['New', 'Name 4', 'Name 3', 'Name 2', '', '']);
    });

    it('should re-point the slot of a deleted visible array element to the next record', async () => {
        // Arrange
        const mounted = await mountList(people(30), {}, { first: 0, count: 10 });

        // Act
        mounted.store.delete('$.data.records.2');
        await flush();

        // Assert
        expect(textsFrom(mounted, 0, 5)).toEqual(['Name 0', 'Name 1', 'Name 3', 'Name 4', 'Name 5']);
        expect(mounted.store.get<number>('$.app.count')).toBe(29);
    });

    it('should keep the key index right across a delete and an insert at the front', async () => {
        // Arrange
        const mounted = await mountList(people(10), { '<-order': '$.data.order' }, { first: 0, count: 10 }, { order: ['r5', 'r2'] });

        // Act
        mounted.store.delete('$.data.records.1');
        mounted.store.get<Person[]>('$.data.records').unshift({ id: 'front', name: 'Front' });
        mounted.store.set('$.data.order', ['r5', 'front', 'r2', 'r1']);
        await flush();

        // Assert
        expect(textsFrom(mounted, 0, 4)).toEqual(['Name 5', 'Front', 'Name 2', '']);
    });

    it('should add, remove and reorder the records of a keyed map', async () => {
        // Arrange
        const mounted = await mountList(peopleMap(4));
        const read = (): string[] => textsFrom(mounted, 0, 5);

        // Act and Assert
        mounted.store.set('$.data.records.extra', { id: 'extra', name: 'Extra' });
        await flush();
        expect(read()).toEqual([...names(0, 4), 'Extra']);

        mounted.store.delete('$.data.records.r1');
        await flush();
        expect(read()).toEqual(['Name 0', 'Name 2', 'Name 3', 'Extra', '']);

        const reordered = { extra: { id: 'extra', name: 'Extra' }, r3: { id: 'r3', name: 'Name 3' }, r0: { id: 'r0', name: 'Name 0' }, r2: { id: 'r2', name: 'Name 2' } };
        mounted.store.replace('$.data.records', reordered);
        await flush();
        expect(read()).toEqual(['Extra', 'Name 3', 'Name 0', 'Name 2', '']);
    });

    it('should re-point slots without rebuilding them when order changes, and skip entries that name no record', async () => {
        // Arrange
        const mounted = await mountList(people(10), { '<-order': '$.data.order' }, { first: 0, count: 10 }, { order: ['r4', 'ghost', 'r2', 'r9'] });
        const before = slotElements(mounted);

        // Act
        const filtered = textsFrom(mounted, 0, 4);
        mounted.store.set('$.data.order', ['r1', 'r0']);
        await flush();

        // Assert
        expect(filtered).toEqual(['Name 4', 'Name 2', 'Name 9', '']);
        expect(textsFrom(mounted, 0, 3)).toEqual(['Name 1', 'Name 0', '']);
        expect(mounted.store.get<number>('$.app.count')).toBe(2);
        expect(slotElements(mounted).every((slot, i) => slot === before[i])).toBe(true);
    });

    it('should rebuild the pool from an edited row template', async () => {
        // Arrange
        const mounted = await mountList(people(5).map((person) => ({ ...person, title: `Title of ${person.name}` })));
        const before = slotElements(mounted);

        // Act
        mounted.store.apply('$.app.row', { '<-_text': '$row.title' });
        await flush();

        // Assert
        const after = slotElements(mounted);
        expect(after).toHaveLength(before.length);
        expect(after.some((slot) => before.includes(slot))).toBe(false);
        expect(textsFrom(mounted, 0, 2)).toEqual(['Title of Name 0', 'Title of Name 1']);
    });

    it('should apply a language switch to the slots without rebuilding them', async () => {
        // Arrange
        const mounted = mountComponent(
            'recordList',
            { '<-records': '$.data.records', row: { component: 'text', _text: 'Hello' } },
            { data: { records: [{ id: 'a', name: 'Ada' }] }, locales: { de: { row: { _text: 'Hallo' } } } }
        );
        await flush();
        await setWindow(mounted, 0, 3);
        const before = slotElements(mounted);

        // Act
        const english = slotText(before[0] as HTMLElement);
        mounted.setLocale('de');
        await flush();

        // Assert
        expect(english).toBe('Hello');
        expect(slotElements(mounted).every((slot, i) => slot === before[i])).toBe(true);
        expect(slotText(before[0] as HTMLElement)).toBe('Hallo');
    });

    it('should remove its slots from the runtime branch when it is removed', async () => {
        // Arrange
        const mounted = await mountList(people(40), {}, { first: 0, count: 10 });
        const store = mounted.store;

        // Act
        mounted.dispose();

        // Assert
        expect(store.get(`${RUNTIME}.slots`)).toBeUndefined();
    });
});
