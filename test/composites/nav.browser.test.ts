import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;
const part = (element: Element, selector: string): HTMLElement | null => root(element).querySelector(selector);
const box = (element: Element): DOMRect => element.getBoundingClientRect();
const text = (value: string): Record<string, unknown> => ({ component: 'text', _text: value });
/** The native button of the menuItem rendered for a child key */
const itemButton = (nav: Element, key: string): HTMLButtonElement => {
    const node = root(nav).querySelector(`sui-node[state$=".children.${key}"]`) as Element;
    return node.firstElementChild?.shadowRoot?.querySelector('button') as HTMLButtonElement;
};
const item = (label: string): Record<string, unknown> => ({ component: 'menuItem', _label: label, icon: 'check' });

/** The first element with `tag` below `from`, crossing shadow roots */
function findDeep(from: ParentNode, tag: string): Element | undefined {
    for (const candidate of Array.from(from.querySelectorAll('*'))) {
        if (candidate.localName === tag) return candidate;
        const inner = candidate.shadowRoot ? findDeep(candidate.shadowRoot, tag) : undefined;
        if (inner) return inner;
    }
    return undefined;
}

describe('nav responsive collapse in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    const frames = async (count: number): Promise<void> => {
        for (let n = 0; n < count; n++) await new Promise((resolve) => requestAnimationFrame(resolve));
    };
    /** A row panel holding a nav and a main text: the width that decides is the panel's layout, set through the host */
    const mountAt = async (width: number, nav: Record<string, unknown> = {}) => {
        const mounted = mountComponent('panel', {
            layout: { type: 'row' },
            children: {
                nav: { component: 'nav', collapseBelow: 'md', children: { home: item('Home'), orders: item('Orders') }, ...nav },
                main: text('Main')
            }
        });
        mounted.host.style.inlineSize = `${width}px`;
        await frames(3);
        const element = findDeep(mounted.host, 'ui-nav') as Element;
        return { ...mounted, nav: element };
    };
    const toggle = (element: Element): HTMLButtonElement => part(element, '.toggle') as HTMLButtonElement;
    const NAV = '$.app.children.nav';

    it('should collapse into a closed menu button below 768 px for collapseBelow md', async () => {
        // Arrange and Act
        const mounted = await mountAt(390);

        // Assert
        expect(mounted.store.get(`${NAV}.compact`)).toBe(true);
        expect(mounted.nav.hasAttribute('compact')).toBe(true);
        expect(toggle(mounted.nav).getAttribute('aria-expanded')).toBe('false');
        expect(toggle(mounted.nav).getAttribute('aria-controls')).toBe('nav');
        expect(toggle(mounted.nav).textContent).toContain('Menu');
        expect(getComputedStyle(part(mounted.nav, '.nav') as HTMLElement).display).toBe('none');
    });

    it('should keep the items and draw no button at 1000 px', async () => {
        // Arrange and Act
        const mounted = await mountAt(1000);

        // Assert
        expect(mounted.store.get(`${NAV}.compact`)).toBe(false);
        expect(part(mounted.nav, '.toggle')).toBeNull();
        expect(getComputedStyle(part(mounted.nav, '.nav') as HTMLElement).display).not.toBe('none');
    });

    it('should open the menu on the button, and close it on the button again', async () => {
        // Arrange
        const mounted = await mountAt(390);

        // Act
        await userEvent.click(toggle(mounted.nav));
        await frames(1);
        const opened = box(part(mounted.nav, '.nav') as HTMLElement);
        const expanded = toggle(mounted.nav).getAttribute('aria-expanded');
        await userEvent.click(toggle(mounted.nav));
        await frames(1);

        // Assert
        expect(expanded).toBe('true');
        expect(opened.width).toBeGreaterThan(100);
        expect(mounted.store.get(`${NAV}.open`)).toBe(false);
        expect(getComputedStyle(part(mounted.nav, '.nav') as HTMLElement).display).toBe('none');
    });

    it('should close the menu when an item is chosen', async () => {
        // Arrange
        const mounted = await mountAt(390);
        mounted.store.set(`${NAV}.open`, true);
        await frames(2);

        // Act
        await userEvent.click(itemButton(mounted.nav, 'orders'));
        await frames(1);

        // Assert
        expect(mounted.store.get(`${NAV}.open`)).toBe(false);
        expect(mounted.store.get(`${NAV}.active`)).toBe('orders');
    });

    it('should close the menu on Escape and return focus to the button', async () => {
        // Arrange
        const mounted = await mountAt(390);
        toggle(mounted.nav).focus();
        await userEvent.keyboard('{Enter}');
        await frames(1);

        // Act
        await userEvent.keyboard('{Escape}');
        await frames(1);

        // Assert
        expect(mounted.store.get(`${NAV}.open`)).toBe(false);
        expect(root(mounted.nav).activeElement).toBe(toggle(mounted.nav));
    });

    it('should follow open written from outside', async () => {
        // Arrange
        const mounted = await mountAt(390);

        // Act
        mounted.store.set(`${NAV}.open`, true);
        await frames(1);

        // Assert
        expect(mounted.nav.hasAttribute('open')).toBe(true);
        expect(toggle(mounted.nav).getAttribute('aria-expanded')).toBe('true');
        expect(getComputedStyle(part(mounted.nav, '.nav') as HTMLElement).display).not.toBe('none');
    });

    it('should use the breakpoint collapseBelow names, never collapse for none, and collapse a horizontal nav too', async () => {
        // Arrange and Act
        const large = await mountAt(900, { collapseBelow: 'lg' });
        const never = await mountAt(300, { collapseBelow: 'none' });
        const horizontal = await mountAt(390, { orientation: 'horizontal' });

        // Assert
        expect(large.store.get(`${NAV}.compact`)).toBe(true);
        expect(never.store.get(`${NAV}.compact`)).toBe(false);
        expect(horizontal.store.get(`${NAV}.compact`)).toBe(true);
    });

    it('should leave compact and close the menu when the layout grows past the breakpoint', async () => {
        // Arrange
        const mounted = await mountAt(390);
        mounted.store.set(`${NAV}.open`, true);

        // Act
        mounted.host.style.inlineSize = '1000px';
        await frames(3);

        // Assert
        expect(mounted.store.get(`${NAV}.compact`)).toBe(false);
        expect(mounted.store.get(`${NAV}.open`)).toBe(false);
    });

    it('should show the German menu label', async () => {
        // Arrange
        const mounted = await mountAt(390);

        // Act
        mounted.setLocale('de');
        await frames(1);

        // Assert
        expect(toggle(mounted.nav).textContent).toContain('Menü');
    });
});

