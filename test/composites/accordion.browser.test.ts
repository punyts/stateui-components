import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;
const nodes = (element: Element): Element[] => Array.from(root(element).querySelectorAll('.accordion > sui-node'));
const disclosures = (element: Element): HTMLElement[] => nodes(element).map((node) => node.firstElementChild as HTMLElement);
const headers = (element: Element): HTMLButtonElement[] =>
    disclosures(element).map((child) => child.shadowRoot?.querySelector('.toggle') as HTMLButtonElement);
const expanded = (element: Element): boolean[] => headers(element).map((header) => header.getAttribute('aria-expanded') === 'true');
const item = (title: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    component: 'disclosure',
    _title: title,
    children: { body: { component: 'text', _text: `${title} body` } },
    ...extra
});
const three = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    a: item('One', extra),
    b: item('Two', extra),
    c: item('Three', extra)
});
const command = (element: Element, name: string, value?: unknown): void => {
    (element as Element & { commands: Record<string, (value?: unknown) => void> }).commands[name]?.(value);
};
const changes = (element: Element): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener('change', (event) => seen.push((event as CustomEvent<unknown>).detail));
    return seen;
};
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const childOpen = (mounted: ReturnType<typeof mountComponent>, key: string): unknown => mounted.store.get(`$.app.children.${key}.open`);
const focusedTitle = (): string | undefined => {
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active?.querySelector('.title')?.textContent ?? undefined;
};

