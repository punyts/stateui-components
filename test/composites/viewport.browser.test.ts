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

interface Commands {
    commands: Record<string, (value?: unknown, payload?: unknown) => void>;
}

/** A content of a known size: a card 400 by 300 pixels wide */
const CONTENT = { component: 'card', padding: 'none', children: { body: { component: 'text', _text: 'Content' } } };

const root = (mounted: MountedComponent): ShadowRoot => mounted.element.shadowRoot as ShadowRoot;
const surface = (mounted: MountedComponent): HTMLElement => root(mounted).querySelector('.viewport') as HTMLElement;
const viewOf = (mounted: MountedComponent): [unknown, unknown, unknown] => [mounted.store.get('$.app.x'), mounted.store.get('$.app.y'), mounted.store.get('$.app.zoom')];
const commands = (mounted: MountedComponent): Commands['commands'] => (mounted.element as unknown as Commands).commands;

const mountViewport = async (extra: Record<string, unknown> = {}): Promise<MountedComponent> => {
    const mounted = mountComponent('viewport', { content: CONTENT, '<-x': '$.data.view.x', '<-y': '$.data.view.y', '<-zoom': '$.data.view.zoom', ...extra }, { data: { view: { x: 0, y: 0, zoom: 1 } } });
    (mounted.element as HTMLElement).style.width = '800px';
    (mounted.element as HTMLElement).style.height = '600px';
    const world = root(mounted).querySelector('.world') as HTMLElement;
    world.style.width = '400px';
    world.style.height = '300px';
    await settle();
    return mounted;
};

const pointer = (target: HTMLElement, type: string, x: number, y: number, pointerId = 1): void => {
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new PointerEvent(type, { clientX: rect.left + x, clientY: rect.top + y, pointerId, pointerType: 'touch', button: 0, bubbles: true, composed: true }));
};

