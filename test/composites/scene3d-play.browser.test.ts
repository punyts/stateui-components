import { report } from '@punyts/core';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent, NodeState } from '../harness/createMountComponent.js';
import { isScene3dChunk } from '../../src/shared/scene3d/load.js';
import type { Scene3dChunk } from '../../src/shared/scene3d/load.js';

/** The built chunk of `../stateui-3d` (test/globalSetup.ts); empty when the workspace has not built it */
const script = inject('chunk3dScript');
const ROOT = '$.app.children';

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Waits a frame at a time until `done` is true, at most `frames` frames */
async function until(done: () => boolean, frames = 300): Promise<void> {
    for (let at = 0; at < frames && !done(); at += 1) await frame();
    if (!done()) throw new Error('it did not happen in time');
}

/** Answers `ui-load-3d` with the real chunk's global, as the runtime's `load3d` hook does */
function answerWith(chunk: unknown): () => void {
    const listener = (event: Event): void => {
        (event as CustomEvent<{ respond: (result: Promise<unknown>) => void }>).detail.respond(Promise.resolve(chunk));
    };
    document.addEventListener('ui-load-3d', listener);
    return () => document.removeEventListener('ui-load-3d', listener);
}

interface Contact {
    shape: string;
    key: string;
    with: string;
    side: string;
    repeat?: string;
}

/** Mounts a scene, records its contacts, and waits until it is drawn */
async function mountScene(node: NodeState, data: Record<string, unknown> = { game: { score: 0 } }): Promise<MountedComponent & { contacts: Contact[] }> {
    const mounted = mountComponent('scene3d', node, { data });
    const contacts: Contact[] = [];
    mounted.element.addEventListener('contact', (event) => contacts.push((event as CustomEvent<Contact>).detail));
    await Promise.resolve();
    await until(() => mounted.element.getAttribute('data-render') === 'ready' && mounted.element.shadowRoot?.querySelector('canvas') !== null, 200);
    return Object.assign(mounted, { contacts });
}

const boxOf = (mounted: MountedComponent): HTMLElement => mounted.element.shadowRoot?.querySelector('.scene') as HTMLElement;

const key = (target: EventTarget, type: 'keydown' | 'keyup', name: string): KeyboardEvent => {
    const event = new KeyboardEvent(type, { key: name, bubbles: true, cancelable: true, composed: true });
    target.dispatchEvent(event);
    return event;
};

const eye = { component: 'camera', position: [0, 2, 10], target: [0, 0, 0] };
const floor = { component: 'mesh', position: [0, -0.5, 0], geometry: { kind: 'box', width: 10, height: 1, depth: 10 }, body: { solid: true } };

/** A scene with a floor and the given bodies, running unless `running` is false */
const game = (bodies: Record<string, unknown>, running = true): NodeState => ({
    _title: 'Game',
    background: '#000000',
    environment: 'none',
    play: { running },
    children: { eye, floor, ...bodies }
});

/** The writes of the store to paths that start with `prefix` */
const writesTo = (set: { mock: { calls: unknown[][] } }, prefix: string): unknown[][] => set.mock.calls.filter(([path]) => String(path).startsWith(prefix));

