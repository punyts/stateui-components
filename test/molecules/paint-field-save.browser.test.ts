import { FileTransferError } from '@punyts/stateui-app';
import type { FileReference, ReleaseFile, TransferFile, TransferFileOptions } from '@punyts/stateui-app';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent, NodeState } from '../harness/createMountComponent.js';

/*
 * paintField saving (G2.8 of the graphics epic 2): the painting is saved as a PNG through the host's `transferFile`
 * hook when painting pauses or focus leaves the field, the value follows, and the files it replaces are given back
 * through `releaseFile`. The hooks here are fakes the tests settle by hand.
 */

const RED = '#ff0000';
const BLUE = '#0000ff';
/** The file the document holds before the field saves anything */
const STORED = { id: '3f0c8a52-1d3e-4b7a-9c61-0a2b4c6d8e10', name: 'before.png', size: 1234, type: 'image/png' };
/** A little more than the pause after which the field saves */
const PAUSE_MS = 1700;

interface Call {
    file: File;
    options: TransferFileOptions;
    resolve(reference: FileReference): void;
    reject(code: ConstructorParameters<typeof FileTransferError>[0]): void;
}

interface Hooks {
    calls: Call[];
    released: string[];
    transferFile: TransferFile;
    releaseFile: ReleaseFile;
}

/** A `transferFile` hook the test settles by hand, and a `releaseFile` hook that records the ids it is given */
function fakeHooks(): Hooks {
    const calls: Call[] = [];
    const released: string[] = [];
    const transferFile: TransferFile = (given, options = {}) =>
        new Promise<FileReference>((resolve, reject) => {
            calls.push({ file: given, options, resolve, reject: (code) => reject(new FileTransferError(code, 'rejected')) });
            options.signal?.addEventListener('abort', () => reject(new FileTransferError('cancelled', 'cancelled')));
        });
    const releaseFile: ReleaseFile = (id) => {
        released.push(id);
        return Promise.resolve();
    };
    return { calls, released, transferFile, releaseFile };
}

const reference = (id: string, size = 100): FileReference => ({ id, name: 'Drawing.png', size, type: 'image/png' });

const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;
const canvasOf = (element: Element): HTMLCanvasElement => root(element).querySelector('canvas') as HTMLCanvasElement;
const get = (mounted: MountedComponent, name: string): unknown => mounted.store.get(`$.app.${name}` as never);
/** A copy of the bound value: the store writes an object value into the one it holds */
const signature = (mounted: MountedComponent): unknown => JSON.parse(JSON.stringify(mounted.store.get('$.data.signature' as never) ?? null));
const errorText = (element: Element): string => root(element).querySelector('.error')?.textContent ?? '';
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const command = (element: Element, name: string): void => {
    (element as Element & { commands: Record<string, () => void> }).commands[name]?.();
};
const record = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};

/** The RGBA of one pixel of the field's canvas */
const pixel = (element: Element, x: number, y: number): number[] => [...(canvasOf(element).getContext('2d') as CanvasRenderingContext2D).getImageData(x, y, 1, 1).data];

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

/** Focuses the canvas, then a button outside the field, so focus leaves the field */
let outside: HTMLButtonElement | undefined;
function blurField(element: Element): void {
    canvasOf(element).focus();
    if (outside === undefined) {
        outside = document.createElement('button');
        outside.textContent = 'Outside';
        document.body.append(outside);
    }
    outside.focus();
}

/** The pixels of a PNG file */
async function decode(file: Blob): Promise<{ width: number; height: number; at(x: number, y: number): number[] }> {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    context.drawImage(bitmap, 0, 0);
    return { width: bitmap.width, height: bitmap.height, at: (x, y) => [...context.getImageData(x, y, 1, 1).data] };
}

