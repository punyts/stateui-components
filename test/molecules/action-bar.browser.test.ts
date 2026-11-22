import { userEvent } from 'vitest/browser';
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

const ACTIONS = { export: { _label: 'Export', icon: 'download' }, remove: { _label: 'Delete', icon: 'trash', tone: 'danger' } };

describe('actionBar in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should show nothing while no record is selected and the count, actions and clear button once some are', async () => {
        // Arrange
        const mounted = mountComponent('actionBar', { actions: ACTIONS, selected: [] });
        await flush();
        const hidden = part(mounted.element, '.bar');

        // Act
        mounted.store.set('$.app.selected', ['a', 'b', 'c']);
        await flush();

        // Assert
        expect(hidden).toBeNull();
        expect(part(mounted.element, '.bar')?.getAttribute('role')).toBe('toolbar');
        expect(part(mounted.element, '.count')?.textContent).toBe('3 selected');
        expect(all(mounted.element, '.action').map((button) => button.textContent?.trim())).toEqual(['Export', 'Delete']);
        expect(all<HTMLElement>(mounted.element, '.action')[1]?.dataset['tone']).toBe('danger');
        expect(part(mounted.element, '.clear')?.getAttribute('aria-label')).toBe('Clear selection');
    });

    it('should count a single selected key as one', async () => {
        // Act
        const mounted = mountComponent('actionBar', { actions: ACTIONS, selected: 'o7' });
        await flush();

        // Assert
        expect(mounted.store.get('$.app.count')).toBe(1);
        expect(part(mounted.element, '.count')?.textContent).toBe('1 selected');
    });

    it('should raise action with the key of the pressed action and clear on the clear button', async () => {
        // Arrange
        const mounted = mountComponent('actionBar', { actions: ACTIONS, selected: ['a'] });
        await flush();
        const actions = events(mounted.element, 'action');
        const cleared = events(mounted.element, 'clear');

        // Act
        await userEvent.click(all<HTMLElement>(mounted.element, '.action')[1] as HTMLElement);
        await userEvent.click(part<HTMLElement>(mounted.element, '.clear') as HTMLElement);

        // Assert
        expect(actions).toEqual(['remove']);
        expect(cleared).toHaveLength(1);
    });

    it('should follow a selection it links to, such as the selected of a table', async () => {
        // Arrange
        const mounted = mountComponent('actionBar', { actions: ACTIONS, '<-selected': '$.data.picked' }, { data: { picked: [] } });
        await flush();

        // Act
        mounted.store.set('$.data.picked', ['o1', 'o2']);
        await flush();
        const two = part(mounted.element, '.count')?.textContent;
        mounted.store.set('$.data.picked', []);
        await flush();

        // Assert
        expect(two).toBe('2 selected');
        expect(part(mounted.element, '.bar')).toBeNull();
    });
});
