import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent, NodeState } from '../harness/createMountComponent.js';

const RED = '#ff0000';
const BLUE = '#0000ff';
const REF = { id: '3f0c8a52-1d3e-4b7a-9c61-0a2b4c6d8e10', name: 'painting.png', size: 1234, type: 'image/png' };

const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;
const part = <T extends Element = HTMLElement>(element: Element, selector: string): T => root(element).querySelector(selector) as T;
const all = <T extends Element = HTMLElement>(element: Element, selector: string): T[] => Array.from(root(element).querySelectorAll<T>(selector));
const canvasOf = (element: Element): HTMLCanvasElement => part<HTMLCanvasElement>(element, 'canvas');
const button = (element: Element, selector: string): HTMLButtonElement => part<HTMLButtonElement>(element, selector);
const get = (mounted: MountedComponent, name: string): unknown => mounted.store.get(`$.app.${name}` as never);
const set = (mounted: MountedComponent, name: string, value: unknown): void => {
    mounted.store.set(`$.app.${name}` as never, value as never);
};
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const command = (element: Element, name: string): void => {
    (element as Element & { commands: Record<string, () => void> }).commands[name]?.();
};
const record = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};

/** The RGBA of one pixel of the field's canvas, in canvas pixels */
const pixel = (element: Element, x: number, y: number): number[] => {
    const context = canvasOf(element).getContext('2d') as CanvasRenderingContext2D;
    return [...context.getImageData(x, y, 1, 1).data];
};
const blank = (element: Element): boolean => {
    const canvas = canvasOf(element);
    const data = (canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, canvas.width, canvas.height).data;
    return data.every((byte) => byte === 0);
};

/** Raises one pointer event on the canvas at a point given in canvas pixels, mapped through its CSS scaling */
function pointer(canvas: HTMLCanvasElement, type: string, x: number, y: number, extra: PointerEventInit = {}): void {
    const box = canvas.getBoundingClientRect();
    const clientX = box.left + (x * box.width) / canvas.width;
    const clientY = box.top + (y * box.height) / canvas.height;
    canvas.dispatchEvent(new PointerEvent(type, { pointerId: 7, isPrimary: true, button: 0, buttons: 1, pointerType: 'mouse', clientX, clientY, bubbles: true, composed: true, cancelable: true, ...extra }));
}

/** Draws a stroke through the points with pointer events: down at the first, a move to each of the others, up at the last */
function stroke(element: Element, ...points: [number, number][]): void {
    const canvas = canvasOf(element);
    const [first, ...rest] = points as [[number, number], ...[number, number][]];
    pointer(canvas, 'pointerdown', first[0], first[1]);
    for (const [x, y] of rest) pointer(canvas, 'pointermove', x, y);
    const last = points[points.length - 1] as [number, number];
    pointer(canvas, 'pointerup', last[0], last[1], { buttons: 0 });
}

/** A horizontal stroke across the middle of a 200 by 100 canvas */
const across = (element: Element): void => stroke(element, [10, 50], [100, 50], [190, 50]);

async function mountPaint(extra: NodeState = {}, options: Parameters<typeof mountComponent>[2] = {}): Promise<MountedComponent> {
    const mounted = mountComponent('paintField', { width: 200, height: 100, colors: [RED, BLUE], sizes: [4, 20], ...extra }, options);
    await flush();
    return mounted;
}

/** The element focused now, through the shadow roots */
function deepActive(): Element | null {
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
}

