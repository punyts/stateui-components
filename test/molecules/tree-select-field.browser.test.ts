import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const button = (element: Element): HTMLButtonElement => part<HTMLButtonElement>(element, '#control');
const isOpen = (element: Element): boolean => part<HTMLElement>(element, '.popup').matches(':popover-open');
const rows = (element: Element): string[] => Array.from(element.shadowRoot?.querySelectorAll<HTMLElement>('.row') ?? []).map((row) => `${row.getAttribute('aria-level')}:${row.querySelector('.text')?.textContent ?? ''}`);
const active = (element: Element): string => {
    const id = button(element).getAttribute('aria-activedescendant');
    return id === null ? '' : (element.shadowRoot?.getElementById(id)?.querySelector('.text')?.textContent ?? '');
};
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const events = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};

const PLACES = [
    { id: 'eu', label: 'Europe' },
    { id: 'fr', label: 'France', parentId: 'eu' },
    { id: 'paris', label: 'Paris', parentId: 'fr' },
    { id: 'lyon', label: 'Lyon', parentId: 'fr' },
    { id: 'de', label: 'Germany', parentId: 'eu' },
    { id: 'as', label: 'Asia' }
];

function mountTree(extra: Record<string, unknown> = {}): ReturnType<typeof mountComponent> {
    return mountComponent('treeSelectField', { _label: 'Place', options: PLACES, ...extra });
}

describe('treeSelectField in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should open a tree of the roots, expand with the keys and choose an option', async () => {
        // Arrange
        const mounted = mountTree();
        const expands = events(mounted.element, 'expand');
        button(mounted.element).focus();

        // Act
        await userEvent.keyboard('{ArrowDown}');
        await flush();
        const roots = rows(mounted.element);
        await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowDown}');
        await flush();
        const opened = rows(mounted.element);
        const before = active(mounted.element);
        await userEvent.keyboard('{Enter}');
        await flush();

        // Assert
        expect(roots).toEqual(['1:Europe', '1:Asia']);
        expect(opened).toEqual(['1:Europe', '2:France', '3:Paris', '3:Lyon', '2:Germany', '1:Asia']);
        expect(before).toBe('Paris');
        expect(mounted.store.get('$.app.value')).toBe('paris');
        expect(button(mounted.element).textContent).toBe('Paris');
        expect(button(mounted.element).title).toBe('Europe / France / Paris');
        expect(isOpen(mounted.element)).toBe(false);
        expect(expands).toEqual([{ key: 'eu', expanded: true }, { key: 'fr', expanded: true }]);
    });

    it('should open on the chosen option with its ancestors expanded, and close or climb with Left', async () => {
        // Arrange
        const mounted = mountTree({ value: 'lyon', showPath: true });
        button(mounted.element).focus();

        // Act
        await userEvent.keyboard('{Enter}');
        await flush();
        const start = active(mounted.element);
        await userEvent.keyboard('{ArrowLeft}');
        await flush();
        const parent = active(mounted.element);
        await userEvent.keyboard('{ArrowLeft}');
        await flush();
        const closed = rows(mounted.element);
        await userEvent.keyboard('{Escape}');
        await flush();

        // Assert
        expect(button(mounted.element).textContent).toBe('Europe / France / Lyon');
        expect(start).toBe('Lyon');
        expect(parent).toBe('France');
        expect(closed).toEqual(['1:Europe', '2:France', '2:Germany', '1:Asia']);
        expect(mounted.store.get('$.app.expanded')).toEqual(['eu']);
        expect(isOpen(mounted.element)).toBe(false);
        expect(mounted.store.get('$.app.value')).toBe('lyon');
    });

    it('should expand with the arrow and choose with a press, keeping options with children closed to choice under leafOnly', async () => {
        // Arrange
        const mounted = mountTree({ leafOnly: true });
        await userEvent.click(button(mounted.element));
        await flush();

        // Act
        await userEvent.click(part(mounted.element, '.row[data-key="eu"] .twisty'));
        await flush();
        await userEvent.click(part(mounted.element, '.row[data-key="fr"] .text'));
        await flush();
        const afterParent = { value: mounted.store.get('$.app.value'), open: isOpen(mounted.element), rows: rows(mounted.element) };
        await userEvent.click(part(mounted.element, '.row[data-key="lyon"] .text'));
        await flush();

        // Assert
        expect(afterParent).toEqual({ value: '', open: true, rows: ['1:Europe', '2:France', '3:Paris', '3:Lyon', '2:Germany', '1:Asia'] });
        expect(part(mounted.element, '.row[data-key="fr"]').getAttribute('aria-disabled')).toBeNull();
        expect(mounted.store.get('$.app.value')).toBe('lyon');
        expect(isOpen(mounted.element)).toBe(false);
    });

    it('should move to the next option starting with a typed letter and fail required when empty', async () => {
        // Arrange
        const mounted = mountTree({ required: true, expanded: ['eu'] });
        button(mounted.element).focus();
        await userEvent.keyboard('{ArrowDown}');
        await flush();

        // Act
        await userEvent.keyboard('g');
        await flush();
        const typed = active(mounted.element);
        await userEvent.keyboard('{Escape}');
        (mounted.element as Element & { commands: Record<string, () => void> }).commands['validate']?.();
        await flush();

        // Assert
        expect(typed).toBe('Germany');
        expect(mounted.store.get('$.app.error')).toBe('required');
        expect(button(mounted.element).getAttribute('aria-invalid')).toBe('true');
    });
});