describe('nav in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    const children = { home: item('Home'), orders: item('Orders'), users: item('Users') };
    const selects = (element: Element): string[] => {
        const seen: string[] = [];
        element.addEventListener('select', (event) => seen.push((event as CustomEvent<string>).detail));
        return seen;
    };

    it('should write selected on the item whose key equals active only', () => {
        // Arrange
        const mounted = mountComponent('nav', { active: 'orders', children });

        // Assert
        expect(mounted.store.get('$.app.children.orders.selected')).toBe(true);
        expect(mounted.store.get('$.app.children.home.selected')).toBe(false);
        expect(itemButton(mounted.element, 'orders').getAttribute('aria-current')).toBe('true');
        expect(itemButton(mounted.element, 'home').hasAttribute('aria-current')).toBe(false);
    });

    it('should move selected when active is written', () => {
        // Arrange
        const mounted = mountComponent('nav', { active: 'orders', children });

        // Act
        mounted.store.set('$.app.active', 'users');

        // Assert
        expect(mounted.store.get('$.app.children.orders.selected')).toBe(false);
        expect(mounted.store.get('$.app.children.users.selected')).toBe(true);
    });

    it('should write selected on an item added later', () => {
        // Arrange
        const mounted = mountComponent('nav', { active: 'reports', children });

        // Act
        mounted.store.set('$.app.children.reports', item('Reports'));

        // Assert
        expect(mounted.store.get('$.app.children.reports.selected')).toBe(true);
    });

    it('should set active and raise select with the key when an item is pressed', async () => {
        // Arrange
        const mounted = mountComponent('nav', { active: 'home', children });
        const seen = selects(mounted.element);

        // Act
        await userEvent.click(itemButton(mounted.element, 'users'));

        // Assert
        expect(seen).toEqual(['users']);
        expect(mounted.store.get('$.app.active')).toBe('users');
        expect(mounted.store.get('$.app.children.users.selected')).toBe(true);
        expect(mounted.store.get('$.app.children.home.selected')).toBe(false);
    });

    it('should not select on a press of a disabled item or a header control', async () => {
        // Arrange
        const mounted = mountComponent('nav', {
            active: 'home',
            header: { component: 'button', _title: 'Brand' },
            children: { ...children, off: { component: 'menuItem', _label: 'Off', disabled: true } }
        });
        const seen = selects(mounted.element);

        // Act
        await userEvent.click(part(mounted.element, '.header ui-button') as HTMLElement);
        await userEvent.click(itemButton(mounted.element, 'off'), { force: true }).catch(() => undefined);

        // Assert
        expect(seen).toEqual([]);
        expect(mounted.store.get('$.app.active')).toBe('home');
    });

    const screenItems = Object.freeze({
        home: { ...item('Home'), screen: 'home' },
        users: { ...item('Users'), screen: 'users' },
        open: { ...item('Open orders'), screen: 'orders', params: { status: 'open' } }
    });
    /** A screen that places the shared horizontal nav above its text */
    const screen = (body: string): Record<string, unknown> => ({
        component: 'panel',
        children: { nav: { component: 'nav', orientation: 'horizontal', children: JSON.parse(JSON.stringify(screenItems)) as unknown }, body: text(body) }
    });
    /** Three screens, each placing the nav; `orders` needs a `status` */
    const screens = () => ({
        home: { root: screen('Home screen') },
        users: { root: screen('Users screen') },
        orders: { params: { status: { type: 'string', required: true } }, root: screen('Orders screen') }
    });
    /** The nav of a screen, by its state path */
    const navOf = (host: HTMLElement, name: string): Element => {
        const all: Element[] = [];
        const walk = (from: ParentNode): void => {
            for (const candidate of Array.from(from.querySelectorAll('*'))) {
                if (candidate.localName === 'ui-nav') all.push(candidate);
                if (candidate.shadowRoot) walk(candidate.shadowRoot);
            }
        };
        walk(host);
        return all.find((nav) => (nav as { scope?: { basePath?: string } }).scope?.basePath === `$.screens.${name}.children.nav`) as Element;
    };
    /** An app whose start screen is `home`; `element` is the nav of the home screen */
    const mountWithScreens = () => {
        const mounted = mountComponent('app', {}, { screens: screens(), start: 'home' });
        return { ...mounted, element: navOf(mounted.host, 'home') };
    };
    const HOME_NAV = '$.screens.home.children.nav';
    const USERS_NAV = '$.screens.users.children.nav';

    it('should mark the item of the start screen active and navigate when an item with a screen is pressed', async () => {
        // Arrange
        const mounted = mountWithScreens();
        const seen = selects(mounted.element);
        const atStart = mounted.store.get(`${HOME_NAV}.active`);

        // Act
        await userEvent.click(itemButton(mounted.element, 'users'));

        // Assert
        expect(atStart).toBe('home');
        expect(mounted.store.get('$.route.screen' as never)).toBe('users');
        expect(mounted.store.get(`${USERS_NAV}.active`)).toBe('users');
        expect(mounted.store.get(`${USERS_NAV}.children.users.selected`)).toBe(true);
        expect(seen).toEqual(['users']);
    });

    it('should pass the params of the item and follow a navigation from elsewhere', async () => {
        // Arrange
        const mounted = mountWithScreens();

        // Act
        await userEvent.click(itemButton(mounted.element, 'open'));
        const pressed = { screen: mounted.store.get('$.route.screen' as never), status: mounted.store.get('$.route.params.status' as never) };
        mounted.navigate('users');

        // Assert
        expect(pressed).toEqual({ screen: 'orders', status: 'open' });
        expect(mounted.store.get(`${USERS_NAV}.active`)).toBe('users');
    });

    it('should keep the current item when the navigation of a pressed item is refused', async () => {
        // Arrange
        // an item without the required status is refused when the document is checked, so the params go at run time
        const mounted = mountWithScreens();
        mounted.store.set(`${HOME_NAV}.children.open.params`, {});

        // Act
        await userEvent.click(itemButton(mounted.element, 'open'));

        // Assert
        expect(mounted.store.get('$.route.screen' as never)).toBe('home');
        expect(mounted.store.get(`${HOME_NAV}.active`)).toBe('home');
    });

    it('should give the items the link role inside the nav and label the landmark', () => {
        // Arrange
        const mounted = mountComponent('nav', { children });

        // Assert
        expect(itemButton(mounted.element, 'home').getAttribute('role')).toBe('link');
        expect(part(mounted.element, 'nav')?.getAttribute('aria-label')).toBe('Main navigation');
    });

    it('should render the header and footer slots', () => {
        // Arrange
        const mounted = mountComponent('nav', { header: text('Head'), footer: text('Foot'), children });

        // Assert
        expect(part(mounted.element, '.header ui-text')).not.toBeNull();
        expect(part(mounted.element, '.footer ui-text')).not.toBeNull();
    });

    it('should lay the items out in a column, or in a row for horizontal', () => {
        // Arrange
        const vertical = mountComponent('nav', { children });
        const horizontal = mountComponent('nav', { orientation: 'horizontal', children });
        const tops = (element: Element): number[] =>
            ['home', 'orders'].map((key) => box(itemButton(element, key)).top);

        // Assert
        expect(tops(vertical.element)[1]).toBeGreaterThan(tops(vertical.element)[0] as number);
        expect(Math.abs((tops(horizontal.element)[1] as number) - (tops(horizontal.element)[0] as number))).toBeLessThan(2);
    });

    it('should wrap a narrow horizontal nav by default and keep one scrolling row with overflow scroll', () => {
        // Arrange
        const many = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((key) => [key, item(`Section ${key}`)]));
        const wrapped = mountComponent('nav', { orientation: 'horizontal', children: many });
        const scrolled = mountComponent('nav', { orientation: 'horizontal', overflow: 'scroll', children: many });
        for (const mounted of [wrapped, scrolled]) mounted.host.style.inlineSize = '320px';
        const spread = (element: Element): number => box(itemButton(element, 'f')).top - box(itemButton(element, 'a')).top;
        const items = part(scrolled.element, '.items') as HTMLElement;

        // Assert
        expect(spread(wrapped.element)).toBeGreaterThan(2);
        expect(Math.abs(spread(scrolled.element))).toBeLessThan(2);
        expect(items.scrollWidth).toBeGreaterThan(items.clientWidth);
        expect(box(scrolled.element).width).toBeLessThanOrEqual(320);
    });

    it('should hide the labels of a collapsed nav but keep the accessible name', () => {
        // Arrange
        const open = mountComponent('nav', { children });
        const collapsed = mountComponent('nav', { collapsed: true, children });
        const label = (element: Element): DOMRect => box(itemButton(element, 'home').querySelector('.label') as Element);

        // Assert
        expect(label(open.element).width).toBeGreaterThan(10);
        expect(label(collapsed.element).width).toBe(0);
        expect(itemButton(collapsed.element, 'home').textContent).toContain('Home');
        expect(box(part(collapsed.element, '.nav') as HTMLElement).width).toBeLessThan(box(part(open.element, '.nav') as HTMLElement).width);
    });

    it('should show the labels again when collapsed is cleared', () => {
        // Arrange
        const mounted = mountComponent('nav', { collapsed: true, children });

        // Act
        mounted.store.set('$.app.collapsed', false);

        // Assert
        expect(box(itemButton(mounted.element, 'home').querySelector('.label') as Element).width).toBeGreaterThan(10);
    });

    it('should show German item labels and the German landmark name', () => {
        // Arrange
        const mounted = mountComponent(
            'nav',
            { children },
            { locales: { de: { children: { home: { _label: 'Start' } } } } }
        );

        // Act
        mounted.setLocale('de');

        // Assert
        expect(part(mounted.element, 'nav')?.getAttribute('aria-label')).toBe('Hauptnavigation');
        expect(itemButton(mounted.element, 'home').querySelector('.label')?.textContent).toBe('Start');
    });
});
