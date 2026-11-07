import { report } from '@punyts/core';
import type { FileReference, TransferFile } from '@punyts/stateui-app';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CORE_ICON_NAMES } from '../../src/icons/coreNames.js';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent, NodeState } from '../harness/createMountComponent.js';

const RED = '#ff0000';
const BLUE = '#0000ff';
const ALL_TOOLS = ['brush', 'eraser', 'line', 'rect', 'ellipse', 'fill'];

const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;
const all = <T extends Element = HTMLElement>(element: Element, selector: string): T[] => Array.from(root(element).querySelectorAll<T>(selector));
const canvasOf = (element: Element): HTMLCanvasElement => root(element).querySelector('canvas') as HTMLCanvasElement;
const get = (mounted: MountedComponent, name: string): unknown => mounted.store.get(`$.app.${name}` as never);
const set = (mounted: MountedComponent, name: string, value: unknown): void => {
    mounted.store.set(`$.app.${name}` as never, value as never);
};
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The RGBA of one pixel of the field's canvas, in canvas pixels */
const pixel = (element: Element, x: number, y: number): number[] => {
    const context = canvasOf(element).getContext('2d') as CanvasRenderingContext2D;
    return [...context.getImageData(x, y, 1, 1).data];
};
const bitmap = (element: Element): Uint8ClampedArray => {
    const canvas = canvasOf(element);
    return (canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, canvas.width, canvas.height).data;
};

/** Raises one pointer event on the canvas at a point given in canvas pixels, mapped through its CSS scaling */
function pointer(canvas: HTMLCanvasElement, type: string, x: number, y: number, extra: PointerEventInit = {}): void {
    const box = canvas.getBoundingClientRect();
    const clientX = box.left + (x * box.width) / canvas.width;
    const clientY = box.top + (y * box.height) / canvas.height;
    canvas.dispatchEvent(new PointerEvent(type, { pointerId: 7, isPrimary: true, button: 0, buttons: 1, pointerType: 'mouse', clientX, clientY, bubbles: true, composed: true, cancelable: true, ...extra }));
}

/** Presses at the first point, moves to each of the others and releases at the last */
function drag(element: Element, ...points: [number, number][]): void {
    const canvas = canvasOf(element);
    const [first, ...rest] = points as [[number, number], ...[number, number][]];
    pointer(canvas, 'pointerdown', first[0], first[1]);
    for (const [x, y] of rest) pointer(canvas, 'pointermove', x, y);
    const last = points[points.length - 1] as [number, number];
    pointer(canvas, 'pointerup', last[0], last[1], { buttons: 0 });
}

/** Chooses a tool with its toolbar button */
async function choose(mounted: MountedComponent, tool: string): Promise<void> {
    const index = ALL_TOOLS.indexOf(tool);
    const buttons = all<HTMLButtonElement>(mounted.element, '.tool');
    (buttons[index] as HTMLButtonElement).click();
    await flush();
}

async function mountPaint(extra: NodeState = {}, options: Parameters<typeof mountComponent>[2] = {}): Promise<MountedComponent> {
    const mounted = mountComponent('paintField', { width: 200, height: 100, tools: ALL_TOOLS, colors: [RED, BLUE], sizes: [4, 20], ...extra }, options);
    await flush();
    return mounted;
}

/** Where each shape from (20, 20) to (180, 80) paints and where it does not, with a point only the preview to (190, 95) paints */
const SHAPES = [
    { tool: 'line', trail: [190, 95], on: [[100, 50]], off: [[100, 25], [180, 20]] },
    { tool: 'rect', trail: [190, 95], on: [[100, 20], [180, 50], [100, 80], [20, 50]], off: [[100, 50]] },
    { tool: 'ellipse', trail: [190, 57], on: [[100, 20], [180, 50], [100, 80], [20, 50]], off: [[100, 50], [22, 22]] }
] as const;

