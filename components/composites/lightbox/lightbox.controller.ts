import type { ControllerContext } from '@punyts/stateui';
import { galleryImages, galleryIndex, galleryStep, zoomStep } from '../shared/lightbox/gallery.js';
import type { GalleryImage } from '../shared/lightbox/gallery.js';
import { registerOverlayMixin } from '../shared/overlay/overlay.js';

registerOverlayMixin();

interface CommandHost {
    commands?: Record<string, () => void>;
}

/**
 * A full-screen viewer over `images` on a modal `dialog` (the `overlay` directive shows it from `open` and raises `open`
 * and `close`). The controller writes the active picture's `src`, `alt` and `caption`, its `index`, `count` and
 * `progressText`, and `atStart` and `atEnd`; previous and next write `active` (wrapping with `loop`) and raise `change`
 * with the key. The zoom steps through 1, 1.5, 2, 3 and 4 by the buttons, `+`, `-` and `0`, or a double press; a zoomed
 * picture scrolls in its stage, which a drag pans, and the zoom resets with each picture. The arrows move between
 * pictures while the picture is fitted, Home and End go to the first and last
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as HTMLElement & CommandHost;
    const path = (name: string): string => `${basePath}.${name}`;
    const read = (name: string): unknown => store.get<unknown>(path(name));
    const stage = (): HTMLElement | null => element.shadowRoot?.querySelector<HTMLElement>('.stage') ?? null;
    let images: GalleryImage[] = [];
    let drag: { id: number; x: number; y: number; left: number; top: number } | undefined;

    /**
     * Runs a write and gives the focus to the dialog when the write disabled the button that had it (next at the end,
     * zoom in at the most): Chromium drops the focus of a disabled button to the body, outside the dialog's keys
     */
    const keepingFocus = (write: () => void): void => {
        const focused = element.shadowRoot?.activeElement;
        write();
        if (focused instanceof HTMLButtonElement && focused.disabled) element.shadowRoot?.querySelector<HTMLElement>('.dialog')?.focus();
    };
    const zoom = (): number => {
        const value = read('zoom');
        return typeof value === 'number' ? value : 1;
    };
    const setZoom = (next: number): void => {
        if (next === zoom()) return;
        const before = zoom();
        keepingFocus(() => store.set(path('zoom'), next));
        host.style.setProperty('--sui-zoom', String(next));
        requestAnimationFrame(() => {
            const box = stage();
            if (box === null) return;
            const ratio = next / before;
            const centreX = (box.scrollLeft + box.clientWidth / 2) * ratio;
            const centreY = (box.scrollTop + box.clientHeight / 2) * ratio;
            box.scrollLeft = before === 1 ? (box.scrollWidth - box.clientWidth) / 2 : centreX - box.clientWidth / 2;
            box.scrollTop = before === 1 ? (box.scrollHeight - box.clientHeight) / 2 : centreY - box.clientHeight / 2;
        });
    };

    const refresh = (): void => keepingFocus(update);
    const update = (): void => {
        images = galleryImages(read('images'));
        const index = galleryIndex(images, read('active'));
        const image = images[index];
        const loop = read('loop') === true;
        const template = read('_progress');
        store.set(path('index'), index);
        store.set(path('count'), images.length);
        store.set(path('src'), image?.src ?? '');
        store.set(path('alt'), image?.alt ?? '');
        store.set(path('caption'), image?.caption ?? '');
        store.set(path('atStart'), image === undefined || (!loop && index === 0));
        store.set(path('atEnd'), image === undefined || (!loop && index === images.length - 1));
        store.set(path('progressText'), image === undefined || images.length < 2 ? '' : (typeof template === 'string' ? template : '').replace('{index}', String(index + 1)).replace('{count}', String(images.length)));
    };
    const go = (key: string | undefined): void => {
        if (key === undefined || key === read('active')) return;
        store.set(path('active'), key);
        element.dispatchEvent(new CustomEvent('change', { detail: key, bubbles: true, composed: true }));
    };
    const step = (by: 1 | -1): void => go(galleryStep(images, galleryIndex(images, read('active')), by, read('loop') === true));
    const close = (): void => store.set(path('open'), false);

    const onActive = (): void => {
        setZoom(1);
        refresh();
    };
    const watched = ['images', 'images.$all', 'loop', '_progress'].map(path);
    store.on(watched, refresh);
    store.on([path('active')], onActive);
    refresh();

    host.commands = {
        open: () => store.set(path('open'), true),
        close,
        next: () => step(1),
        previous: () => step(-1)
    };

    return {
        onPrevious: () => step(-1),
        onNext: () => step(1),
        onClose: close,
        onZoomIn: () => setZoom(zoomStep(zoom(), 1)),
        onZoomOut: () => setZoom(zoomStep(zoom(), -1)),
        onZoomReset: () => setZoom(1),
        onToggleZoom: () => setZoom(zoom() > 1 ? 1 : 2),
        onKeyDown: (event: KeyboardEvent): void => {
            const fitted = zoom() === 1;
            const handled = (() => {
                switch (event.key) {
                    case 'ArrowLeft':
                        if (!fitted) return false;
                        step(-1);
                        return true;
                    case 'ArrowRight':
                        if (!fitted) return false;
                        step(1);
                        return true;
                    case 'Home':
                        go(images[0]?.key);
                        return true;
                    case 'End':
                        go(images[images.length - 1]?.key);
                        return true;
                    case '+':
                    case '=':
                        setZoom(zoomStep(zoom(), 1));
                        return true;
                    case '-':
                        setZoom(zoomStep(zoom(), -1));
                        return true;
                    case '0':
                        setZoom(1);
                        return true;
                    default:
                        return false;
                }
            })();
            if (handled) event.preventDefault();
        },
        onPointerDown: (event: PointerEvent): void => {
            const box = stage();
            if (box === null || zoom() === 1 || event.button !== 0) return;
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: box.scrollLeft, top: box.scrollTop };
            try {
                box.setPointerCapture(event.pointerId);
            } catch {
                // a pointer that is no longer active cannot be captured; the drag still follows the stage's own events
            }
        },
        onPointerMove: (event: PointerEvent): void => {
            const box = stage();
            if (box === null || drag === undefined || event.pointerId !== drag.id) return;
            box.scrollLeft = drag.left - (event.clientX - drag.x);
            box.scrollTop = drag.top - (event.clientY - drag.y);
        },
        onPointerUp: (event: PointerEvent): void => {
            if (drag !== undefined && event.pointerId === drag.id) drag = undefined;
        },
        dispose: (): void => {
            store.off(watched, refresh);
            store.off([path('active')], onActive);
            delete host.commands;
        }
    };
}
