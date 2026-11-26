import { report } from '@punyts/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

const NODES = {
    app: { label: 'Shop' },
    data: { label: 'Data', parent: 'app', note: '2 datasets' },
    orders: { label: 'Orders', parent: 'data' },
    stock: { label: 'Stock', parent: 'data' },
    screens: { label: 'Screens', parent: 'app' }
};

const root = (mounted: MountedComponent): ShadowRoot => mounted.element.shadowRoot as ShadowRoot;
const cardOf = (mounted: MountedComponent, id: string): HTMLElement => root(mounted).querySelector<HTMLElement>(`.card[data-id="${id}"]`) as HTMLElement;
const boxOf = (mounted: MountedComponent, id: string): DOMRect => cardOf(mounted, id).getBoundingClientRect();
/** The text of a card, through the shadow roots of the components it draws */
const deepText = (node: Node): string => {
    const own = node instanceof Element && node.shadowRoot ? deepText(node.shadowRoot) : '';
    return own + Array.from(node.childNodes).map((child) => (child.nodeType === Node.TEXT_NODE ? (child.textContent ?? '') : deepText(child))).join('');
};
/** The first element matching a selector in a card, through the shadow roots */
const deepFind = (node: Element | ShadowRoot, selector: string): Element | undefined => {
    for (const child of Array.from(node.querySelectorAll('*'))) {
        if (child.matches(selector)) return child;
        const inner = child.shadowRoot ? deepFind(child.shadowRoot, selector) : undefined;
        if (inner !== undefined) return inner;
    }
    return undefined;
};
const pathsOf = (mounted: MountedComponent): SVGPathElement[] => Array.from(root(mounted).querySelectorAll<SVGPathElement>('.edges path'));

const mountDiagram = async (extra: Record<string, unknown> = {}, nodes: unknown = NODES): Promise<MountedComponent> => {
    const mounted = mountComponent('treeDiagram', { '<-nodes': '$.data.nodes', ...extra }, { data: { nodes } });
    await settle();
    return mounted;
};

