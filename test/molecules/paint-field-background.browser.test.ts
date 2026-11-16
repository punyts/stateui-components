import { report } from '@punyts/core';
import { FileTransferError } from '@punyts/stateui-app';
import type { FileData, FileReference, ReadFile, ReleaseFile, TransferFile } from '@punyts/stateui-app';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent, NodeState } from '../harness/createMountComponent.js';

/*
 * paintField background files (G2.9b of the graphics epic 2): `background` may be the reference of an image file of the
 * app's store. The field reads it through the host's `readFile` hook, draws it under the strokes scaled to fit
 * (`contain`), and a saved PNG has it under the strokes. The hooks here are fakes.
 */

const RED = '#ff0000';
const GREEN = [0, 255, 0, 255];
const BLUE = [0, 0, 255, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

const PICTURE_ID = '6a1f2c3d-4e5b-4a7c-8d9e-0f1a2b3c4d5e';
const OTHER_ID = '7b2e3d4c-5f6a-4b8d-9e0f-1a2b3c4d5e6f';

const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;
const canvasOf = (element: Element): HTMLCanvasElement => root(element).querySelector('canvas.canvas') as HTMLCanvasElement;
const backdropOf = (element: Element): HTMLCanvasElement => root(element).querySelector('canvas.backdrop') as HTMLCanvasElement;
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const at = (canvas: HTMLCanvasElement, x: number, y: number): number[] => [...(canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(x, y, 1, 1).data];
const fileCalls = (spy: { mock: { calls: unknown[][] } }): unknown[][] => spy.mock.calls.filter((call) => (call[1] as { code?: string } | undefined)?.code === 'SUI-RUN-FILE');

/**
 * A PNG of `width` by `height` pixels: green, or green on the left half and blue on the right half with `split`
 */
async function png(width: number, height: number, split = false): Promise<ArrayBuffer> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    context.fillStyle = '#00ff00';
    context.fillRect(0, 0, width, height);
    if (split) {
        context.fillStyle = '#0000ff';
        context.fillRect(width / 2, 0, width / 2, height);
    }
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((made) => resolve(made as Blob), 'image/png'));
    return blob.arrayBuffer();
}

const referenceOf = (id: string, size: number, type = 'image/png'): FileReference => ({ id, name: 'photo.png', size, type });

/** A `readFile` hook over a map of stored files; an id it does not hold rejects with `not_found` */
function fakeRead(files: Map<string, ArrayBuffer>): { readFile: ReadFile; reads: string[] } {
    const reads: string[] = [];
    const readFile: ReadFile = (id) => {
        reads.push(id);
        const data = files.get(id);
        if (data === undefined) return Promise.reject(new FileTransferError('not_found', 'no such file'));
        const result: FileData = { file: referenceOf(id, data.byteLength), data: data.slice(0) };
        return Promise.resolve(result);
    };
    return { readFile, reads };
}

/** Raises one pointer event on the canvas at a point given in canvas pixels, mapped through its CSS scaling */
function pointer(canvas: HTMLCanvasElement, type: string, x: number, y: number, extra: PointerEventInit = {}): void {
    const box = canvas.getBoundingClientRect();
    const clientX = box.left + (x * box.width) / canvas.width;
    const clientY = box.top + (y * box.height) / canvas.height;
    canvas.dispatchEvent(new PointerEvent(type, { pointerId: 7, isPrimary: true, button: 0, buttons: 1, pointerType: 'mouse', clientX, clientY, bubbles: true, composed: true, cancelable: true, ...extra }));
}

/** A horizontal stroke across a 200 by 100 canvas at the height `y` */
function stroke(element: Element, y = 50): void {
    const canvas = canvasOf(element);
    pointer(canvas, 'pointerdown', 10, y);
    pointer(canvas, 'pointermove', 100, y);
    pointer(canvas, 'pointermove', 190, y);
    pointer(canvas, 'pointerup', 190, y, { buttons: 0 });
}

async function decode(file: Blob): Promise<(x: number, y: number) => number[]> {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    context.drawImage(bitmap, 0, 0);
    return (x, y) => [...context.getImageData(x, y, 1, 1).data];
}

interface Hooks {
    readFile?: ReadFile;
    transferFile?: TransferFile;
    releaseFile?: ReleaseFile;
}

