import { report } from '@punyts/core';
import { FileTransferError } from '@punyts/stateui-app';
import type { FileData, FileReference, ReadFile } from '@punyts/stateui-app';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent, NodeState } from '../harness/createMountComponent.js';

/*
 * drawImage (G1.9b of the graphics epic 1): a picture from a `data:` URL or a file of the app's store, in both
 * renderers. A file is read through the host's `readFile` hook (a fake here); SVG shows it as a `data:` URL built from
 * the bytes, canvas draws the decoded bitmap. The drawing stays pending until its pictures are decoded.
 */

type Rgba = [number, number, number, number];

const GREEN: Rgba = [0, 255, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];
const RED: Rgba = [255, 0, 0, 255];
const EMPTY: Rgba = [0, 0, 0, 0];

const PICTURE_ID = '6a1f2c3d-4e5b-4a7c-8d9e-0f1a2b3c4d5e';
const MISSING_ID = '7b2e3d4c-5f6a-4b8d-9e0f-1a2b3c4d5e6f';
const ROOT = '$.app.children';

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

const calls = (spy: { mock: { calls: unknown[][] } }, code: string): unknown[][] =>
    spy.mock.calls.filter((call) => (call[1] as { code?: string } | undefined)?.code === code);

/** A PNG of `width` by `height` pixels: green on the left half and blue on the right half */
async function png(width: number, height: number): Promise<ArrayBuffer> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    context.fillStyle = '#00ff00';
    context.fillRect(0, 0, width / 2, height);
    context.fillStyle = '#0000ff';
    context.fillRect(width / 2, 0, width / 2, height);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((made) => resolve(made as Blob), 'image/png'));
    return blob.arrayBuffer();
}

/** The same picture as a `data:` URL */
async function pngUrl(width: number, height: number): Promise<string> {
    const bytes = new Uint8Array(await png(width, height));
    let text = '';
    for (const byte of bytes) text += String.fromCharCode(byte);
    return `data:image/png;base64,${btoa(text)}`;
}

const referenceOf = (id: string, type = 'image/png'): FileReference => ({ id, name: 'plan.png', size: 1, type });

/** A `readFile` hook over a map of stored files; an id it does not hold rejects with `not_found`. `gate` holds the answers back */
function fakeRead(files: Map<string, ArrayBuffer>, gate: Promise<void> = Promise.resolve()): { readFile: ReadFile; reads: string[] } {
    const reads: string[] = [];
    const readFile: ReadFile = async (id) => {
        reads.push(id);
        await gate;
        const data = files.get(id);
        if (data === undefined) throw new FileTransferError('not_found', 'no such file');
        const result: FileData = { file: referenceOf(id), data: data.slice(0) };
        return result;
    };
    return { readFile, reads };
}

/** Waits until the drawing says it is drawn (`data-render="ready"`), at most 100 frames */
async function drawn(mounted: MountedComponent): Promise<void> {
    await Promise.resolve();
    for (let at = 0; at < 100; at += 1) {
        if (mounted.element.getAttribute('data-render') === 'ready') return;
        await frame();
    }
    throw new Error(`the drawing is still ${mounted.element.getAttribute('data-render')}`);
}

/** Mounts a 200 by 100 drawing (a drawing unit is a CSS pixel) with these shapes, without waiting for it */
function mountDrawing(renderer: 'svg' | 'canvas', children: NodeState, readFile?: ReadFile): MountedComponent {
    const mounted = mountComponent('drawing', { renderer, viewBox: { x: 0, y: 0, width: 200, height: 100 }, children }, { hooks: readFile === undefined ? {} : { readFile } });
    mounted.host.style.width = '200px';
    (mounted.element as HTMLElement).style.setProperty('--ui-drawing-height', '100px');
    return mounted;
}

const surfaceOf = (mounted: MountedComponent): Element => mounted.element.shadowRoot?.querySelector('.surface') as Element;

