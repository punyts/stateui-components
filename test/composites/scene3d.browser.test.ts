import { report } from '@punyts/core';
import { FileTransferError } from '@punyts/stateui-app';
import type { ReadFile } from '@punyts/stateui-app';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const host = (element: Element): HTMLElement => element.shadowRoot?.querySelector('.scene') as HTMLElement;
const fallback = (element: Element): HTMLElement => element.shadowRoot?.querySelector('.fallback') as HTMLElement;
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A fake of the renderer's createScene3d that draws nothing (the drawing is tested in scene3d-draw.browser.test.ts) */
function fakeScene(): { create: () => unknown } {
    return { create: () => ({ update: () => undefined, drawn: () => Promise.resolve(), dispose: () => undefined }) };
}

/** Answers `ui-load-3d` on the document with a fake chunk (the dispatcher's `load3d` hook is G3.3) until removed */
function fakeChunk(answer: () => Promise<unknown>): () => void {
    const listener = (event: Event): void => {
        (event as CustomEvent<{ respond: (result: Promise<unknown>) => void }>).detail.respond(answer());
    };
    document.addEventListener('ui-load-3d', listener);
    return () => document.removeEventListener('ui-load-3d', listener);
}

describe('scene3d view and controller skeleton (G3.4) in Chromium', () => {
    let remove: (() => void) | undefined;

    afterEach(() => {
        remove?.();
        remove = undefined;
        mountComponent.unmountAll();
        vi.restoreAllMocks();
    });

    it('should be an image named by its title, described only when it has a description', async () => {
        // Arrange
        const mounted = mountComponent('scene3d', { _title: 'Chair' });
        const title = (): string | null | undefined => mounted.element.shadowRoot?.getElementById(host(mounted.element).getAttribute('aria-labelledby') ?? '')?.textContent;
        await settle();
        const before = host(mounted.element).getAttribute('aria-describedby');

        // Act
        mounted.store.set('$.app._description', 'A wooden chair, turned to the left');

        // Assert
        expect(host(mounted.element).getAttribute('role')).toBe('img');
        expect(title()).toBe('Chair');
        expect(before).toBeNull();
        expect(host(mounted.element).getAttribute('aria-describedby')).toBe('description');
    });

    it('should show _fallback and be ready when no host answers ui-load-3d', async () => {
        // Arrange
        const mounted = mountComponent('scene3d', { _fallback: 'No 3D here' });
        const pending = mounted.element.getAttribute('data-render');

        // Act
        await settle();

        // Assert
        expect(pending).toBe('pending');
        expect(mounted.element.getAttribute('data-render')).toBe('ready');
        expect(mounted.element.hasAttribute('data-fallback')).toBe(true);
        expect(fallback(mounted.element).textContent).toBe('No 3D here');
        expect(getComputedStyle(fallback(mounted.element)).display).not.toBe('none');
    });

    it('should show _fallback when the chunk fails to load', async () => {
        // Arrange
        remove = fakeChunk(() => Promise.reject(new Error('404')));

        // Act
        const mounted = mountComponent('scene3d');
        await settle();

        // Assert
        expect(mounted.element.hasAttribute('data-fallback')).toBe(true);
        expect(mounted.element.getAttribute('data-render')).toBe('ready');
    });

    it.each([
        ['no host answers', undefined, 'no_chunk'],
        ['the chunk is missing', () => Promise.reject(Object.assign(new Error('404'), { code: 'load_failed' })), 'load_failed'],
        ['the chunk script fails', () => Promise.reject(Object.assign(new Error('boom'), { code: 'script_error' })), 'script_error'],
        ['the chunk times out', () => Promise.reject(Object.assign(new Error('late'), { code: 'timeout' })), 'timeout'],
        ['the global is not the renderer', () => Promise.resolve({}), 'script_error']
    ] as const)('should report one SUI-RUN-3D with the scene path when %s (G3.3)', async (_, answer, reason) => {
        // Arrange
        const spy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        if (answer) remove = fakeChunk(answer);

        // Act
        const mounted = mountComponent('scene3d', { _fallback: 'No 3D here' });
        await settle();

        // Assert
        const calls = spy.mock.calls.filter((call) => (call[1] as { code?: string } | undefined)?.code === 'SUI-RUN-3D');
        expect(calls).toHaveLength(1);
        expect(calls[0]?.[1]).toEqual({ code: 'SUI-RUN-3D', path: '$.app' });
        expect(calls[0]?.[0]).toContain(reason);
        expect(mounted.element.hasAttribute('data-fallback')).toBe(true);
    });

    it('should report nothing when the chunk loads', async () => {
        // Arrange
        const spy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        remove = fakeChunk(() => Promise.resolve({ version: '0.0.0', createScene3d: fakeScene().create }));

        // Act
        mountComponent('scene3d');
        await settle();

        // Assert
        expect(spy.mock.calls.filter((call) => (call[1] as { code?: string } | undefined)?.code === 'SUI-RUN-3D')).toHaveLength(0);
    });

    it('should ask once for the chunk and hide _fallback when it loads', async () => {
        // Arrange
        let asked = 0;
        remove = fakeChunk(() => {
            asked += 1;
            return Promise.resolve({ version: '0.0.0', createScene3d: fakeScene().create });
        });

        // Act
        const mounted = mountComponent('scene3d');
        await settle();

        // Assert
        expect(asked).toBe(1);
        expect(mounted.element.hasAttribute('data-fallback')).toBe(false);
        expect(getComputedStyle(fallback(mounted.element)).display).toBe('none');
        expect(mounted.element.getAttribute('data-render')).toBe('ready');
    });

    it('should show the German title and fallback text', async () => {
        // Arrange
        const mounted = mountComponent('scene3d', {}, { locale: 'de' });
        await settle();

        // Assert
        expect(mounted.element.shadowRoot?.querySelector('.title')?.textContent).toBe('3D-Szene');
        expect(fallback(mounted.element).textContent).toBe('Diese 3D-Szene kann in diesem Browser nicht angezeigt werden.');
    });
});