async function mountPaint(background: unknown, hooks: Hooks, extra: NodeState = {}): Promise<MountedComponent> {
    const mounted = mountComponent('paintField', { width: 200, height: 100, colors: [RED], sizes: [6], background: background as never, ...extra }, { hooks });
    await flush();
    return mounted;
}

describe('paintField background files in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
        vi.restoreAllMocks();
    });

    it('should draw a background file under the strokes, which the eraser leaves alone', async () => {
        // Arrange
        const files = new Map([[PICTURE_ID, await png(200, 100, true)]]);
        const read = fakeRead(files);
        const mounted = await mountPaint(referenceOf(PICTURE_ID, 1), { readFile: read.readFile });
        const backdrop = backdropOf(mounted.element);
        await vi.waitFor(() => expect(at(backdrop, 20, 20)).toEqual(GREEN));

        // Act
        stroke(mounted.element);

        // Assert
        expect(read.reads).toEqual([PICTURE_ID]);
        expect([backdrop.width, backdrop.height]).toEqual([200, 100]);
        expect(at(backdrop, 180, 20)).toEqual(BLUE);
        expect(at(canvasOf(mounted.element), 100, 50)).toEqual([255, 0, 0, 255]);
        expect(at(canvasOf(mounted.element), 100, 20)).toEqual(CLEAR);
        expect(at(backdrop, 100, 50)).toEqual(BLUE);
        // the painting lies over the backdrop, which takes no pointer input
        expect(Number(getComputedStyle(canvasOf(mounted.element)).zIndex)).toBeGreaterThan(Number(getComputedStyle(backdrop).zIndex) || 0);
        expect(getComputedStyle(backdrop).pointerEvents).toBe('none');
        expect(backdrop.getAttribute('aria-hidden')).toBe('true');
        expect(getComputedStyle(backdrop).backgroundColor).toBe('rgb(255, 255, 255)');
    });

    it('should fit a wide picture to the width, with white bands above and below', async () => {
        // Arrange
        const read = fakeRead(new Map([[PICTURE_ID, await png(400, 100)]]));

        // Act
        const mounted = await mountPaint(referenceOf(PICTURE_ID, 1), { readFile: read.readFile });
        const backdrop = backdropOf(mounted.element);
        await vi.waitFor(() => expect(at(backdrop, 100, 50)).toEqual(GREEN));

        // Assert: 400 by 100 in 200 by 100 is 200 by 50, from y 25 to 75
        expect(at(backdrop, 2, 30)).toEqual(GREEN);
        expect(at(backdrop, 197, 70)).toEqual(GREEN);
        expect(at(backdrop, 100, 20)).toEqual(CLEAR);
        expect(at(backdrop, 100, 80)).toEqual(CLEAR);
    });

    it('should fit a tall picture to the height, with white bands left and right', async () => {
        // Arrange
        const read = fakeRead(new Map([[PICTURE_ID, await png(100, 400)]]));

        // Act
        const mounted = await mountPaint(referenceOf(PICTURE_ID, 1), { readFile: read.readFile });
        const backdrop = backdropOf(mounted.element);
        await vi.waitFor(() => expect(at(backdrop, 100, 50)).toEqual(GREEN));

        // Assert: 100 by 400 in 200 by 100 is 25 by 100, from x 87.5 to 112.5
        expect(at(backdrop, 100, 2)).toEqual(GREEN);
        expect(at(backdrop, 100, 97)).toEqual(GREEN);
        expect(at(backdrop, 80, 50)).toEqual(CLEAR);
        expect(at(backdrop, 120, 50)).toEqual(CLEAR);
    });

    it('should show white for a missing file, report SUI-RUN-FILE with the field path, and still paint', async () => {
        // Arrange
        const error = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        const read = fakeRead(new Map());

        // Act
        const mounted = await mountPaint(referenceOf(PICTURE_ID, 1), { readFile: read.readFile });
        await vi.waitFor(() => expect(fileCalls(error)).toHaveLength(1));
        stroke(mounted.element);

        // Assert
        expect(fileCalls(error)[0]?.[1]).toMatchObject({ code: 'SUI-RUN-FILE', path: '$.app' });
        expect(String(fileCalls(error)[0]?.[0])).toContain('not_found');
        expect(String(fileCalls(error)[0]?.[0])).not.toContain(PICTURE_ID);
        const backdrop = backdropOf(mounted.element);
        expect(at(backdrop, 100, 20)).toEqual(CLEAR);
        expect(getComputedStyle(backdrop).backgroundColor).toBe('rgb(255, 255, 255)');
        expect(at(canvasOf(mounted.element), 100, 50)).toEqual([255, 0, 0, 255]);
    });

    it('should report a file that is not an image, and a host with no readFile hook as offline', async () => {
        // Arrange
        const error = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        const read = fakeRead(new Map([[PICTURE_ID, new TextEncoder().encode('not a picture').buffer as ArrayBuffer]]));

        // Act
        await mountPaint(referenceOf(PICTURE_ID, 1), { readFile: read.readFile });
        await vi.waitFor(() => expect(fileCalls(error)).toHaveLength(1));
        mountComponent.unmountAll();
        await mountPaint(referenceOf(OTHER_ID, 1), {});
        await vi.waitFor(() => expect(fileCalls(error)).toHaveLength(2));

        // Assert
        expect(String(fileCalls(error)[0]?.[0])).toContain('not_an_image');
        expect(String(fileCalls(error)[1]?.[0])).toContain('offline');
    });

    it('should refuse a background file of a type the store does not hold as an image as SUI-STATE-INVALID', async () => {
        // Arrange
        const read = fakeRead(new Map());

        // Act / Assert
        expect(() => mountComponent('paintField', { background: referenceOf(PICTURE_ID, 12, 'text/plain') as never }, { hooks: { readFile: read.readFile } })).toThrow(
            /SUI-STATE-INVALID Property "background" at \$\.app\.background/
        );
        expect(read.reads).toEqual([]);
    });

    it('should follow a change of background: a new file, then a colour', async () => {
        // Arrange
        const read = fakeRead(new Map([[PICTURE_ID, await png(200, 100)], [OTHER_ID, await png(200, 100, true)]]));
        const mounted = await mountPaint(referenceOf(PICTURE_ID, 1), { readFile: read.readFile });
        const backdrop = backdropOf(mounted.element);
        await vi.waitFor(() => expect(at(backdrop, 180, 50)).toEqual(GREEN));

        // Act
        mounted.store.set('$.app.background' as never, referenceOf(OTHER_ID, 1) as never);
        await vi.waitFor(() => expect(at(backdrop, 180, 50)).toEqual(BLUE));
        mounted.store.set('$.app.background' as never, '#0000ff' as never);
        await flush();

        // Assert
        expect(read.reads).toEqual([PICTURE_ID, OTHER_ID]);
        expect(at(backdrop, 180, 50)).toEqual(CLEAR);
        expect(getComputedStyle(backdrop).backgroundColor).toBe('rgb(0, 0, 255)');
    });

    it('should save a PNG with the background under the strokes, and never give the background file back', async () => {
        // Arrange
        const read = fakeRead(new Map([[PICTURE_ID, await png(400, 100, true)]]));
        const files: File[] = [];
        const released: string[] = [];
        const transferFile: TransferFile = (file) => {
            files.push(file);
            return Promise.resolve({ id: OTHER_ID, name: file.name, size: file.size, type: 'image/png' });
        };
        const releaseFile: ReleaseFile = (id) => {
            released.push(id);
            return Promise.resolve();
        };
        const mounted = await mountPaint(referenceOf(PICTURE_ID, 1), { readFile: read.readFile, transferFile, releaseFile });

        // Act: paint at once, before the read has ended: the save waits for it
        stroke(mounted.element);
        canvasOf(mounted.element).focus();
        const outside = document.createElement('button');
        document.body.append(outside);
        outside.focus();
        await vi.waitFor(() => expect(files).toHaveLength(1));
        (mounted.element as Element & { commands: Record<string, () => void> }).commands.clear?.();
        await new Promise((resolve) => setTimeout(resolve, 20));
        outside.remove();

        // Assert: 400 by 100 is drawn at 200 by 50, from y 25 to 75; green on the left, blue on the right
        const pixel = await decode(files[0] as File);
        expect(pixel(100, 50)).toEqual([255, 0, 0, 255]);
        expect(pixel(40, 35)).toEqual(GREEN);
        expect(pixel(160, 65)).toEqual(BLUE);
        expect(pixel(100, 10)).toEqual(WHITE);
        expect(released).toEqual([OTHER_ID]);
        expect(released).not.toContain(PICTURE_ID);
    });
});
