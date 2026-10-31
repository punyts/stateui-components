import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));
const frames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};
const BODY = '$.runtime.nodes.app.body';
const rowTemplate = { component: 'text', '<-_text': '$row.label' };

interface Item {
    id: string;
    label: string;
    parentId?: string;
    hasChildren?: boolean;
}

const item = (id: string, label: string, parentId?: string, extra: Partial<Item> = {}): Item => ({
    id,
    label,
    ...(parentId === undefined ? {} : { parentId }),
    ...extra
});
/** Fruit (Apple, Apricot (Apricot jam)), Veg (Beet), Nuts (a leaf with no children) */
const food = (): Item[] => [
    item('fruit', 'Fruit'),
    item('apple', 'Apple', 'fruit'),
    item('apricot', 'Apricot', 'fruit'),
    item('jam', 'Apricot jam', 'apricot'),
    item('veg', 'Veg'),
    item('beet', 'Beet', 'veg'),
    item('nuts', 'Nuts')
];

const recordList = (mounted: MountedComponent): Element | null => mounted.element.shadowRoot?.querySelector('ui-record-list') ?? null;
const slotElements = (mounted: MountedComponent): HTMLElement[] =>
    Array.from(recordList(mounted)?.shadowRoot?.querySelectorAll<HTMLElement>('.slot') ?? []);
const slotText = (slot: HTMLElement): string => (slot.firstElementChild?.firstElementChild as Element | null)?.shadowRoot?.textContent?.trim() ?? '';
const index = (slot: HTMLElement): number => Number(/--sui-index:\s*(-?\d+)/.exec(slot.getAttribute('style') ?? '')?.[1] ?? -1);
const visible = (mounted: MountedComponent): HTMLElement[] =>
    slotElements(mounted)
        .filter((slot) => !slot.hidden)
        .sort((a, b) => index(a) - index(b));
const shown = (mounted: MountedComponent): string[] => visible(mounted).map(slotText);
const slotOf = (mounted: MountedComponent, text: string): HTMLElement => {
    const slot = visible(mounted).find((candidate) => slotText(candidate) === text);
    if (slot === undefined) throw new Error(`no row shows "${text}"`);
    return slot;
};
const focused = (mounted: MountedComponent): string | undefined => {
    const active = recordList(mounted)?.shadowRoot?.activeElement;
    return active instanceof HTMLElement && active.classList.contains('slot') ? slotText(active) : undefined;
};
const focusRow = async (mounted: MountedComponent, text: string): Promise<void> => {
    slotOf(mounted, text).focus();
    await flush();
};
const press = async (key: string): Promise<void> => {
    await userEvent.keyboard(key);
    await flush();
};
const events = (mounted: MountedComponent, name: string): unknown[] => {
    const seen: unknown[] = [];
    mounted.element.addEventListener(name, (event) => seen.push((event as CustomEvent<unknown>).detail));
    return seen;
};
const command = (mounted: MountedComponent, name: string, value?: unknown): void => {
    (mounted.element as Element & { commands: Record<string, (value?: unknown) => void> }).commands[name]?.(value);
};

const mountTree = async (
    records: unknown,
    extra: Record<string, unknown> = {},
    window = { first: 0, count: 12 }
): Promise<MountedComponent> => {
    const mounted = mountComponent('tree', { '<-records': '$.data.nodes', row: rowTemplate, ...extra }, { data: { nodes: records } });
    (mounted.element as HTMLElement).style.blockSize = '320px';
    await flush();
    await frames(3);
    mounted.store.set(`${BODY}.window`, window);
    await flush();
    return mounted;
};

