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

describe('spinner variants in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should draw three dots for the dots variant and nothing while inactive', async () => {
        // Arrange
        const mounted = mountComponent('spinner', { look: 'dots' });
        await flush();
        const dots = all(mounted.element, '.dot').length;

        // Act
        mounted.store.set('$.app.active', false);
        await flush();

        // Assert
        expect(dots).toBe(3);
        expect(part(mounted.element, '[role=status]')).toBeNull();
        expect(mounted.element.hasAttribute('active')).toBe(false);
    });
});
