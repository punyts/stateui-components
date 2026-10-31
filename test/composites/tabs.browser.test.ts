import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;
const all = (element: Element, selector: string): HTMLElement[] => Array.from(root(element).querySelectorAll<HTMLElement>(selector));
const part = (element: Element, selector: string): HTMLElement | null => root(element).querySelector(selector);
const text = (value: string, placement: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    component: 'text',
    _text: value,
    placement,
    ...extra
});
const labels = (element: Element): string[] => all(element, '[role=tab] .label').map((label) => label.textContent?.trim() ?? '');
const hiddenFlags = (element: Element): boolean[] => all(element, '[role=tabpanel]').map((panel) => panel.hidden);
const selectedKeys = (element: Element): string[] => all(element, '[role=tab][aria-selected=true]').map((tab) => tab.dataset.key ?? '');
const command = (element: Element, name: string, value: unknown): void => {
    (element as Element & { commands: Record<string, (value: unknown) => void> }).commands[name]?.(value);
};
const changes = (element: Element): string[] => {
    const seen: string[] = [];
    element.addEventListener('change', (event) => seen.push((event as CustomEvent<string>).detail));
    return seen;
};
const three = {
    one: text('First body', { _tab: 'One' }),
    two: text('Second body', { _tab: 'Two', badge: 3 }),
    three: text('Third body', { _tab: 'Three', icon: 'star' })
};

