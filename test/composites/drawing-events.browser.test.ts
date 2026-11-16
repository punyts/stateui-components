import { report } from '@punyts/core';
import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent, MountOptions, NodeState } from '../harness/createMountComponent.js';

const ROOT = '$.app.children';

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Waits until the drawing says it is drawn (`data-render="ready"`), at most 50 frames */
async function drawn(mounted: MountedComponent): Promise<void> {
    await Promise.resolve();
    for (let at = 0; at < 50; at += 1) {
        if (mounted.element.getAttribute('data-render') === 'ready') return;
        await frame();
    }
    throw new Error(`the drawing is still ${mounted.element.getAttribute('data-render')}`);
}

interface Mounted extends MountedComponent {
    /** The `press` and `hover` events the drawing raised, in order */
    readonly raised: { type: string; detail: { shape: string; key: string; x: number; y: number } }[];
    /** The names `emit` commands sent to the host */
    readonly emitted: string[];
}

async function mountDrawing(node: NodeState, options: MountOptions = {}): Promise<Mounted> {
    const emitted: string[] = [];
    const mounted = mountComponent('drawing', node, { data: { ui: { seat: '', hovered: '' } }, ...options, hooks: { onEmit: (name) => emitted.push(name) } });
    const raised: Mounted['raised'] = [];
    for (const type of ['press', 'hover']) {
        mounted.element.addEventListener(type, (event) => raised.push({ type, detail: (event as CustomEvent).detail }));
    }
    await drawn(mounted);
    // The pointer stays where the last test left it: park it on empty drawing space and forget what that raised
    await userEvent.hover(surfaceOf(mounted), { position: { x: 2, y: 2 } });
    raised.length = 0;
    emitted.length = 0;
    return Object.assign(mounted, { raised, emitted });
}

const shapeAt = (mounted: MountedComponent, path: string): SVGElement => {
    const found = mounted.element.shadowRoot?.querySelector<SVGElement>(`[data-shape-path="${ROOT}.${path}"]`);
    if (!found) throw new Error(`no element for ${path}`);
    return found;
};

const surfaceOf = (mounted: MountedComponent): HTMLElement => mounted.element.shadowRoot?.querySelector('.surface') as HTMLElement;

/** An `on` entry that records the seat and tells the host once per run */
const pressOn = (seat: string) => ({
    press: [
        { command: 'set', target: '$.data.ui.seat', value: seat },
        { command: 'emit', target: `pressed-${seat}` }
    ]
});

/** Two seats side by side: `a` interactive, `b` not; both have a press entry, and `a` a hover entry */
const seats = {
    viewBox: { x: 0, y: 0, width: 100, height: 50 },
    children: {
        a: {
            component: 'rect',
            x: 10,
            y: 10,
            width: 30,
            height: 30,
            fill: '#336699',
            interactive: true,
            _label: 'Seat A',
            on: { ...pressOn('a'), hover: { command: 'emit', target: 'hovered-a' } }
        },
        b: { component: 'rect', x: 60, y: 10, width: 30, height: 30, fill: '#993366', on: pressOn('b') }
    }
};