describe('paintField in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should draw a canvas of width by height pixels, scaled by CSS, with a button per tool, colour and size', async () => {
        // Arrange
        const mounted = await mountPaint({ width: 640, height: 240 });
        const canvas = canvasOf(mounted.element);

        // Assert
        expect([canvas.width, canvas.height]).toEqual([640, 240]);
        expect(getComputedStyle(canvas).touchAction).toBe('none');
        expect(all(mounted.element, '.tool').map((tool) => tool.textContent?.trim())).toEqual(['Brush', 'Eraser']);
        expect(all(mounted.element, '.color').map((color) => color.getAttribute('aria-label'))).toEqual([`Colour ${RED}`, `Colour ${BLUE}`]);
        expect(all(mounted.element, '.size').map((size) => size.getAttribute('aria-label'))).toEqual(['Size 4', 'Size 20']);
        expect([button(mounted.element, '.undo'), button(mounted.element, '.redo'), button(mounted.element, '.clear')].map((each) => each.textContent?.trim())).toEqual(['Undo', 'Redo', 'Clear']);
        expect(all<HTMLButtonElement>(mounted.element, 'button').every((each) => each.type === 'button')).toBe(true);
    });

    it('should show a button for each listed tool only, and start a new painting on a new size', async () => {
        // Arrange
        const mounted = await mountPaint({ tools: ['brush'] });
        across(mounted.element);
        expect(get(mounted, 'dirty')).toBe(true);

        // Act
        set(mounted, 'width', 300);
        await flush();

        // Assert
        expect(all(mounted.element, '.tool')).toHaveLength(1);
        expect(canvasOf(mounted.element).width).toBe(300);
        expect(blank(mounted.element)).toBe(true);
        expect(get(mounted, 'dirty')).toBe(false);
    });

    it('should paint a brush stroke with pointer events in the first colour and the first size', async () => {
        // Arrange
        const mounted = await mountPaint();

        // Act
        across(mounted.element);

        // Assert
        expect(pixel(mounted.element, 100, 50)).toEqual([255, 0, 0, 255]);
        expect(pixel(mounted.element, 100, 49)).toEqual([255, 0, 0, 255]);
        expect(pixel(mounted.element, 100, 40)[3]).toBe(0);
        expect(pixel(mounted.element, 100, 10)[3]).toBe(0);
    });

    it('should paint a token colour resolved from the theme', async () => {
        // Arrange
        const mounted = await mountPaint({ colors: ['{color.text.base}'] });

        // Act
        across(mounted.element);

        // Assert
        const painted = pixel(mounted.element, 100, 50);
        expect(painted[3]).toBe(255);
        expect(getComputedStyle(canvasOf(mounted.element)).getPropertyValue('--ui-color-text-base').trim()).not.toBe('');
    });

    it('should erase with the eraser tool chosen from its button', async () => {
        // Arrange
        const mounted = await mountPaint();
        across(mounted.element);
        const eraser = all<HTMLButtonElement>(mounted.element, '.tool')[1] as HTMLButtonElement;

        // Act
        eraser.click();
        await flush();
        stroke(mounted.element, [100, 5], [100, 95]);

        // Assert
        expect(get(mounted, 'tool')).toBe('eraser');
        expect(eraser.getAttribute('aria-pressed')).toBe('true');
        expect(all(mounted.element, '.tool')[0]?.getAttribute('aria-pressed')).toBe('false');
        expect(pixel(mounted.element, 100, 50)[3]).toBe(0);
        expect(pixel(mounted.element, 30, 50)).toEqual([255, 0, 0, 255]);
    });

    it('should change the colour and the size from their buttons and write them to the node', async () => {
        // Arrange
        const mounted = await mountPaint();
        const [, blue] = all<HTMLButtonElement>(mounted.element, '.color');
        const [, wide] = all<HTMLButtonElement>(mounted.element, '.size');

        // Act
        blue?.click();
        wide?.click();
        await flush();
        across(mounted.element);

        // Assert
        expect(get(mounted, 'color')).toBe(BLUE);
        expect(get(mounted, 'brushSize')).toBe(20);
        expect(blue?.getAttribute('aria-pressed')).toBe('true');
        expect(wide?.getAttribute('aria-pressed')).toBe('true');
        expect(all(mounted.element, '.color')[0]?.getAttribute('aria-pressed')).toBe('false');
        expect(pixel(mounted.element, 100, 50)).toEqual([0, 0, 255, 255]);
        expect(pixel(mounted.element, 100, 42)).toEqual([0, 0, 255, 255]);
    });

    it('should follow tool, color and brushSize written from outside', async () => {
        // Arrange
        const mounted = await mountPaint();

        // Act
        set(mounted, 'color', BLUE);
        set(mounted, 'brushSize', 20);
        await flush();
        across(mounted.element);
        set(mounted, 'tool', 'eraser');
        await flush();
        stroke(mounted.element, [100, 5], [100, 95]);

        // Assert
        expect(all(mounted.element, '.color')[1]?.getAttribute('aria-pressed')).toBe('true');
        expect(all(mounted.element, '.size')[1]?.getAttribute('aria-pressed')).toBe('true');
        expect(all(mounted.element, '.tool')[1]?.getAttribute('aria-pressed')).toBe('true');
        expect(pixel(mounted.element, 30, 42)).toEqual([0, 0, 255, 255]);
        expect(pixel(mounted.element, 100, 50)[3]).toBe(0);
    });

    it('should undo, redo and clear from the buttons', async () => {
        // Arrange
        const mounted = await mountPaint();
        across(mounted.element);

        // Act and assert
        button(mounted.element, '.undo').click();
        expect(blank(mounted.element)).toBe(true);
        button(mounted.element, '.redo').click();
        expect(pixel(mounted.element, 100, 50)).toEqual([255, 0, 0, 255]);
        button(mounted.element, '.clear').click();
        expect(blank(mounted.element)).toBe(true);
        button(mounted.element, '.undo').click();
        expect(pixel(mounted.element, 100, 50)).toEqual([255, 0, 0, 255]);
    });

    it('should undo, redo and clear from the commands, and clear empties the value', async () => {
        // Arrange
        const mounted = await mountPaint({ '<-value': '$.data.signature' }, { data: { signature: REF } });
        const changed = record(mounted.element, 'changed');
        across(mounted.element);

        // Act and assert
        command(mounted.element, 'undo');
        expect(blank(mounted.element)).toBe(true);
        command(mounted.element, 'redo');
        expect(pixel(mounted.element, 100, 50)).toEqual([255, 0, 0, 255]);
        command(mounted.element, 'clear');
        expect(blank(mounted.element)).toBe(true);
        expect(mounted.store.get('$.data.signature' as never)).toEqual({});
        await flush();
        expect(changed).toEqual([{ value: {} }]);
    });

    it('should keep dirty true in the runtime state while unsaved strokes exist', async () => {
        // Arrange
        const mounted = await mountPaint();
        expect(get(mounted, 'dirty')).toBe(false);

        // Act and assert
        across(mounted.element);
        expect(get(mounted, 'dirty')).toBe(true);
        command(mounted.element, 'undo');
        expect(get(mounted, 'dirty')).toBe(false);
        command(mounted.element, 'redo');
        expect(get(mounted, 'dirty')).toBe(true);
        command(mounted.element, 'clear');
        expect(get(mounted, 'dirty')).toBe(false);
        command(mounted.element, 'undo');
        expect(get(mounted, 'dirty')).toBe(true);
        command(mounted.element, 'reset');
        expect(get(mounted, 'dirty')).toBe(false);
        expect(blank(mounted.element)).toBe(true);
    });

    it('should hold no image data in the store', async () => {
        // Arrange
        const mounted = await mountPaint();

        // Act
        across(mounted.element);
        stroke(mounted.element, [20, 20], [180, 80]);
        const state = JSON.stringify(mounted.store.get('$' as never));

        // Assert
        expect(state).not.toContain('data:image');
        expect(state).not.toMatch(/\[(?:\d{1,3},){64}/);
        expect(state.length).toBeLessThan(200_000);
        expect(JSON.stringify(get(mounted, 'value'))).toBe('{}');
    });

    it('should be registered by a surrounding form, and required makes it invalid while empty', async () => {
        // Arrange
        const mounted = mountComponent('form', { children: { signature: { component: 'paintField', required: true } } });
        await flush();
        const invalid = record(mounted.element, 'invalid');
        const submitted = record(mounted.element, 'submitted');

        // Act
        command(mounted.element, 'submit');
        await flush();
        const field = root(mounted.element).querySelector('ui-paint-field') as Element;

        // Assert
        expect(invalid).toContainEqual({ keys: ['signature'] });
        expect(invalid).toContainEqual({ rule: 'required' });
        expect(submitted).toEqual([]);
        expect(mounted.store.get('$.app.children.signature.error' as never)).toBe('required');
        expect(part(field, '.error').textContent).toBe('Draw something here');
        expect(part(field, '.field').getAttribute('aria-describedby')).toBe('help error');
    });

    it('should pass required with a file reference and give the form that value', async () => {
        // Arrange
        const mounted = mountComponent('form', { children: { signature: { component: 'paintField', required: true, value: REF } } });
        await flush();
        const submitted = record(mounted.element, 'submitted');

        // Act
        command(mounted.element, 'submit');

        // Assert
        expect(submitted).toEqual([{ values: { signature: REF } }]);
    });

    it('should be a group labelled by its label and described by its description, with the canvas an image named by the label', async () => {
        // Arrange
        const mounted = await mountPaint({ _label: 'Signature' });
        const group = part(mounted.element, '.field');
        const label = part(mounted.element, '#label');
        const canvas = canvasOf(mounted.element);

        // Assert
        expect(group.getAttribute('role')).toBe('group');
        expect(group.getAttribute('aria-labelledby')).toBe('label');
        expect(label.textContent).toBe('Signature');
        expect(group.getAttribute('aria-describedby')).toBe('help');
        expect(part(mounted.element, '#help').textContent).toContain('pointer');
        expect(canvas.getAttribute('role')).toBe('img');
        expect(canvas.getAttribute('aria-labelledby')).toBe('label');
        expect(part(mounted.element, '.toolbar').getAttribute('aria-label')).toBe('Painting tools');
    });

    it('should show the German texts', async () => {
        // Arrange
        const mounted = await mountPaint({}, { locale: 'de' });
        await flush();

        // Assert
        expect(part(mounted.element, '#label').textContent).toBe('Zeichnung');
        expect(all(mounted.element, '.tool').map((tool) => tool.textContent?.trim())).toEqual(['Pinsel', 'Radierer']);
        expect(button(mounted.element, '.clear').textContent?.trim()).toBe('Leeren');
    });

    it('should move focus by Tab through tools, colours, sizes, undo, redo, clear and then the canvas', async () => {
        // Arrange
        const mounted = await mountPaint();
        const expected = [
            ...all(mounted.element, '.tool'),
            ...all(mounted.element, '.color'),
            ...all(mounted.element, '.size'),
            button(mounted.element, '.undo'),
            button(mounted.element, '.redo'),
            button(mounted.element, '.clear'),
            canvasOf(mounted.element)
        ];
        const seen: (Element | null)[] = [];

        // Act
        for (let i = 0; i < expected.length; i++) {
            await userEvent.tab();
            seen.push(deepActive());
        }

        // Assert
        expect(seen).toEqual(expected);
    });

    it('should operate the toolbar buttons by keyboard', async () => {
        // Arrange
        const mounted = await mountPaint();
        across(mounted.element);

        // Act
        all(mounted.element, '.tool')[1]?.focus();
        await userEvent.keyboard('{Enter}');
        all(mounted.element, '.color')[1]?.focus();
        await userEvent.keyboard(' ');
        button(mounted.element, '.undo').focus();
        await userEvent.keyboard('{Enter}');

        // Assert
        expect(get(mounted, 'tool')).toBe('eraser');
        expect(get(mounted, 'color')).toBe(BLUE);
        expect(blank(mounted.element)).toBe(true);
    });

    it('should take no keyboard input on the canvas', async () => {
        // Arrange
        const mounted = await mountPaint();
        across(mounted.element);
        const before = JSON.stringify(mounted.store.get('$.app' as never));

        // Act
        canvasOf(mounted.element).focus();
        await userEvent.keyboard('{Enter} {Backspace}{Delete}z{ArrowLeft}');

        // Assert
        expect(deepActive()).toBe(canvasOf(mounted.element));
        expect(JSON.stringify(mounted.store.get('$.app' as never))).toBe(before);
        expect(pixel(mounted.element, 100, 50)).toEqual([255, 0, 0, 255]);
    });

    it.each(['disabled', 'readonly'])('should draw nothing and disable every toolbar button when %s', async (flag) => {
        // Arrange
        const mounted = await mountPaint({ [flag]: true });

        // Act
        across(mounted.element);
        all<HTMLButtonElement>(mounted.element, '.tool')[1]?.click();

        // Assert
        expect(blank(mounted.element)).toBe(true);
        expect(get(mounted, 'dirty')).toBe(false);
        expect(get(mounted, 'tool')).toBe('brush');
        expect(all<HTMLButtonElement>(mounted.element, 'button').every((each) => each.disabled)).toBe(true);
    });

    it('should draw nothing when locked by a disabled form', async () => {
        // Arrange
        const mounted = mountComponent('form', { disabled: true, children: { signature: { component: 'paintField', width: 200, height: 100 } } });
        await flush();
        const field = root(mounted.element).querySelector('ui-paint-field') as Element;

        // Act
        across(field);

        // Assert
        expect(mounted.store.get('$.app.children.signature.locked' as never)).toBe(true);
        expect(blank(field)).toBe(true);
        expect(all<HTMLButtonElement>(field, 'button').every((each) => each.disabled)).toBe(true);
    });

    it('should stop a stroke that is under way when the field becomes disabled', async () => {
        // Arrange
        const mounted = await mountPaint();
        const canvas = canvasOf(mounted.element);
        pointer(canvas, 'pointerdown', 10, 50);

        // Act
        set(mounted, 'disabled', true);
        pointer(canvas, 'pointermove', 190, 50);
        pointer(canvas, 'pointerup', 190, 50, { buttons: 0 });

        // Assert
        expect(blank(mounted.element)).toBe(true);
        expect(get(mounted, 'dirty')).toBe(false);
    });
});
