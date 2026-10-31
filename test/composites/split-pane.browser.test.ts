import { page, userEvent } from 'vitest/browser';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;
const part = (element: Element, selector: string): HTMLElement => root(element).querySelector(selector) as HTMLElement;
const divider = (element: Element): HTMLElement => part(element, '.divider');
const text = (value: string): Record<string, unknown> => ({ component: 'text', _text: value });
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60));
const get = (mounted: { store: { get(path: string): unknown } }, name: string): unknown => mounted.store.get(`$.app.${name}`);
const resizes = (element: Element): { split: number; collapsed: boolean }[] => {
    const seen: { split: number; collapsed: boolean }[] = [];
    element.addEventListener('resize', (event) => seen.push((event as CustomEvent<{ split: number; collapsed: boolean }>).detail));
    return seen;
};
/** Counts the writes to `split`, which the divider must make once per drag */
const countWrites = (mounted: { store: { on(paths: string[], callback: () => void): void } }): { count: number } => {
    const writes = { count: 0 };
    mounted.store.on(['$.app.split'], () => {
        writes.count += 1;
    });
    return writes;
};
const press = async (element: Element, key: string): Promise<void> => {
    divider(element).focus();
    await userEvent.keyboard(`{${key}}`);
    await flush();
};
const mount = async (node: Record<string, unknown> = {}, width = 1000): Promise<ReturnType<typeof mountComponent>> => {
    const mounted = mountComponent('splitPane', { start: text('Start'), end: text('End'), ...node });
    mounted.host.style.inlineSize = `${width}px`;
    await flush();
    return mounted;
};
const startWidth = (element: Element): number => part(element, '.start').getBoundingClientRect().width;
/** Drags the divider by a number of pixels along the split, with real mouse events */
const dragBy = async (element: Element, pixels: number, vertical = false): Promise<void> => {
    const box = divider(element).getBoundingClientRect();
    const target = part(element, '.split');
    const targetBox = target.getBoundingClientRect();
    const x = box.left + box.width / 2 + (vertical ? 0 : pixels) - targetBox.left;
    const y = box.top + box.height / 2 + (vertical ? pixels : 0) - targetBox.top;
    await userEvent.dragAndDrop(divider(element), target, { targetPosition: { x, y } } as never);
    await flush();
};