async function mountPaint(hooks: Partial<Hooks> | undefined, extra: NodeState = {}, value: unknown = {}): Promise<MountedComponent> {
    const given = { ...(hooks?.transferFile ? { transferFile: hooks.transferFile } : {}), ...(hooks?.releaseFile ? { releaseFile: hooks.releaseFile } : {}) };
    const mounted = mountComponent('paintField', { width: 200, height: 100, colors: [RED, BLUE], sizes: [4, 20], '<-value': '$.data.signature', ...extra }, { data: { signature: value }, hooks: given });
    await flush();
    return mounted;
}

/** Strokes, leaves the field and waits for the save to reach the hook */
async function paintAndSave(mounted: MountedComponent, hooks: Hooks, y = 50): Promise<Call> {
    const before = hooks.calls.length;
    stroke(mounted.element, y);
    blurField(mounted.element);
    await vi.waitFor(() => expect(hooks.calls.length).toBe(before + 1));
    return hooks.calls[before] as Call;
}

describe('paintField saving in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
        outside?.remove();
        outside = undefined;
        vi.restoreAllMocks();
    });

    it('should save the painting as a PNG when painting pauses, and not before', async () => {
        // Arrange
        const hooks = fakeHooks();
        const mounted = await mountPaint(hooks);

        // Act
        stroke(mounted.element);
        await wait(1000);
        const early = hooks.calls.length;
        await vi.waitFor(() => expect(hooks.calls).toHaveLength(1), { timeout: 3000 });

        // Assert
        expect(early).toBe(0);
        const file = (hooks.calls[0] as Call).file;
        expect(file).toBeInstanceOf(File);
        expect(file.name).toBe('Drawing.png');
        expect(file.type).toBe('image/png');
        expect(new Uint8Array(await file.slice(0, 4).arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
        const image = await decode(file);
        expect([image.width, image.height]).toEqual([200, 100]);
        expect(image.at(100, 50)).toEqual([255, 0, 0, 255]);
        expect(image.at(100, 10)[3]).toBe(0);
        expect((hooks.calls[0] as Call).options.signal).toBeInstanceOf(AbortSignal);
    });

    it('should save when the field loses focus, named painting.png without a label and over the background colour', async () => {
        // Arrange
        const hooks = fakeHooks();
        const mounted = await mountPaint(hooks, { _label: '', background: BLUE });

        // Act
        const call = await paintAndSave(mounted, hooks);

        // Assert
        expect(call.file.name).toBe('painting.png');
        const image = await decode(call.file);
        expect(image.at(100, 50)).toEqual([255, 0, 0, 255]);
        expect(image.at(100, 10)).toEqual([0, 0, 255, 255]);
    });

    it('should not save a field that is not dirty, on a pause or when it loses focus', async () => {
        // Arrange
        const hooks = fakeHooks();
        const mounted = await mountPaint(hooks);

        // Act: nothing painted
        blurField(mounted.element);
        await wait(100);
        const blank = hooks.calls.length;
        const call = await paintAndSave(mounted, hooks);
        call.resolve(reference('a1'));
        await flush();
        // saved: neither leaving the field again nor a pause saves
        blurField(mounted.element);
        await wait(PAUSE_MS);

        // Assert
        expect(blank).toBe(0);
        expect(hooks.calls).toHaveLength(1);
        expect(get(mounted, 'dirty')).toBe(false);
    });

    it('should not save while focus moves inside the field', async () => {
        // Arrange
        const hooks = fakeHooks();
        const mounted = await mountPaint(hooks);
        stroke(mounted.element);

        // Act
        canvasOf(mounted.element).focus();
        (root(mounted.element).querySelector('.undo') as HTMLButtonElement).focus();
        await wait(100);

        // Assert
        expect(hooks.calls).toHaveLength(0);
    });

    it('should cancel a pending save on the next stroke and save again on the next pause', async () => {
        // Arrange
        const hooks = fakeHooks();
        const mounted = await mountPaint(hooks);
        const first = await paintAndSave(mounted, hooks);

        // Act
        stroke(mounted.element, 30);
        const aborted = first.options.signal?.aborted;
        first.resolve(reference('late'));
        await flush();
        const afterAbort = signature(mounted);
        await vi.waitFor(() => expect(hooks.calls).toHaveLength(2), { timeout: 3000 });
        (hooks.calls[1] as Call).resolve(reference('b1'));
        await flush();

        // Assert
        expect(aborted).toBe(true);
        expect(afterAbort).toEqual({});
        expect(signature(mounted)).toEqual(reference('b1'));
        const image = await decode((hooks.calls[1] as Call).file);
        expect(image.at(100, 30)).toEqual([255, 0, 0, 255]);
        expect(image.at(100, 50)).toEqual([255, 0, 0, 255]);
    });

    it('should write the reference, clear dirty, raise changed and release the file it replaced', async () => {
        // Arrange
        const hooks = fakeHooks();
        const mounted = await mountPaint(hooks);
        const changed = record(mounted.element, 'changed');

        // Act
        (await paintAndSave(mounted, hooks)).resolve(reference('a1', 321));
        await flush();
        const first = { value: signature(mounted), dirty: get(mounted, 'dirty') };
        stroke(mounted.element, 30);
        const dirtyAgain = get(mounted, 'dirty');
        blurField(mounted.element);
        await vi.waitFor(() => expect(hooks.calls).toHaveLength(2));
        (hooks.calls[1] as Call).resolve(reference('a2', 654));
        await flush();
        await flush();

        // Assert
        expect(first).toEqual({ value: reference('a1', 321), dirty: false });
        expect(dirtyAgain).toBe(true);
        expect(signature(mounted)).toEqual(reference('a2', 654));
        expect(get(mounted, 'dirty')).toBe(false);
        expect(get(mounted, 'error')).toBe('');
        expect(changed).toEqual([{ value: reference('a1', 321) }, { value: reference('a2', 654) }]);
        expect(hooks.released).toEqual(['a1']);
    });

    it('should not release the file the document gave the field when a save replaces it', async () => {
        // Arrange
        const hooks = fakeHooks();
        const mounted = await mountPaint(hooks, {}, STORED);

        // Act
        (await paintAndSave(mounted, hooks)).resolve(reference('a1'));
        await flush();
        await flush();

        // Assert
        expect(signature(mounted)).toEqual(reference('a1'));
        expect(hooks.released).toEqual([]);
    });

    it.each([
        ['too_large', 'The drawing is too large to save'],
        ['quota', 'The storage limit of this app is reached'],
        ['offline', 'The drawing could not be saved'],
        ['unsupported_type', 'The drawing could not be saved in this format'],
        ['internal', 'Saving the drawing failed']
    ] as const)('should keep the strokes and show %s when the upload fails, and try again only after the next stroke', async (code, message) => {
        // Arrange
        const hooks = fakeHooks();
        const mounted = await mountPaint(hooks);
        const invalid = record(mounted.element, 'invalid');

        // Act
        (await paintAndSave(mounted, hooks)).reject(code);
        await flush();
        const failed = { error: get(mounted, 'error'), text: errorText(mounted.element), dirty: get(mounted, 'dirty'), value: signature(mounted) };
        blurField(mounted.element);
        await wait(PAUSE_MS);
        const retried = hooks.calls.length;
        (await paintAndSave(mounted, hooks, 30)).resolve(reference('ok'));
        await flush();

        // Assert
        expect(failed).toEqual({ error: code, text: message, dirty: true, value: {} });
        expect(invalid).toContainEqual({ rule: code });
        expect(pixel(mounted.element, 100, 50)).toEqual([255, 0, 0, 255]);
        expect(retried).toBe(1);
        expect(get(mounted, 'error')).toBe('');
        expect(signature(mounted)).toEqual(reference('ok'));
    });

    it('should show internal for a rejection whose code is not a saving code', async () => {
        // Arrange
        const hooks = fakeHooks();
        const mounted = await mountPaint(hooks);

        // Act
        (await paintAndSave(mounted, hooks)).reject('unauthorized');
        await flush();

        // Assert
        expect(get(mounted, 'error')).toBe('internal');
    });

    it('should fail with offline when the host gives no transferFile hook', async () => {
        // Arrange
        const mounted = await mountPaint(undefined);

        // Act
        stroke(mounted.element);
        blurField(mounted.element);

        // Assert
        await vi.waitFor(() => expect(get(mounted, 'error')).toBe('offline'));
        expect(get(mounted, 'dirty')).toBe(true);
        expect(errorText(mounted.element)).toBe('The drawing could not be saved');
    });

    it('should fail with too_large before sending a PNG over 10 MiB', async () => {
        // Arrange
        const hooks = fakeHooks();
        const mounted = await mountPaint(hooks);
        const big = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'image/png' });
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback: BlobCallback) {
            setTimeout(() => callback(big), 0);
        });

        // Act
        stroke(mounted.element);
        blurField(mounted.element);

        // Assert
        await vi.waitFor(() => expect(get(mounted, 'error')).toBe('too_large'));
        expect(hooks.calls).toHaveLength(0);
        expect(get(mounted, 'dirty')).toBe(true);
    });

    it('should empty the value on clear and release the file it held', async () => {
        // Arrange
        const hooks = fakeHooks();
        const mounted = await mountPaint(hooks);
        (await paintAndSave(mounted, hooks)).resolve(reference('a1'));
        await flush();

        // Act
        command(mounted.element, 'clear');
        await flush();

        // Assert
        expect(signature(mounted)).toEqual({});
        expect(get(mounted, 'dirty')).toBe(false);
        expect(hooks.released).toEqual(['a1']);
    });

    it('should not fail when the host gives no releaseFile hook', async () => {
        // Arrange
        const hooks = fakeHooks();
        const mounted = await mountPaint({ transferFile: hooks.transferFile, calls: hooks.calls });
        (await paintAndSave(mounted, hooks)).resolve(reference('a1'));
        await flush();

        // Act
        command(mounted.element, 'clear');
        await flush();

        // Assert
        expect(signature(mounted)).toEqual({});
        expect(get(mounted, 'error')).toBe('');
    });

    it('should abort the save on reset, restore the document value and release the files the field saved', async () => {
        // Arrange
        const hooks = fakeHooks();
        const mounted = await mountPaint(hooks, {}, STORED);
        (await paintAndSave(mounted, hooks)).resolve(reference('a1'));
        await flush();
        const pending = await paintAndSave(mounted, hooks, 30);

        // Act
        command(mounted.element, 'reset');
        const aborted = pending.options.signal?.aborted;
        pending.resolve(reference('late'));
        await flush();
        await flush();

        // Assert
        expect(aborted).toBe(true);
        expect(signature(mounted)).toEqual(STORED);
        expect(get(mounted, 'dirty')).toBe(false);
        expect(hooks.released).toEqual(['a1']);
    });

    it('should abort the save on dispose and write no late result', async () => {
        // Arrange
        const hooks = fakeHooks();
        const mounted = await mountPaint(hooks);
        const pending = await paintAndSave(mounted, hooks);

        // Act
        mounted.dispose();
        const aborted = pending.options.signal?.aborted;
        pending.resolve(reference('late'));
        await flush();

        // Assert
        expect(aborted).toBe(true);
        expect(signature(mounted)).toEqual({});
    });

    it('should save nothing after dispose when a pause was pending', async () => {
        // Arrange
        const hooks = fakeHooks();
        const mounted = await mountPaint(hooks);
        stroke(mounted.element);

        // Act
        mounted.dispose();
        await wait(PAUSE_MS);

        // Assert
        expect(hooks.calls).toHaveLength(0);
    });
});