describe('drawing events with the SVG renderer in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
        vi.restoreAllMocks();
    });

    it('should make an interactive shape a named button in the tab order and leave a non-interactive one out of hits and tabs', async () => {
        // Act
        const mounted = await mountDrawing(seats);

        // Assert
        const a = shapeAt(mounted, 'a');
        const b = shapeAt(mounted, 'b');
        expect([a.getAttribute('role'), a.getAttribute('tabindex'), a.getAttribute('aria-label')]).toEqual(['button', '0', 'Seat A']);
        expect(getComputedStyle(a).pointerEvents).toBe('visiblepainted');
        expect([b.getAttribute('role'), b.getAttribute('tabindex'), b.getAttribute('aria-label')]).toEqual([null, null, null]);
        expect(getComputedStyle(b).pointerEvents).toBe('none');
        expect(mounted.element.shadowRoot?.querySelector('.drawing')?.getAttribute('role')).toBe('group');
    });

    it('should keep the img role for a drawing with no interactive shape', async () => {
        // Act
        const mounted = await mountDrawing({ children: { b: seats.children.b } });

        // Assert
        expect(mounted.element.shadowRoot?.querySelector('.drawing')?.getAttribute('role')).toBe('img');
    });

    it('should run the on entry of an interactive shape exactly once for a click, with the position in drawing units', async () => {
        // Arrange
        const mounted = await mountDrawing(seats);

        // Act
        await userEvent.click(shapeAt(mounted, 'a'));

        // Assert
        expect(mounted.store.get('$.data.ui.seat')).toBe('a');
        // The pointer entered the shape on its way to the click, so it hovered it first
        expect(mounted.emitted).toEqual(['hovered-a', 'pressed-a']);
        const presses = mounted.raised.filter((event) => event.type === 'press');
        expect(presses).toHaveLength(1);
        expect(presses[0]?.detail.shape).toBe(`${ROOT}.a`);
        expect(presses[0]?.detail.key).toBe('a');
        expect(presses[0]?.detail.x).toBeCloseTo(25, 0);
        expect(presses[0]?.detail.y).toBeCloseTo(25, 0);
    });

    it('should run nothing for a click on a non-interactive shape or on empty drawing space', async () => {
        // Arrange
        const mounted = await mountDrawing(seats);
        const surface = surfaceOf(mounted);
        const box = surface.getBoundingClientRect();

        // Act
        await userEvent.click(shapeAt(mounted, 'b'), { force: true });
        await userEvent.click(surface, { position: { x: 2, y: 2 } });
        await userEvent.click(surface, { position: { x: box.width - 2, y: box.height - 2 } });

        // Assert
        expect(mounted.store.get('$.data.ui.seat')).toBe('');
        expect(mounted.emitted).toEqual([]);
        expect(mounted.raised).toEqual([]);
    });

    it('should raise hover once when the pointer enters a shape, and again only after it left and came back', async () => {
        // Arrange
        const mounted = await mountDrawing(seats);
        const a = shapeAt(mounted, 'a');
        const surface = surfaceOf(mounted);

        // Act
        await userEvent.hover(a);
        await userEvent.hover(a, { position: { x: 2, y: 2 } });
        await userEvent.hover(a, { position: { x: 20, y: 20 } });
        const afterFirstEntry = mounted.emitted.length;
        await userEvent.hover(surface, { position: { x: 2, y: 2 } });
        await userEvent.hover(a);

        // Assert
        expect(afterFirstEntry).toBe(1);
        expect(mounted.emitted).toEqual(['hovered-a', 'hovered-a']);
        const hovers = mounted.raised.filter((event) => event.type === 'hover');
        expect(hovers.map((event) => event.detail.shape)).toEqual([`${ROOT}.a`, `${ROOT}.a`]);
        expect(hovers[0]?.detail.x).toBeGreaterThanOrEqual(10);
        expect(hovers[0]?.detail.x).toBeLessThanOrEqual(40);
    });

    it('should not raise hover for a non-interactive shape', async () => {
        // Arrange
        const mounted = await mountDrawing(seats);

        // Act
        await userEvent.hover(shapeAt(mounted, 'b'), { force: true });

        // Assert
        expect(mounted.raised).toEqual([]);
    });

    it('should press a focused shape with Enter and with Space, once each, at its centre', async () => {
        // Arrange
        const mounted = await mountDrawing(seats);
        const a = shapeAt(mounted, 'a');
        a.focus();

        // Act
        await userEvent.keyboard('{Enter}');
        await userEvent.keyboard('[Space]');

        // Assert
        expect(mounted.element.shadowRoot?.activeElement).toBe(a);
        expect(mounted.emitted).toEqual(['pressed-a', 'pressed-a']);
        expect(mounted.raised.map((event) => [event.type, event.detail.shape, event.detail.x, event.detail.y])).toEqual([
            ['press', `${ROOT}.a`, 25, 25],
            ['press', `${ROOT}.a`, 25, 25]
        ]);
    });

    it('should raise nothing for keys on a non-interactive shape, which cannot take focus', async () => {
        // Arrange
        const mounted = await mountDrawing(seats);
        const b = shapeAt(mounted, 'b');

        // Act
        b.focus();
        b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));

        // Assert
        expect(mounted.element.shadowRoot?.activeElement).not.toBe(b);
        expect(mounted.raised).toEqual([]);
        expect(mounted.emitted).toEqual([]);
    });

    it("should run the row template's entry for a pressed repeat copy with $row at its record", async () => {
        // Arrange
        const mounted = await mountDrawing(
            {
                viewBox: { x: 0, y: 0, width: 100, height: 50 },
                children: {
                    seats: {
                        component: 'drawRepeat',
                        '<-records': '$.data.seats',
                        row: {
                            component: 'rect',
                            width: 20,
                            height: 20,
                            '<-x': '$row.x',
                            '<-y': '$row.y',
                            interactive: true,
                            '<-_label': '$row.name',
                            on: { press: { command: 'set', target: '$.data.ui.seat', value: '$row.name' } }
                        }
                    }
                }
            },
            {
                data: {
                    ui: { seat: '', hovered: '' },
                    seats: [
                        { id: 's1', name: 'One', x: 10, y: 10 },
                        { id: 's2', name: 'Two', x: 60, y: 10 }
                    ]
                }
            }
        );
        const copy = shapeAt(mounted, 'seats.rows.s2');

        // Act
        await userEvent.click(copy);

        // Assert
        expect(copy.getAttribute('aria-label')).toBe('Two');
        expect(mounted.store.get('$.data.ui.seat')).toBe('Two');
        expect(mounted.raised.map((event) => [event.type, event.detail.shape, event.detail.key])).toEqual([['hover', `${ROOT}.seats.rows.s2`, 's2'], ['press', `${ROOT}.seats.rows.s2`, 's2']]);
    });

    it("should follow a children reorder (remove and re-add, as the live preview writes it) and keep each shape's entry", async () => {
        // Arrange
        const errors = vi.spyOn(report, 'error');
        const mounted = await mountDrawing({ ...seats, children: { a: seats.children.a, b: { ...seats.children.b, interactive: true, _label: 'Seat B' } } });
        const a = shapeAt(mounted, 'a');
        const node = mounted.store.get(`${ROOT}.a`);

        // Act
        mounted.store.delete(`${ROOT}.a` as never);
        mounted.store.set(`${ROOT}.a`, node as never);
        await drawn(mounted);
        await userEvent.click(shapeAt(mounted, 'a'));

        // Assert
        const svg = mounted.element.shadowRoot?.querySelector('.surface > svg');
        const order = Array.from(svg?.children ?? []).map((child) => child.getAttribute('data-shape-path')).filter((path) => path !== null);
        expect(order).toEqual([`${ROOT}.b`, `${ROOT}.a`]);
        expect(shapeAt(mounted, 'a')).toBe(a);
        expect(mounted.store.get('$.data.ui.seat')).toBe('a');
        expect(errors).not.toHaveBeenCalled();
    });
});