describe('tree accessibility in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should give each treeitem its level, state, set size, position and name', async () => {
        // Arrange and Act
        const mounted = await mountTree(food(), { expanded: ['fruit'] });
        const attributes = (text: string): Record<string, string | null> => {
            const slot = slotOf(mounted, text);
            return Object.fromEntries(
                ['role', 'aria-level', 'aria-expanded', 'aria-setsize', 'aria-posinset', 'aria-label'].map((name) => [name, slot.getAttribute(name)])
            );
        };

        // Assert
        expect(recordList(mounted)?.getAttribute('role')).toBe('tree');
        expect(attributes('Fruit')).toEqual({ role: 'treeitem', 'aria-level': '1', 'aria-expanded': 'true', 'aria-setsize': '3', 'aria-posinset': '1', 'aria-label': 'Fruit' });
        expect(attributes('Apricot')).toEqual({ role: 'treeitem', 'aria-level': '2', 'aria-expanded': 'false', 'aria-setsize': '2', 'aria-posinset': '2', 'aria-label': 'Apricot' });
        expect(attributes('Apple')['aria-expanded']).toBeNull();
        expect(attributes('Veg')['aria-expanded']).toBe('false');
        expect(attributes('Nuts')).toMatchObject({ 'aria-expanded': null, 'aria-posinset': '3' });
    });

    it('should follow a change of expansion in aria-expanded and of a label in aria-label', async () => {
        // Arrange
        const mounted = await mountTree(food());

        // Act
        mounted.store.set('$.app.expanded', ['veg'] as never);
        await flush();
        mounted.store.set('$.data.nodes.5.label', 'Beetroot' as never);
        await flush();

        // Assert
        expect(slotOf(mounted, 'Veg').getAttribute('aria-expanded')).toBe('true');
        expect(slotOf(mounted, 'Fruit').getAttribute('aria-expanded')).toBe('false');
        expect(slotOf(mounted, 'Beetroot').getAttribute('aria-label')).toBe('Beetroot');
    });
});

describe('tree keyboard in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should move down and up through the shown records, and stop at the ends', async () => {
        // Arrange
        const mounted = await mountTree(food(), { expanded: ['fruit'] });
        await focusRow(mounted, 'Fruit');

        // Act and assert
        await press('{ArrowDown}');
        expect(focused(mounted)).toBe('Apple');
        await press('{ArrowDown}');
        expect(focused(mounted)).toBe('Apricot');
        await press('{ArrowDown}');
        expect(focused(mounted)).toBe('Veg');
        await press('{ArrowUp}');
        expect(focused(mounted)).toBe('Apricot');
        await focusRow(mounted, 'Fruit');
        await press('{ArrowUp}');
        expect(focused(mounted)).toBe('Fruit');
    });

    it('should go to the first and last shown record with Home and End', async () => {
        // Arrange
        const mounted = await mountTree(food(), { expanded: ['fruit'] });
        await focusRow(mounted, 'Apple');

        // Act and assert
        await press('{End}');
        expect(focused(mounted)).toBe('Nuts');
        await press('{Home}');
        expect(focused(mounted)).toBe('Fruit');
    });

    it('should open a closed record with Right, then move to its first child', async () => {
        // Arrange
        const mounted = await mountTree(food());
        await focusRow(mounted, 'Fruit');

        // Act
        await press('{ArrowRight}');

        // Assert
        expect(mounted.store.get('$.app.expanded')).toEqual(['fruit']);
        expect(shown(mounted)).toEqual(['Fruit', 'Apple', 'Apricot', 'Veg', 'Nuts']);
        expect(focused(mounted)).toBe('Fruit');

        // Act
        await press('{ArrowRight}');

        // Assert
        expect(focused(mounted)).toBe('Apple');
    });

    it('should do nothing on Right for a record with no children', async () => {
        // Arrange
        const mounted = await mountTree(food());
        await focusRow(mounted, 'Nuts');

        // Act
        await press('{ArrowRight}');

        // Assert
        expect(mounted.store.get('$.app.expanded')).toEqual([]);
        expect(focused(mounted)).toBe('Nuts');
    });

    it('should close an open record with Left, and move to the parent from a closed one', async () => {
        // Arrange
        const mounted = await mountTree(food(), { expanded: ['fruit', 'apricot'] });
        await focusRow(mounted, 'Apricot');

        // Act and assert
        await press('{ArrowLeft}');
        expect(mounted.store.get('$.app.expanded')).toEqual(['fruit']);
        expect(shown(mounted)).toEqual(['Fruit', 'Apple', 'Apricot', 'Veg', 'Nuts']);
        expect(focused(mounted)).toBe('Apricot');
        await press('{ArrowLeft}');
        expect(focused(mounted)).toBe('Fruit');
        await press('{ArrowLeft}');
        expect(mounted.store.get('$.app.expanded')).toEqual([]);
        await press('{ArrowLeft}');
        expect(focused(mounted)).toBe('Fruit');
    });

    it('should move to the parent from a leaf with Left', async () => {
        // Arrange
        const mounted = await mountTree(food(), { expanded: ['fruit', 'apricot'] });
        await focusRow(mounted, 'Apricot jam');

        // Act
        await press('{ArrowLeft}');

        // Assert
        expect(focused(mounted)).toBe('Apricot');
    });

    it('should jump to the next record whose label starts with the typed character, wrapping round', async () => {
        // Arrange
        const mounted = await mountTree(food(), { expanded: ['fruit'] });
        await focusRow(mounted, 'Fruit');

        // Act and assert
        await press('a');
        expect(focused(mounted)).toBe('Apple');
        await press('a');
        expect(focused(mounted)).toBe('Apricot');
        await press('a');
        expect(focused(mounted)).toBe('Apple');
        await press('N');
        expect(focused(mounted)).toBe('Nuts');
        await press('z');
        expect(focused(mounted)).toBe('Nuts');
    });

    it('should use labelField, not the shown text, for the typed character', async () => {
        // Arrange
        const records = [
            { id: 'x', title: 'Zebra', label: 'a' },
            { id: 'y', title: 'Yak', label: 'b' }
        ];
        const mounted = await mountTree(records, { labelField: 'title', row: { component: 'text', '<-_text': '$row.title' } });
        await focusRow(mounted, 'Zebra');

        // Act
        await press('y');

        // Assert
        expect(focused(mounted)).toBe('Yak');
    });

    it('should swap Left and Right in right-to-left text', async () => {
        // Arrange
        const mounted = await mountTree(food());
        (mounted.element as HTMLElement).style.direction = 'rtl';
        await focusRow(mounted, 'Fruit');

        // Act
        await press('{ArrowRight}');

        // Assert
        expect(mounted.store.get('$.app.expanded')).toEqual([]);

        // Act
        await press('{ArrowLeft}');

        // Assert
        expect(mounted.store.get('$.app.expanded')).toEqual(['fruit']);
    });
});

