import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const TILES = '/__map-tiles/{z}/{x}/{y}.png';

const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const all = (element: Element, selector: string): HTMLElement[] => [...(element.shadowRoot?.querySelectorAll<HTMLElement>(selector) ?? [])];
const until = async (check: () => boolean, timeout = 3000): Promise<void> => {
    const start = performance.now();
    while (!check()) {
        if (performance.now() - start > timeout) throw new Error('timed out');
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
};
const command = (element: Element, name: string, value?: unknown): void => {
    (element as Element & { commands: Record<string, (value: unknown, payload: unknown) => void> }).commands[name]?.(value, undefined);
};

/** A map of 512 by 256 pixels at zoom 1 over the equator, with two markers */
async function mountMap(extra: Record<string, unknown> = {}): Promise<ReturnType<typeof mountComponent>> {
    const mounted = mountComponent('map', {
        tiles: TILES,
        lat: 0,
        lng: 0,
        zoom: 1,
        markers: { depot: { lat: 0, lng: 0, _label: 'Depot' }, shop: { lat: 40, lng: 90, _label: 'Shop' } },
        ...extra
    });
    (mounted.element as HTMLElement).style.cssText = 'display: block; inline-size: 512px; block-size: 256px';
    await until(() => mounted.store.get('$.app.width') === 512 && mounted.store.get('$.app.height') === 256);
    return mounted;
}

describe('map in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should cover its size with tiles from the template and stand each marker on its place', async () => {
        // Act
        const mounted = await mountMap();
        const tiles = all(mounted.element, '.tile');
        const depot = part<HTMLButtonElement>(mounted.element, '.marker[data-key="depot"]');

        // Assert
        expect(tiles.map((tile) => tile.getAttribute('src')).sort()).toEqual(['/__map-tiles/1/0/0.png', '/__map-tiles/1/0/1.png', '/__map-tiles/1/1/0.png', '/__map-tiles/1/1/1.png']);
        expect(tiles[0]?.getAttribute('alt')).toBe('');
        expect(depot.style.left).toBe('256px');
        expect(depot.style.top).toBe('128px');
        expect(depot.getAttribute('aria-label')).toBe('Depot');
        expect(part(mounted.element, '.map').getAttribute('aria-roledescription')).toBe('map');
    });

    it('should select a pressed marker and raise select with its place', async () => {
        // Arrange
        const mounted = await mountMap();
        const selects: unknown[] = [];
        mounted.element.addEventListener('select', (event) => selects.push((event as CustomEvent).detail));

        // Act
        await userEvent.click(part(mounted.element, '.marker[data-key="shop"]'));

        // Assert
        expect(mounted.store.get('$.app.selected')).toBe('shop');
        expect(selects).toEqual([{ key: 'shop', lat: 40, lng: 90 }]);
        await until(() => part(mounted.element, '.marker[data-key="shop"]').getAttribute('aria-pressed') === 'true');
    });

    it('should pan with a drag and with the arrows, zoom with keys and buttons, and raise change', async () => {
        // Arrange
        const mounted = await mountMap({ maxZoom: 2 });
        const changes: unknown[] = [];
        mounted.element.addEventListener('change', (event) => changes.push((event as CustomEvent).detail));
        const map = part<HTMLElement>(mounted.element, '.map');
        const box = map.getBoundingClientRect();
        const at = (type: string, x: number): PointerEvent => new PointerEvent(type, { pointerId: 3, button: 0, clientX: x, clientY: box.top + 20, bubbles: true });

        // Act
        map.dispatchEvent(at('pointerdown', box.left + 300));
        map.dispatchEvent(at('pointermove', box.left + 172));
        map.dispatchEvent(at('pointerup', box.left + 172));
        const dragged = mounted.store.get('$.app.lng');
        map.focus();
        await userEvent.keyboard('{ArrowRight}');
        const keyed = mounted.store.get('$.app.lng');
        await userEvent.keyboard('+');
        await userEvent.click(part(mounted.element, '.zoom-out'));
        await userEvent.click(part(mounted.element, '.zoom-in'));

        // Assert
        expect(dragged).toBeCloseTo(90, 5);
        expect(keyed).toBeCloseTo(135, 5);
        expect(mounted.store.get('$.app.zoom')).toBe(2);
        expect(mounted.store.get('$.app.atMax')).toBe(true);
        expect(part<HTMLButtonElement>(mounted.element, '.zoom-in').disabled).toBe(true);
        expect(changes).toHaveLength(5);
        expect(changes[0]).toEqual({ lat: 0, lng: 90, zoom: 1 });
    });

    it('should zoom around the pointer with the wheel and move to a place on lookAt', async () => {
        // Arrange
        const mounted = await mountMap();
        const map = part<HTMLElement>(mounted.element, '.map');
        const box = map.getBoundingClientRect();

        // Act
        map.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, clientX: box.left + 256, clientY: box.top + 128, bubbles: true, cancelable: true }));
        await until(() => mounted.store.get('$.app.zoom') === 2);
        const centred = [mounted.store.get('$.app.lat'), mounted.store.get('$.app.lng')];
        command(mounted.element, 'lookAt', { lat: 51.5, lng: -0.12, zoom: 12 });

        // Assert
        expect(centred).toEqual([0, 0]);
        expect([mounted.store.get('$.app.lat'), mounted.store.get('$.app.lng'), mounted.store.get('$.app.zoom')]).toEqual([51.5, -0.12, 12]);
        await until(() => all(mounted.element, '.tile').every((tile) => (tile.getAttribute('src') ?? '').startsWith('/__map-tiles/12/')));
    });

    it('should draw no tiles from a template that is not https or our own origin', async () => {
        // Act
        const mounted = await mountMap({ tiles: 'http://tiles.example.com/{z}/{x}/{y}.png' });

        // Assert
        expect(all(mounted.element, '.tile')).toHaveLength(0);
        expect(all(mounted.element, '.marker')).toHaveLength(2);
    });
});
