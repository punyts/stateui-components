import type { FileReference, TransferFile } from '@punyts/stateui-app';
import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const until = async (check: () => boolean, timeout = 3000): Promise<void> => {
    const start = performance.now();
    while (!check()) {
        if (performance.now() - start > timeout) throw new Error('timed out');
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
};

/** A 400 by 200 picture, its left half red and its right half blue */
async function halves(name: string, type: string): Promise<File> {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, 200, 200);
    context.fillStyle = '#0000ff';
    context.fillRect(200, 0, 200, 200);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((made) => resolve(made as Blob), type, 1));
    return new File([blob], name, { type });
}

/** The size of a picture file and the colour at its centre, as 'red', 'blue' or 'mixed' */
async function look(file: File): Promise<{ width: number; height: number; colour: string }> {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    context.drawImage(bitmap, 0, 0);
    const corners = [context.getImageData(2, 2, 1, 1).data, context.getImageData(bitmap.width - 3, bitmap.height - 3, 1, 1).data];
    const tone = (pixel: Uint8ClampedArray): string => ((pixel[0] ?? 0) > 200 && (pixel[2] ?? 0) < 60 ? 'red' : (pixel[2] ?? 0) > 200 && (pixel[0] ?? 0) < 60 ? 'blue' : 'other');
    const [first, last] = corners.map(tone);
    return { width: bitmap.width, height: bitmap.height, colour: first === last ? (first as string) : 'mixed' };
}

/** A `transferFile` hook that answers at once and keeps the files it was given */
function hook(): { files: File[]; transferFile: TransferFile } {
    const files: File[] = [];
    const transferFile: TransferFile = (given) => {
        files.push(given);
        return Promise.resolve<FileReference>({ id: `id-${given.name}`, name: given.name, size: given.size, type: given.type });
    };
    return { files, transferFile };
}

async function pick(element: Element, ...files: File[]): Promise<void> {
    const transfer = new DataTransfer();
    for (const item of files) transfer.items.add(item);
    const input = part<HTMLInputElement>(element, '.picker');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
}

function mountCrop(transfer: { transferFile: TransferFile }, crop = '1:1', extra: Record<string, unknown> = {}): ReturnType<typeof mountComponent> {
    return mountComponent('fileField', { '<-value': '$.data.files', crop, maxFiles: 3, ...extra }, { data: { files: [] }, hooks: { transferFile: transfer.transferFile } });
}

describe('fileField crop step in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should open a picture in a frame of the ratio, zoom and move it with keys and send the framed part', async () => {
        // Arrange
        const transfer = hook();
        const mounted = mountCrop(transfer);
        await pick(mounted.element, await halves('wide.png', 'image/png'));
        await until(() => mounted.store.get('$.app.cropping') === true);
        const frame = part<HTMLCanvasElement>(mounted.element, '.crop-frame');
        const zoom = part<HTMLInputElement>(mounted.element, '.zoom');

        // Act
        zoom.value = '2';
        zoom.dispatchEvent(new Event('input', { bubbles: true }));
        frame.focus();
        await userEvent.keyboard('{ArrowRight>20/}');
        await userEvent.keyboard('{Enter}');
        await until(() => transfer.files.length === 1);
        const sent = transfer.files[0] as File;
        await until(() => (mounted.store.get('$.data.files') as unknown[]).length === 1);

        // Assert
        expect([frame.width, frame.height]).toEqual([480, 480]);
        expect(part(mounted.element, '.crop')).toBeNull();
        expect(mounted.store.get('$.app.cropZoom')).toBe(2);
        expect(sent.name).toBe('wide.png');
        expect(sent.type).toBe('image/png');
        expect(await look(sent)).toEqual({ width: 100, height: 100, colour: 'red' });
        expect(part(mounted.element, '.name').textContent).toBe('wide.png');
    });

    it('should move the picture with a drag and keep a JPEG a JPEG', async () => {
        // Arrange
        const transfer = hook();
        const mounted = mountCrop(transfer, '1:1');
        await pick(mounted.element, await halves('wide.jpg', 'image/jpeg'));
        await until(() => mounted.store.get('$.app.cropping') === true);
        const frame = part<HTMLCanvasElement>(mounted.element, '.crop-frame');
        const box = frame.getBoundingClientRect();
        const at = (type: string, x: number): PointerEvent => new PointerEvent(type, { pointerId: 7, button: 0, clientX: x, clientY: box.top + 10, bubbles: true });

        // Act
        frame.dispatchEvent(at('pointerdown', box.right - 5));
        frame.dispatchEvent(at('pointermove', box.left));
        frame.dispatchEvent(at('pointerup', box.left));
        await userEvent.click(part(mounted.element, '.crop-use'));
        await until(() => transfer.files.length === 1);
        const sent = transfer.files[0] as File;

        // Assert
        expect(sent.type).toBe('image/jpeg');
        expect(await look(sent)).toEqual({ width: 200, height: 200, colour: 'blue' });
    });

    it('should drop a picture on cancel, return focus to the button and send other files as they are', async () => {
        // Arrange
        const transfer = hook();
        const mounted = mountCrop(transfer, '16:9', { accept: ['image/png', 'text/plain'] });
        await pick(mounted.element, await halves('wide.png', 'image/png'), new File(['notes'], 'notes.txt', { type: 'text/plain' }));
        await until(() => mounted.store.get('$.app.cropping') === true);
        const frame = part<HTMLCanvasElement>(mounted.element, '.crop-frame');

        // Act
        frame.focus();
        await userEvent.keyboard('{Escape}');
        await until(() => (mounted.store.get('$.data.files') as unknown[]).length === 1);

        // Assert
        expect([frame.width, frame.height]).toEqual([480, 270]);
        expect(transfer.files.map((file) => file.name)).toEqual(['notes.txt']);
        expect(part(mounted.element, '.crop')).toBeNull();
        expect(mounted.element.shadowRoot?.activeElement?.id).toBe('control');
    });

    it('should send a picture without a crop step when crop is not set', async () => {
        // Arrange
        const transfer = hook();
        const mounted = mountCrop(transfer, '');
        const picture = await halves('wide.png', 'image/png');

        // Act
        await pick(mounted.element, picture);
        await until(() => transfer.files.length === 1);

        // Assert
        expect(transfer.files[0]).toBe(picture);
        expect(mounted.store.get('$.app.cropping')).toBe(false);
    });
});
