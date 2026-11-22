import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;
const part = <T extends HTMLElement>(element: Element, selector: string): T => root(element).querySelector(selector) as T;
const command = (element: Element, name: string): void => {
    (element as Element & { commands: Record<string, () => void> }).commands[name]?.();
};
const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** A picture of a colour as inline png data, drawn on a canvas */
const picture = (colour: string, width = 400, height = 300): string => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    context.fillStyle = colour;
    context.fillRect(0, 0, width, height);
    return canvas.toDataURL('image/png');
};

const gallery = (): Record<string, unknown> => ({
    dock: { src: picture('#1d4ed8'), _alt: 'The dock at dawn', _caption: 'Dawn, from the north pier' },
    pier: { src: picture('#15803d'), _alt: 'The pier' },
    gate: { src: picture('#b91c1c'), _alt: 'The gate', _caption: 'The old gate' }
});

describe('lightbox in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should open full screen at the active picture with its alt text, caption and position', async () => {
        // Arrange
        const mounted = mountComponent('lightbox', { images: gallery(), active: 'pier' });
        const opened: number[] = [];
        mounted.element.addEventListener('open', () => opened.push(1));

        // Act
        command(mounted.element, 'open');
        await frame();
        const dialog = part<HTMLDialogElement>(mounted.element, 'dialog');

        // Assert
        expect(dialog.open).toBe(true);
        expect(opened).toHaveLength(1);
        expect(part<HTMLImageElement>(mounted.element, 'img.picture').alt).toBe('The pier');
        expect(part(mounted.element, '.progress').textContent).toBe('2 of 3');
        expect(part(mounted.element, '.caption')).toBeNull();
        expect(Math.round(dialog.getBoundingClientRect().width)).toBe(window.innerWidth);
    });

    it('should move with the buttons and the arrow keys, raise change, stop at the ends and wrap with loop', async () => {
        // Arrange
        const mounted = mountComponent('lightbox', { images: gallery(), active: 'dock' });
        const changes: string[] = [];
        mounted.element.addEventListener('change', (event) => changes.push((event as CustomEvent<string>).detail));
        command(mounted.element, 'open');
        await frame();

        // Act
        await userEvent.click(part(mounted.element, '.next'));
        await userEvent.keyboard('{ArrowRight}');
        const atEnd = part<HTMLButtonElement>(mounted.element, '.next').disabled;
        await userEvent.keyboard('{ArrowRight}');
        mounted.store.set('$.app.loop', true);
        await userEvent.keyboard('{ArrowRight}');

        // Assert
        expect(changes).toEqual(['pier', 'gate', 'dock']);
        expect(atEnd).toBe(true);
        expect(part(mounted.element, '.caption').textContent).toBe('Dawn, from the north pier');
        expect(part<HTMLButtonElement>(mounted.element, '.previous').disabled).toBe(false);
    });

    it('should zoom in to a scrolling stage, pan by a drag, and fit again for the next picture', async () => {
        // Arrange
        const mounted = mountComponent('lightbox', { images: gallery(), active: 'dock' });
        command(mounted.element, 'open');
        await frame();
        const stage = part(mounted.element, '.stage');

        // Act
        await userEvent.click(part(mounted.element, '.zoom-in'));
        await userEvent.click(part(mounted.element, '.zoom-in'));
        await frame();
        await frame();
        const zoomed = { zoom: mounted.store.get('$.app.zoom'), wide: stage.scrollWidth > stage.clientWidth, left: stage.scrollLeft };
        const box = stage.getBoundingClientRect();
        const at = (type: string, dx: number): void => {
            stage.dispatchEvent(new PointerEvent(type, { pointerId: 7, button: 0, bubbles: true, composed: true, clientX: box.left + box.width / 2 + dx, clientY: box.top + box.height / 2 }));
        };
        at('pointerdown', 0);
        at('pointermove', -80);
        at('pointerup', -80);
        const panned = stage.scrollLeft;
        command(mounted.element, 'next');
        await frame();

        // Assert
        expect(zoomed.zoom).toBe(2);
        expect(zoomed.wide).toBe(true);
        expect(zoomed.left).toBeGreaterThan(0);
        expect(panned).toBeGreaterThan(zoomed.left);
        expect(mounted.store.get('$.app.zoom')).toBe(1);
        expect(stage.hasAttribute('data-zoomed')).toBe(false);
    });

    it('should close on Escape and leave out a picture whose source is not https or picture data', async () => {
        // Arrange
        const mounted = mountComponent('lightbox', { images: [{ src: 'http://example.com/a.jpg', alt: 'Plain http' }, { id: 'ok', src: picture('#000000'), alt: 'Black' }] });
        command(mounted.element, 'open');
        await frame();

        // Act
        const count = mounted.store.get('$.app.count');
        const alt = part<HTMLImageElement>(mounted.element, 'img.picture').alt;
        await userEvent.keyboard('{Escape}');

        // Assert
        expect(count).toBe(1);
        expect(alt).toBe('Black');
        expect(part(mounted.element, '.previous')).toBeNull();
        expect(mounted.store.get('$.app.open')).toBe(false);
    });
});
