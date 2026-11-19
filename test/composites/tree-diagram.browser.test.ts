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
const pathsOf = (mounted: MountedComponent): SVGPathElement[] => Array.from(root(mounted).querySelectorAll<SVGPathElement>('.edges path'));

const mountDiagram = async (extra: Record<string, unknown> = {}, nodes: unknown = NODES): Promise<MountedComponent> => {
    const mounted = mountComponent('treeDiagram', { '<-nodes': '$.data.nodes', noteField: 'note', ...extra }, { data: { nodes } });
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
        expect(cardOf(mounted, 'data').textContent).toContain('2 datasets');
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

    it('should select a card on a press, light its links, and let it go on a second press', async () => {
        // Arrange
        const mounted = await mountDiagram({ links: [{ from: 'orders', to: 'screens' }] });
        const selects: unknown[] = [];
        mounted.element.addEventListener('select', (event) => selects.push((event as CustomEvent).detail));
        const open = (): HTMLButtonElement => cardOf(mounted, 'orders').querySelector('.open') as HTMLButtonElement;

        // Act
        open().click();
        await settle();
        const lit = pathsOf(mounted).find((path) => path.classList.contains('link'))?.hasAttribute('data-lit');
        const chosen = cardOf(mounted, 'orders').hasAttribute('data-selected');
        open().click();
        await settle();

        // Assert
        expect(selects).toEqual([{ id: 'orders' }, { id: '' }]);
        expect(lit).toBe(true);
        expect(chosen).toBe(true);
        expect(mounted.store.get('$.app.selected')).toBe('');
        expect(cardOf(mounted, 'orders').hasAttribute('data-selected')).toBe(false);
    });

    it('should raise open on Enter and add from the + of an addable diagram', async () => {
        // Arrange
        const mounted = await mountDiagram({ addable: true });
        const raised: [string, unknown][] = [];
        for (const name of ['open', 'add']) mounted.element.addEventListener(name, (event) => raised.push([name, (event as CustomEvent).detail]));
        const card = cardOf(mounted, 'stock');

        // Act
        (card.querySelector('.open') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
        (card.querySelector('.add') as HTMLButtonElement).click();

        // Assert
        expect(raised).toEqual([['open', { id: 'stock' }], ['add', { id: 'stock' }]]);
        expect(card.querySelector('.add')?.getAttribute('aria-label')).toBe('Add to Stock');
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
});