/** The canvas drawings are 200 by 100 CSS pixels with the seats' 100 by 50 `viewBox`, so a drawing unit is two pixels */
const SCALE = 2;

const canvasOf = (mounted: MountedComponent): HTMLCanvasElement => mounted.element.shadowRoot?.querySelector('.surface > canvas') as HTMLCanvasElement;

/** Mounts a drawing on the canvas renderer at 200 by 100 CSS pixels, waits until it is drawn and parks the pointer */
async function mountCanvasDrawing(node: NodeState, options: MountOptions = {}): Promise<Mounted> {
    const emitted: string[] = [];
    const mounted = mountComponent(
        'drawing',
        { renderer: 'canvas', ...node },
        { data: { ui: { seat: '', hovered: '' } }, ...options, hooks: { onEmit: (name) => emitted.push(name) } }
    );
    mounted.host.style.width = '200px';
    (mounted.element as HTMLElement).style.setProperty('--ui-drawing-height', '100px');
    const raised: Mounted['raised'] = [];
    for (const type of ['press', 'hover']) {
        mounted.element.addEventListener(type, (event) => raised.push({ type, detail: (event as CustomEvent).detail }));
    }
    await drawn(mounted);
    await userEvent.hover(canvasOf(mounted), { position: { x: 2, y: 2 } });
    raised.length = 0;
    emitted.length = 0;
    return Object.assign(mounted, { raised, emitted });
}