describe('accordion in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should stack the disclosure children closed by default', () => {
        // Arrange
        const mounted = mountComponent('accordion', { children: three() });

        // Assert
        expect(disclosures(mounted.element)).toHaveLength(3);
        expect(expanded(mounted.element)).toEqual([false, false, false]);
        expect(mounted.store.get('$.app.open')).toBe('');
    });

    it('should close the open child when another opens without multiple, and write open', async () => {
        // Arrange
        const mounted = mountComponent('accordion', { children: three() });
        const seen = changes(mounted.element);

        // Act
        await userEvent.click(headers(mounted.element)[0] as HTMLElement);
        await flush();

        // Assert
        expect(mounted.store.get('$.app.open')).toBe('a');
        expect(expanded(mounted.element)).toEqual([true, false, false]);

        // Act
        await userEvent.click(headers(mounted.element)[1] as HTMLElement);
        await flush();

        // Assert
        expect(mounted.store.get('$.app.open')).toBe('b');
        expect(childOpen(mounted, 'a')).toBe(false);
        expect(expanded(mounted.element)).toEqual([false, true, false]);
        expect(seen).toEqual(['a', 'b']);
    });

    it('should close the open child with a click on its own header', async () => {
        // Arrange
        const mounted = mountComponent('accordion', { open: 'a', children: three() });
        await flush();

        // Act
        await userEvent.click(headers(mounted.element)[0] as HTMLElement);
        await flush();

        // Assert
        expect(mounted.store.get('$.app.open')).toBe('');
        expect(expanded(mounted.element)).toEqual([false, false, false]);
    });

    it('should open each child on its own with multiple, and write a list', async () => {
        // Arrange
        const mounted = mountComponent('accordion', { multiple: true, open: [], children: three() });
        const seen = changes(mounted.element);

        // Act
        await userEvent.click(headers(mounted.element)[0] as HTMLElement);
        await userEvent.click(headers(mounted.element)[2] as HTMLElement);
        await flush();

        // Assert
        expect(mounted.store.get('$.app.open')).toEqual(['a', 'c']);
        expect(expanded(mounted.element)).toEqual([true, false, true]);

        // Act
        await userEvent.click(headers(mounted.element)[0] as HTMLElement);
        await flush();

        // Assert
        expect(mounted.store.get('$.app.open')).toEqual(['c']);
        expect(seen).toEqual([['a'], ['a', 'c'], ['c']]);
    });

    it('should take open from the accordion at load and set the children to match', async () => {
        // Arrange
        const mounted = mountComponent('accordion', { open: 'b', children: three() });
        await flush();

        // Assert
        expect(expanded(mounted.element)).toEqual([false, true, false]);
        expect(childOpen(mounted, 'b')).toBe(true);
    });

    it('should take the children that are open at load when open is empty', async () => {
        // Arrange
        const children = { a: item('One'), b: item('Two', { open: true }), c: item('Three', { open: true }) };
        const single = mountComponent('accordion', { children });
        const many = mountComponent('accordion', { multiple: true, children });
        await flush();

        // Assert
        expect(single.store.get('$.app.open')).toBe('b');
        expect(expanded(single.element)).toEqual([false, true, false]);
        expect(many.store.get('$.app.open')).toEqual(['b', 'c']);
        expect(expanded(many.element)).toEqual([false, true, true]);
    });

    it('should follow open when the minion writes it, and raise change once', async () => {
        // Arrange
        const mounted = mountComponent('accordion', { children: three() });
        const seen = changes(mounted.element);

        // Act
        mounted.store.set('$.app.open', 'c' as never);
        await flush();

        // Assert
        expect(expanded(mounted.element)).toEqual([false, false, true]);

        // Act
        mounted.store.set('$.app.open', 'a' as never);
        await flush();

        // Assert
        expect(expanded(mounted.element)).toEqual([true, false, false]);
        expect(childOpen(mounted, 'c')).toBe(false);
        expect(seen).toEqual(['c', 'a']);
    });

    it('should drop a key that names no child, and keep the first key of a list without multiple', async () => {
        // Arrange
        const mounted = mountComponent('accordion', { children: three() });

        // Act
        mounted.store.set('$.app.open', 'missing' as never);
        await flush();

        // Assert
        expect(mounted.store.get('$.app.open')).toBe('');
        expect(expanded(mounted.element)).toEqual([false, false, false]);

        // Act
        mounted.store.set('$.app.open', ['b', 'c'] as never);
        await flush();

        // Assert
        expect(mounted.store.get('$.app.open')).toBe('b');
        expect(expanded(mounted.element)).toEqual([false, true, false]);
    });

    it('should follow a child whose open is written directly', async () => {
        // Arrange
        const mounted = mountComponent('accordion', { open: 'a', children: three() });
        await flush();

        // Act
        mounted.store.set('$.app.children.c.open', true as never);
        await flush();

        // Assert
        expect(mounted.store.get('$.app.open')).toBe('c');
        expect(childOpen(mounted, 'a')).toBe(false);
        expect(expanded(mounted.element)).toEqual([false, false, true]);
    });

    it('should turn a string into a list and a list into its first key when multiple changes', async () => {
        // Arrange
        const mounted = mountComponent('accordion', { open: 'b', children: three() });
        await flush();

        // Act
        mounted.store.set('$.app.multiple', true as never);
        await flush();

        // Assert
        expect(mounted.store.get('$.app.open')).toEqual(['b']);

        // Act
        command(mounted.element, 'expandAll');
        mounted.store.set('$.app.multiple', false as never);
        await flush();

        // Assert
        expect(mounted.store.get('$.app.open')).toBe('a');
        expect(expanded(mounted.element)).toEqual([true, false, false]);
    });

    it('should open and close by command', async () => {
        // Arrange
        const mounted = mountComponent('accordion', { children: three() });

        // Act and assert
        command(mounted.element, 'open', 'b');
        await flush();
        expect(expanded(mounted.element)).toEqual([false, true, false]);
        command(mounted.element, 'open', 'c');
        await flush();
        expect(expanded(mounted.element)).toEqual([false, false, true]);
        command(mounted.element, 'open', 'missing');
        await flush();
        expect(expanded(mounted.element)).toEqual([false, false, true]);
        command(mounted.element, 'close', 'a');
        await flush();
        expect(expanded(mounted.element)).toEqual([false, false, true]);
        command(mounted.element, 'close', 'c');
        await flush();
        expect(expanded(mounted.element)).toEqual([false, false, false]);
    });

    it('should expand and collapse everything with multiple, and ignore expandAll without it', async () => {
        // Arrange
        const many = mountComponent('accordion', { multiple: true, children: three() });
        const single = mountComponent('accordion', { children: three() });

        // Act
        command(many.element, 'expandAll');
        command(single.element, 'expandAll');
        await flush();

        // Assert
        expect(many.store.get('$.app.open')).toEqual(['a', 'b', 'c']);
        expect(expanded(many.element)).toEqual([true, true, true]);
        expect(expanded(single.element)).toEqual([false, false, false]);

        // Act
        command(many.element, 'collapseAll');
        command(single.element, 'open', 'a');
        command(single.element, 'collapseAll');
        await flush();

        // Assert
        expect(many.store.get('$.app.open')).toEqual([]);
        expect(expanded(many.element)).toEqual([false, false, false]);
        expect(single.store.get('$.app.open')).toBe('');
        expect(expanded(single.element)).toEqual([false, false, false]);
    });

    it('should move focus between headers with Up, Down, Home and End', async () => {
        // Arrange
        const mounted = mountComponent('accordion', { children: three() });
        headers(mounted.element)[0]?.focus();

        // Act and assert
        await userEvent.keyboard('{ArrowDown}');
        expect(focusedTitle()).toBe('Two');
        await userEvent.keyboard('{ArrowDown}');
        expect(focusedTitle()).toBe('Three');
        await userEvent.keyboard('{ArrowDown}');
        expect(focusedTitle()).toBe('One');
        await userEvent.keyboard('{ArrowUp}');
        expect(focusedTitle()).toBe('Three');
        await userEvent.keyboard('{Home}');
        expect(focusedTitle()).toBe('One');
        await userEvent.keyboard('{End}');
        expect(focusedTitle()).toBe('Three');
        expect(expanded(mounted.element)).toEqual([false, false, false]);
    });

    it('should skip a disabled header and leave keys in an open body alone', async () => {
        // Arrange
        const children = {
            a: item('One'),
            b: item('Two', { disabled: true }),
            c: item('Three', { children: { field: { component: 'textField', _label: 'Name' } }, open: true })
        };
        const mounted = mountComponent('accordion', { children });
        await flush();
        headers(mounted.element)[0]?.focus();

        // Act
        await userEvent.keyboard('{ArrowDown}');

        // Assert
        expect(focusedTitle()).toBe('Three');

        // Act
        const field = disclosures(mounted.element)[2]?.shadowRoot?.querySelector('sui-node')?.firstElementChild?.shadowRoot?.querySelector('input');
        expect(field).toBeTruthy();
        field?.focus();
        await userEvent.keyboard('{ArrowUp}');

        // Assert
        expect((field?.getRootNode() as ShadowRoot).activeElement).toBe(field);
    });

    it('should add a border and separators with bordered', () => {
        // Arrange
        const mounted = mountComponent('accordion', { bordered: true, children: three() });

        // Assert
        expect(mounted.element.hasAttribute('bordered')).toBe(true);
        const box = root(mounted.element).querySelector('.accordion') as HTMLElement;
        expect(parseFloat(getComputedStyle(box).borderTopWidth)).toBeGreaterThan(0);
    });

    it('should pick up a child added later that is open', async () => {
        // Arrange
        const mounted = mountComponent('accordion', { open: 'a', children: three() });
        await flush();

        // Act
        mounted.store.set('$.app.children.d', item('Four', { open: true }) as never);
        await flush();

        // Assert
        expect(mounted.store.get('$.app.open')).toBe('d');
        expect(childOpen(mounted, 'a')).toBe(false);
    });
});