describe('viewport in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should move the content by the view in state, and keep the view a link writes', async () => {
        // Arrange
        const mounted = await mountViewport();

        // Act
        mounted.store.set('$.data.view.x', 30);
        mounted.store.set('$.data.view.zoom', 2);
        await settle();

        // Assert
        const transform = getComputedStyle(root(mounted).querySelector('.world') as HTMLElement).transform;
        expect(transform).toBe('matrix(2, 0, 0, 2, 30, 0)');
    });

    it('should pan by a drag past the slop, write the view, raise change once, and keep the click that ends it from the content', async () => {
        // Arrange
        const mounted = await mountViewport();
        const changes: unknown[] = [];
        mounted.element.addEventListener('change', (event) => changes.push((event as CustomEvent).detail));
        let clicks = 0;
        root(mounted).querySelector('.world')?.addEventListener('click', () => clicks++);
        const area = surface(mounted);

        // Act
        pointer(area, 'pointerdown', 100, 100);
        pointer(area, 'pointermove', 102, 101);
        pointer(area, 'pointermove', 150, 130);
        pointer(area, 'pointerup', 150, 130);
        (root(mounted).querySelector('.world') as HTMLElement).click();
        await settle();

        // Assert
        expect(viewOf(mounted)).toEqual([50, 30, 1]);
        expect(mounted.store.get('$.data.view')).toEqual({ x: 50, y: 30, zoom: 1 });
        expect(changes).toEqual([{ x: 50, y: 30, zoom: 1 }]);
        expect(clicks).toBe(0);
    });

    it('should zoom around the pointer with Ctrl and the wheel, and pan with the wheel alone', async () => {
        // Arrange
        const mounted = await mountViewport();
        const area = surface(mounted);
        const rect = area.getBoundingClientRect();

        // Act
        area.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, deltaX: 10, clientX: rect.left + 10, clientY: rect.top + 10, bubbles: true, cancelable: true }));
        await settle();
        const panned = viewOf(mounted);
        area.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, ctrlKey: true, clientX: rect.left + 200, clientY: rect.top + 100, bubbles: true, cancelable: true }));
        await settle();

        // Assert
        expect(panned).toEqual([-10, -40, 1]);
        const [x, y, zoom] = viewOf(mounted) as number[];
        expect(zoom).toBeCloseTo(Math.E, 3);
        // The point under the pointer stays: (200 - x) / zoom is the content point it was over, (200 - -10) / 1
        expect((200 - (x as number)) / (zoom as number)).toBeCloseTo(210, 1);
        expect((100 - (y as number)) / (zoom as number)).toBeCloseTo(140, 1);
    });

    it('should fit the content into the area the inset leaves free, at most at zoom 1', async () => {
        // Arrange
        const mounted = await mountViewport({ inset: { right: 400 } });

        // Act
        commands(mounted).fit(0);
        await settle();

        // Assert
        expect(viewOf(mounted)).toEqual([0, 150, 1]);
    });

    it('should zoom in and out around the middle and clamp to the limits', async () => {
        // Arrange
        const mounted = await mountViewport({ maxZoom: 1.5 });

        // Act
        commands(mounted).zoomIn();
        const first = viewOf(mounted);
        commands(mounted).zoomIn();
        const capped = viewOf(mounted)[2];
        commands(mounted).zoomReset();

        // Assert
        expect(first).toEqual([-100, -75, 1.25]);
        expect(capped).toBe(1.5);
        expect(viewOf(mounted)).toEqual([0, 0, 1]);
    });

    it('should bring a box of the content into view from an event payload, moving as little as it can', async () => {
        // Arrange
        const mounted = await mountViewport();

        // Act
        commands(mounted).lookAt(undefined, { id: 'a', box: { x: 900, y: 100, width: 100, height: 40 } });
        const moved = viewOf(mounted);
        commands(mounted).lookAt({ x: 500, y: 100, width: 100, height: 40 });

        // Assert
        expect(moved).toEqual([-224, 0, 1]);
        expect(viewOf(mounted)).toEqual([-224, 0, 1]);
    });

    it('should pan with the arrows and zoom with + while it has the focus', async () => {
        // Arrange
        const mounted = await mountViewport();
        const area = surface(mounted);
        area.focus();

        // Act
        area.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true }));
        area.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }));
        const panned = viewOf(mounted);
        area.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true, composed: true }));

        // Assert
        expect(panned).toEqual([-40, -40, 1]);
        expect(viewOf(mounted)[2]).toBe(1.25);
    });
    it('should bring a treeDiagram card into view when its select runs lookAt on the viewport through $parent', async () => {
        // Arrange
        const nodes = { app: { label: 'Shop' }, data: { label: 'Data', parent: 'app' }, orders: { label: 'Orders', parent: 'data' }, stock: { label: 'Stock', parent: 'orders' } };
        const diagram = { component: 'treeDiagram', '<-nodes': '$.data.nodes', on: { select: { command: 'lookAt', target: '$parent' } } };
        const mounted = mountComponent('viewport', { content: diagram }, { data: { nodes } });
        (mounted.element as HTMLElement).style.width = '200px';
        (mounted.element as HTMLElement).style.height = '300px';
        await settle();
        const diagramRoot = (root(mounted).querySelector('ui-tree-diagram') as HTMLElement).shadowRoot as ShadowRoot;
        const stock = diagramRoot.querySelector('.card[data-id="stock"]') as HTMLElement;

        // Act
        stock.click();
        await settle();

        // Assert
        const area = surface(mounted).getBoundingClientRect();
        const card = stock.getBoundingClientRect();
        expect(mounted.store.get('$.app.x')).toBeLessThan(0);
        expect(card.right).toBeLessThanOrEqual(area.right - 23);
        expect(card.left).toBeGreaterThanOrEqual(area.left);
    });

    it('should scale the grid’s dots with the zoom, and thin them out when zoomed far out', async () => {
        // Arrange
        const mounted = await mountViewport({ grid: true });
        const spacing = (): number => parseFloat(getComputedStyle(surface(mounted)).backgroundSize);
        const radius = (): number => parseFloat(/\)\s+([\d.]+)px/.exec(getComputedStyle(surface(mounted)).backgroundImage)?.[1] ?? 'NaN');
        const atOne = { spacing: spacing(), radius: radius() };

        // Act
        mounted.store.set('$.data.view.zoom', 2);
        await settle();
        const atTwo = { spacing: spacing(), radius: radius() };
        mounted.store.set('$.data.view.zoom', 0.25);
        await settle();
        const atQuarter = spacing();

        // Assert
        expect(atTwo.spacing).toBeCloseTo(atOne.spacing * 2, 1);
        expect(atTwo.radius).toBeGreaterThan(atOne.radius);
        expect(atQuarter).toBeCloseTo(atOne.spacing, 1);
    });

    it('should select no text and start no native drag while a drag pans', async () => {
        // Arrange
        const mounted = await mountViewport();
        const drag = new DragEvent('dragstart', { bubbles: true, composed: true, cancelable: true });
        const text = root(mounted).querySelector('.world') as HTMLElement;

        // Act
        text.dispatchEvent(drag);

        // Assert
        expect(getComputedStyle(surface(mounted)).userSelect).toBe('none');
        expect(drag.defaultPrevented).toBe(true);
    });

    it('should raise press for a press on the empty area that does not pan, and not for one on the content', async () => {
        // Arrange
        const mounted = await mountViewport();
        let presses = 0;
        mounted.element.addEventListener('press', () => presses++);
        const area = surface(mounted);
        const content = root(mounted).querySelector('sui-node') as HTMLElement;

        // Act
        pointer(area, 'pointerdown', 700, 500);
        pointer(area, 'pointerup', 700, 500);
        content.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, pointerId: 2, pointerType: 'touch', bubbles: true, composed: true }));
        content.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 10, pointerId: 2, pointerType: 'touch', bubbles: true, composed: true }));
        pointer(area, 'pointerdown', 700, 500, 3);
        pointer(area, 'pointermove', 600, 400, 3);
        pointer(area, 'pointerup', 600, 400, 3);
        await settle();

        // Assert
        expect(presses).toBe(1);
    });
});
