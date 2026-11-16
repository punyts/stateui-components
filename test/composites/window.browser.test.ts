import { page, userEvent } from 'vitest/browser';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

type Mounted = ReturnType<typeof mountComponent>;

const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;
const part = (element: Element, selector: string): HTMLElement => root(element).querySelector(selector) as HTMLElement;
const text = (value: string): Record<string, unknown> => ({ component: 'text', _text: value });
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60));
const PLACEMENT = '$.app.children.win.placement';

/** The window inside the adhoc panel the tests mount */
const win = (mounted: Mounted): HTMLElement => part(mounted.element, '.body ui-window');
const area = (mounted: Mounted): HTMLElement => part(mounted.element, '.body');
/** The window's box relative to the layout box */
const boxOf = (mounted: Mounted): { x: number; y: number; width: number; height: number } => {
    const outer = area(mounted).getBoundingClientRect();
    const inner = win(mounted).getBoundingClientRect();
    return { x: Math.round(inner.left - outer.left), y: Math.round(inner.top - outer.top), width: Math.round(inner.width), height: Math.round(inner.height) };
};
const events = (element: Element, names: readonly string[]): { name: string; detail: unknown }[] => {
    const seen: { name: string; detail: unknown }[] = [];
    for (const name of names) element.addEventListener(name, (event) => seen.push({ name, detail: (event as CustomEvent).detail }));
    return seen;
};

const mount = async (node: Record<string, unknown> = {}): Promise<Mounted> => {
    const mounted = mountComponent('panel', {
        layout: { type: 'adhoc' },
        children: {
            win: {
                component: 'window',
                _title: 'Notes',
                placement: { x: '100px', y: '50px', width: '300px', height: '200px', z: 2 },
                children: { body: text('Hello') },
                ...node
            }
        }
    });
    mounted.host.style.inlineSize = '900px';
    await flush();
    area(mounted).style.blockSize = '600px';
    area(mounted).style.padding = '0';
    await flush();
    return mounted;
};

/** Synthetic pointer events: press on `target`, move by steps, then release or not */
const pointer = (target: Element, type: string, x: number, y: number): void => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }));
};
const dragFrom = async (target: HTMLElement, dx: number, dy: number, release = true): Promise<void> => {
    const rect = target.getBoundingClientRect();
    const x = rect.left + Math.min(20, rect.width / 2);
    const y = rect.top + rect.height / 2;
    pointer(target, 'pointerdown', x, y);
    pointer(target, 'pointermove', x + dx / 2, y + dy / 2);
    pointer(target, 'pointermove', x + dx, y + dy);
    if (release) pointer(target, 'pointerup', x + dx, y + dy);
    await flush();
};

