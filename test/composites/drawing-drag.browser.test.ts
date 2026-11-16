import { report } from '@punyts/core';
import { captureChanges } from '@punyts/state-sync';
import type { Capture, Change } from '@punyts/state-sync';
import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent, MountOptions, NodeState } from '../harness/createMountComponent.js';

const ROOT = '$.app.children';

/** The drawings are 200 by 100 CSS pixels with a 100 by 50 `viewBox`, so a drawing unit is two pixels */
const SCALE = 2;
const VIEW_BOX = { x: 0, y: 0, width: 100, height: 50 };

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

type Renderer = 'svg' | 'canvas';

interface Mounted extends MountedComponent {
    readonly renderer: Renderer;
    /** The `press` and `dragEnd` events the drawing raised, in order, each with the value of `watch` when it was raised */
    readonly raised: { type: string; detail: { shape: string; key: string; x: number; y: number }; seen: unknown }[];
    /** The changes a sync capture of the store sent (what a synced app posts to its host), flushed by `sent()` */
    readonly changes: Change[];
    /** Sends the changes the capture holds and gives every change sent so far */
    sent(): Change[];
}

let capture: Capture | undefined;

/**
 * Mounts a drawing at 200 by 100 CSS pixels on a renderer, waits until it is drawn, and starts a sync capture. `watch`
 * is a store path whose value is recorded with each event, to see that `dragEnd` comes after the write
 */
async function mountDrawing(renderer: Renderer, node: NodeState, options: MountOptions = {}, watch = `${ROOT}.a.x`): Promise<Mounted> {
    const mounted = mountComponent('drawing', { renderer, viewBox: VIEW_BOX, ...node }, { data: { ui: { ended: '' } }, ...options });
    mounted.host.style.width = '200px';
    (mounted.element as HTMLElement).style.setProperty('--ui-drawing-height', '100px');
    const raised: Mounted['raised'] = [];
    for (const type of ['press', 'dragEnd']) {
        mounted.element.addEventListener(type, (event) => raised.push({ type, detail: (event as CustomEvent).detail, seen: mounted.store.get(watch) }));
    }
    await drawn(mounted);
    const changes: Change[] = [];
    capture = captureChanges(mounted.store, { base: () => 0, onChanges: (batch) => changes.push(...batch) });
    const sent = (): Change[] => {
        capture?.flush();
        return changes;
    };
    return Object.assign(mounted, { renderer, raised, changes, sent });
}

const surfaceOf = (mounted: MountedComponent): HTMLElement => mounted.element.shadowRoot?.querySelector('.surface') as HTMLElement;

/** The element a pointer goes down on: the shape's own SVG element, or the canvas */
function pressTarget(mounted: Mounted, path: string): Element {
    const root = mounted.element.shadowRoot;
    const found = mounted.renderer === 'svg' ? root?.querySelector(`svg [data-shape-path="${ROOT}.${path}"]`) : root?.querySelector('.surface > canvas');
    if (!found) throw new Error(`no element for ${path}`);
    return found;
}

/** The element that takes the keys of a shape: its SVG element, or its proxy button on canvas */
function focusTarget(mounted: Mounted, path: string): HTMLElement {
    const found = mounted.element.shadowRoot?.querySelector<HTMLElement>(`[data-shape-path="${ROOT}.${path}"]`);
    if (!found) throw new Error(`no element for ${path}`);
    return found;
}

/** Dispatches a pointer event at a point in drawing units, as a captured pointer's events reach the shape */
function pointer(mounted: Mounted, type: string, target: Element, x: number, y: number): void {
    const box = surfaceOf(mounted).getBoundingClientRect();
    const init = { bubbles: true, composed: true, cancelable: true, clientX: box.left + x * SCALE, clientY: box.top + y * SCALE, pointerId: 7, button: 0, buttons: 1, pointerType: 'mouse', isPrimary: true };
    target.dispatchEvent(new PointerEvent(type, init));
}

/** The box of a shape on screen in drawing units: the SVG element's, or the canvas proxy's (placed when it is drawn) */
function boxOf(mounted: Mounted, path: string): { x: number; y: number } {
    const surface = surfaceOf(mounted).getBoundingClientRect();
    const box = focusTarget(mounted, path).getBoundingClientRect();
    return { x: Math.round((box.left - surface.left) / SCALE), y: Math.round((box.top - surface.top) / SCALE) };
}

/** A 20 by 10 seat at (10, 10) that drags on both axes, whose dragEnd entry records the shape it ended */
const seat = {
    component: 'rect',
    x: 10,
    y: 10,
    width: 20,
    height: 10,
    interactive: true,
    draggable: 'both',
    _label: 'Seat',
    on: { dragEnd: { command: 'set', target: '$.data.ui.ended', value: 'a' } }
};

