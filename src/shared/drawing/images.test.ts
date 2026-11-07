import { describe, expect, it } from 'vitest';
import { readStoredFile } from '../field/files.js';
import type { StoredFile } from '../field/files.js';
import { createImageLoader, imageSourceOf, placeImage } from './images.js';
import type { ImageSource } from './images.js';
import { drawingIssueError } from './render.js';
import { Unusable } from './shapeReader.js';

const ID = '6a1f2c3d-4e5b-4a7c-8d9e-0f1a2b3c4d5e';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const reference = (type: string) => ({ id: ID, name: 'plan', size: 10, type });

/** A promise with its settle functions, so a test ends a load when it wants */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
}

describe('imageSourceOf (G1.9b)', () => {
    it('should take a data: URL of a png, jpeg, gif or webp picture as written', () => {
        // Assert
        expect(imageSourceOf(PNG)).toEqual({ kind: 'data', key: PNG, url: PNG });
        for (const type of ['image/jpeg', 'image/gif', 'image/webp', 'IMAGE/PNG']) expect(imageSourceOf(`data:${type};base64,AAAA`)?.kind).toBe('data');
    });

    it('should take the reference of a picture file, keyed by its id', () => {
        // Assert
        expect(imageSourceOf(reference('image/webp'))).toEqual({ kind: 'file', key: `file:${ID}`, id: ID, type: 'image/webp' });
    });

    it('should give nothing for an unset src', () => {
        // Assert
        expect(imageSourceOf(undefined)).toBeUndefined();
        expect(imageSourceOf(null)).toBeUndefined();
        expect(imageSourceOf('')).toBeUndefined();
    });

    it('should refuse an SVG or any other type, and a value that is no picture', () => {
        // Assert
        for (const value of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:text/plain,hi', 'https://example.com/a.png', 'plan.png', 42, reference('image/svg+xml'), reference('application/pdf'), { id: ID }]) {
            expect(() => imageSourceOf(value as never)).toThrow(Unusable);
        }
        expect(() => imageSourceOf('data:image/svg+xml,<svg/>')).toThrow('property "src" is not a data: URL of a png, jpeg, gif or webp picture');
    });
});

describe('placeImage (G1.9b)', () => {
    const box = { x: 10, y: 20, width: 200, height: 100 };

    it('should fit a wide picture inside its box and centre it (contain)', () => {
        // Assert: 400 by 100 in 200 by 100 is 200 by 50, from y 45
        expect(placeImage('contain', 400, 100, box)).toEqual({ x: 10, y: 45, width: 200, height: 50, clip: false });
    });

    it('should fill the box with a tall picture and cut it (cover)', () => {
        // Assert: 100 by 400 covering 200 by 100 is 200 by 800, centred on y 70
        expect(placeImage('cover', 100, 400, box)).toEqual({ x: 10, y: -330, width: 200, height: 800, clip: true });
    });

    it('should stretch a picture to its box', () => {
        // Assert
        expect(placeImage('stretch', 100, 400, box)).toEqual({ x: 10, y: 20, width: 200, height: 100, clip: false });
    });

    it('should place nothing for a picture or a box with no pixels', () => {
        // Assert
        expect(placeImage('contain', 0, 10, box).width).toBe(0);
        expect(placeImage('contain', 10, 10, { ...box, height: 0 }).width).toBe(0);
    });
});

describe('createImageLoader (G1.9b)', () => {
    const source = imageSourceOf(PNG) as ImageSource;
    const other = imageSourceOf(reference('image/png')) as ImageSource;

    it('should load a source once, be pending until it ends, and say when it has', async () => {
        // Arrange
        const load = deferred<string>();
        const calls: string[] = [];
        let settledCount = 0;
        const loader = createImageLoader<string>({
            load: (from) => {
                calls.push(from.key);
                return load.promise;
            },
            onSettled: () => (settledCount += 1)
        });

        // Act
        const first = loader.use(source);
        const second = loader.use(source);
        const settled = loader.settled();
        load.resolve('loaded');
        await settled;

        // Assert
        expect(first).toEqual({ status: 'pending' });
        expect(second).toEqual({ status: 'pending' });
        expect(calls).toEqual([PNG]);
        expect(settledCount).toBe(1);
        expect(loader.use(source)).toEqual({ status: 'ready', value: 'loaded' });
    });

    it('should keep the reason of a failed load, and internal for a failure with none', async () => {
        // Arrange
        const loader = createImageLoader<string>({ load: (from) => Promise.reject(from.kind === 'file' ? { reason: 'not_found' } : new Error('x')), onSettled: () => undefined });

        // Act
        loader.use(source);
        loader.use(other);
        await loader.settled();

        // Assert
        expect(loader.use(other)).toEqual({ status: 'failed', reason: 'not_found' });
        expect(loader.use(source)).toEqual({ status: 'failed', reason: 'internal' });
    });

    it('should release the values no shape used since the last sweep, abort a load under way, and release a late one', async () => {
        // Arrange
        const released: string[] = [];
        const late = deferred<string>();
        const signals: AbortSignal[] = [];
        const loader = createImageLoader<string>({
            load: (from, signal) => {
                signals.push(signal);
                return from.kind === 'data' ? Promise.resolve('picture') : late.promise;
            },
            release: (value) => released.push(value),
            onSettled: () => undefined
        });
        loader.use(source);
        loader.use(other);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        loader.sweep();

        // Act: neither is used before the next sweep
        loader.sweep();
        late.resolve('late');
        await late.promise;
        await Promise.resolve();

        // Assert
        expect(released).toEqual(['picture', 'late']);
        expect(signals.every((signal) => signal.aborted)).toBe(true);
        await expect(loader.settled()).resolves.toBeUndefined();
    });
});

describe('readStoredFile and the SUI-RUN-FILE issue (G1.9b)', () => {
    it('should read through ui-file-read and be offline when nothing answers', async () => {
        // Arrange
        const target = new EventTarget();
        const stored: StoredFile = { file: reference('image/png'), data: new ArrayBuffer(4) };
        const ids: string[] = [];

        // Act
        const offline = readStoredFile(target, ID, new AbortController().signal);
        target.addEventListener('ui-file-read', (event) => {
            const detail = (event as CustomEvent<{ id: string; respond: (result: Promise<StoredFile>) => void }>).detail;
            ids.push(detail.id);
            detail.respond(Promise.resolve(stored));
        });
        const answered = readStoredFile(target, ID, new AbortController().signal);

        // Assert
        await expect(offline).rejects.toEqual({ code: 'offline' });
        await expect(answered).resolves.toBe(stored);
        expect(ids).toEqual([ID]);
    });

    it('should word a picture that cannot be used as SUI-RUN-FILE with the node path', () => {
        // Act
        const error = drawingIssueError({ code: 'SUI-RUN-FILE', path: '$.app.children.plan', reason: 'not_found' });

        // Assert
        expect(error.code).toBe('SUI-RUN-FILE');
        expect(error.message).toContain('drawImage at $.app.children.plan cannot use its file: not_found');
        expect(error.statePath).toBe('$.app.children.plan');
    });
});
