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
    { id: 'r0', name: 'Ada', stock: 4, state: 'open', active: true },
    { id: 'r1', name: 'Grace', stock: 7, state: 'done', active: false }
];

const columns = {
    name: { _title: 'Name', field: 'name', edit: 'text', required: true, maxLength: 12 },
    stock: { _title: 'Stock', field: 'stock', edit: 'number', min: 0 },
    state: { _title: 'State', field: 'state', edit: 'select', required: true, options: { open: { _label: 'Open' }, done: { _label: 'Done' } } },
    active: { _title: 'Active', field: 'active', edit: 'check' }
};

const shadow = (mounted: MountedComponent): ShadowRoot => mounted.element.shadowRoot as ShadowRoot;
const rowSlot = (mounted: MountedComponent, index: number): HTMLElement =>
    Array.from(shadow(mounted).querySelector('ui-record-list')?.shadowRoot?.querySelectorAll<HTMLElement>('.slot') ?? []).find(
        (element) => !element.hidden && new RegExp(`--sui-index:\\s*${index}\\b`).test(element.getAttribute('style') ?? '')
    ) as HTMLElement;
const cell = (mounted: MountedComponent, index: number, key: string): HTMLElement =>
    rowSlot(mounted, index).querySelector('sui-node')?.firstElementChild?.shadowRoot?.querySelector<HTMLElement>(`.cell[data-key="${key}"]`) as HTMLElement;
const control = (mounted: MountedComponent): HTMLInputElement | HTMLSelectElement | null =>
    shadow(mounted).querySelector<HTMLInputElement | HTMLSelectElement>('.edit-control');
const error = (mounted: MountedComponent): HTMLElement | null => shadow(mounted).querySelector<HTMLElement>('.edit-error');

const mountTable = async (): Promise<MountedComponent> => {
    const mounted = mountComponent('table', { '<-items': '$.data.rows', columns }, { data: { rows: records() } });
    const element = mounted.element as HTMLElement;
    element.style.blockSize = '240px';
    element.style.inlineSize = '600px';
    await settle();
    return mounted;
};
const open = async (mounted: MountedComponent, index: number, key: string): Promise<void> => {
    await userEvent.dblClick(cell(mounted, index, key));
    await settle();
};
const retype = async (mounted: MountedComponent, value: string): Promise<void> => {
    await userEvent.clear(control(mounted) as HTMLInputElement);
    if (value !== '') await userEvent.keyboard(value);
};

describe('table inline editing in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should open an editor over the cell on a double press and write the value on Enter with edit', async () => {
        // Arrange
        const mounted = await mountTable();
        const edits = events(mounted.element, 'edit');

        // Act
        await open(mounted, 0, 'stock');
        const editor = control(mounted) as HTMLInputElement;
        const focused = shadow(mounted).activeElement === editor;
        await retype(mounted, '12');
        await userEvent.keyboard('{Enter}');
        await settle();

        // Assert
        expect(editor.type).toBe('number');
        expect(editor.getAttribute('aria-label')).toBe('Stock');
        expect(focused).toBe(true);
        expect(mounted.store.get('$.data.rows.0.stock')).toBe(12);
        expect(edits).toEqual([{ key: 'r0', column: 'stock', field: 'stock', value: 12, previous: 4 }]);
        expect(control(mounted)).toBeNull();
        expect(cell(mounted, 0, 'stock').textContent?.trim()).toBe('12');
    });

    it('should show the rule message for a failing value and stay open', async () => {
        // Arrange
        const mounted = await mountTable();
        const edits = events(mounted.element, 'edit');

        // Act
        await open(mounted, 0, 'name');
        await retype(mounted, '');
        await userEvent.keyboard('{Enter}');
        await settle();

        // Assert
        expect(control(mounted)?.getAttribute('aria-invalid')).toBe('true');
        expect(error(mounted)?.textContent?.trim()).toBe('This field is required');
        expect(error(mounted)?.getAttribute('role')).toBe('alert');
        expect(mounted.store.get('$.data.rows.0.name')).toBe('Ada');
        expect(edits).toEqual([]);
    });

    it('should close unwritten on Escape and give focus back to the row', async () => {
        // Arrange
        const mounted = await mountTable();

        // Act
        await open(mounted, 1, 'name');
        await retype(mounted, 'Hopper');
        await userEvent.keyboard('{Escape}');
        await settle();

        // Assert
        expect(control(mounted)).toBeNull();
        expect(mounted.store.get('$.data.rows.1.name')).toBe('Grace');
        expect(shadow(mounted).querySelector('ui-record-list')?.shadowRoot?.activeElement).toBe(rowSlot(mounted, 1));
    });

    it('should write and move to the next editable cell on Tab, and back on Shift+Tab', async () => {
        // Arrange
        const mounted = await mountTable();

        // Act
        await open(mounted, 0, 'name');
        await retype(mounted, 'Ada L');
        await userEvent.keyboard('{Tab}');
        await settle();
        const afterTab = { label: control(mounted)?.getAttribute('aria-label'), value: control(mounted)?.value };
        await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
        await settle();

        // Assert
        expect(mounted.store.get('$.data.rows.0.name')).toBe('Ada L');
        expect(afterTab).toEqual({ label: 'Stock', value: '4' });
        expect(control(mounted)?.getAttribute('aria-label')).toBe('Name');
    });

    it('should open the first editable column of the focused row on F2', async () => {
        // Arrange
        const mounted = await mountTable();
        rowSlot(mounted, 1).focus();

        // Act
        await userEvent.keyboard('{F2}');
        await settle();

        // Assert
        expect(control(mounted)?.getAttribute('aria-label')).toBe('Name');
        expect(control(mounted)?.value).toBe('Grace');
    });

    it('should show select labels in cells, edit with the listed options, and toggle a check column in place', async () => {
        // Arrange
        const mounted = await mountTable();
        const shown = cell(mounted, 0, 'state').textContent?.trim();

        // Act
        await open(mounted, 0, 'state');
        const select = control(mounted) as HTMLSelectElement;
        const options = Array.from(select.options).map((option) => [option.value, option.textContent?.trim()]);
        await userEvent.selectOptions(select, 'done');
        await userEvent.keyboard('{Enter}');
        await settle();
        const checkbox = cell(mounted, 1, 'active').querySelector('ui-checkbox')?.shadowRoot?.querySelector<HTMLInputElement>('input') as HTMLInputElement;
        await userEvent.click(checkbox);
        await settle();

        // Assert
        expect(shown).toBe('Open');
        expect(options).toEqual([['open', 'Open'], ['done', 'Done']]);
        expect(mounted.store.get('$.data.rows.0.state')).toBe('done');
        expect(cell(mounted, 0, 'state').textContent?.trim()).toBe('Done');
        expect(mounted.store.get('$.data.rows.1.active')).toBe(true);
    });
});