describe('tree selection in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should select nothing while selectable is none, and still open a record on a press', async () => {
        // Arrange
        const mounted = await mountTree(food());
        const selects = events(mounted, 'select');

        // Act
        await userEvent.click(slotOf(mounted, 'Fruit'));
        await flush();

        // Assert
        expect(selects).toEqual([]);
        expect(mounted.store.get('$.app.expanded')).toEqual(['fruit']);
        expect(slotOf(mounted, 'Fruit').getAttribute('aria-selected')).toBeNull();
    });

    it('should replace the selection in single mode, write selected and raise select with the keys', async () => {
        // Arrange
        const mounted = await mountTree(food(), { selectable: 'single', expanded: ['fruit'] });
        const selects = events(mounted, 'select');

        // Act
        await userEvent.click(slotOf(mounted, 'Apple'));
        await flush();
        await userEvent.click(slotOf(mounted, 'Nuts'));
        await flush();

        // Assert
        expect(mounted.store.get('$.app.selected')).toBe('nuts');
        expect(selects).toEqual([['apple'], ['nuts']]);
        expect(slotOf(mounted, 'Nuts').getAttribute('aria-selected')).toBe('true');
        expect(slotOf(mounted, 'Apple').getAttribute('aria-selected')).toBe('false');
        expect(recordList(mounted)?.getAttribute('aria-multiselectable')).toBe('false');
    });

    it('should toggle each record in multi mode and pick with Space', async () => {
        // Arrange
        const mounted = await mountTree(food(), { selectable: 'multi', expanded: ['fruit'] });
        const selects = events(mounted, 'select');

        // Act
        await userEvent.click(slotOf(mounted, 'Apple'));
        await flush();
        await focusRow(mounted, 'Nuts');
        await press(' ');
        await userEvent.click(slotOf(mounted, 'Apple'));
        await flush();

        // Assert
        expect(mounted.store.get('$.app.selected')).toEqual(['nuts']);
        expect(selects).toEqual([['apple'], ['apple', 'nuts'], ['nuts']]);
        expect(recordList(mounted)?.getAttribute('aria-multiselectable')).toBe('true');
    });

    it('should not select with Space while selectable is none', async () => {
        // Arrange
        const mounted = await mountTree(food());
        const selects = events(mounted, 'select');
        await focusRow(mounted, 'Nuts');

        // Act
        await press(' ');

        // Assert
        expect(selects).toEqual([]);
    });

    it('should show a selection written from outside', async () => {
        // Arrange
        const mounted = await mountTree(food(), { selectable: 'single', expanded: ['fruit'] });

        // Act
        mounted.store.set('$.app.selected', 'apricot' as never);
        await flush();

        // Assert
        expect(slotOf(mounted, 'Apricot').getAttribute('aria-selected')).toBe('true');
    });

    it('should raise activate with the key on Enter and on a double press', async () => {
        // Arrange
        const mounted = await mountTree(food(), { selectable: 'single' });
        const activated = events(mounted, 'activate');
        await focusRow(mounted, 'Nuts');

        // Act
        await press('{Enter}');
        await userEvent.dblClick(slotOf(mounted, 'Veg'));
        await flush();

        // Assert
        expect(activated).toEqual(['nuts', 'veg']);
        expect(mounted.store.get('$.app.expanded')).toEqual(['veg']);
    });

    it('should open and close a record with a press on it, once for a double press', async () => {
        // Arrange
        const mounted = await mountTree(food());

        // Act and assert
        await userEvent.click(slotOf(mounted, 'Fruit'));
        await flush();
        expect(shown(mounted)).toEqual(['Fruit', 'Apple', 'Apricot', 'Veg', 'Nuts']);
        await userEvent.click(slotOf(mounted, 'Fruit'));
        await flush();
        expect(shown(mounted)).toEqual(['Fruit', 'Veg', 'Nuts']);
    });
});