describe('window in Chromium', () => {
    beforeAll(async () => {
        await page.viewport(1200, 900);
    });
    afterAll(async () => {
        await page.viewport(414, 896);
    });
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render a named window at its placement with its content and the default buttons', async () => {
        // Arrange
        const mounted = await mount();
        const element = win(mounted);

        // Assert
        expect(boxOf(mounted)).toEqual({ x: 100, y: 50, width: 300, height: 200 });
        expect(part(element, '.window').getAttribute('aria-label')).toBe('Notes');
        expect(part(element, '.title').textContent?.trim()).toBe('Notes');
        expect(part(element, '.body ui-text')).not.toBeNull();
        const shown = Array.from(root(element).querySelectorAll('[data-control]')).map((button) => button.getAttribute('data-control'));
        expect(shown).toEqual(['minimize', 'maximize', 'close']);
        expect(part(element, '[data-control=maximize]').getAttribute('aria-label')).toBe('Maximize');
    });

    it('should show the buttons controls lists and raise one event per button', async () => {
        // Arrange
        const mounted = await mount({ controls: ['snapLeft', 'snapRight', 'close'] });
        const element = win(mounted);
        const seen = events(element, ['snapLeft', 'snapRight', 'minimize', 'maximize', 'close']);

        // Act
        for (const name of ['snapLeft', 'snapRight', 'close']) part(element, `[data-control=${name}]`).click();
        await flush();

        // Assert
        expect(part(element, '[data-control=minimize]')).toBeNull();
        expect(seen.map((event) => event.name)).toEqual(['snapLeft', 'snapRight', 'close']);
        expect(mounted.store.get(PLACEMENT)).toEqual({ x: '100px', y: '50px', width: '300px', height: '200px', z: 2 });
    });

    it('should move by a title drag, write the placement once on release and raise move', async () => {
        // Arrange
        const mounted = await mount();
        const element = win(mounted);
        const seen = events(element, ['move', 'resize']);
        let writes = 0;
        mounted.store.on([PLACEMENT], () => {
            writes += 1;
        });

        // Act
        await dragFrom(part(element, '.title'), 120, 40);

        // Assert
        expect(mounted.store.get(PLACEMENT)).toEqual({ x: '220px', y: '90px', width: '300px', height: '200px', z: 2 });
        expect(writes).toBe(1);
        expect(seen).toEqual([{ name: 'move', detail: { x: 220, y: 90, width: 300, height: 200 } }]);
        expect(boxOf(mounted)).toEqual({ x: 220, y: 90, width: 300, height: 200 });
        expect(element.style.translate).toBe('');
    });

    it('should not move for a press under the drag threshold', async () => {
        // Arrange
        const mounted = await mount();
        const seen = events(win(mounted), ['move']);

        // Act
        await dragFrom(part(win(mounted), '.title'), 2, 1);

        // Assert
        expect(seen).toEqual([]);
        expect(mounted.store.get(`${PLACEMENT}.x`)).toBe('100px');
    });

    it('should keep the title bar inside the layout box', async () => {
        // Arrange
        const mounted = await mount();

        // Act
        await dragFrom(part(win(mounted), '.title'), -1000, -500);

        // Assert
        expect(mounted.store.get(PLACEMENT)).toMatchObject({ x: '-252px', y: '0px' });
    });

    it('should resize by the corner and the edges, never under the minimum size', async () => {
        // Arrange
        const mounted = await mount();
        const seen = events(win(mounted), ['resize']);

        // Act
        await dragFrom(part(win(mounted), '.corner'), 50, 30);
        await dragFrom(part(win(mounted), '.edge-e'), -400, 0);
        await dragFrom(part(win(mounted), '.edge-s'), 0, 10);

        // Assert
        expect(seen.map((event) => event.detail)).toEqual([
            { x: 100, y: 50, width: 350, height: 230 },
            { x: 100, y: 50, width: 240, height: 230 },
            { x: 100, y: 50, width: 240, height: 240 }
        ]);
        expect(boxOf(mounted)).toEqual({ x: 100, y: 50, width: 240, height: 240 });
    });

    it('should put the window back on Escape during a drag and write nothing', async () => {
        // Arrange
        const mounted = await mount();
        const element = win(mounted);
        const seen = events(element, ['move']);

        // Act
        await dragFrom(part(element, '.title'), 120, 40, false);
        const during = boxOf(mounted);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        pointer(part(element, '.title'), 'pointerup', 0, 0);
        await flush();

        // Assert
        expect(during.x).toBe(220);
        expect(boxOf(mounted)).toEqual({ x: 100, y: 50, width: 300, height: 200 });
        expect(seen).toEqual([]);
        expect(mounted.store.get(`${PLACEMENT}.x`)).toBe('100px');
    });

    it('should move with the arrow keys and resize with Shift, and raise maximize on Enter and a double click', async () => {
        // Arrange
        const mounted = await mount();
        const element = win(mounted);
        const seen = events(element, ['move', 'resize', 'maximize']);

        // Act
        part(element, '.title').focus();
        await userEvent.keyboard('{ArrowRight}{ArrowDown}{Shift>}{ArrowRight}{/Shift}{Enter}');
        await flush();
        part(element, '.titlebar').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
        await flush();

        // Assert
        expect(seen.map((event) => event.name)).toEqual(['move', 'move', 'resize', 'maximize', 'maximize']);
        expect(mounted.store.get(PLACEMENT)).toEqual({ x: '116px', y: '66px', width: '316px', height: '200px', z: 2 });
    });

    it('should not drag a maximized or unmovable window, and hide the grips of one that is not resizable', async () => {
        // Arrange
        const mounted = await mount({ maximized: true });
        const element = win(mounted);
        const seen = events(element, ['move']);

        // Act
        await dragFrom(part(element, '.title'), 120, 40);
        mounted.store.set('$.app.children.win.maximized', false);
        mounted.store.set('$.app.children.win.movable', false);
        mounted.store.set('$.app.children.win.resizable', false);
        await flush();
        await dragFrom(part(element, '.title'), 120, 40);

        // Assert
        expect(seen).toEqual([]);
        expect(getComputedStyle(part(element, '.corner')).display).toBe('none');
        expect(part(element, '.title').getAttribute('aria-disabled')).toBe('true');
    });

    it('should show the restore label and glyph when maximized', async () => {
        // Arrange
        const mounted = await mount({ maximized: true });

        // Assert
        expect(part(win(mounted), '[data-control=maximize]').getAttribute('aria-label')).toBe('Restore');
        expect(mounted.store.get('$.app.children.win.maximizeGlyph')).toBe('squares');
    });

    it('should raise activate once for a press and when focus comes in from outside', async () => {
        // Arrange
        const mounted = await mount();
        const element = win(mounted);
        const seen = events(element, ['activate']);

        // Act
        pointer(part(element, '.body'), 'pointerdown', 0, 0);
        pointer(part(element, '.body'), 'pointerup', 0, 0);
        await flush();
        part(element, '[data-control=close]').focus();
        await flush();
        part(element, '.title').focus();
        await flush();

        // Assert
        expect(seen).toHaveLength(2);
    });

    it('should speak German with the de locale', async () => {
        // Arrange
        const mounted = await mount();
        mounted.setLocale('de');
        await flush();

        // Assert
        expect(part(win(mounted), '[data-control=close]').getAttribute('aria-label')).toBe('Schließen');
    });
});
