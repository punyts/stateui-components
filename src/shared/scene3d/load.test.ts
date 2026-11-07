import { describe, expect, it } from 'vitest';
import { LOAD_3D_EVENT, isScene3dChunk, requestScene3dChunk } from './load.js';
import type { Load3dRequest } from './load.js';

const CHUNK = { version: '0.1.0', createScene3d: () => ({}) };

/** Answers every `ui-load-3d` on the target with the promise `answer` gives, and counts the requests */
function answering(target: EventTarget, answer: () => Promise<unknown>): { count: () => number } {
    let count = 0;
    target.addEventListener(LOAD_3D_EVENT, (event) => {
        count += 1;
        (event as CustomEvent<Load3dRequest>).detail.respond(answer());
    });
    return { count: () => count };
}

describe('requestScene3dChunk (G3.4 of the graphics epic 3)', () => {
    it('should raise a bubbling, composed ui-load-3d and be offline when nothing answers', async () => {
        // Arrange
        const target = new EventTarget();
        const seen: Event[] = [];
        target.addEventListener(LOAD_3D_EVENT, (event) => seen.push(event));

        // Act
        const request = requestScene3dChunk(target);

        // Assert
        await expect(request).rejects.toEqual({ code: 'offline' });
        expect(seen).toHaveLength(1);
        expect(seen[0]?.bubbles).toBe(true);
        expect(seen[0]?.composed).toBe(true);
    });

    it('should resolve with the chunk the hook gives', async () => {
        // Arrange
        const target = new EventTarget();
        const hook = answering(target, () => Promise.resolve(CHUNK));

        // Act
        const chunk = await requestScene3dChunk(target);

        // Assert
        expect(chunk).toBe(CHUNK);
        expect(hook.count()).toBe(1);
    });

    it('should fail when the hook rejects, and be invalid when it gives no chunk', async () => {
        // Arrange
        const failing = new EventTarget();
        const empty = new EventTarget();
        answering(failing, () => Promise.reject(new Error('404')));
        answering(empty, () => Promise.resolve({ version: 1 }));

        // Act
        const failed = requestScene3dChunk(failing);
        const invalid = requestScene3dChunk(empty);

        // Assert
        await expect(failed).rejects.toMatchObject({ code: 'failed' });
        await expect(invalid).rejects.toEqual({ code: 'invalid' });
    });

    it('should know the chunk global by its version and createScene3d', () => {
        // Assert
        expect(isScene3dChunk(CHUNK)).toBe(true);
        expect(isScene3dChunk({ version: '1' })).toBe(false);
        expect(isScene3dChunk(null)).toBe(false);
    });
});