/**
 * The RGBA at a point in drawing units: read from the canvas bitmap, or for SVG from the svg drawn into a canvas (its
 * markup as an image, which shows its `image` elements' `data:` pictures)
 */
async function pixelAt(mounted: MountedComponent, x: number, y: number): Promise<Rgba> {
    const surface = surfaceOf(mounted);
    let source: HTMLCanvasElement;
    const canvas = surface.querySelector('canvas');
    if (canvas !== null) source = canvas;
    else {
        const svg = surface.querySelector('svg')!.cloneNode(true) as SVGSVGElement;
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svg.setAttribute('width', '200');
        svg.setAttribute('height', '100');
        const image = new Image();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
        await image.decode();
        source = document.createElement('canvas');
        source.width = 200;
        source.height = 100;
        source.getContext('2d')!.drawImage(image, 0, 0, 200, 100);
    }
    const ratio = source.width / 200;
    const data = source.getContext('2d')!.getImageData(Math.floor(x * ratio), Math.floor(y * ratio), 1, 1).data;
    return [data[0]!, data[1]!, data[2]!, data[3]!];
}

describe.each(['svg', 'canvas'] as const)('drawImage with the %s renderer in Chromium', (renderer) => {
    afterEach(() => {
        mountComponent.unmountAll();
        vi.restoreAllMocks();
    });

    it('should draw a stored file, read through readFile, and stay pending until it is decoded', async () => {
        // Arrange
        let open!: () => void;
        const gate = new Promise<void>((resolve) => (open = resolve));
        const read = fakeRead(new Map([[PICTURE_ID, await png(40, 20)]]), gate);
        const mounted = mountDrawing(renderer, { plan: { component: 'drawImage', src: referenceOf(PICTURE_ID) as never, x: 0, y: 0, width: 200, height: 100, fit: 'stretch' } }, read.readFile);

        // Act: the read is held back for some frames
        for (let at = 0; at < 6; at += 1) await frame();
        const whileReading = mounted.element.getAttribute('data-render');
        open();
        await drawn(mounted);

        // Assert
        expect(whileReading).toBe('pending');
        expect(read.reads).toEqual([PICTURE_ID]);
        expect(await pixelAt(mounted, 50, 50)).toEqual(GREEN);
        expect(await pixelAt(mounted, 150, 50)).toEqual(BLUE);
        if (renderer === 'svg') {
            const image = surfaceOf(mounted).querySelector('image[data-shape-kind="drawImage"]');
            expect(image?.getAttribute('href')).toMatch(/^data:image\/png;base64,/);
            expect(image?.getAttribute('data-shape-path')).toBe(`${ROOT}.plan`);
        }
    });

    it('should draw a data: URL and fit it into its box (contain), centred', async () => {
        // Arrange
        const src = await pngUrl(400, 100);

        // Act: 400 by 100 in 200 by 100 is 200 by 50, from y 25 to 75
        const mounted = mountDrawing(renderer, { plan: { component: 'drawImage', src, x: 0, y: 0, width: 200, height: 100 } });
        await drawn(mounted);

        // Assert
        expect(await pixelAt(mounted, 40, 50)).toEqual(GREEN);
        expect(await pixelAt(mounted, 160, 50)).toEqual(BLUE);
        expect(await pixelAt(mounted, 100, 10)).toEqual(EMPTY);
        expect(await pixelAt(mounted, 100, 90)).toEqual(EMPTY);
    });

    it('should cut a picture that covers its box', async () => {
        // Arrange: 40 by 20 covering a 20 by 20 box at x 90 shows its middle (green left, blue right), nothing beside
        const src = await pngUrl(40, 20);

        // Act
        const mounted = mountDrawing(renderer, { plan: { component: 'drawImage', src, x: 90, y: 40, width: 20, height: 20, fit: 'cover' } });
        await drawn(mounted);

        // Assert
        expect(await pixelAt(mounted, 94, 50)).toEqual(GREEN);
        expect(await pixelAt(mounted, 106, 50)).toEqual(BLUE);
        expect(await pixelAt(mounted, 80, 50)).toEqual(EMPTY);
        expect(await pixelAt(mounted, 120, 50)).toEqual(EMPTY);
    });

    it('should draw nothing for a missing file, report SUI-RUN-FILE with the node path, and draw the other shapes', async () => {
        // Arrange
        const error = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        const read = fakeRead(new Map());

        // Act
        const mounted = mountDrawing(
            renderer,
            {
                plan: { component: 'drawImage', src: referenceOf(MISSING_ID) as never, x: 0, y: 0, width: 200, height: 100 },
                mark: { component: 'rect', x: 150, y: 10, width: 20, height: 20, fill: '#ff0000' }
            },
            read.readFile
        );
        await drawn(mounted);

        // Assert
        expect(calls(error, 'SUI-RUN-FILE')).toHaveLength(1);
        expect(calls(error, 'SUI-RUN-FILE')[0]?.[1]).toMatchObject({ code: 'SUI-RUN-FILE', path: `${ROOT}.plan` });
        expect(String(calls(error, 'SUI-RUN-FILE')[0]?.[0])).toContain('not_found');
        expect(String(calls(error, 'SUI-RUN-FILE')[0]?.[0])).not.toContain(MISSING_ID);
        expect(await pixelAt(mounted, 50, 50)).toEqual(EMPTY);
        expect(await pixelAt(mounted, 160, 20)).toEqual(RED);
        if (renderer === 'svg') expect(surfaceOf(mounted).querySelector('image')).toBeNull();
    });

    it('should report a file that is not a picture, and a host with no readFile hook as offline', async () => {
        // Arrange
        const error = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        const read = fakeRead(new Map([[PICTURE_ID, new TextEncoder().encode('not a picture').buffer as ArrayBuffer]]));

        // Act
        await drawn(mountDrawing(renderer, { plan: { component: 'drawImage', src: referenceOf(PICTURE_ID) as never, width: 20, height: 20 } }, read.readFile));
        mountComponent.unmountAll();
        await drawn(mountDrawing(renderer, { plan: { component: 'drawImage', src: referenceOf(PICTURE_ID) as never, width: 20, height: 20 } }));

        // Assert
        expect(calls(error, 'SUI-RUN-FILE').map((call) => String(call[0]))).toEqual([expect.stringContaining('not_an_image'), expect.stringContaining('offline')]);
    });

    it('should refuse a data: URL of another type and an SVG file as SUI-STATE-INVALID', () => {
        // Arrange
        const read = fakeRead(new Map());

        // Act / Assert
        for (const src of ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:text/plain;base64,aGk=', referenceOf(PICTURE_ID, 'image/svg+xml')]) {
            expect(() => mountDrawing(renderer, { plan: { component: 'drawImage', src: src as never, width: 20, height: 20 } }, read.readFile)).toThrow(
                /SUI-STATE-INVALID Property "src" at \$\.app\.children\.plan\.src/
            );
            mountComponent.unmountAll();
        }
        expect(read.reads).toEqual([]);
    });

    it('should refuse a linked src that is not a picture as SUI-RUN-DRAW and read nothing', async () => {
        // Arrange
        const error = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        const read = fakeRead(new Map());
        const mounted = mountComponent(
            'drawing',
            { renderer, viewBox: { x: 0, y: 0, width: 200, height: 100 }, children: { plan: { component: 'drawImage', '<-src': '$.data.src', width: 20, height: 20 } } },
            { hooks: { readFile: read.readFile }, data: { src: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } }
        );

        // Act
        await drawn(mounted);

        // Assert
        expect(calls(error, 'SUI-RUN-DRAW')[0]?.[1]).toMatchObject({ path: `${ROOT}.plan` });
        expect(String(calls(error, 'SUI-RUN-DRAW')[0]?.[0])).toContain('property "src" is not a data: URL of a png, jpeg, gif or webp picture');
        expect(read.reads).toEqual([]);
    });
});
