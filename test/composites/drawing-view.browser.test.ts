import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const host = (element: Element): HTMLElement => element.shadowRoot?.querySelector('.drawing') as HTMLElement;
const surface = (element: Element): HTMLElement => element.shadowRoot?.querySelector('.surface') as HTMLElement;
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('drawing view (the skeleton of G1.3) in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should be an image named by its title, described only when it has a description', async () => {
        // Arrange
        const mounted = mountComponent('drawing', { _title: 'Floor plan' });
        const title = (): string | null | undefined => mounted.element.shadowRoot?.getElementById(host(mounted.element).getAttribute('aria-labelledby') ?? '')?.textContent;
        await settle();
        const before = host(mounted.element).getAttribute('aria-describedby');

        // Act
        mounted.store.set('$.app._description', 'Rooms on the ground floor');

        // Assert
        expect(host(mounted.element).getAttribute('role')).toBe('img');
        expect(title()).toBe('Floor plan');
        expect(before).toBeNull();
        expect(host(mounted.element).getAttribute('aria-describedby')).toBe('description');
    });

    it('should mark its surface with the renderer and follow a change of it', async () => {
        // Arrange
        const mounted = mountComponent('drawing');
        await settle();
        const before = surface(mounted.element).dataset['renderer'];

        // Act
        mounted.store.set('$.app.renderer', 'canvas');

        // Assert
        expect(before).toBe('svg');
        expect(surface(mounted.element).dataset['renderer']).toBe('canvas');
    });

    it('should show the German title', async () => {
        // Arrange
        const mounted = mountComponent('drawing', {}, { locale: 'de' });
        await settle();

        // Assert
        expect(mounted.element.shadowRoot?.querySelector('.title')?.textContent).toBe('Zeichnung');
    });
});