describe('splitPane in Chromium', () => {
    beforeAll(async () => {
        await page.viewport(1200, 900);
    });
    afterAll(async () => {
        await page.viewport(414, 896);
    });
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render both panes and a separator that reports the split and its bounds', async () => {
        // Arrange
        const mounted = await mount();
        const bar = divider(mounted.element);

        // Assert
        expect(part(mounted.element, '.start sui-node')).not.toBeNull();
        expect(part(mounted.element, '.end sui-node')).not.toBeNull();
        expect(bar.getAttribute('role')).toBe('separator');
        expect(bar.getAttribute('aria-orientation')).toBe('vertical');
        expect(bar.getAttribute('aria-valuenow')).toBe('40');
        expect(bar.getAttribute('aria-valuemin')).toBe('20');
        expect(bar.getAttribute('aria-valuemax')).toBe('80');
        expect(bar.getAttribute('aria-controls')).toBe('start');
        expect(bar.getAttribute('aria-label')).toBe('Resize panes');
        expect(bar.tabIndex).toBe(0);
    });

    it('should give the start pane its split as a share of the container through --sui-split', async () => {
        // Arrange
        const mounted = await mount({ split: 30 });

        // Assert
        expect(part(mounted.element, '.split').style.getPropertyValue('--sui-split')).toBe('30');
        expect(startWidth(mounted.element)).toBeCloseTo(300, 0);
    });

    it('should keep a split written outside min and max inside them without writing it back', async () => {
        // Arrange
        const mounted = await mount({ split: 95 });

        // Assert
        expect(divider(mounted.element).getAttribute('aria-valuenow')).toBe('80');
        expect(startWidth(mounted.element)).toBeCloseTo(800, 0);
        expect(get(mounted, 'split')).toBe(95);
    });

    it('should move 5 percent with the arrow keys, write split and raise resize each time', async () => {
        // Arrange
        const mounted = await mount();
        const seen = resizes(mounted.element);

        // Act
        await press(mounted.element, 'ArrowRight');
        await press(mounted.element, 'ArrowRight');
        await press(mounted.element, 'ArrowLeft');

        // Assert
        expect(get(mounted, 'split')).toBe(45);
        expect(divider(mounted.element).getAttribute('aria-valuenow')).toBe('45');
        expect(seen).toEqual([
            { split: 45, collapsed: false },
            { split: 50, collapsed: false },
            { split: 45, collapsed: false }
        ]);
        expect(startWidth(mounted.element)).toBeCloseTo(450, 0);
    });

    it('should go to min and max with Home and End and stop there', async () => {
        // Arrange
        const mounted = await mount();
        const seen = resizes(mounted.element);

        // Act
        await press(mounted.element, 'End');
        await press(mounted.element, 'ArrowRight');
        expect(get(mounted, 'split')).toBe(80);
        await press(mounted.element, 'Home');
        await press(mounted.element, 'ArrowLeft');

        // Assert
        expect(get(mounted, 'split')).toBe(20);
        expect(seen).toEqual([
            { split: 80, collapsed: false },
            { split: 20, collapsed: false }
        ]);
    });

    it('should drag the divider, converting pixels to percent of the container', async () => {
        // Arrange
        const mounted = await mount();

        // Act
        await dragBy(mounted.element, 200);

        // Assert
        expect(Number(get(mounted, 'split'))).toBeCloseTo(60, 0);
        expect(startWidth(mounted.element)).toBeCloseTo(600, -1);
    });

    it('should clamp a drag to max and to min', async () => {
        // Arrange
        const mounted = await mount();

        // Act and assert
        await dragBy(mounted.element, 450);
        expect(get(mounted, 'split')).toBe(80);
        await dragBy(mounted.element, -900);
        expect(get(mounted, 'split')).toBe(20);
    });

    it('should write split once per drag and raise one resize, and nothing for a drag that does not move', async () => {
        // Arrange
        const mounted = await mount();
        const writes = countWrites(mounted);
        const seen = resizes(mounted.element);

        // Act
        await dragBy(mounted.element, 150);
        const afterFirst = writes.count;
        await dragBy(mounted.element, 0);

        // Assert
        expect(afterFirst).toBe(1);
        expect(writes.count).toBe(1);
        expect(seen).toHaveLength(1);
        expect(seen[0]?.collapsed).toBe(false);
        expect(Number(seen[0]?.split)).toBeCloseTo(55, 0);
    });

    it('should drag a vertical split by the height of its container', async () => {
        // Arrange
        const mounted = await mount({ orientation: 'vertical' });
        const height = part(mounted.element, '.split').getBoundingClientRect().height;
        const bar = divider(mounted.element);

        // Act
        await dragBy(mounted.element, height * 0.2, true);

        // Assert
        expect(bar.getAttribute('aria-orientation')).toBe('horizontal');
        expect(Number(get(mounted, 'split'))).toBeCloseTo(60, 0);
        expect(part(mounted.element, '.start').getBoundingClientRect().height).toBeCloseTo(height * 0.6, -1);
    });

    it('should move a vertical split with the Up and Down keys', async () => {
        // Arrange
        const mounted = await mount({ orientation: 'vertical' });

        // Act
        await press(mounted.element, 'ArrowDown');
        await press(mounted.element, 'ArrowUp');
        await press(mounted.element, 'ArrowUp');

        // Assert
        expect(get(mounted, 'split')).toBe(35);
    });

    it('should collapse the start pane with Enter when collapsible, and bring it back with Enter', async () => {
        // Arrange
        const mounted = await mount({ collapsible: true });
        const seen = resizes(mounted.element);

        // Act
        await press(mounted.element, 'Enter');

        // Assert
        expect(get(mounted, 'collapsed')).toBe(true);
        expect(mounted.element.hasAttribute('collapsed')).toBe(true);
        expect(divider(mounted.element).getAttribute('aria-valuenow')).toBe('0');
        expect(divider(mounted.element).getAttribute('aria-valuemin')).toBe('0');
        expect(startWidth(mounted.element)).toBe(0);
        expect(getComputedStyle(part(mounted.element, '.start')).visibility).toBe('hidden');
        expect(get(mounted, 'split')).toBe(40);

        // Act
        await press(mounted.element, 'Enter');

        // Assert
        expect(get(mounted, 'collapsed')).toBe(false);
        expect(startWidth(mounted.element)).toBeCloseTo(400, 0);
        expect(divider(mounted.element).getAttribute('aria-valuenow')).toBe('40');
        expect(seen).toEqual([
            { split: 40, collapsed: true },
            { split: 40, collapsed: false }
        ]);
    });

    it('should bring a collapsed pane back with an arrow key', async () => {
        // Arrange
        const mounted = await mount({ collapsible: true });
        await press(mounted.element, 'Enter');

        // Act
        await press(mounted.element, 'ArrowRight');

        // Assert
        expect(get(mounted, 'collapsed')).toBe(false);
        expect(get(mounted, 'split')).toBe(45);
    });

    it('should do nothing on Enter when not collapsible', async () => {
        // Arrange
        const mounted = await mount();
        const seen = resizes(mounted.element);

        // Act
        await press(mounted.element, 'Enter');

        // Assert
        expect(get(mounted, 'collapsed')).toBe(false);
        expect(seen).toEqual([]);
        expect(startWidth(mounted.element)).toBeCloseTo(400, 0);
    });

    it('should lay the panes side by side from the md breakpoint and stack them below it with the divider hidden', async () => {
        // Arrange
        const wide = await mount({}, 800);
        const narrow = await mount({}, 600);
        const rect = (element: Element, selector: string): DOMRect => part(element, selector).getBoundingClientRect();

        // Assert
        expect(rect(wide.element, '.end').left).toBeGreaterThan(rect(wide.element, '.start').right - 1);
        expect(Math.abs(rect(wide.element, '.end').top - rect(wide.element, '.start').top)).toBeLessThan(2);
        expect(getComputedStyle(divider(wide.element)).display).not.toBe('none');
        expect(rect(narrow.element, '.end').top).toBeGreaterThanOrEqual(rect(narrow.element, '.start').bottom - 1);
        expect(Math.abs(rect(narrow.element, '.end').left - rect(narrow.element, '.start').left)).toBeLessThan(2);
        expect(rect(narrow.element, '.start').width).toBeCloseTo(600, 0);
        expect(getComputedStyle(divider(narrow.element)).display).toBe('none');
    });

    it('should show the German name of the divider', async () => {
        // Arrange
        const mounted = mountComponent('splitPane', { start: text('Start'), end: text('End') }, { locale: 'de' });
        await flush();

        // Assert
        expect(divider(mounted.element).getAttribute('aria-label')).toBe('Bereichsgröße ändern');
    });

    it('should follow a split written from outside', async () => {
        // Arrange
        const mounted = await mount();

        // Act
        mounted.store.set('$.app.split', 60 as never);
        await flush();

        // Assert
        expect(divider(mounted.element).getAttribute('aria-valuenow')).toBe('60');
        expect(startWidth(mounted.element)).toBeCloseTo(600, 0);
    });
});
