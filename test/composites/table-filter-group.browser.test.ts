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

const records = () => [
    { id: 'a', name: 'Ada', state: 'open', units: 4 },
    { id: 'b', name: 'Grace', state: 'done', units: 6 },
    { id: 'c', name: 'Hopper', state: 'open', units: 10 },
    { id: 'd', name: 'Lovelace', state: 'done', units: 1 }
];

const columns = {
    name: { _title: 'Name', field: 'name', filter: 'text' },
    state: { _title: 'State', field: 'state', filter: 'select', options: { open: { _label: 'Open' }, done: { _label: 'Done' } } },
    units: { _title: 'Units', field: 'units', total: 'sum', align: 'end' }
};

const shadow = (mounted: MountedComponent): ShadowRoot => mounted.element.shadowRoot as ShadowRoot;
const listRoot = (mounted: MountedComponent): ShadowRoot => shadow(mounted).querySelector('ui-record-list')?.shadowRoot as ShadowRoot;
/** The rows the body shows, in position order, each as the text of its cells */
const shownRows = (mounted: MountedComponent): string[][] =>
    Array.from(listRoot(mounted).querySelectorAll<HTMLElement>('.slot'))
        .filter((slot) => !slot.hidden)
        .sort((a, b) => Number(a.style.getPropertyValue('--sui-index')) - Number(b.style.getPropertyValue('--sui-index')))
        .map((slot) => Array.from(slot.querySelector('sui-node')?.firstElementChild?.shadowRoot?.querySelectorAll<HTMLElement>('.cell') ?? []).map((cell) => cell.textContent?.replace('▾', '').replace(/\s+/g, ' ').trim() ?? ''));
const filterControl = (mounted: MountedComponent, key: string): HTMLInputElement | HTMLSelectElement =>
    shadow(mounted).querySelector<HTMLInputElement | HTMLSelectElement>(`.filter[data-key="${key}"]`) as HTMLInputElement | HTMLSelectElement;
const groupToggle = (mounted: MountedComponent, index: number): HTMLButtonElement =>
    Array.from(listRoot(mounted).querySelectorAll<HTMLElement>('.slot'))
        .find((slot) => !slot.hidden && slot.style.getPropertyValue('--sui-index').trim() === String(index))
        ?.querySelector('sui-node')?.firstElementChild?.shadowRoot?.querySelector<HTMLButtonElement>('.group-toggle') as HTMLButtonElement;

const mountTable = async (extra: Record<string, unknown> = {}): Promise<MountedComponent> => {
    const mounted = mountComponent('table', { '<-items': '$.data.rows', columns, ...extra }, { data: { rows: records() } });
    const element = mounted.element as HTMLElement;
    element.style.blockSize = '320px';
    element.style.inlineSize = '600px';
    await settle();
    return mounted;
};

describe('table filters and groups in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should filter by a text and a select column from the filter row, keep the filters as state and raise filter', async () => {
        // Arrange
        const mounted = await mountTable();
        const filtered = events(mounted.element, 'filter');

        // Act
        await userEvent.type(filterControl(mounted, 'name'), 'e');
        await settle();
        const byName = shownRows(mounted).map((row) => row[0]);
        await userEvent.selectOptions(filterControl(mounted, 'state') as HTMLSelectElement, 'done');
        await settle();

        // Assert
        expect(filterControl(mounted, 'name').getAttribute('aria-label')).toBe('Filter Name');
        expect(filterControl(mounted, 'units')).toBeNull();
        expect(byName).toEqual(['Grace', 'Hopper', 'Lovelace']);
        expect(shownRows(mounted).map((row) => row[0])).toEqual(['Grace', 'Lovelace']);
        expect(mounted.store.get('$.app.filters')).toEqual({ name: 'e', state: 'done' });
        expect(filtered.at(-1)).toEqual({ filter: '', filters: { name: 'e', state: 'done' } });
        expect(mounted.element.getAttribute('aria-rowcount')).toBe('4');
    });

    it('should apply the quick filter across columns and clear every filter with clearFilters', async () => {
        // Arrange
        const mounted = await mountTable({ filter: 'OPEN' });
        const quick = shownRows(mounted).map((row) => row[0]);
        mounted.store.set('$.app.filters', { name: 'hop' });
        await settle();
        const both = shownRows(mounted).map((row) => row[0]);

        // Act
        (mounted.element as HTMLElement & { commands: Record<string, () => void> }).commands['clearFilters']?.();
        await settle();

        // Assert
        expect(quick).toEqual(['Ada', 'Hopper']);
        expect(both).toEqual(['Hopper']);
        expect(shownRows(mounted)).toHaveLength(4);
        expect(mounted.store.get('$.app.filter')).toBe('');
        expect((filterControl(mounted, 'name') as HTMLInputElement).value).toBe('');
    });

    it('should group by a field with a labelled group row and the totals of each group', async () => {
        // Arrange and Act
        const mounted = await mountTable({ groupBy: 'state', sortBy: 'name' });

        // Assert
        expect(shownRows(mounted)).toEqual([
            ['', 'Done (2)', '7'],
            ['Grace', 'Done', '6'],
            ['Lovelace', 'Done', '1'],
            ['', 'Open (2)', '14'],
            ['Ada', 'Open', '4'],
            ['Hopper', 'Open', '10']
        ]);
        expect(groupToggle(mounted, 0).getAttribute('aria-expanded')).toBe('true');
    });

    it('should collapse and expand a group on a press, write collapsedGroups and raise groupToggle, never selecting it', async () => {
        // Arrange
        const mounted = await mountTable({ groupBy: 'state', selectable: 'multi' });
        const toggled = events(mounted.element, 'groupToggle');

        // Act
        await userEvent.click(groupToggle(mounted, 0));
        await settle();
        const collapsed = shownRows(mounted).map((row) => row[1]);
        const expanded = groupToggle(mounted, 0).getAttribute('aria-expanded');
        await userEvent.click(groupToggle(mounted, 0));
        await settle();

        // Assert
        expect(collapsed).toEqual(['Done (2)', 'Open (2)', 'Open', 'Open']);
        expect(expanded).toBe('false');
        expect(toggled).toEqual([{ group: 'done', collapsed: true }, { group: 'done', collapsed: false }]);
        expect(mounted.store.get('$.app.collapsedGroups')).toEqual([]);
        expect(shownRows(mounted)).toHaveLength(6);
        expect(mounted.store.get('$.app.selected')).toBeUndefined();
    });

    it('should keep group rows out of select all and filter inside groups', async () => {
        // Arrange
        const mounted = await mountTable({ groupBy: 'state', selectable: 'multi', filters: { name: 'a' } });

        // Act
        (mounted.element as HTMLElement & { commands: Record<string, () => void> }).commands['selectAll']?.();
        await settle();

        // Assert
        expect(shownRows(mounted).map((row) => row[0] || row[1])).toEqual(['Done (2)', 'Grace', 'Lovelace', 'Open (1)', 'Ada']);
        expect(mounted.store.get('$.app.selected')).toEqual(['b', 'd', 'a']);
    });
});
