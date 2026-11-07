import { report } from '@punyts/core';
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
