import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;
const part = (element: Element, selector: string): HTMLElement | null => root(element).querySelector(selector);
const all = (element: Element, selector: string): HTMLElement[] => Array.from(root(element).querySelectorAll<HTMLElement>(selector));
/** The rendered text of each node: a `sui-node` holds one component whose own shadow root has the text */
const texts = (element: Element, selector: string): string[] =>
    all(element, selector).map((item) => item.firstElementChild?.shadowRoot?.textContent?.trim() ?? '');
const boxes = (element: Element, selector: string): DOMRect[] => all(element, selector).map((item) => box(item.firstElementChild as Element));
const text = (value: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ component: 'text', _text: value, ...extra });
const box = (element: Element): DOMRect => element.getBoundingClientRect();
const toggles = (element: Element): boolean[] => {
    const seen: boolean[] = [];
    element.addEventListener('toggle', (event) => seen.push((event as CustomEvent<{ collapsed: boolean }>).detail.collapsed));
    return seen;
};
const command = (element: Element, name: string): void => {
    (element as Element & { commands: Record<string, () => void> }).commands[name]?.();
};

describe('panel in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render the title, description, actions and children in key order', () => {
        // Arrange
        const mounted = mountComponent('panel', {
            _title: 'Details',
            _description: 'About the order',
            actions: { component: 'button', _title: 'Edit' },
            children: { b: text('Second'), a: text('First') }
        });

        // Assert
        expect(part(mounted.element, '.title')?.textContent?.trim()).toBe('Details');
        expect(part(mounted.element, '.description')?.textContent?.trim()).toBe('About the order');
        expect(part(mounted.element, '.actions ui-button')).not.toBeNull();
        expect(texts(mounted.element, '.body > sui-node')).toEqual(['Second', 'First']);
    });

    it('should render no header for a panel with no title, description, actions or collapse control and no body for no children', () => {
        // Arrange
        const mounted = mountComponent('panel', {});

        // Assert
        expect(part(mounted.element, '.header')).toBeNull();
        expect(getComputedStyle(part(mounted.element, '.body') as HTMLElement).display).toBe('none');
    });

    it('should default to a flat elevation and follow elevation raised', () => {
        // Arrange
        const flat = mountComponent('panel', { children: { a: text('A') } });
        const raised = mountComponent('panel', { elevation: 'raised', children: { a: text('A') } });

        // Assert
        expect(flat.element.getAttribute('elevation')).toBe('flat');
        expect(getComputedStyle(part(flat.element, '.panel') as HTMLElement).boxShadow).toBe('none');
        expect(getComputedStyle(part(raised.element, '.panel') as HTMLElement).boxShadow).not.toBe('none');
    });

    it('should draw a border only when bordered', () => {
        // Arrange
        const plain = mountComponent('panel', {});
        const bordered = mountComponent('panel', { bordered: true });
        const colour = (element: Element): string => getComputedStyle(part(element, '.panel') as HTMLElement).borderTopColor;

        // Assert
        expect(colour(plain.element)).toBe('rgba(0, 0, 0, 0)');
        expect(colour(bordered.element)).not.toBe('rgba(0, 0, 0, 0)');
    });

    it('should shrink the padding with density compact', () => {
        // Arrange
        const padding = (density: string): number =>
            parseFloat(getComputedStyle(part(mountComponent('panel', { density }).element, '.panel') as HTMLElement).paddingLeft);

        // Assert
        expect(padding('compact')).toBeLessThan(padding('spacious'));
    });

    it('should lay the children out as a column, a row, a grid, a region and ad hoc through layout and placement', () => {
        // Arrange
        const place = (layout: Record<string, unknown>, placed: Record<string, Record<string, unknown>>): DOMRect[] => {
            const mounted = mountComponent('panel', {
                layout,
                children: {
                    a: text('A', { placement: placed.a }),
                    b: text('B', { placement: placed.b }),
                    c: text('C', { placement: placed.c })
                }
            });
            return all(mounted.element, '.body > sui-node > ui-text').map(box);
        };

        // Act
        const column = place({ type: 'column' }, { a: {}, b: {}, c: {} });
        const row = place({ type: 'row' }, { a: {}, b: {}, c: {} });
        const grid = place({ type: 'grid', cols: 2 }, { a: {}, b: {}, c: {} });
        const region = place({ type: 'region' }, { a: { region: 'nw' }, b: { region: 'ne' }, c: { region: 'center' } });
        const adhoc = place({ type: 'adhoc' }, { a: { x: '0px', y: '0px' }, b: { x: '100px', y: '20px' }, c: { x: '50px', y: '40px' } });

        // Assert
        expect(column[1]?.top).toBeGreaterThan(column[0]?.top ?? 0);
        expect(column[1]?.left).toBe(column[0]?.left);
        expect(row[1]?.left).toBeGreaterThan(row[0]?.left ?? 0);
        expect(row[1]?.top).toBe(row[0]?.top);
        expect(grid[1]?.top).toBe(grid[0]?.top);
        expect(grid[2]?.top).toBeGreaterThan(grid[0]?.top ?? 0);
        expect(grid[2]?.left).toBe(grid[0]?.left);
        expect(region[1]?.left).toBeGreaterThan(region[0]?.left ?? 0);
        expect(region[2]?.top).toBeGreaterThan(region[0]?.top ?? 0);
        expect((adhoc[1]?.left ?? 0) - (adhoc[0]?.left ?? 0)).toBeCloseTo(100, 0);
        expect((adhoc[2]?.top ?? 0) - (adhoc[0]?.top ?? 0)).toBeCloseTo(40, 0);
    });

    it('should render nested panels with their own layouts', () => {
        // Arrange
        const mounted = mountComponent('panel', {
            _title: 'Outer',
            children: {
                inner: {
                    component: 'panel',
                    _title: 'Inner',
                    layout: { type: 'row' },
                    children: { a: text('A'), b: text('B') }
                }
            }
        });
        const inner = part(mounted.element, '.body ui-panel') as HTMLElement;
        const [a, b] = all(inner, '.body ui-text').map(box);

        // Assert
        expect(part(inner, '.title')?.textContent?.trim()).toBe('Inner');
        expect(b?.left).toBeGreaterThan(a?.left ?? 0);
        expect(b?.top).toBe(a?.top);
        expect(box(inner).top).toBeGreaterThan(box(part(mounted.element, '.title') as HTMLElement).top);
    });

    it('should add a child after load without re-creating the others', () => {
        // Arrange
        const mounted = mountComponent('panel', { children: { a: text('A'), b: text('B') } });
        const [a, b] = all(mounted.element, '.body > sui-node');

        // Act
        mounted.store.set('$.app.children.c', text('C'));

        // Assert
        const after = all(mounted.element, '.body > sui-node');
        expect(texts(mounted.element, '.body > sui-node')).toEqual(['A', 'B', 'C']);
        expect(after[0]).toBe(a);
        expect(after[1]).toBe(b);
    });

    it('should remove a child and reorder the keys without re-creating the others', () => {
        // Arrange
        const mounted = mountComponent('panel', { children: { a: text('A'), b: text('B'), c: text('C') } });
        const [a, , c] = all(mounted.element, '.body > sui-node');

        // Act
        mounted.store.replace('$.app.children', { c: text('C'), a: text('A') });

        // Assert
        const after = all(mounted.element, '.body > sui-node');
        expect(texts(mounted.element, '.body > sui-node')).toEqual(['C', 'A']);
        expect(after[0]).toBe(c);
        expect(after[1]).toBe(a);
    });

    it('should show children that were added to a panel that had none', () => {
        // Arrange
        const mounted = mountComponent('panel', {});

        // Act
        mounted.store.set('$.app.children', { a: text('Late') });

        // Assert
        expect(texts(mounted.element, '.body > sui-node')).toEqual(['Late']);
        expect(getComputedStyle(part(mounted.element, '.body') as HTMLElement).display).not.toBe('none');
    });

    it('should have a header control with aria-expanded only when collapsible', () => {
        // Arrange
        const plain = mountComponent('panel', { _title: 'Plain' });
        const collapsible = mountComponent('panel', { _title: 'Open', collapsible: true });

        // Assert
        expect(part(plain.element, '.toggle')).toBeNull();
        expect(part(collapsible.element, '.toggle')?.getAttribute('aria-expanded')).toBe('true');
    });

    it('should hide a collapsed body but keep the children in the DOM with their state', async () => {
        // Arrange
        const mounted = mountComponent('panel', {
            _title: 'Notes',
            collapsible: true,
            children: { note: { component: 'input', value: 'draft' } }
        });
        const child = part(mounted.element, '.body ui-input') as HTMLElement;
        mounted.store.set('$.app.children.note.value', 'edited');

        // Act
        await userEvent.click(part(mounted.element, '.toggle') as HTMLElement);

        // Assert
        expect(mounted.element.hasAttribute('collapsed')).toBe(true);
        expect(part(mounted.element, '.toggle')?.getAttribute('aria-expanded')).toBe('false');
        expect(part(mounted.element, '.body ui-input')).toBe(child);
        expect(box(child).height).toBe(0);
        expect(mounted.store.get('$.app.children.note.value')).toBe('edited');
    });

    it('should start collapsed with collapsed true and expand again from the control', async () => {
        // Arrange
        const mounted = mountComponent('panel', { _title: 'Notes', collapsible: true, collapsed: true, children: { a: text('A') } });
        expect(box(part(mounted.element, '.body ui-text') as HTMLElement).height).toBe(0);

        // Act
        await userEvent.click(part(mounted.element, '.toggle') as HTMLElement);

        // Assert
        expect(mounted.store.get('$.app.collapsed')).toBe(false);
        expect(box(part(mounted.element, '.body ui-text') as HTMLElement).height).toBeGreaterThan(0);
    });

    it('should expand, collapse and toggle through the commands and raise toggle on each change', () => {
        // Arrange
        const mounted = mountComponent('panel', { collapsible: true, children: { a: text('A') } });
        const seen = toggles(mounted.element);

        // Act
        command(mounted.element, 'collapse');
        command(mounted.element, 'collapse');
        command(mounted.element, 'expand');
        command(mounted.element, 'toggle');
        command(mounted.element, 'toggle');

        // Assert
        expect(seen).toEqual([true, false, true, false]);
        expect(mounted.store.get('$.app.collapsed')).toBe(false);
    });

    it('should raise toggle with the new state from the header control', async () => {
        // Arrange
        const mounted = mountComponent('panel', { _title: 'Notes', collapsible: true });
        const seen = toggles(mounted.element);

        // Act
        await userEvent.click(part(mounted.element, '.toggle') as HTMLElement);
        await userEvent.keyboard('{Enter}');

        // Assert
        expect(seen).toEqual([true, false]);
    });

    it('should name a collapse control that has no title by _toggleLabel, in German too', () => {
        // Arrange
        const mounted = mountComponent('panel', { collapsible: true });

        // Act
        const english = part(mounted.element, '.toggle')?.getAttribute('aria-label');
        mounted.setLocale('de');

        // Assert
        expect(english).toBe('Toggle section');
        expect(part(mounted.element, '.toggle')?.getAttribute('aria-label')).toBe('Bereich umschalten');
    });

    it('should show the German title and description from the document overlay', () => {
        // Arrange
        const mounted = mountComponent(
            'panel',
            { _title: 'Details', _description: 'About' },
            { locales: { de: { _title: 'Einzelheiten', _description: 'Über' } } }
        );

        // Act
        mounted.setLocale('de');

        // Assert
        expect(part(mounted.element, '.title')?.textContent?.trim()).toBe('Einzelheiten');
        expect(part(mounted.element, '.description')?.textContent?.trim()).toBe('Über');
    });
});