describe('tabs in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should show the first child when active is empty and the roles of a tab set', () => {
        // Arrange
        const mounted = mountComponent('tabs', { children: three });

        // Assert
        expect(part(mounted.element, '[role=tablist]')).not.toBeNull();
        expect(all(mounted.element, '[role=tab]')).toHaveLength(3);
        expect(selectedKeys(mounted.element)).toEqual(['one']);
        expect(hiddenFlags(mounted.element)).toEqual([false, true, true]);
        expect(all(mounted.element, '[role=tab]')[0]?.getAttribute('aria-controls')).toBe('panel-one');
        expect(all(mounted.element, '[role=tabpanel]')[0]?.getAttribute('aria-labelledby')).toBe('tab-one');
    });

    it('should show the label, icon and badge from each child placement', () => {
        // Arrange
        const mounted = mountComponent('tabs', { children: { ...three, bare: text('Bare', {}) } });
        const tabs = all(mounted.element, '[role=tab]');

        // Assert
        expect(labels(mounted.element)).toEqual(['One', 'Two', 'Three', 'bare']);
        expect(tabs[1]?.querySelector('.badge')?.textContent?.trim()).toBe('3');
        expect(tabs[0]?.querySelector('.badge')).toBeNull();
        expect(tabs[2]?.querySelector('.glyph')).not.toBeNull();
        expect(tabs[0]?.querySelector('.glyph')).toBeNull();
    });

    it('should honour active, write active on a click and raise change once', async () => {
        // Arrange
        const mounted = mountComponent('tabs', { active: 'two', children: three });
        const seen = changes(mounted.element);
        expect(selectedKeys(mounted.element)).toEqual(['two']);

        // Act
        await userEvent.click(all(mounted.element, '[role=tab]')[2] as HTMLElement);
        await userEvent.click(all(mounted.element, '[role=tab]')[2] as HTMLElement);

        // Assert
        expect(mounted.store.get('$.app.active')).toBe('three');
        expect(selectedKeys(mounted.element)).toEqual(['three']);
        expect(hiddenFlags(mounted.element)).toEqual([true, true, false]);
        expect(seen).toEqual(['three']);
    });

    it('should select through the command and ignore an unknown key', () => {
        // Arrange
        const mounted = mountComponent('tabs', { children: three });
        const seen = changes(mounted.element);

        // Act
        command(mounted.element, 'select', 'two');
        command(mounted.element, 'select', 'nope');
        command(mounted.element, 'select', 'two');

        // Assert
        expect(mounted.store.get('$.app.active')).toBe('two');
        expect(seen).toEqual(['two']);
    });

    it('should follow a state write to active and raise change once', () => {
        // Arrange
        const mounted = mountComponent('tabs', { children: three });
        const seen = changes(mounted.element);

        // Act
        mounted.store.set('$.app.active', 'three');

        // Assert
        expect(selectedKeys(mounted.element)).toEqual(['three']);
        expect(seen).toEqual(['three']);
    });

    it('should move with the arrow keys, Home and End, wrapping at the ends', async () => {
        // Arrange
        const mounted = mountComponent('tabs', { children: three });
        const tabs = all(mounted.element, '[role=tab]');
        tabs[0]?.focus();

        // Act and Assert
        await userEvent.keyboard('{ArrowRight}');
        expect(selectedKeys(mounted.element)).toEqual(['two']);
        expect(root(mounted.element).activeElement).toBe(tabs[1]);
        await userEvent.keyboard('{End}');
        expect(selectedKeys(mounted.element)).toEqual(['three']);
        await userEvent.keyboard('{ArrowRight}');
        expect(selectedKeys(mounted.element)).toEqual(['one']);
        await userEvent.keyboard('{ArrowLeft}');
        expect(selectedKeys(mounted.element)).toEqual(['three']);
        await userEvent.keyboard('{Home}');
        expect(selectedKeys(mounted.element)).toEqual(['one']);
        expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    });

    it('should use the vertical arrows when orientation is vertical', async () => {
        // Arrange
        const mounted = mountComponent('tabs', { orientation: 'vertical', children: three });
        all(mounted.element, '[role=tab]')[0]?.focus();

        // Act
        await userEvent.keyboard('{ArrowRight}');
        const afterRight = selectedKeys(mounted.element);
        await userEvent.keyboard('{ArrowDown}');

        // Assert
        expect(afterRight).toEqual(['one']);
        expect(selectedKeys(mounted.element)).toEqual(['two']);
        expect(part(mounted.element, '[role=tablist]')?.getAttribute('aria-orientation')).toBe('vertical');
    });

    it('should keep inactive panels in the DOM with their state', async () => {
        // Arrange
        const mounted = mountComponent('tabs', {
            children: {
                a: { component: 'input', value: 'draft', placement: { _tab: 'A' } },
                b: text('B body', { _tab: 'B' })
            }
        });
        const input = part(mounted.element, '[role=tabpanel] ui-input') as HTMLElement;
        mounted.store.set('$.app.children.a.value', 'edited');

        // Act
        await userEvent.click(all(mounted.element, '[role=tab]')[1] as HTMLElement);
        await userEvent.click(all(mounted.element, '[role=tab]')[0] as HTMLElement);

        // Assert
        expect(part(mounted.element, '[role=tabpanel] ui-input')).toBe(input);
        expect(mounted.store.get('$.app.children.a.value')).toBe('edited');
    });

    it('should add, remove and reorder tabs and fall back to the first key', () => {
        // Arrange
        const mounted = mountComponent('tabs', { active: 'two', children: three });

        // Act
        mounted.store.set('$.app.children.four', text('Fourth', { _tab: 'Four' }));
        const added = labels(mounted.element);
        mounted.store.replace('$.app.children', { four: text('Fourth', { _tab: 'Four' }), two: text('Second', { _tab: 'Two' }) });
        const reordered = labels(mounted.element);
        mounted.store.delete('$.app.children.two');

        // Assert
        expect(added).toEqual(['One', 'Two', 'Three', 'Four']);
        expect(reordered).toEqual(['Four', 'Two']);
        expect(selectedKeys(mounted.element)).toEqual(['four']);
    });

    it('should render the line and pill appearances differently', () => {
        // Arrange
        const border = (appearance: string): string => {
            const mounted = mountComponent('tabs', { appearance, children: three });
            return getComputedStyle(all(mounted.element, '[role=tab]')[0] as HTMLElement).borderBottomWidth;
        };
        const radius = (appearance: string): string => {
            const mounted = mountComponent('tabs', { appearance, children: three });
            return getComputedStyle(all(mounted.element, '[role=tab]')[0] as HTMLElement).borderTopLeftRadius;
        };

        // Assert
        expect(border('line')).not.toBe('0px');
        expect(border('pill')).toBe('0px');
        expect(radius('line')).toBe('0px');
        expect(radius('pill')).not.toBe('0px');
    });

    it('should translate a placement _tab with a locale overlay', () => {
        // Arrange
        const mounted = mountComponent(
            'tabs',
            { children: three },
            { locales: { de: { children: { one: { placement: { _tab: 'Eins' } }, two: { placement: { _tab: 'Zwei' } } } } } }
        );

        // Act
        mounted.setLocale('de');

        // Assert
        expect(labels(mounted.element)).toEqual(['Eins', 'Zwei', 'Three']);
    });

    it('should show the strip by default', () => {
        // Arrange
        const mounted = mountComponent('tabs', { children: three });

        // Assert
        expect(mounted.element.getAttribute('strip')).toBe('visible');
        expect(getComputedStyle(part(mounted.element, '[role=tablist]') as HTMLElement).display).toBe('flex');
    });

    it('should hide the strip with strip hidden, keep its tabs out of the tab order and still switch panels through active', async () => {
        // Arrange
        const mounted = mountComponent('tabs', { strip: 'hidden', children: three });
        const strip = part(mounted.element, '[role=tablist]') as HTMLElement;

        // Assert
        expect(getComputedStyle(strip).display).toBe('none');
        expect(strip.getBoundingClientRect().height).toBe(0);
        expect(hiddenFlags(mounted.element)).toEqual([false, true, true]);

        // Act
        mounted.store.set('$.app.active', 'two' as never);
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Assert
        expect(selectedKeys(mounted.element)).toEqual(['two']);
        expect(hiddenFlags(mounted.element)).toEqual([true, false, true]);
        expect(all(mounted.element, '[role=tab]').every((tab) => tab.offsetParent === null)).toBe(true);
    });

    it('should switch panels of a hidden strip through the select command and raise change', () => {
        // Arrange
        const mounted = mountComponent('tabs', { strip: 'hidden', children: three });
        const seen = changes(mounted.element);

        // Act
        command(mounted.element, 'select', 'three');

        // Assert
        expect(hiddenFlags(mounted.element)).toEqual([true, true, false]);
        expect(seen).toEqual(['three']);
    });

    it('should not reach a tab of a hidden strip with the Tab key', async () => {
        // Arrange
        const mounted = mountComponent('tabs', { strip: 'hidden', children: { one: text('First', { _tab: 'One' }), two: text('Second', { _tab: 'Two' }) } });
        const before = document.activeElement;

        // Act
        await userEvent.tab();

        // Assert
        expect(mounted.element.shadowRoot?.activeElement ?? null).toBeNull();
        expect(document.activeElement).not.toBe(mounted.element);
        expect(before).not.toBe(mounted.element);
    });
});
