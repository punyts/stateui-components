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
/** The text of each crumb in order: a collapsed menu shows as `…` */
const trail = (element: Element): string[] =>
    all<HTMLElement>(element, '.crumb').map((crumb) => (crumb.dataset['kind'] === 'more' ? '…' : (crumb.querySelector('.link, .page')?.textContent ?? '')));

/** The menu inside the collapsed crumb, found through the shadow roots */
const menu = (element: Element): Element | null => part(element, '.crumb[data-kind="more"] sui-node')?.firstElementChild ?? null;
const menuTrigger = (element: Element): HTMLButtonElement | null =>
    menu(element)?.shadowRoot?.querySelector('.trigger sui-node')?.firstElementChild?.shadowRoot?.querySelector('button') ?? null;
const menuPopup = (element: Element): HTMLElement | null => menu(element)?.shadowRoot?.querySelector<HTMLElement>('.popup') ?? null;
const menuItemButtons = (element: Element): HTMLButtonElement[] =>
    Array.from(menuPopup(element)?.querySelectorAll('sui-node') ?? []).map((node) => node.firstElementChild?.shadowRoot?.querySelector('button') as HTMLButtonElement);

const orders = {
    home: { _label: 'Home' },
    shop: { _label: 'Shop' },
    orders: { _label: 'Orders' },
    o42: { _label: 'Order 42' }
};
const deep = {
    home: { _label: 'Home' },
    shop: { _label: 'Shop' },
    orders: { _label: 'Orders' },
    year: { _label: '2026' },
    month: { _label: 'October' },
    o42: { _label: 'Order 42' }
};

