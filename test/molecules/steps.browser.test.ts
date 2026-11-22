import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const part = <T extends Element>(element: Element, selector: string): T | null => element.shadowRoot?.querySelector<T>(selector) ?? null;
const all = <T extends Element>(element: Element, selector: string): T[] => Array.from(element.shadowRoot?.querySelectorAll<T>(selector) ?? []);
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const events = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail ?? null));
    return seen;
};

const ITEMS = {
    search: { _label: 'Search the docs', status: 'done', _detail: '3 pages found' },
    read: { _label: 'Read the pages', status: 'running' },
    write: { _label: 'Write the answer' }
};

describe('steps in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should fold the steps to a line of progress with a running mark until opened', async () => {
        // Act
        const mounted = mountComponent('steps', { items: ITEMS });
        await flush();

        // Assert
        expect(part(mounted.element, '.toggle')?.getAttribute('aria-expanded')).toBe('false');
        expect(part<HTMLElement>(mounted.element, '.list')?.hidden).toBe(true);
        expect(part(mounted.element, '.progress')?.textContent).toBe('1 of 3 done');
        expect(part(mounted.element, '.toggle ui-spinner')).not.toBeNull();
        expect(mounted.store.get('$.app.busy')).toBe(true);
    });

    it('should open on a press of the header and show each step with its status mark and detail', async () => {
        // Arrange
        const mounted = mountComponent('steps', { items: ITEMS });
        const toggles = events(mounted.element, 'toggle');
        await flush();

        // Act
        part<HTMLButtonElement>(mounted.element, '.toggle')?.click();
        await flush();

        // Assert
        const steps = all<HTMLElement>(mounted.element, '.step');
        expect(toggles).toEqual([true]);
        expect(part(mounted.element, '.toggle')?.getAttribute('aria-expanded')).toBe('true');
        expect(steps.map((step) => step.dataset['status'])).toEqual(['done', 'running', 'pending']);
        expect(steps[0]?.querySelector('ui-icon')?.getAttribute('name')).toBe('circle-check');
        expect(steps[0]?.querySelector('.detail')?.textContent).toBe('3 pages found');
        expect(steps[1]?.querySelector('ui-spinner')).not.toBeNull();
        expect(steps[2]?.querySelector('ui-icon')?.getAttribute('name')).toBe('circle');
    });

    it('should mark a failed step and stop showing work once nothing runs', async () => {
        // Arrange
        const mounted = mountComponent('steps', { items: ITEMS });
        await flush();

        // Act
        mounted.store.set('$.app.items.read.status', 'error');
        await flush();

        // Assert
        expect(mounted.store.get('$.app.failed')).toBe(true);
        expect(mounted.store.get('$.app.busy')).toBe(false);
        expect(part(mounted.element, '.toggle ui-spinner')).toBeNull();
        expect(part<HTMLElement>(mounted.element, '.steps')?.dataset['failed']).toBe('true');
    });

    it('should open and close from the commands', async () => {
        // Arrange
        const mounted = mountComponent('steps', { items: ITEMS });
        await flush();
        const commands = (mounted.element as Element & { commands: Record<string, () => void> }).commands;

        // Act
        commands['open']?.();
        const opened = mounted.store.get('$.app.open');
        commands['toggle']?.();

        // Assert
        expect(opened).toBe(true);
        expect(mounted.store.get('$.app.open')).toBe(false);
    });
});
