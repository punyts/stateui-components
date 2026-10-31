import { report } from '@punyts/core';
import type { RootCatalogEntry } from '@punyts/stateui-app/build';
import { afterEach, describe, expect, it, vi } from 'vitest';
import catalog from '../.test-build/real/components/catalog.json';
import { mountComponent } from './harness/mountComponent.js';

const roots = (catalog.components as unknown as RootCatalogEntry[]).filter((entry) => entry.tier === 'root');

describe('the catalog examples in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
        vi.restoreAllMocks();
    });

    it.each(roots.map((entry) => [entry.name, entry] as const))('should mount the example of %s without a reported error', async (_name, entry) => {
        // Arrange
        const reported: unknown[] = [];
        vi.spyOn(report, 'error').mockImplementation((...args: unknown[]) => {
            reported.push(args);
        });
        const failures: string[] = [];
        const onError = (event: ErrorEvent): void => {
            failures.push(event.message);
        };
        window.addEventListener('error', onError);

        // Act
        const mounted = mountComponent(entry.name, entry.example as Record<string, unknown>);
        await new Promise((resolve) => setTimeout(resolve, 0));
        window.removeEventListener('error', onError);

        // Assert
        expect(mounted.element.localName).toBe(entry.tag);
        expect(reported).toEqual([]);
        expect(failures).toEqual([]);
    });

    it.each(roots.map((entry) => [entry.name, entry] as const))('should mount the example of %s in German without a reported error', async (_name, entry) => {
        // Arrange
        const reported: unknown[] = [];
        vi.spyOn(report, 'error').mockImplementation((...args: unknown[]) => {
            reported.push(args);
        });

        // Act
        const mounted = mountComponent(entry.name, entry.example as Record<string, unknown>, { locale: 'de' });
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Assert
        expect(mounted.element.localName).toBe(entry.tag);
        expect(reported).toEqual([]);
    });
});

describe('the accessible-name rules in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should name an icon-only button by its _title in English and in German and draw no label', () => {
        // Arrange
        const mounted = mountComponent('button', { icon: 'plus', iconPosition: 'only', _title: 'Add order' });

        // Assert
        expect(mounted.element.shadowRoot?.querySelector('button')?.getAttribute('aria-label')).toBe('Add order');
        expect(mounted.element.shadowRoot?.querySelector('.label')).toBeNull();
    });

    it('should name the icon-only button by the German default title when the node sets none', () => {
        // Arrange
        const mounted = mountComponent('button', { icon: 'plus', iconPosition: 'only' }, { locale: 'de' });

        // Assert
        expect(mounted.element.shadowRoot?.querySelector('button')?.getAttribute('aria-label')).toBe('Schaltfläche');
    });
});