/** The writes a capture sent below a path */
const writesBelow = (changes: readonly Change[], path: string): Change[] => changes.filter((change) => change.path === path || change.path.startsWith(`${path}.`));

for (const renderer of ['svg', 'canvas'] as const) {
    describe(`drawing drag with the ${renderer} renderer in Chromium`, () => {
        afterEach(() => {
            capture?.stop();
            capture = undefined;
            mountComponent.unmountAll();
            vi.restoreAllMocks();
        });

        it('should move the shape in the renderer during a pointer drag with no change sent, then write once per axis on release and raise dragEnd after it', async () => {
            // Arrange
            const mounted = await mountDrawing(renderer, { children: { a: seat } });
            const target = pressTarget(mounted, 'a');

            // Act: press at the seat's centre, move in three steps, release
            pointer(mounted, 'pointerdown', target, 20, 15);
            const moves: { x: number; y: number }[] = [];
            for (const [x, y] of [
                [30, 20],
                [40, 25],
                [50, 30]
            ] as const) {
                pointer(mounted, 'pointermove', target, x, y);
                await drawn(mounted);
                await frame();
                moves.push(boxOf(mounted, 'a'));
            }
            const duringDrag = [...mounted.sent()];
            const storedDuring = [mounted.store.get(`${ROOT}.a.x`), mounted.store.get(`${ROOT}.a.y`)];
            pointer(mounted, 'pointerup', target, 50, 30);
            target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, detail: 1 }));
            const afterRelease = writesBelow(mounted.sent(), '$.app').map((change) => [change.path, change.value]);
            await drawn(mounted);
            await frame();

            // Assert
            expect(duringDrag).toEqual([]);
            expect(storedDuring).toEqual([10, 10]);
            expect(moves).toEqual([
                { x: 20, y: 15 },
                { x: 30, y: 20 },
                { x: 40, y: 25 }
            ]);
            expect(afterRelease).toEqual([
                [`${ROOT}.a.x`, 40],
                [`${ROOT}.a.y`, 25]
            ]);
            expect(boxOf(mounted, 'a')).toEqual({ x: 40, y: 25 });
            // dragEnd is raised once, after the write (it saw the new x), and the click that ended the drag is no press
            expect(mounted.raised.map((event) => [event.type, event.detail.shape, event.detail.key, event.seen])).toEqual([['dragEnd', `${ROOT}.a`, 'a', 40]]);
            expect(Math.abs(mounted.raised[0]!.detail.x - 50)).toBeLessThanOrEqual(0.5);
            expect(Math.abs(mounted.raised[0]!.detail.y - 30)).toBeLessThanOrEqual(0.5);
            expect(mounted.store.get('$.data.ui.ended')).toBe('a');
        });

        it('should drag with a real pointer (captured), as a person drags', async () => {
            // Arrange
            const mounted = await mountDrawing(renderer, { children: { a: seat } });
            const target = pressTarget(mounted, 'a');
            const source = renderer === 'svg' ? { x: 20, y: 10 } : { x: 40, y: 30 };

            // Act: from the seat's centre (20, 15) to (70, 25): 50 units right and 10 down
            await userEvent.dragAndDrop(target, surfaceOf(mounted), { sourcePosition: source, targetPosition: { x: 70 * SCALE, y: 25 * SCALE } });
            await drawn(mounted);

            // Assert
            const x = mounted.store.get(`${ROOT}.a.x`) as number;
            const y = mounted.store.get(`${ROOT}.a.y`) as number;
            expect(Math.abs(x - 60)).toBeLessThanOrEqual(1);
            expect(Math.abs(y - 20)).toBeLessThanOrEqual(1);
            expect(writesBelow(mounted.sent(), '$.app')).toHaveLength(2);
            expect(mounted.raised.map((event) => event.type)).toEqual(['dragEnd']);
        });

        it('should write through a <-x and <-y link on the node to its target', async () => {
            // Arrange
            const { x: _x, y: _y, ...rest } = seat;
            const linked = { ...rest, '<-x': '$.data.pos.x', '<-y': '$.data.pos.y' };
            const mounted = await mountDrawing(renderer, { children: { a: linked } }, { data: { ui: { ended: '' }, pos: { x: 10, y: 10 } } }, '$.data.pos.x');
            const target = pressTarget(mounted, 'a');

            // Act
            pointer(mounted, 'pointerdown', target, 20, 15);
            pointer(mounted, 'pointermove', target, 35, 15);
            pointer(mounted, 'pointerup', target, 35, 15);
            await drawn(mounted);

            // Assert
            expect(mounted.store.get('$.data.pos')).toEqual({ x: 25, y: 10 });
            expect(mounted.raised.map((event) => [event.type, event.seen])).toEqual([['dragEnd', 25]]);
        });

        it('should write a dragged repeat copy to its record, and run the row entry with $row at it', async () => {
            // Arrange
            const repeat = {
                component: 'drawRepeat',
                '<-records': '$.data.seats',
                row: {
                    component: 'rect',
                    width: 10,
                    height: 10,
                    '<-x': '$row.x',
                    '<-y': '$row.y',
                    interactive: true,
                    draggable: 'both',
                    '<-_label': '$row.name',
                    on: { dragEnd: { command: 'set', target: '$.data.ui.ended', value: '$row.name' } }
                }
            };
            const seats = [
                { id: 's1', name: 'One', x: 10, y: 10 },
                { id: 's2', name: 'Two', x: 60, y: 10 }
            ];
            const mounted = await mountDrawing(renderer, { children: { seats: repeat } }, { data: { ui: { ended: '' }, seats } }, '$.data.seats.1.x');
            const target = pressTarget(mounted, 'seats.rows.s2');

            // Act
            pointer(mounted, 'pointerdown', target, 65, 15);
            pointer(mounted, 'pointermove', target, 75, 35);
            const during = [...mounted.sent()];
            pointer(mounted, 'pointerup', target, 75, 35);
            await drawn(mounted);
            await frame();

            // Assert
            expect(during).toEqual([]);
            expect(mounted.store.get('$.data.seats')).toEqual([seats[0], { id: 's2', name: 'Two', x: 70, y: 30 }]);
            expect(boxOf(mounted, 'seats.rows.s2')).toEqual({ x: 70, y: 30 });
            expect(mounted.raised.map((event) => [event.type, event.detail.shape, event.detail.key, event.seen])).toEqual([['dragEnd', `${ROOT}.seats.rows.s2`, 's2', 70]]);
            expect(mounted.store.get('$.data.ui.ended')).toBe('Two');
        });

        it('should not drag a repeat copy whose y is a literal, and report the repeat once as SUI-RUN-DRAW', async () => {
            // Arrange
            const errors = vi.spyOn(report, 'error');
            const repeat = {
                component: 'drawRepeat',
                '<-records': '$.data.seats',
                row: { component: 'rect', width: 10, height: 10, y: 5, '<-x': '$row.x', interactive: true, draggable: 'both' }
            };
            const mounted = await mountDrawing(renderer, { children: { seats: repeat } }, { data: { ui: { ended: '' }, seats: [{ id: 's1', x: 10 }] } });
            const target = pressTarget(mounted, 'seats.rows.s1');

            // Act
            pointer(mounted, 'pointerdown', target, 15, 10);
            pointer(mounted, 'pointermove', target, 40, 30);
            pointer(mounted, 'pointerup', target, 40, 30);
            mounted.store.set('$.data.seats.0.x', 12 as never);
            await drawn(mounted);

            // Assert
            expect(writesBelow(mounted.sent(), '$.app')).toEqual([]);
            expect(mounted.raised.filter((event) => event.type === 'dragEnd')).toEqual([]);
            const drawErrors = errors.mock.calls.filter(([, meta]) => (meta as { code?: string }).code === 'SUI-RUN-DRAW');
            expect(drawErrors).toHaveLength(1);
            expect(drawErrors[0]?.[0]).toContain(`${ROOT}.seats`);
            expect((drawErrors[0]?.[1] as { path?: string }).path).toBe(`${ROOT}.seats`);
        });

        it('should move a focused shape by step with the arrow keys (Shift for ten), each key written at once and followed by dragEnd', async () => {
            // Arrange
            const mounted = await mountDrawing(renderer, { children: { a: { ...seat, step: 2 } } });
            const element = focusTarget(mounted, 'a');
            element.focus();

            // Act
            await userEvent.keyboard('{ArrowRight}');
            const afterOne = writesBelow(mounted.sent(), '$.app').length;
            await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
            await userEvent.keyboard('{ArrowLeft}');
            await drawn(mounted);

            // Assert
            expect(afterOne).toBe(1);
            expect([mounted.store.get(`${ROOT}.a.x`), mounted.store.get(`${ROOT}.a.y`)]).toEqual([10, 30]);
            expect(writesBelow(mounted.sent(), '$.app').map((change) => [change.path, change.value])).toEqual([
                [`${ROOT}.a.x`, 12],
                [`${ROOT}.a.y`, 30],
                [`${ROOT}.a.x`, 10]
            ]);
            expect(mounted.raised.map((event) => [event.type, event.seen])).toEqual([
                ['dragEnd', 12],
                ['dragEnd', 12],
                ['dragEnd', 10]
            ]);
            expect(mounted.element.shadowRoot?.activeElement).toBe(element);
        });

        it('should keep the arrow keys off a shape that does not drag on that axis', async () => {
            // Arrange
            const mounted = await mountDrawing(renderer, { children: { a: { ...seat, draggable: 'x' } } });
            focusTarget(mounted, 'a').focus();

            // Act
            await userEvent.keyboard('{ArrowUp}');
            await userEvent.keyboard('{ArrowRight}');

            // Assert
            expect(writesBelow(mounted.sent(), '$.app').map((change) => change.path)).toEqual([`${ROOT}.a.x`]);
        });

        it('should write nothing and put the shape back when Escape cancels a drag, and not press on the release', async () => {
            // Arrange
            const mounted = await mountDrawing(renderer, { children: { a: seat } });
            const target = pressTarget(mounted, 'a');

            // Act
            pointer(mounted, 'pointerdown', target, 20, 15);
            pointer(mounted, 'pointermove', target, 50, 30);
            await drawn(mounted);
            await frame();
            const moved = boxOf(mounted, 'a');
            await userEvent.keyboard('{Escape}');
            await drawn(mounted);
            await frame();
            const back = boxOf(mounted, 'a');
            pointer(mounted, 'pointermove', target, 60, 40);
            pointer(mounted, 'pointerup', target, 60, 40);
            target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, detail: 1 }));
            await drawn(mounted);

            // Assert
            expect(moved).toEqual({ x: 40, y: 25 });
            expect(back).toEqual({ x: 10, y: 10 });
            expect(mounted.sent()).toEqual([]);
            expect(mounted.raised).toEqual([]);
            expect([mounted.store.get(`${ROOT}.a.x`), mounted.store.get(`${ROOT}.a.y`)]).toEqual([10, 10]);
        });

        it('should write nothing and put the shape back on a pointer cancel', async () => {
            // Arrange
            const mounted = await mountDrawing(renderer, { children: { a: seat } });
            const target = pressTarget(mounted, 'a');

            // Act
            pointer(mounted, 'pointerdown', target, 20, 15);
            pointer(mounted, 'pointermove', target, 50, 30);
            pointer(mounted, 'pointercancel', target, 50, 30);
            await drawn(mounted);
            await frame();

            // Assert
            expect(boxOf(mounted, 'a')).toEqual({ x: 10, y: 10 });
            expect(mounted.sent()).toEqual([]);
            expect(mounted.raised).toEqual([]);
        });

        it('should keep the shape inside its bounds, for the pointer and for the keys', async () => {
            // Arrange
            const bounded = { ...seat, bounds: { x: 0, y: 0, width: 60, height: 40 } };
            const mounted = await mountDrawing(renderer, { children: { a: bounded } });
            const target = pressTarget(mounted, 'a');

            // Act: far beyond the bottom right, then Shift+Right at the edge
            pointer(mounted, 'pointerdown', target, 20, 15);
            pointer(mounted, 'pointermove', target, 95, 48);
            pointer(mounted, 'pointerup', target, 95, 48);
            await drawn(mounted);
            const dropped = [mounted.store.get(`${ROOT}.a.x`), mounted.store.get(`${ROOT}.a.y`)];
            focusTarget(mounted, 'a').focus();
            await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');

            // Assert: the seat is 20 by 10, so it stops at x 40 and y 30
            expect(dropped).toEqual([40, 30]);
            expect(mounted.store.get(`${ROOT}.a.x`)).toBe(40);
        });

        it('should still press a draggable shape that is clicked without moving, and write nothing', async () => {
            // Arrange
            const pressable = { ...seat, on: { press: { command: 'set', target: '$.data.ui.ended', value: 'pressed' } } };
            const mounted = await mountDrawing(renderer, { children: { a: pressable } });

            // Act
            await userEvent.click(renderer === 'svg' ? pressTarget(mounted, 'a') : surfaceOf(mounted), renderer === 'svg' ? {} : { position: { x: 20 * SCALE, y: 15 * SCALE } });

            // Assert
            expect(mounted.store.get('$.data.ui.ended')).toBe('pressed');
            expect(writesBelow(mounted.sent(), '$.app')).toEqual([]);
            expect(mounted.raised.map((event) => event.type)).toEqual(['press']);
        });
    });
}