describe('scene3d model files (G3.7b) in Chromium, with a fake chunk', () => {
    let remove: (() => void) | undefined;

    afterEach(() => {
        remove?.();
        remove = undefined;
        mountComponent.unmountAll();
        vi.restoreAllMocks();
    });

    /** Mounts a scene whose fake chunk keeps the options it was made with */
    async function mountWithOptions(readFile?: ReadFile): Promise<{ options: Record<string, unknown> }> {
        const made: { options: Record<string, unknown> } = { options: {} };
        const create = (_: Element, options: Record<string, unknown>) => {
            made.options = options;
            return fakeScene().create();
        };
        remove = fakeChunk(() => Promise.resolve({ version: '0.0.0', createScene3d: create }));
        mountComponent('scene3d', {}, { hooks: readFile === undefined ? {} : { readFile } });
        await settle();
        return made;
    }

    it('should give the scene a readFile that reads a stored file through ui-file-read', async () => {
        // Arrange
        const reads: string[] = [];
        const bytes = new Uint8Array([103, 108, 84, 70]).buffer;
        const { options } = await mountWithOptions(async (id) => {
            reads.push(id);
            if (id !== 'chair') throw new FileTransferError('not_found', 'no such file');
            return { file: { id, name: 'chair.glb', size: 4, type: 'model/gltf-binary' }, data: bytes };
        });
        const readFile = options.readFile as (id: string, signal: AbortSignal) => Promise<ArrayBuffer>;

        // Act
        const data = await readFile('chair', new AbortController().signal);
        const missing = await readFile('gone', new AbortController().signal).catch((error: unknown) => error);

        // Assert
        expect(reads).toEqual(['chair', 'gone']);
        expect(new Uint8Array(data)).toEqual(new Uint8Array(bytes));
        expect((missing as { code?: string }).code).toBe('not_found');
    });

    it('should read offline when the host has no readFile hook', async () => {
        // Arrange
        const { options } = await mountWithOptions();
        const readFile = options.readFile as (id: string, signal: AbortSignal) => Promise<ArrayBuffer>;

        // Act
        const error = await readFile('chair', new AbortController().signal).catch((caught: unknown) => caught);

        // Assert
        expect(error).toEqual({ code: 'offline' });
    });

    it('should report a file issue as SUI-RUN-FILE and a model issue as SUI-RUN-3D, at the node path', async () => {
        // Arrange
        const spy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        const { options } = await mountWithOptions();
        const onIssue = options.onIssue as (issue: { kind: string; path: string; reason: string }) => void;

        // Act
        onIssue({ kind: 'file', path: '$.app.children.chair', reason: 'not_found' });
        onIssue({ kind: 'model', path: '$.app.children.lamp', reason: 'draco: it uses KHR_draco_mesh_compression' });

        // Assert
        expect(spy.mock.calls.map((call) => call[1])).toEqual([
            { code: 'SUI-RUN-FILE', path: '$.app.children.chair' },
            { code: 'SUI-RUN-3D', path: '$.app.children.lamp' }
        ]);
        expect(spy.mock.calls[0]?.[0]).toContain('not_found');
        expect(spy.mock.calls[1]?.[0]).toContain('draco: it uses KHR_draco_mesh_compression');
    });
});
