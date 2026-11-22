import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const all = <T extends Element>(element: Element, selector: string): T[] => Array.from(element.shadowRoot?.querySelectorAll<T>(selector) ?? []);
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const ITEMS = {
    mdn: { _title: 'Using the Fetch API', url: 'https://www.developer.mozilla.org/en-US/docs/Web/API/Fetch_API', _excerpt: 'The Fetch API provides an interface for fetching resources.' },
    spec: { url: 'https://fetch.spec.whatwg.org/' },
    bad: { _title: 'Not a link', url: 'javascript:alert(1)' }
};

describe('sources in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should number each source and show its link, title, host and excerpt in a labelled list', async () => {
        // Act
        const mounted = mountComponent('sources', { items: ITEMS });
        await flush();

        // Assert
        const rows = all<HTMLElement>(mounted.element, '.source');
        expect(mounted.element.shadowRoot?.querySelector('nav')?.getAttribute('aria-label')).toBe('Sources');
        expect(rows.map((row) => row.querySelector('.number')?.textContent)).toEqual(['1', '2', '3']);
        const link = rows[0]?.querySelector<HTMLAnchorElement>('a.title');
        expect(link?.textContent).toBe('Using the Fetch API');
        expect(link?.getAttribute('href')).toBe('https://www.developer.mozilla.org/en-US/docs/Web/API/Fetch_API');
        expect(link?.target).toBe('_blank');
        expect(link?.rel).toBe('noopener noreferrer');
        expect(rows[0]?.querySelector('.host')?.textContent).toBe('developer.mozilla.org');
        expect(rows[0]?.querySelector('.excerpt')?.textContent).toBe('The Fetch API provides an interface for fetching resources.');
        expect(rows[1]?.querySelector('a.title')?.textContent).toBe('fetch.spec.whatwg.org');
    });

    it('should show a source whose URL is not http or https as plain text, never a link', async () => {
        // Act
        const mounted = mountComponent('sources', { items: ITEMS });
        await flush();

        // Assert
        const bad = all<HTMLElement>(mounted.element, '.source')[2];
        expect(bad?.querySelector('a')).toBeNull();
        expect(bad?.querySelector('.title')?.textContent).toBe('Not a link');
        expect(bad?.querySelector('.host')).toBeNull();
    });

    it('should follow a change of the items', async () => {
        // Arrange
        const mounted = mountComponent('sources', { items: ITEMS });
        await flush();

        // Act
        mounted.store.replace('$.app.items', { one: { _title: 'Only', url: 'http://example.com/a' } });
        await flush();

        // Assert
        expect(all(mounted.element, '.source').map((row) => row.querySelector('.title')?.textContent)).toEqual(['Only']);
    });
});