describe('breadcrumb in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render a nav landmark named by its label with the items in order', async () => {
        // Arrange
        const mounted = mountComponent('breadcrumb', { _label: 'You are here', items: orders });
        await flush();

        // Assert
        expect(part(mounted.element, 'nav').getAttribute('aria-label')).toBe('You are here');
        expect(part(mounted.element, 'ol')).not.toBeNull();
        expect(trail(mounted.element)).toEqual(['Home', 'Shop', 'Orders', 'Order 42']);
    });

    it('should make the last item current by default: aria-current page and not a button', async () => {
        // Arrange
        const mounted = mountComponent('breadcrumb', { items: orders });
        await flush();
        const page = all(mounted.element, '[aria-current="page"]');

        // Assert
        expect(page.map((node) => node.textContent)).toEqual(['Order 42']);
        expect(page[0]?.localName).toBe('span');
        expect(all(mounted.element, 'button.link').map((button) => button.textContent)).toEqual(['Home', 'Shop', 'Orders']);
    });

    it('should take the named item as current and keep the items after it as buttons', async () => {
        // Arrange
        const mounted = mountComponent('breadcrumb', { items: orders, current: 'shop' });
        await flush();

        // Assert
        expect(all(mounted.element, '[aria-current="page"]').map((node) => node.textContent)).toEqual(['Shop']);
        expect(all(mounted.element, 'button.link').map((button) => button.textContent)).toEqual(['Home', 'Orders', 'Order 42']);
    });

    it('should raise select with the key of a pressed item and nothing for the current item', async () => {
        // Arrange
        const mounted = mountComponent('breadcrumb', { items: orders });
        await flush();
        const selected = events(mounted.element, 'select');

        // Act
        await userEvent.click(all(mounted.element, 'button.link')[1] as Element);
        part<HTMLElement>(mounted.element, '[aria-current="page"]').click();

        // Assert
        expect(selected).toEqual(['shop']);
    });

    it('should show a data change of the items and of the current key', async () => {
        // Arrange
        const mounted = mountComponent('breadcrumb', { maxVisible: 6, '<-items': '$.data.trail', '<-current': '$.data.at' }, { data: { trail: orders, at: '' } });
        await flush();

        // Act
        mounted.store.set('$.data.trail', { ...orders, o43: { _label: 'Order 43' } });
        await flush();
        const longer = trail(mounted.element);
        mounted.store.set('$.data.at', 'orders');
        await flush();

        // Assert
        expect(longer).toEqual(['Home', 'Shop', 'Orders', 'Order 42', 'Order 43']);
        expect(all(mounted.element, '[aria-current="page"]').map((node) => node.textContent)).toEqual(['Orders']);
    });

    it('should show the key of an item with no label', async () => {
        // Arrange
        const mounted = mountComponent('breadcrumb', { items: { home: {}, shop: { _label: 'Shop' } } });
        await flush();

        // Assert
        expect(trail(mounted.element)).toEqual(['home', 'Shop']);
    });

    it('should collapse the middle items into a menu when there are more than maxVisible', async () => {
        // Arrange
        const mounted = mountComponent('breadcrumb', { items: deep });
        await flush();
        await flush();

        // Assert
        expect(trail(mounted.element)).toEqual(['Home', '…', '2026', 'October', 'Order 42']);
        expect(menu(mounted.element)?.localName).toBe('ui-menu');
        expect(menuTrigger(mounted.element)?.getAttribute('aria-label')).toBe('Show hidden levels');
        expect(menuTrigger(mounted.element)?.getAttribute('aria-haspopup')).toBe('menu');
    });

    it('should not collapse when the items fit, and collapse with a smaller maxVisible', async () => {
        // Arrange
        const fits = mountComponent('breadcrumb', { items: deep, maxVisible: 6 });
        const small = mountComponent('breadcrumb', { items: orders, maxVisible: 2 });
        await flush();
        await flush();

        // Assert
        expect(trail(fits.element)).toEqual(['Home', 'Shop', 'Orders', '2026', 'October', 'Order 42']);
        expect(menu(fits.element)).toBeNull();
        expect(trail(small.element)).toEqual(['Home', '…', 'Order 42']);
    });

    it('should open the menu from its trigger, list the collapsed items and raise select with the chosen key', async () => {
        // Arrange
        const mounted = mountComponent('breadcrumb', { items: deep });
        await flush();
        await flush();
        const selected = events(mounted.element, 'select');

        // Act
        await userEvent.click(menuTrigger(mounted.element) as Element);
        await flush();
        const open = menuPopup(mounted.element)?.matches(':popover-open');
        const names = menuItemButtons(mounted.element).map((button) => button.textContent?.trim());
        await userEvent.click(menuItemButtons(mounted.element)[1] as Element);
        await flush();

        // Assert
        expect(open).toBe(true);
        expect(names).toEqual(['Shop', 'Orders']);
        expect(selected).toEqual(['orders']);
        expect(menuPopup(mounted.element)?.matches(':popover-open')).toBe(false);
    });

    it('should keep the current item out of the menu, and update the menu when the items change', async () => {
        // Arrange
        const mounted = mountComponent('breadcrumb', { '<-items': '$.data.trail', current: 'orders' }, { data: { trail: deep } });
        await flush();
        await flush();

        // Act
        mounted.store.set('$.data.trail', { ...deep, extra: { _label: 'Extra' } });
        await flush();
        await flush();
        await userEvent.click(menuTrigger(mounted.element) as Element);
        await flush();

        // Assert
        expect(trail(mounted.element)).toEqual(['Home', '…', 'Orders', '2026', 'October', 'Order 42', 'Extra']);
        expect(all(mounted.element, '.page').map((node) => node.textContent)).toEqual(['Orders']);
        expect(menuItemButtons(mounted.element).map((button) => button.textContent?.trim())).toEqual(['Shop']);
    });

    it('should show the label, the menu trigger name and the translated item labels in German', async () => {
        // Arrange
        const locales = { de: { items: { home: { _label: 'Startseite' }, shop: { _label: 'Laden' }, orders: { _label: 'Bestellungen' }, year: { _label: '2026' }, month: { _label: 'Oktober' }, o42: { _label: 'Bestellung 42' } } } };
        const mounted = mountComponent('breadcrumb', { items: deep }, { locales, locale: 'de' });
        await flush();
        await flush();

        // Assert
        expect(part(mounted.element, 'nav').getAttribute('aria-label')).toBe('Brotkrümelnavigation');
        expect(menuTrigger(mounted.element)?.getAttribute('aria-label')).toBe('Ausgeblendete Ebenen anzeigen');
        expect(trail(mounted.element)).toEqual(['Startseite', '…', '2026', 'Oktober', 'Bestellung 42']);
    });
});