describe('paintField shape and fill tools in Chromium (G2.6b)', () => {
    afterEach(() => {
        mountComponent.unmountAll();
        vi.restoreAllMocks();
    });

    it('should show a button for each tool listed in tools, with its label and a core icon', async () => {
        // Arrange
        const mounted = await mountPaint();

        // Assert
        const buttons = all(mounted.element, '.tool');
        expect(buttons.map((tool) => tool.textContent?.trim())).toEqual(['Brush', 'Eraser', 'Line', 'Rectangle', 'Ellipse', 'Fill']);
        const icons = buttons.map((tool) => tool.querySelector('ui-icon')?.getAttribute('name'));
        expect(icons).toEqual(['brush', 'eraser', 'line', 'square', 'oval', 'bucket-droplet']);
        for (const icon of icons) expect(CORE_ICON_NAMES).toContain(icon);
    });

    it('should show the German labels of the new tools, and only the tools listed', async () => {
        // Arrange
        const mounted = await mountPaint({ tools: ['fill', 'line'] }, { locale: 'de' });
        await flush();

        // Assert
        expect(all(mounted.element, '.tool').map((tool) => tool.textContent?.trim())).toEqual(['Füllen', 'Linie']);
        expect(get(mounted, 'tool')).toBe('brush');
    });

    it('should keep the brush and the eraser when tools is not set', async () => {
        // Arrange
        const mounted = mountComponent('paintField', { width: 200, height: 100 });
        await flush();

        // Assert
        expect(all(mounted.element, '.tool').map((tool) => tool.textContent?.trim())).toEqual(['Brush', 'Eraser']);
    });

    it('should refuse a node whose tools name a tool the engine lacks as SUI-STATE-INVALID', () => {
        // Act and assert
        expect(() => mountComponent('paintField', { tools: ['brush', 'spray'] })).toThrow(/SUI-STATE-INVALID Property "tools" at \$\.app\.tools/);
    });

    it('should report a tool the engine lacks written at run time once as SUI-STATE-INVALID and leave it out', async () => {
        // Arrange
        const warn = vi.spyOn(report, 'warning').mockImplementation(() => undefined);
        const invalid = (): unknown[][] => warn.mock.calls.filter((call) => (call[1] as { code?: string } | undefined)?.code === 'SUI-STATE-INVALID');
        const mounted = await mountPaint({ tools: ['brush', 'fill'] });

        // Act
        set(mounted, 'tools', ['brush', 'spray', 'fill']);
        await flush();
        set(mounted, 'colors', [BLUE]);
        await flush();

        // Assert
        expect(all(mounted.element, '.tool').map((tool) => tool.textContent?.trim())).toEqual(['Brush', 'Fill']);
        expect(invalid()).toHaveLength(1);
        expect(String(invalid()[0]?.[0])).toContain('"spray"');
        expect(invalid()[0]?.[1]).toMatchObject({ code: 'SUI-STATE-INVALID', path: '$.app' });
    });

    it.each(SHAPES)('should preview a $tool while the pointer moves and draw it on release', async ({ tool, trail, on, off }) => {
        // Arrange
        const mounted = await mountPaint();
        await choose(mounted, tool);
        const canvas = canvasOf(mounted.element);

        // Act
        pointer(canvas, 'pointerdown', 20, 20);
        pointer(canvas, 'pointermove', 190, 95);
        const preview = pixel(mounted.element, trail[0], trail[1]);
        pointer(canvas, 'pointermove', 180, 80);
        const moved = pixel(mounted.element, trail[0], trail[1]);
        pointer(canvas, 'pointerup', 180, 80, { buttons: 0 });

        // Assert
        expect(get(mounted, 'tool')).toBe(tool);
        expect(preview[3]).toBeGreaterThan(0);
        expect(moved[3]).toBe(0);
        for (const [x, y] of on) expect(pixel(mounted.element, x, y)).toEqual([255, 0, 0, 255]);
        for (const [x, y] of off) expect(pixel(mounted.element, x, y)).toEqual([0, 0, 0, 0]);
        expect(get(mounted, 'dirty')).toBe(true);
    });

    it.each(SHAPES)('should leave the canvas as it was when a $tool is cancelled before release', async ({ tool }) => {
        // Arrange
        const mounted = await mountPaint();
        drag(mounted.element, [10, 50], [100, 50], [190, 50]);
        const before = bitmap(mounted.element);
        await choose(mounted, tool);
        const canvas = canvasOf(mounted.element);

        // Act
        pointer(canvas, 'pointerdown', 20, 20);
        pointer(canvas, 'pointermove', 180, 80);
        const during = bitmap(mounted.element);
        pointer(canvas, 'pointercancel', 180, 80, { buttons: 0 });

        // Assert
        expect(during).not.toEqual(before);
        expect(bitmap(mounted.element)).toEqual(before);
    });

    it('should draw nothing for a shape pressed and released on one point', async () => {
        // Arrange
        const mounted = await mountPaint();
        await choose(mounted, 'rect');

        // Act
        drag(mounted.element, [50, 50]);

        // Assert
        expect(bitmap(mounted.element).every((byte) => byte === 0)).toBe(true);
        expect(get(mounted, 'dirty')).toBe(false);
    });

    it('should flood fill inside a rectangle in the chosen colour, and undo the fill', async () => {
        // Arrange
        const mounted = await mountPaint();
        await choose(mounted, 'rect');
        drag(mounted.element, [20, 20], [180, 80]);
        await choose(mounted, 'fill');
        (all<HTMLButtonElement>(mounted.element, '.color')[1] as HTMLButtonElement).click();
        await flush();

        // Act
        drag(mounted.element, [100, 50]);

        // Assert
        await expect.poll(() => pixel(mounted.element, 100, 50)).toEqual([0, 0, 255, 255]);
        expect(pixel(mounted.element, 30, 30)).toEqual([0, 0, 255, 255]);
        expect(pixel(mounted.element, 100, 20)).toEqual([255, 0, 0, 255]);
        expect(pixel(mounted.element, 5, 5)).toEqual([0, 0, 0, 0]);
        expect(pixel(mounted.element, 195, 95)).toEqual([0, 0, 0, 0]);
        expect(get(mounted, 'dirty')).toBe(true);

        (root(mounted.element).querySelector('.undo') as HTMLButtonElement).click();
        await flush();
        expect(pixel(mounted.element, 100, 50)).toEqual([0, 0, 0, 0]);
        expect(pixel(mounted.element, 100, 20)).toEqual([255, 0, 0, 255]);
    });

    it('should flood fill an empty canvas out to every border', async () => {
        // Arrange
        const mounted = await mountPaint({ tool: 'fill' });

        // Act
        drag(mounted.element, [100, 50]);

        // Assert
        await expect.poll(() => pixel(mounted.element, 0, 0)).toEqual([255, 0, 0, 255]);
        expect(pixel(mounted.element, 199, 99)).toEqual([255, 0, 0, 255]);
        expect(get(mounted, 'dirty')).toBe(true);
    });

    it('should save a painting only once a large fill under way is on the canvas', async () => {
        // Arrange
        const files: File[] = [];
        const transferFile: TransferFile = (file) => {
            files.push(file);
            return new Promise<FileReference>(() => undefined);
        };
        const mounted = mountComponent('paintField', { width: 2000, height: 2000, tools: ALL_TOOLS, tool: 'fill', colors: [RED] }, { hooks: { transferFile } });
        await flush();
        const canvas = canvasOf(mounted.element);

        // Act: fill, then leave the field at once, while the fill is still being written
        drag(mounted.element, [1000, 1000]);
        const early = pixel(mounted.element, 1999, 1999);
        canvas.focus();
        const outside = document.createElement('button');
        document.body.append(outside);
        outside.focus();
        await expect.poll(() => files.length, { timeout: 10000 }).toBe(1);
        outside.remove();

        // Assert
        expect(early).toEqual([0, 0, 0, 0]);
        const bitmap = await createImageBitmap(files[0] as File);
        const copy = document.createElement('canvas');
        copy.width = bitmap.width;
        copy.height = bitmap.height;
        const context = copy.getContext('2d') as CanvasRenderingContext2D;
        context.drawImage(bitmap, 0, 0);
        expect([...context.getImageData(1999, 1999, 1, 1).data]).toEqual([255, 0, 0, 255]);
        expect([...context.getImageData(0, 0, 1, 1).data]).toEqual([255, 0, 0, 255]);
    });
});
