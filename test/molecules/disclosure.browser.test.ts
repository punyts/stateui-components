import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;
const part = <T extends HTMLElement = HTMLElement>(element: Element, selector: string): T | null => root(element).querySelector<T>(selector);
const header = (element: Element): HTMLButtonElement => part<HTMLButtonElement>(element, '.toggle') as HTMLButtonElement;
const text = (value: string): Record<string, unknown> => ({ component: 'text', _text: value });
const body = { a: text('First'), b: text('Second') };
const command = (element: Element, name: string): void => {
    (element as Element & { commands: Record<string, () => void> }).commands[name]?.();
};
const toggles = (element: Element): boolean[] => {
    const seen: boolean[] = [];
    element.addEventListener('toggle', (event) => seen.push((event as CustomEvent<{ open: boolean }>).detail.open));
    return seen;
};
const shown = (element: Element): boolean => getComputedStyle(part(element, '.content') as HTMLElement).display !== 'none';
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('disclosure in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render a header button that names the body it controls and is closed by default', () => {
        // Arrange
        const mounted = mountComponent('disclosure', { _title: 'Advanced', children: body });
        const button = header(mounted.element);
        const content = part(mounted.element, `#${button.getAttribute('aria-controls')}`);

        // Assert
        expect(button.tagName).toBe('BUTTON');
        expect(button.querySelector('.title')?.textContent).toBe('Advanced');
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(content).not.toBeNull();
        expect(content?.getAttribute('role')).toBe('region');
        expect(content?.getAttribute('aria-labelledby')).toBe(button.id);
        expect(shown(mounted.element)).toBe(false);
    });

    it('should show the children of a disclosure that starts open', () => {
        // Arrange
        const mounted = mountComponent('disclosure', { _title: 'Advanced', open: true, children: body });

        // Assert
        expect(header(mounted.element).getAttribute('aria-expanded')).toBe('true');
        expect(shown(mounted.element)).toBe(true);
        expect(root(mounted.element).querySelectorAll('.body > sui-node')).toHaveLength(2);
    });

    it('should open and close on a click and write open', async () => {
        // Arrange
        const mounted = mountComponent('disclosure', { children: body });

        // Act
        await userEvent.click(header(mounted.element));

        // Assert
        expect(mounted.store.get('$.app.open')).toBe(true);
        expect(header(mounted.element).getAttribute('aria-expanded')).toBe('true');
        expect(shown(mounted.element)).toBe(true);

        // Act
        await userEvent.click(header(mounted.element));

        // Assert
        expect(mounted.store.get('$.app.open')).toBe(false);
        expect(shown(mounted.element)).toBe(false);
    });

    it('should toggle with Enter and Space on the focused header', async () => {
        // Arrange
        const mounted = mountComponent('disclosure', { children: body });
        header(mounted.element).focus();

        // Act
        await userEvent.keyboard('{Enter}');

        // Assert
        expect(mounted.store.get('$.app.open')).toBe(true);

        // Act
        await userEvent.keyboard(' ');

        // Assert
        expect(mounted.store.get('$.app.open')).toBe(false);
    });

    it('should open, close and toggle by command', () => {
        // Arrange
        const mounted = mountComponent('disclosure', { children: body });

        // Act and assert
        command(mounted.element, 'open');
        expect(mounted.store.get('$.app.open')).toBe(true);
        command(mounted.element, 'open');
        expect(mounted.store.get('$.app.open')).toBe(true);
        command(mounted.element, 'close');
        expect(mounted.store.get('$.app.open')).toBe(false);
        command(mounted.element, 'toggle');
        expect(mounted.store.get('$.app.open')).toBe(true);
        command(mounted.element, 'toggle');
        expect(mounted.store.get('$.app.open')).toBe(false);
    });

    it('should raise toggle once per change of open, whoever wrote it, and none at load', async () => {
        // Arrange
        const mounted = mountComponent('disclosure', { open: true, children: body });
        const seen = toggles(mounted.element);

        // Act
        await userEvent.click(header(mounted.element));
        command(mounted.element, 'open');
        mounted.store.set('$.app.open', false as never);
        mounted.store.set('$.app.open', false as never);
        await flush();

        // Assert
        expect(seen).toEqual([false, true, false]);
    });

    it('should show the summary only while closed', async () => {
        // Arrange
        const mounted = mountComponent('disclosure', { _title: 'Advanced', _summary: '3 options', children: body });
        const summary = (): string | undefined => part(mounted.element, '.summary')?.textContent?.trim();

        // Assert
        expect(summary()).toBe('3 options');

        // Act
        command(mounted.element, 'open');
        await flush();

        // Assert
        expect(summary()).toBeUndefined();

        // Act
        command(mounted.element, 'close');
        await flush();

        // Assert
        expect(summary()).toBe('3 options');
    });

    it('should not toggle by click while disabled, but still by command', () => {
        // Arrange
        const mounted = mountComponent('disclosure', { disabled: true, children: body });

        // Act
        header(mounted.element).dispatchEvent(new MouseEvent('click', { bubbles: true }));

        // Assert
        expect(header(mounted.element).disabled).toBe(true);
        expect(mounted.store.get('$.app.open')).toBe(false);

        // Act
        command(mounted.element, 'open');

        // Assert
        expect(mounted.store.get('$.app.open')).toBe(true);
    });

    it('should draw the default chevron turned while closed, and a custom icon as it is', () => {
        // Arrange
        const plain = mountComponent('disclosure', { children: body });
        const custom = mountComponent('disclosure', { icon: 'plus', children: body });

        // Assert
        expect(part(plain.element, '.chevron')?.hasAttribute('data-turn')).toBe(true);
        expect(getComputedStyle(part(plain.element, '.chevron') as HTMLElement).transform).not.toBe('none');
        expect(custom.element.shadowRoot?.querySelector('.chevron')?.hasAttribute('data-turn')).toBe(false);
        expect(getComputedStyle(part(custom.element, '.chevron') as HTMLElement).transform).toBe('none');
    });

    it('should render the actions beside the header, outside the toggle button', () => {
        // Arrange
        const mounted = mountComponent('disclosure', { actions: { component: 'button', _title: 'Reset' }, children: body });

        // Assert
        expect(part(mounted.element, '.actions ui-button')).not.toBeNull();
        expect(header(mounted.element).contains(part(mounted.element, '.actions'))).toBe(false);
    });

    it('should lay the children out with the layout of the node', () => {
        // Arrange
        const mounted = mountComponent('disclosure', { open: true, layout: { type: 'row' }, children: body });
        const boxes = Array.from(root(mounted.element).querySelectorAll('.body > sui-node')).map((node) => (node.firstElementChild as Element).getBoundingClientRect());

        // Assert
        expect(boxes).toHaveLength(2);
        expect(boxes[1]?.left).toBeGreaterThan(boxes[0]?.left ?? 0);
        expect(Math.abs((boxes[1]?.top ?? 0) - (boxes[0]?.top ?? 1))).toBeLessThan(2);
    });

    it('should show German content: title and summary', () => {
        // Arrange
        const mounted = mountComponent('disclosure', { _title: 'Erweitert', _summary: '3 Optionen' }, { locale: 'de' });

        // Assert
        expect(part(mounted.element, '.title')?.textContent).toBe('Erweitert');
        expect(part(mounted.element, '.summary')?.textContent).toBe('3 Optionen');
    });
});