describe('toolbar in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    const buttons = { a: { component: 'button', _title: 'A' }, b: { component: 'button', _title: 'B' } };
    const bounds = (align: string): { host: DOMRect; first: DOMRect; last: DOMRect } => {
        const mounted = mountComponent('toolbar', { align, children: buttons });
        const items = boxes(mounted.element, '.row > sui-node');
        return { host: box(part(mounted.element, '.row') as HTMLElement), first: items[0] as DOMRect, last: items[1] as DOMRect };
    };

    it('should render the children as a row in key order', () => {
        // Arrange
        const mounted = mountComponent('toolbar', { children: { b: text('Second'), a: text('First') } });
        const [b, a] = boxes(mounted.element, '.row > sui-node');

        // Assert
        expect(part(mounted.element, '.row')?.getAttribute('role')).toBe('toolbar');
        expect(texts(mounted.element, '.row > sui-node')).toEqual(['Second', 'First']);
        expect(a?.left).toBeGreaterThan(b?.left ?? 0);
        expect(a?.top).toBe(b?.top);
    });

    it('should align the row to the start, center, end or between', () => {
        // Arrange
        const start = bounds('start');
        const center = bounds('center');
        const end = bounds('end');
        const between = bounds('between');

        // Assert
        expect(start.first.left - start.host.left).toBeLessThan(center.first.left - center.host.left);
        expect(center.first.left - center.host.left).toBeLessThan(end.first.left - end.host.left);
        expect(end.host.right - end.last.right).toBeLessThan(center.host.right - center.last.right);
        expect(between.last.right).toBeGreaterThan(start.last.right);
        expect(between.first.left - between.host.left).toBeCloseTo(start.first.left - start.host.left, 0);
    });

    it('should wrap the children only with wrap', () => {
        // Arrange
        const many = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`k${index}`, { component: 'button', _title: `Button number ${index}` }]));
        const narrow = (wrap: boolean): HTMLElement => {
            const mounted = mountComponent('toolbar', { wrap, children: many });
            mounted.host.style.width = '320px';
            return part(mounted.element, '.row') as HTMLElement;
        };
        const tops = (row: HTMLElement): Set<number> => new Set(Array.from(row.children).map((item) => Math.round(box(item.firstElementChild as Element).top)));

        // Assert
        expect(tops(narrow(false)).size).toBe(1);
        expect(tops(narrow(true)).size).toBeGreaterThan(1);
    });

    it('should reject a layout, because the toolbar lays its children out itself', () => {
        // Assert
        expect(() => mountComponent('toolbar', { layout: { type: 'column' }, children: buttons })).toThrow(/SUI-LAYOUT-UNSUPPORTED/);
    });

    it('should add and remove children after load without re-creating the others', () => {
        // Arrange
        const mounted = mountComponent('toolbar', { children: { a: text('A'), b: text('B') } });
        const [a] = all(mounted.element, '.row > sui-node');

        // Act
        mounted.store.set('$.app.children.c', text('C'));
        mounted.store.replace('$.app.children', { a: text('A'), c: text('C') });

        // Assert
        expect(texts(mounted.element, '.row > sui-node')).toEqual(['A', 'C']);
        expect(all(mounted.element, '.row > sui-node')[0]).toBe(a);
    });

    it('should show nothing and not fail with no children', () => {
        // Arrange
        const mounted = mountComponent('toolbar', {});

        // Assert
        expect(all(mounted.element, '.row > sui-node')).toHaveLength(0);
    });

    it('should work as a child of a panel', () => {
        // Arrange
        const mounted = mountComponent('panel', {
            _title: 'Orders',
            children: { bar: { component: 'toolbar', align: 'end', children: buttons } }
        });
        const bar = part(mounted.element, '.body ui-toolbar') as HTMLElement;

        // Assert
        expect(bar.getAttribute('align')).toBe('end');
        expect(all(bar, '.row ui-button')).toHaveLength(2);
    });
});
