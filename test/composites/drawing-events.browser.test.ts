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
