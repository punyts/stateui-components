import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const all = <T extends Element>(element: Element, selector: string): T[] => Array.from(element.shadowRoot?.querySelectorAll<T>(selector) ?? []);
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const events = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};
const get = (mounted: { store: { get(path: string): unknown } }, name: string): unknown => mounted.store.get(`$.app.${name}`);

/** The list of pages as the user sees it: numbers and … for a gap */
const shown = (element: Element): string[] => all(element, '.entry').map((entry) => (entry.querySelector('.page') ? (entry.querySelector('.page')?.textContent ?? '') : '…'));
const previous = (element: Element): HTMLButtonElement => part<HTMLButtonElement>(element, '.previous');
const next = (element: Element): HTMLButtonElement => part<HTMLButtonElement>(element, '.next');
const pageButton = (element: Element, page: number): HTMLButtonElement => all<HTMLButtonElement>(element, '.page').find((button) => button.textContent === String(page)) as HTMLButtonElement;
/** The native select inside the page size `select` atom */
const sizeSelect = (element: Element): HTMLSelectElement | null => part(element, 'ui-select')?.shadowRoot?.querySelector('select') ?? null;

describe('pagination in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render a nav landmark with previous, next and the current page marked', async () => {
        // Arrange
        const mounted = mountComponent('pagination', { _label: 'Orders pages', page: 2, pageSize: 10, total: 50 });
        await flush();

        // Assert
        expect(part(mounted.element, 'nav').getAttribute('aria-label')).toBe('Orders pages');
        expect(previous(mounted.element).textContent?.trim()).toBe('Previous');
        expect(next(mounted.element).textContent?.trim()).toBe('Next');
        expect(shown(mounted.element)).toEqual(['1', '2', '3', '4', '5']);
        expect(all(mounted.element, '[aria-current="page"]').map((node) => node.textContent)).toEqual(['2']);
        expect(all(mounted.element, '.page').map((button) => button.getAttribute('aria-label'))).toEqual(['Page 1', 'Page 2', 'Page 3', 'Page 4', 'Page 5']);
    });

    it('should list the only page of one page and disable both edges', async () => {
        // Arrange
        const mounted = mountComponent('pagination', { page: 1, pageSize: 10, total: 7 });
        const empty = mountComponent('pagination', { page: 1, pageSize: 10, total: 0 });
        await flush();

        // Assert
        expect(shown(mounted.element)).toEqual(['1']);
        expect(previous(mounted.element).disabled).toBe(true);
        expect(next(mounted.element).disabled).toBe(true);
        expect(shown(empty.element)).toEqual(['1']);
    });

    it('should list every page of 7 pages with no ellipsis', async () => {
        // Arrange
        const mounted = mountComponent('pagination', { page: 4, pageSize: 10, total: 70 });
        await flush();

        // Assert
        expect(shown(mounted.element)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    });

    it('should list the first, last, current and siblings with ellipses for 100 pages', async () => {
        // Arrange
        const start = mountComponent('pagination', { page: 1, pageSize: 10, total: 1000 });
        const middle = mountComponent('pagination', { page: 50, pageSize: 10, total: 1000 });
        const end = mountComponent('pagination', { page: 100, pageSize: 10, total: 1000 });
        const wide = mountComponent('pagination', { page: 50, pageSize: 10, total: 1000, siblings: 2 });
        await flush();

        // Assert
        expect(shown(start.element)).toEqual(['1', '2', '3', '4', '5', '…', '100']);
        expect(shown(middle.element)).toEqual(['1', '…', '49', '50', '51', '…', '100']);
        expect(shown(end.element)).toEqual(['1', '…', '96', '97', '98', '99', '100']);
        expect(shown(wide.element)).toEqual(['1', '…', '48', '49', '50', '51', '52', '…', '100']);
        expect(all(middle.element, '.gap').every((gap) => gap.getAttribute('aria-hidden') === 'true')).toBe(true);
    });

    it('should disable previous on the first page and next on the last, and no more', async () => {
        // Arrange
        const first = mountComponent('pagination', { page: 1, pageSize: 10, total: 100 });
        const last = mountComponent('pagination', { page: 10, pageSize: 10, total: 100 });
        const inside = mountComponent('pagination', { page: 5, pageSize: 10, total: 100 });
        await flush();

        // Assert
        expect([previous(first.element).disabled, next(first.element).disabled]).toEqual([true, false]);
        expect([previous(last.element).disabled, next(last.element).disabled]).toEqual([false, true]);
        expect([previous(inside.element).disabled, next(inside.element).disabled]).toEqual([false, false]);
    });

    it('should write page and raise change with page and pageSize for a page, previous and next', async () => {
        // Arrange
        const mounted = mountComponent('pagination', { '<-page': '$.data.page', pageSize: 10, total: 100 }, { data: { page: 3 } });
        await flush();
        const changes = events(mounted.element, 'change');

        // Act
        await userEvent.click(pageButton(mounted.element, 4));
        await flush();
        await userEvent.click(next(mounted.element));
        await flush();
        await userEvent.click(previous(mounted.element));
        await flush();
        await userEvent.click(previous(mounted.element));
        await flush();

        // Assert
        expect(changes).toEqual([
            { page: 4, pageSize: 10 },
            { page: 5, pageSize: 10 },
            { page: 4, pageSize: 10 },
            { page: 3, pageSize: 10 }
        ]);
        expect(mounted.store.get('$.data.page')).toBe(3);
        expect(all(mounted.element, '[aria-current="page"]').map((node) => node.textContent)).toEqual(['3']);
    });

    it('should not raise change for the current page or a disabled edge button', async () => {
        // Arrange
        const mounted = mountComponent('pagination', { page: 1, pageSize: 10, total: 100 });
        await flush();
        const changes = events(mounted.element, 'change');

        // Act
        await userEvent.click(pageButton(mounted.element, 1));
        previous(mounted.element).click();

        // Assert
        expect(changes).toEqual([]);
    });

    it('should follow data written from outside for page, pageSize and total', async () => {
        // Arrange
        const mounted = mountComponent('pagination', { '<-page': '$.data.page', '<-total': '$.data.total', pageSize: 10 }, { data: { page: 1, total: 30 } });
        await flush();

        // Act
        mounted.store.set('$.data.total', 1000);
        mounted.store.set('$.data.page', 50);
        await flush();

        // Assert
        expect(shown(mounted.element)).toEqual(['1', '…', '49', '50', '51', '…', '100']);
        expect(get(mounted, 'pages')).toBe(100);
        expect(get(mounted, 'current')).toBe(50);
    });

    it('should show a page beyond the last as the last page without writing it back', async () => {
        // Arrange
        const mounted = mountComponent('pagination', { '<-page': '$.data.page', pageSize: 10, total: 30 }, { data: { page: 9 } });
        await flush();

        // Assert
        expect(get(mounted, 'current')).toBe(3);
        expect(next(mounted.element).disabled).toBe(true);
        expect(mounted.store.get('$.data.page')).toBe(9);
    });

    it('should hide the page size select without pageSizes', async () => {
        // Arrange
        const mounted = mountComponent('pagination', { page: 1, pageSize: 10, total: 100 });
        await flush();

        // Assert
        expect(part(mounted.element, 'ui-select')).toBeNull();
    });

    it('should offer the page sizes, show the current one and reset page to 1 when a size is picked', async () => {
        // Arrange
        const mounted = mountComponent(
            'pagination',
            { '<-page': '$.data.page', '<-pageSize': '$.data.size', total: 500, pageSizes: [10, 25, 50] },
            { data: { page: 7, size: 25 } }
        );
        await flush();
        await flush();
        const changes = events(mounted.element, 'change');
        const select = sizeSelect(mounted.element) as HTMLSelectElement;
        const offered = Array.from(select.options).map((option) => option.text);
        const before = select.value;

        // Act
        await userEvent.selectOptions(select, '50');
        await flush();
        await flush();

        // Assert
        expect(offered).toEqual(['10', '25', '50']);
        expect(before).toBe('25');
        expect(select.getAttribute('aria-label')).toBe('Rows per page');
        expect(mounted.store.get('$.data.size')).toBe(50);
        expect(typeof mounted.store.get('$.data.size')).toBe('number');
        expect(mounted.store.get('$.data.page')).toBe(1);
        expect(changes).toEqual([{ page: 1, pageSize: 50 }]);
        expect(shown(mounted.element)).toEqual(['1', '2', '3', '4', '5', '…', '10']);
    });

    it('should list a page size that is not in pageSizes', async () => {
        // Arrange
        const mounted = mountComponent('pagination', { pageSize: 15, total: 500, pageSizes: [10, 25] });
        await flush();
        await flush();

        // Assert
        expect(Array.from((sizeSelect(mounted.element) as HTMLSelectElement).options).map((option) => option.text)).toEqual(['10', '15', '25']);
    });

    it('should show previous, next and the position only when compact', async () => {
        // Arrange
        const mounted = mountComponent('pagination', { compact: true, page: 3, pageSize: 10, total: 100 });
        await flush();
        const changes = events(mounted.element, 'change');

        // Act
        await userEvent.click(next(mounted.element));
        await flush();

        // Assert
        expect(mounted.element.hasAttribute('compact')).toBe(true);
        expect(all(mounted.element, '.page')).toEqual([]);
        expect(part(mounted.element, '.status').textContent?.trim()).toBe('4 / 10');
        expect(changes).toEqual([{ page: 4, pageSize: 10 }]);
    });

    it('should show the labels and page names in German', async () => {
        // Arrange
        const mounted = mountComponent('pagination', { page: 2, pageSize: 10, total: 100, pageSizes: [10, 20] }, { locale: 'de' });
        await flush();
        await flush();

        // Assert
        expect(part(mounted.element, 'nav').getAttribute('aria-label')).toBe('Seitennavigation');
        expect(previous(mounted.element).textContent?.trim()).toBe('Zurück');
        expect(next(mounted.element).textContent?.trim()).toBe('Weiter');
        expect(pageButton(mounted.element, 3).getAttribute('aria-label')).toBe('Seite 3');
        expect(sizeSelect(mounted.element)?.getAttribute('aria-label')).toBe('Zeilen pro Seite');
    });
});