/** The proxy buttons of a canvas drawing, in document order */
const proxiesOf = (mounted: MountedComponent): HTMLButtonElement[] =>
    Array.from(mounted.element.shadowRoot?.querySelectorAll<HTMLButtonElement>('.surface button[data-shape-path]') ?? []);

const proxyOf = (mounted: MountedComponent, path: string): HTMLButtonElement => {
    const found = mounted.element.shadowRoot?.querySelector<HTMLButtonElement>(`button[data-shape-path="${ROOT}.${path}"]`);
    if (!found) throw new Error(`no proxy for ${path}`);
    return found;
};

/** A point of the canvas in CSS pixels from one in drawing units */
const at = (x: number, y: number): { position: { x: number; y: number } } => ({ position: { x: x * SCALE, y: y * SCALE } });

describe('drawing events with the canvas renderer in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
        vi.restoreAllMocks();
    });

    it('should give each interactive shape a named proxy button over its bounds, and none to a non-interactive one', async () => {
        // Act
        const mounted = await mountCanvasDrawing(seats);

        // Assert
        const proxies = proxiesOf(mounted);
        expect(proxies.map((proxy) => proxy.getAttribute('data-shape-path'))).toEqual([`${ROOT}.a`]);
        const a = proxies[0]!;
        expect([a.type, a.getAttribute('data-shape-kind'), a.getAttribute('aria-label'), a.tabIndex]).toEqual(['button', 'rect', 'Seat A', 0]);
        expect([getComputedStyle(a).opacity, getComputedStyle(a).pointerEvents]).toEqual(['0', 'none']);
        expect(mounted.element.shadowRoot?.querySelector('.drawing')?.getAttribute('role')).toBe('group');
        // The proxy's box is the shape's bounds (10, 10, 30 by 30 drawing units) within a pixel
        const canvas = canvasOf(mounted).getBoundingClientRect();
        const box = a.getBoundingClientRect();
        expect(Math.abs(box.left - canvas.left - 10 * SCALE)).toBeLessThanOrEqual(1);
        expect(Math.abs(box.top - canvas.top - 10 * SCALE)).toBeLessThanOrEqual(1);
        expect(Math.abs(box.width - 30 * SCALE)).toBeLessThanOrEqual(1);
        expect(Math.abs(box.height - 30 * SCALE)).toBeLessThanOrEqual(1);
    });

    it('should keep the img role and add no proxy for a drawing with no interactive shape', async () => {
        // Act
        const mounted = await mountCanvasDrawing({ viewBox: seats.viewBox, children: { b: seats.children.b } });

        // Assert
        expect(mounted.element.shadowRoot?.querySelector('.drawing')?.getAttribute('role')).toBe('img');
        expect(proxiesOf(mounted)).toEqual([]);
    });

    it('should run the on entry of an interactive shape exactly once for a pointer click, with the position in drawing units', async () => {
        // Arrange
        const mounted = await mountCanvasDrawing(seats);

        // Act
        await userEvent.click(canvasOf(mounted), at(20, 30));

        // Assert
        expect(mounted.store.get('$.data.ui.seat')).toBe('a');
        expect(mounted.emitted).toEqual(['hovered-a', 'pressed-a']);
        const presses = mounted.raised.filter((event) => event.type === 'press');
        expect(presses).toHaveLength(1);
        expect(presses[0]?.detail.shape).toBe(`${ROOT}.a`);
        expect(presses[0]?.detail.key).toBe('a');
        // The pointer lands on a whole pixel, so the position is within one drawing unit
        expect(Math.abs(presses[0]!.detail.x - 20)).toBeLessThanOrEqual(1);
        expect(Math.abs(presses[0]!.detail.y - 30)).toBeLessThanOrEqual(1);
    });

    it('should run nothing for a click on a non-interactive shape or on empty drawing space', async () => {
        // Arrange
        const mounted = await mountCanvasDrawing(seats);
        const canvas = canvasOf(mounted);

        // Act
        await userEvent.click(canvas, at(75, 25));
        await userEvent.click(canvas, at(1, 1));
        await userEvent.click(canvas, at(99, 49));

        // Assert
        expect(mounted.store.get('$.data.ui.seat')).toBe('');
        expect(mounted.emitted).toEqual([]);
        expect(mounted.raised).toEqual([]);
    });

    it('should pass a click through a non-interactive shape on top to the interactive shape below, as SVG does', async () => {
        // Arrange: a plain shape drawn over seat a
        const cover = { component: 'rect', x: 15, y: 15, width: 20, height: 20, fill: '#000000', on: pressOn('cover') };
        const mounted = await mountCanvasDrawing({ ...seats, children: { ...seats.children, cover } });

        // Act
        await userEvent.click(canvasOf(mounted), at(25, 25));

        // Assert
        expect(mounted.store.get('$.data.ui.seat')).toBe('a');
        expect(mounted.raised.filter((event) => event.type === 'press').map((event) => event.detail.shape)).toEqual([`${ROOT}.a`]);
    });

    it('should raise hover once when the pointer enters a shape, and again only after it left and came back', async () => {
        // Arrange
        const mounted = await mountCanvasDrawing(seats);
        const canvas = canvasOf(mounted);

        // Act
        await userEvent.hover(canvas, at(25, 25));
        await userEvent.hover(canvas, at(12, 12));
        await userEvent.hover(canvas, at(38, 30));
        const afterFirstEntry = mounted.emitted.length;
        await userEvent.hover(canvas, at(1, 1));
        await userEvent.hover(canvas, at(25, 25));

        // Assert
        expect(afterFirstEntry).toBe(1);
        expect(mounted.emitted).toEqual(['hovered-a', 'hovered-a']);
        const hovers = mounted.raised.filter((event) => event.type === 'hover');
        expect(hovers.map((event) => event.detail.shape)).toEqual([`${ROOT}.a`, `${ROOT}.a`]);
        expect(Math.abs(hovers[0]!.detail.x - 25)).toBeLessThanOrEqual(1);
        expect(Math.abs(hovers[0]!.detail.y - 25)).toBeLessThanOrEqual(1);
    });

    it('should not raise hover for a non-interactive shape', async () => {
        // Arrange
        const mounted = await mountCanvasDrawing(seats);

        // Act
        await userEvent.hover(canvasOf(mounted), at(75, 25));

        // Assert
        expect(mounted.raised).toEqual([]);
    });

    it('should press a focused proxy with Enter and with Space, once each, at the centre, and not repeat for a held key', async () => {
        // Arrange
        const mounted = await mountCanvasDrawing(seats);
        const a = proxyOf(mounted, 'a');
        a.focus();

        // Act
        await userEvent.keyboard('{Enter}');
        await userEvent.keyboard('[Space]');
        a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, composed: true, cancelable: true }));

        // Assert
        expect(mounted.element.shadowRoot?.activeElement).toBe(a);
        expect(mounted.emitted).toEqual(['pressed-a', 'pressed-a']);
        expect(mounted.raised.map((event) => [event.type, event.detail.shape, event.detail.x, event.detail.y])).toEqual([
            ['press', `${ROOT}.a`, 25, 25],
            ['press', `${ROOT}.a`, 25, 25]
        ]);
    });

    it('should press a shape once for an element-level click on its proxy, as ui_interact clicks it', async () => {
        // Arrange
        const mounted = await mountCanvasDrawing(seats);

        // Act
        proxyOf(mounted, 'a').click();

        // Assert
        expect(mounted.emitted).toEqual(['pressed-a']);
        expect(mounted.raised.map((event) => [event.type, event.detail.shape, event.detail.x, event.detail.y])).toEqual([['press', `${ROOT}.a`, 25, 25]]);
    });

    it('should make the proxies follow a state change: moved, added, removed and reordered with the shapes', async () => {
        // Arrange
        const errors = vi.spyOn(report, 'error');
        const mounted = await mountCanvasDrawing(seats);
        const a = proxyOf(mounted, 'a');

        // Act: move a, then add an interactive seat c
        mounted.store.set(`${ROOT}.a.x`, 50 as never);
        mounted.store.set(`${ROOT}.c`, { component: 'circle', cx: 80, cy: 25, r: 5, interactive: true, _label: 'Seat C' } as never);
        await drawn(mounted);
        const moved = a.getBoundingClientRect();
        const canvas = canvasOf(mounted).getBoundingClientRect();
        const added = proxiesOf(mounted).map((proxy) => [proxy.getAttribute('data-shape-path'), proxy.getAttribute('data-shape-kind'), proxy.getAttribute('aria-label')]);
        // Remove a and add it back (as the live preview writes a reorder): it is drawn after c now
        const node = mounted.store.get(`${ROOT}.a`);
        mounted.store.delete(`${ROOT}.a` as never);
        mounted.store.set(`${ROOT}.a`, node as never);
        await drawn(mounted);
        const reordered = proxiesOf(mounted);
        mounted.store.delete(`${ROOT}.c` as never);
        await drawn(mounted);

        // Assert
        expect(Math.abs(moved.left - canvas.left - 50 * SCALE)).toBeLessThanOrEqual(1);
        expect(added).toEqual([
            [`${ROOT}.a`, 'rect', 'Seat A'],
            [`${ROOT}.c`, 'circle', 'Seat C']
        ]);
        expect(reordered.map((proxy) => proxy.getAttribute('data-shape-path'))).toEqual([`${ROOT}.c`, `${ROOT}.a`]);
        expect(reordered[1]).toBe(a);
        expect(proxiesOf(mounted).map((proxy) => proxy.getAttribute('data-shape-path'))).toEqual([`${ROOT}.a`]);
        expect(errors).not.toHaveBeenCalled();
    });

    it('should drop the proxy of a shape that turns non-interactive or hidden, and press nothing there', async () => {
        // Arrange
        const mounted = await mountCanvasDrawing(seats);

        // Act
        mounted.store.set(`${ROOT}.a.interactive`, false as never);
        await drawn(mounted);
        await userEvent.click(canvasOf(mounted), at(25, 25));
        const afterOff = proxiesOf(mounted).length;
        mounted.store.set(`${ROOT}.a.interactive`, true as never);
        mounted.store.set(`${ROOT}.a.hidden`, true as never);
        await drawn(mounted);
        await userEvent.click(canvasOf(mounted), at(25, 25));

        // Assert
        expect(afterOff).toBe(0);
        expect(proxiesOf(mounted)).toEqual([]);
        expect(mounted.raised).toEqual([]);
        expect(mounted.store.get('$.data.ui.seat')).toBe('');
    });

    it("should give repeat copies proxies and run the row template's entry with $row at the record, by pointer and by proxy", async () => {
        // Arrange
        const mounted = await mountCanvasDrawing(
            {
                viewBox: { x: 0, y: 0, width: 100, height: 50 },
                children: {
                    seats: {
                        component: 'drawRepeat',
                        '<-records': '$.data.seats',
                        row: {
                            component: 'rect',
                            width: 20,
                            height: 20,
                            '<-x': '$row.x',
                            '<-y': '$row.y',
                            interactive: true,
                            '<-_label': '$row.name',
                            on: { press: { command: 'set', target: '$.data.ui.seat', value: '$row.name' } }
                        }
                    }
                }
            },
            {
                data: {
                    ui: { seat: '', hovered: '' },
                    seats: [
                        { id: 's1', name: 'One', x: 10, y: 10 },
                        { id: 's2', name: 'Two', x: 60, y: 10 }
                    ]
                }
            }
        );

        // Act
        await userEvent.click(canvasOf(mounted), at(70, 20));
        const byPointer = mounted.store.get('$.data.ui.seat');
        proxyOf(mounted, 'seats.rows.s1').click();

        // Assert
        expect(proxiesOf(mounted).map((proxy) => [proxy.getAttribute('data-shape-path'), proxy.getAttribute('aria-label')])).toEqual([
            [`${ROOT}.seats.rows.s1`, 'One'],
            [`${ROOT}.seats.rows.s2`, 'Two']
        ]);
        expect(byPointer).toBe('Two');
        expect(mounted.store.get('$.data.ui.seat')).toBe('One');
        expect(mounted.raised.map((event) => [event.type, event.detail.shape, event.detail.key])).toEqual([
            ['hover', `${ROOT}.seats.rows.s2`, 's2'],
            ['press', `${ROOT}.seats.rows.s2`, 's2'],
            ['press', `${ROOT}.seats.rows.s1`, 's1']
        ]);
    });
});