describe.skipIf(script === '')('scene3d play with the real 3D renderer chunk in Chromium (docs/design/stateui-game-loop.md)', () => {
    let chunk: Scene3dChunk;
    let remove: (() => void) | undefined;

    beforeAll(() => {
        if (isScene3dChunk((globalThis as Record<string, unknown>).__stateui3d)) {
            chunk = (globalThis as Record<string, unknown>).__stateui3d as Scene3dChunk;
            return;
        }
        const element = document.createElement('script');
        element.textContent = script;
        document.head.append(element);
        const global = (globalThis as Record<string, unknown>).__stateui3d;
        if (!isScene3dChunk(global)) throw new Error('The chunk set no __stateui3d');
        chunk = global;
    });

    afterEach(() => {
        remove?.();
        remove = undefined;
        mountComponent.unmountAll();
        vi.restoreAllMocks();
    });

    it('should drop a falling body onto the floor, write it once where it landed, and raise contact on both for the on entry', async () => {
        // Arrange
        remove = answerWith(chunk);
        const ball = {
            component: 'mesh',
            position: [0, 2, 0],
            geometry: { kind: 'sphere', radius: 0.5 },
            body: { solid: true, falls: true },
            on: { contact: { command: 'set', target: '$.data.game.score', value: 1 } }
        };
        const mounted = await mountScene(game({ ball }));
        const set = vi.spyOn(mounted.store, 'set');

        // Act
        await until(() => mounted.contacts.length === 2);
        await frame();

        // Assert
        expect(mounted.contacts).toEqual([
            { shape: `${ROOT}.ball`, key: 'ball', with: 'floor', side: 'bottom' },
            { shape: `${ROOT}.floor`, key: 'floor', with: 'ball', side: 'top' }
        ]);
        const position = mounted.store.get<number[]>(`${ROOT}.ball.position`) as number[];
        expect(position[1]).toBeCloseTo(0.5, 5);
        expect(mounted.store.get(`${ROOT}.ball.velocity`)).toEqual([0, 0, 0]);
        expect(writesTo(set, `${ROOT}.ball.position`)).toHaveLength(1);
        expect(mounted.store.get('$.data.game.score')).toBe(1);
        expect(mounted.store.get('$.raised.app.children.ball.contact')).toEqual({ key: 'ball', with: 'floor', side: 'bottom' });
    });

    it('should move a body while its control key is held, write it once when it rests, mark the scene moving meanwhile, and take the key without raising key', async () => {
        // Arrange
        remove = answerWith(chunk);
        const paddle = { component: 'mesh', position: [0, 0.5, 0], geometry: { kind: 'box' }, body: { solid: true, control: { ArrowRight: [4, 0, 0] } } };
        const mounted = await mountScene(game({ paddle }));
        const keyed: string[] = [];
        mounted.element.addEventListener('key', (event) => keyed.push((event as CustomEvent<{ key: string }>).detail.key));
        const set = vi.spyOn(mounted.store, 'set');
        const box = boxOf(mounted);
        box.focus();

        // Act
        const down = key(box, 'keydown', 'ArrowRight');
        for (let at = 0; at < 20; at += 1) await frame();
        const during = writesTo(set, `${ROOT}.paddle.position`).length;
        const marked = mounted.element.getAttribute('data-play');
        key(box, 'keyup', 'ArrowRight');
        await until(() => writesTo(set, `${ROOT}.paddle.position`).length > 0);

        // Assert
        expect(box.getAttribute('aria-keyshortcuts')).toBe('ArrowRight');
        expect(down.defaultPrevented).toBe(true);
        expect(keyed).toEqual([]);
        expect(during).toBe(0);
        expect((mounted.store.get<number[]>(`${ROOT}.paddle.position`) as number[])[0]).toBeGreaterThan(0.5);
        expect(writesTo(set, `${ROOT}.paddle.position`)).toHaveLength(1);
        expect(mounted.contacts).toEqual([]);
        expect(marked).toBe('moving');
        expect(mounted.element.hasAttribute('data-play')).toBe(false);
    });

    it('should take a velocity logic sets while the game runs, and write every body where it is when the game stops', async () => {
        // Arrange
        remove = answerWith(chunk);
        const puck = { component: 'mesh', position: [0, 0.5, 0], geometry: { kind: 'box', width: 0.5, height: 0.5, depth: 0.5 }, body: {} };
        const mounted = await mountScene(game({ puck }));

        // Act
        mounted.store.set(`${ROOT}.puck.velocity`, [2, 0, 0]);
        for (let at = 0; at < 15; at += 1) await frame();
        const moving = [...(mounted.store.get<number[]>(`${ROOT}.puck.position`) as number[])];
        mounted.store.set('$.app.play.running', false);
        await frame();

        // Assert
        expect(moving).toEqual([0, 0.5, 0]);
        const stopped = mounted.store.get<number[]>(`${ROOT}.puck.position`) as number[];
        expect(stopped[0]).toBeGreaterThan(0);
        expect(mounted.store.get(`${ROOT}.puck.velocity`)).toEqual([2, 0, 0]);
    });

    it('should drop repeat3d copies onto the floor, write each record where it landed, name the repeat in the contacts of the floor, and run the contact entry of the row with $row', async () => {
        // Arrange
        remove = answerWith(chunk);
        const row = {
            component: 'mesh',
            geometry: { kind: 'sphere', radius: 0.5 },
            '<-position': '$row.at',
            '<-velocity': '$row.speed',
            body: { solid: true, falls: true },
            on: { contact: { command: 'set', target: '$.data.ui.last', value: '$row.name' } }
        };
        const fruit = [
            { id: 'apple', at: [-1, 2, 0], speed: [0, 0, 0], name: 'Apple' },
            { id: 'pear', at: [1, 3, 0], speed: [0, 0, 0], name: 'Pear' }
        ];
        const mounted = await mountScene(game({ fruit: { component: 'repeat3d', '<-records': '$.data.fruit', row } }), { fruit, ui: { last: '' } });
        const set = vi.spyOn(mounted.store, 'set');

        // Act
        await until(() => mounted.contacts.length === 4);
        await frame();

        // Assert
        expect(mounted.contacts.filter((contact) => contact.key === 'floor')).toEqual([
            { shape: `${ROOT}.floor`, key: 'floor', with: 'apple', repeat: 'fruit', side: 'top' },
            { shape: `${ROOT}.floor`, key: 'floor', with: 'pear', repeat: 'fruit', side: 'top' }
        ]);
        expect(mounted.contacts.filter((contact) => contact.key !== 'floor').map((contact) => [contact.shape, contact.with, contact.side])).toEqual([
            [`${ROOT}.fruit.rows.apple`, 'floor', 'bottom'],
            [`${ROOT}.fruit.rows.pear`, 'floor', 'bottom']
        ]);
        for (const index of [0, 1]) {
            expect((mounted.store.get<number[]>(`$.data.fruit.${index}.at`) as number[])[1]).toBeCloseTo(0.5, 5);
            expect([...(mounted.store.get<number[]>(`$.data.fruit.${index}.speed`) as number[])]).toEqual([0, 0, 0]);
        }
        expect(mounted.store.get('$.data.ui.last')).toBe('Pear');
        expect(set.mock.calls.filter(([path]) => String(path).includes('.rows.'))).toEqual([]);
    });

    it('should move nothing while the game does not run, and report a control key that is not a scene key', async () => {
        // Arrange
        remove = answerWith(chunk);
        const errors = vi.spyOn(report, 'error');
        const ball = { component: 'mesh', position: [0, 2, 0], body: { solid: true, falls: true, control: { Shift: [1, 0, 0] } } };
        const mounted = await mountScene(game({ ball }, false));

        // Act
        for (let at = 0; at < 10; at += 1) await frame();
        const still = [...(mounted.store.get<number[]>(`${ROOT}.ball.position`) as number[])];
        mounted.store.set('$.app.play.running', true);
        await frame();

        // Assert
        expect(still).toEqual([0, 2, 0]);
        expect(errors.mock.calls.filter(([message]) => String(message).includes('"Shift"'))).toHaveLength(1);
        expect(errors.mock.calls.find(([message]) => String(message).includes('"Shift"'))?.[1]).toMatchObject({ code: 'SUI-RUN-3D', path: `${ROOT}.ball` });
    });
});