describe('tree commands and lazy children in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should open and close records by command, and ignore a key that is unknown or has no children', async () => {
        // Arrange
        const mounted = await mountTree(food());

        // Act and assert
        command(mounted, 'expand', 'veg');
        await flush();
        expect(shown(mounted)).toEqual(['Fruit', 'Veg', 'Beet', 'Nuts']);
        command(mounted, 'expand', 'nuts');
        command(mounted, 'expand', 'missing');
        command(mounted, 'expand');
        await flush();
        expect(mounted.store.get('$.app.expanded')).toEqual(['veg']);
        command(mounted, 'collapse', 'veg');
        await flush();
        expect(shown(mounted)).toEqual(['Fruit', 'Veg', 'Nuts']);
    });

    it('should open every record that has children with expandAll, and close them all with collapseAll', async () => {
        // Arrange
        const mounted = await mountTree(food(), {}, { first: 0, count: 12 });

        // Act and assert
        command(mounted, 'expandAll');
        await flush();
        expect(shown(mounted)).toEqual(['Fruit', 'Apple', 'Apricot', 'Apricot jam', 'Veg', 'Beet', 'Nuts']);
        command(mounted, 'collapseAll');
        await flush();
        expect(shown(mounted)).toEqual(['Fruit', 'Veg', 'Nuts']);
        expect(mounted.store.get('$.app.expanded')).toEqual([]);
    });

    it('should expand 1,000 nodes with expandAll and keep the slot count bounded', async () => {
        // Arrange
        const records: Item[] = [];
        for (let group = 0; group < 10; group++) {
            records.push(item(`g${group}`, `Group ${group}`));
            for (let child = 0; child < 9; child++) {
                records.push(item(`g${group}c${child}`, `Child ${group}.${child}`, `g${group}`));
                for (let leaf = 0; leaf < 10; leaf++) records.push(item(`g${group}c${child}l${leaf}`, `Leaf ${group}.${child}.${leaf}`, `g${group}c${child}`));
            }
        }
        const mounted = await mountTree(records, {}, { first: 0, count: 10 });

        // Act
        command(mounted, 'expandAll');
        await flush();
        await flush();

        // Assert
        expect(records).toHaveLength(1000);
        expect(mounted.store.get<number>('$.app.body.count')).toBe(1000);
        expect(slotElements(mounted).length).toBeLessThanOrEqual(22);
        expect(shown(mounted).slice(0, 3)).toEqual(['Group 0', 'Child 0.0', 'Leaf 0.0.0']);

        // Act
        command(mounted, 'collapseAll');
        await flush();

        // Assert
        expect(mounted.store.get<number>('$.app.body.count')).toBe(10);
        expect(slotElements(mounted).length).toBeLessThanOrEqual(22);
    });

    it('should raise expand once for an open record marked as having children when none are loaded, and show a busy row', async () => {
        // Arrange
        const records = [item('lazy', 'Lazy', undefined, { hasChildren: true }), item('plain', 'Plain')];
        const mounted = await mountTree(records);
        const expands = events(mounted, 'expand');

        // Act
        await focusRow(mounted, 'Lazy');
        await press('{ArrowRight}');
        await flush();

        // Assert
        expect(expands).toEqual(['lazy']);
        expect(mounted.store.get<number>('$.app.body.count')).toBe(3);
        const busy = visible(mounted).filter((slot) => slot.hasAttribute('data-pending'));
        expect(busy).toHaveLength(1);
        expect(busy[0]?.getAttribute('aria-busy')).toBe('true');
        expect(busy[0]?.getAttribute('aria-hidden')).toBe('true');
        expect(index(busy[0] as HTMLElement)).toBe(1);
        expect(slotOf(mounted, 'Lazy').getAttribute('aria-expanded')).toBe('true');
        expect(shown(mounted)).toEqual(['Lazy', '', 'Plain']);
    });

    it('should replace the busy row with the children when they arrive in records, without another expand', async () => {
        // Arrange
        const records = [item('lazy', 'Lazy', undefined, { hasChildren: true }), item('plain', 'Plain')];
        const mounted = await mountTree(records, { expanded: ['lazy'] });
        const expands = events(mounted, 'expand');

        // Act
        mounted.store.set('$.data.nodes', [...records, item('kid1', 'Kid 1', 'lazy'), item('kid2', 'Kid 2', 'lazy')] as never);
        await flush();

        // Assert
        expect(expands).toEqual([]);
        expect(visible(mounted).some((slot) => slot.hasAttribute('data-pending'))).toBe(false);
        expect(shown(mounted)).toEqual(['Lazy', 'Kid 1', 'Kid 2', 'Plain']);
        expect(slotOf(mounted, 'Kid 1').getAttribute('aria-level')).toBe('2');
    });

    it('should raise expand at load for a key written into expanded, and again after a close and a new open', async () => {
        // Arrange
        const records = [item('lazy', 'Lazy', undefined, { hasChildren: true })];
        const mounted = mountComponent('tree', { '<-records': '$.data.nodes', row: rowTemplate, expanded: ['lazy'] }, { data: { nodes: records } });
        const expands = events(mounted, 'expand');
        await flush();
        await frames(2);

        // Act
        command(mounted, 'collapse', 'lazy');
        await flush();
        command(mounted, 'expand', 'lazy');
        await flush();

        // Assert
        expect(expands).toEqual(['lazy']);
    });

    it('should raise expand when a command opens a marked record, and not for a record whose children are loaded', async () => {
        // Arrange
        const records = [item('lazy', 'Lazy', undefined, { hasChildren: true }), item('full', 'Full', undefined, { hasChildren: true }), item('c', 'C', 'full')];
        const mounted = await mountTree(records);
        const expands = events(mounted, 'expand');

        // Act
        command(mounted, 'expand', 'full');
        command(mounted, 'expand', 'lazy');
        await flush();

        // Assert
        expect(expands).toEqual(['lazy']);
    });

    it('should not move to or select the busy row from the keyboard', async () => {
        // Arrange
        const records = [item('lazy', 'Lazy', undefined, { hasChildren: true }), item('plain', 'Plain')];
        const mounted = await mountTree(records, { expanded: ['lazy'], selectable: 'single' });
        await focusRow(mounted, 'Lazy');

        // Act
        await press('{ArrowDown}');

        // Assert
        expect(focused(mounted)).toBe('Plain');
    });
});