describe('treeDiagram in Chromium', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        mountComponent.unmountAll();
    });

    it('should place each card in a column further out than its parent, a parent level with the middle of its children', async () => {
        // Arrange and Act
        const mounted = await mountDiagram();

        // Assert
        const [app, data, orders, stock] = ['app', 'data', 'orders', 'stock'].map((id) => boxOf(mounted, id)) as DOMRect[];
        expect(data.left).toBeGreaterThan(app.right);
        expect(orders.left).toBeGreaterThan(data.right);
        expect(Math.abs(orders.left - stock.left)).toBeLessThan(1);
        expect(Math.abs((data.top + data.bottom) / 2 - (orders.top + stock.bottom) / 2)).toBeLessThan(1);
        expect(deepText(cardOf(mounted, 'data'))).toContain('2 datasets');
        expect(root(mounted).querySelectorAll('.card:not([data-placed])')).toHaveLength(0);
    });

    it('should draw an edge from each parent to each child, and a link across the tree', async () => {
        // Arrange and Act
        const mounted = await mountDiagram({ links: [{ from: 'orders', to: 'screens', kind: 'uses' }] });

        // Assert
        const paths = pathsOf(mounted);
        expect(paths.filter((path) => path.classList.contains('tree'))).toHaveLength(4);
        const link = paths.find((path) => path.classList.contains('link')) as SVGPathElement;
        expect([link.dataset['from'], link.dataset['to']]).toEqual(['orders', 'screens']);
        expect(link.getAttribute('d')).toMatch(/^M[\d.]+,[\d.]+ C/);
    });

    it('should select a card on a press, give its box, light its links, and let it go on a second press', async () => {
        // Arrange
        const mounted = await mountDiagram({ links: [{ from: 'orders', to: 'screens' }] });
        const selects: { id: string; box: { x: number; y: number; width: number; height: number } }[] = [];
        mounted.element.addEventListener('select', (event) => selects.push((event as CustomEvent).detail));

        // Act
        cardOf(mounted, 'orders').click();
        await settle();
        const lit = pathsOf(mounted).find((path) => path.classList.contains('link'))?.hasAttribute('data-lit');
        const chosen = cardOf(mounted, 'orders').getAttribute('aria-selected');
        cardOf(mounted, 'orders').click();
        await settle();

        // Assert
        expect(selects.map((detail) => detail.id)).toEqual(['orders', '']);
        const box = selects[0]!.box;
        expect(box.width).toBe(cardOf(mounted, 'orders').offsetWidth);
        expect(box.x).toBeGreaterThan(0);
        expect(lit).toBe(true);
        expect(chosen).toBe('true');
        expect(mounted.store.get('$.app.selected')).toBe('');
        expect(cardOf(mounted, 'orders').hasAttribute('data-selected')).toBe(false);
    });

    it('should draw each card with the consumer template, whose controls tell the host of their record and do not select', async () => {
        // Arrange
        const told: [string, string, unknown][] = [];
        const card = {
            component: 'card',
            padding: 'sm',
            children: {
                name: { component: 'text', '<-_text': '$row.label' },
                add: { component: 'button', '@id': 'addNode', size: 'sm', _title: 'Add' }
            }
        };
        const mounted = mountComponent('treeDiagram', { '<-nodes': '$.data.nodes', card }, { data: { nodes: NODES }, hooks: { onRaised: (report) => void (report.event === 'press' ? told.push([report.id, report.event, (report.row as { label?: unknown } | undefined)?.label]) : undefined) } });
        await settle();

        // Act
        const stock = cardOf(mounted, 'stock');
        const button = deepFind(stock, 'button') as HTMLButtonElement;
        button.click();
        await settle();
        mounted.store.set('$.data.nodes.stock.label', 'Inventory');
        await settle();

        // Assert
        expect(told).toEqual([['addNode', 'press', 'Stock']]);
        expect(mounted.store.get('$.app.selected')).toBe('');
        expect(deepText(cardOf(mounted, 'stock'))).toContain('Inventory');
        expect(deepText(cardOf(mounted, 'app'))).toContain('Shop');
    });

    it('should raise open on Enter and a double press, and move the focus along the tree with the arrows', async () => {
        // Arrange
        const mounted = await mountDiagram();
        const opened: unknown[] = [];
        mounted.element.addEventListener('open', (event) => opened.push((event as CustomEvent).detail.id));
        const key = (id: string, name: string): void => {
            cardOf(mounted, id).dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, composed: true }));
        };

        // Act
        key('stock', 'Enter');
        cardOf(mounted, 'data').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
        key('app', 'ArrowRight');
        const first = root(mounted).activeElement?.getAttribute('data-id');
        key('data', 'ArrowRight');
        const second = root(mounted).activeElement?.getAttribute('data-id');
        key('orders', 'ArrowLeft');
        const back = root(mounted).activeElement?.getAttribute('data-id');
        await settle();

        // Assert
        expect(opened).toEqual(['stock', 'data']);
        expect([first, second, back]).toEqual(['data', 'orders', 'data']);
        expect(root(mounted).querySelectorAll('.card[tabindex="0"]')).toHaveLength(1);
        expect(cardOf(mounted, 'orders').getAttribute('aria-level')).toBe('3');
    });

    it('should wrap the leaves that wrap into a block, and show every link when linksShown is always', async () => {
        // Arrange
        const nodes = { app: { label: 'Shop' }, a: { label: 'A', parent: 'app', wrap: true }, b: { label: 'B', parent: 'app', wrap: true }, c: { label: 'C', parent: 'app', wrap: true } };

        // Act
        const mounted = await mountDiagram({ leafBlock: 400, linksShown: 'always', links: [{ from: 'a', to: 'c', kind: 'uses', label: 'A uses C' }] }, nodes);

        // Assert
        expect(Math.abs(boxOf(mounted, 'a').top - boxOf(mounted, 'b').top)).toBeLessThan(1);
        expect(boxOf(mounted, 'b').left).toBeGreaterThan(boxOf(mounted, 'a').right);
        const link = pathsOf(mounted).find((path) => path.classList.contains('link')) as SVGPathElement;
        expect(link.hasAttribute('data-lit')).toBe(true);
        expect(link.dataset['kind']).toBe('uses');
        expect(link.querySelector('title')?.textContent).toBe('A uses C');
        expect(pathsOf(mounted).filter((path) => path.classList.contains('tree'))).toHaveLength(1);
    });

    it('should put the branches on both sides when twoSided, and lay out again when a record is added', async () => {
        // Arrange
        const mounted = await mountDiagram({ twoSided: true });

        // Act
        mounted.store.set('$.data.nodes.files', { label: 'Files', parent: 'app' });
        await settle();

        // Assert
        expect(boxOf(mounted, 'screens').right).toBeLessThan(boxOf(mounted, 'app').left);
        expect(boxOf(mounted, 'data').left).toBeGreaterThan(boxOf(mounted, 'app').right);
        expect(cardOf(mounted, 'files').hasAttribute('data-placed')).toBe(true);
    });

    it('should leave out the cards of a parent loop and report it once', async () => {
        // Arrange
        const warning = vi.spyOn(report, 'warning').mockImplementation(() => undefined);

        // Act
        const mounted = await mountDiagram({}, { a: { label: 'A' }, b: { label: 'B', parent: 'c' }, c: { label: 'C', parent: 'b' } });

        // Assert
        expect(cardOf(mounted, 'a').hasAttribute('data-placed')).toBe(true);
        expect(cardOf(mounted, 'b').hasAttribute('data-placed')).toBe(false);
        expect(warning.mock.calls.filter(([message]) => String(message).startsWith('treeDiagram'))).toHaveLength(1);
    });

    it('should raise layout with its size once the cards are placed, and let the selection go on a press between the cards', async () => {
        // Arrange
        const layouts: { width: number; height: number }[] = [];
        const mounted = mountComponent('treeDiagram', { '<-nodes': '$.data.nodes' }, { data: { nodes: NODES } });
        mounted.element.addEventListener('layout', (event) => layouts.push((event as CustomEvent).detail));
        await settle();
        const selects: string[] = [];
        mounted.element.addEventListener('select', (event) => selects.push((event as CustomEvent).detail.id));
        cardOf(mounted, 'orders').click();
        await settle();

        // Act
        (root(mounted).querySelector('.diagram') as HTMLElement).click();
        await settle();

        // Assert
        expect(layouts.length).toBeGreaterThan(0);
        expect(layouts.at(-1)).toEqual({ width: mounted.store.get('$.app.width'), height: mounted.store.get('$.app.height') });
        expect(layouts.at(-1)!.width).toBeGreaterThan(0);
        expect(selects).toEqual(['orders', '']);
        expect(mounted.store.get('$.app.selected')).toBe('');
    });
});
