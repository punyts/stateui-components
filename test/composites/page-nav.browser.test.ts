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
const wide = (host: HTMLElement): void => {
    host.style.inlineSize = '1200px';
};

describe('page in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
        document.title = '';
    });

    const slots = {
        header: text('Head'),
        nav: text('Navigation'),
        footer: text('Foot'),
        children: { a: text('Main') }
    };

    it('should place the nav beside the main area for navPosition start', () => {
        // Arrange
        const mounted = mountComponent('page', slots);
        wide(mounted.host);

        // Act
        const nav = box(part(mounted.element, '.nav') as HTMLElement);
        const main = box(part(mounted.element, '.main') as HTMLElement);
        const header = box(part(mounted.element, '.header') as HTMLElement);

        // Assert
        expect(mounted.element.getAttribute('nav-position')).toBe('start');
        expect(nav.right).toBeLessThanOrEqual(main.left + 1);
        expect(Math.abs(nav.top - main.top)).toBeLessThan(2);
        expect(header.bottom).toBeLessThanOrEqual(nav.top + 1);
    });

    it('should place the nav above the main area for navPosition top', () => {
        // Arrange
        const mounted = mountComponent('page', { ...slots, navPosition: 'top' });
        wide(mounted.host);

        // Act
        const nav = box(part(mounted.element, '.nav') as HTMLElement);
        const main = box(part(mounted.element, '.main') as HTMLElement);

        // Assert
        expect(nav.bottom).toBeLessThanOrEqual(main.top + 1);
        expect(Math.abs(nav.left - main.left)).toBeLessThan(2);
    });

    it('should remove the nav from the layout for navPosition none', () => {
        // Arrange
        const mounted = mountComponent('page', { ...slots, navPosition: 'none' });
        wide(mounted.host);

        // Assert
        expect(part(mounted.element, '.nav')).toBeNull();
        expect(box(part(mounted.element, '.main') as HTMLElement).left).toBeLessThan(40);
    });

    it('should follow navPosition written later', () => {
        // Arrange
        const mounted = mountComponent('page', slots);

        // Act
        mounted.store.set('$.app.navPosition', 'none');

        // Assert
        expect(part(mounted.element, '.nav')).toBeNull();
    });

    it('should render no header or footer region when the slots are empty', () => {
        // Arrange
        const mounted = mountComponent('page', { children: { a: text('Main') } });

        // Assert
        expect(part(mounted.element, '.header')).toBeNull();
        expect(part(mounted.element, '.footer')).toBeNull();
        expect(part(mounted.element, '.nav')).toBeNull();
    });

    it('should limit the main width to 768 px for maxWidth md and leave it unlimited for none', () => {
        // Arrange
        const limited = mountComponent('page', { ...slots, navPosition: 'none', maxWidth: 'md' });
        const open = mountComponent('page', { ...slots, navPosition: 'none' });
        wide(limited.host);
        wide(open.host);

        // Assert
        expect(box(part(limited.element, '.content') as HTMLElement).width).toBe(768);
        expect(box(part(open.element, '.content') as HTMLElement).width).toBeGreaterThan(1000);
    });

    it.each([
        ['lg', 1024],
        ['xl', 1280]
    ] as const)('should limit the main width to the %s breakpoint', (maxWidth, expected) => {
        // Arrange
        const mounted = mountComponent('page', { ...slots, navPosition: 'none', maxWidth });
        mounted.host.style.inlineSize = '1500px';

        // Assert
        expect(box(part(mounted.element, '.content') as HTMLElement).width).toBe(expected);
    });

    it('should lay out the children of the main area with layout', () => {
        // Arrange
        const mounted = mountComponent('page', {
            navPosition: 'none',
            layout: { type: 'row', gap: 'md' },
            children: { a: text('A'), b: text('B') }
        });
        wide(mounted.host);

        // Act
        const [a, b] = Array.from(root(mounted.element).querySelectorAll('.body > sui-node')).map((node) => box(node.firstElementChild as Element));

        // Assert
        expect(Math.abs((a as DOMRect).top - (b as DOMRect).top)).toBeLessThan(2);
        expect((b as DOMRect).left).toBeGreaterThan((a as DOMRect).right - 1);
    });

    it('should set the document title from _title and follow it', () => {
        // Arrange
        document.title = 'Before';

        // Act
        const mounted = mountComponent('page', { _title: 'Orders' });
        const first = document.title;
        mounted.store.set('$.app._title', 'Customers');

        // Assert
        expect(first).toBe('Orders');
        expect(document.title).toBe('Customers');
    });

    it('should restore the document title on dispose and leave it alone for an empty _title', () => {
        // Arrange
        document.title = 'Before';
        const untitled = mountComponent('page', {});
        const unchanged = document.title;
        untitled.dispose();
        const titled = mountComponent('page', { _title: 'Orders' });

        // Act
        titled.dispose();

        // Assert
        expect(unchanged).toBe('Before');
        expect(document.title).toBe('Before');
    });

    it('should show the German _title from the document overlay', () => {
        // Arrange
        const mounted = mountComponent('page', { _title: 'Orders' }, { locales: { de: { _title: 'Bestellungen' } } });

        // Act
        mounted.setLocale('de');

        // Assert
        expect(document.title).toBe('Bestellungen');
    });
});

describe('page responsive nav in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    const frames = async (count: number): Promise<void> => {
        for (let n = 0; n < count; n++) await new Promise((resolve) => requestAnimationFrame(resolve));
    };
    const nav = { component: 'nav', children: { home: item('Home'), orders: item('Orders') } };
    const mountAt = async (width: number, extra: Record<string, unknown> = {}) => {
        const mounted = mountComponent('page', { nav, children: { a: text('Main') }, _title: 'Shop', ...extra });
        mounted.host.style.inlineSize = `${width}px`;
        await frames(3);
        return mounted;
    };
    const toggle = (element: Element): HTMLButtonElement => part(element, '.toggle') as HTMLButtonElement;
    const navBox = (element: Element): DOMRect => box(part(element, '.nav') as HTMLElement);

    it('should collapse a start nav into a bar with a closed menu button below 768 px and give the main area the full width', async () => {
        // Arrange and Act
        const mounted = await mountAt(390);

        // Assert
        expect(mounted.store.get('$.app.compact')).toBe(true);
        expect(mounted.element.hasAttribute('compact')).toBe(true);
        expect(toggle(mounted.element).getAttribute('aria-expanded')).toBe('false');
        expect(toggle(mounted.element).getAttribute('aria-controls')).toBe('nav');
        expect(toggle(mounted.element).textContent).toContain('Menu');
        expect(getComputedStyle(part(mounted.element, '.nav') as HTMLElement).display).toBe('none');
        const main = box(part(mounted.element, '.main') as HTMLElement);
        expect(main.width).toBeGreaterThan(350);
    });

    it('should keep the nav column and draw no bar at 1000 px', async () => {
        // Arrange and Act
        const mounted = await mountAt(1000);

        // Assert
        expect(mounted.store.get('$.app.compact')).toBe(false);
        expect(part(mounted.element, '.bar')).toBeNull();
        expect(box(part(mounted.element, '.nav') as HTMLElement).right).toBeLessThanOrEqual(box(part(mounted.element, '.main') as HTMLElement).left + 1);
    });

    it('should open the nav over the content on the button, and close it on the button again', async () => {
        // Arrange
        const mounted = await mountAt(390);

        // Act
        await userEvent.click(toggle(mounted.element));
        await frames(1);
        const opened = navBox(mounted.element);
        const expanded = toggle(mounted.element).getAttribute('aria-expanded');
        await userEvent.click(toggle(mounted.element));
        await frames(1);

        // Assert
        expect(mounted.store.get('$.app.navOpen')).toBe(false);
        expect(expanded).toBe('true');
        expect(opened.width).toBeGreaterThan(100);
        expect(opened.top).toBeGreaterThanOrEqual(box(part(mounted.element, '.bar') as HTMLElement).bottom - 1);
        expect(getComputedStyle(part(mounted.element, '.nav') as HTMLElement).display).toBe('none');
    });

    it('should close the nav when a nav item is chosen', async () => {
        // Arrange
        const mounted = await mountAt(390);
        mounted.store.set('$.app.navOpen', true);
        await frames(2);

        // Act
        await userEvent.click(itemButton(part(mounted.element, '.nav > sui-node')?.firstElementChild as Element, 'orders'));
        await frames(1);

        // Assert
        expect(mounted.store.get('$.app.navOpen')).toBe(false);
    });

    it('should close the nav on Escape and return focus to the button', async () => {
        // Arrange
        const mounted = await mountAt(390);
        toggle(mounted.element).focus();
        await userEvent.keyboard('{Enter}');
        await frames(1);

        // Act
        await userEvent.keyboard('{Escape}');
        await frames(1);

        // Assert
        expect(mounted.store.get('$.app.navOpen')).toBe(false);
        expect(root(mounted.element).activeElement).toBe(toggle(mounted.element));
    });

    it('should follow navOpen written from outside', async () => {
        // Arrange
        const mounted = await mountAt(390);

        // Act
        mounted.store.set('$.app.navOpen', true);
        await frames(1);

        // Assert
        expect(mounted.element.hasAttribute('nav-open')).toBe(true);
        expect(toggle(mounted.element).getAttribute('aria-expanded')).toBe('true');
        expect(getComputedStyle(part(mounted.element, '.nav') as HTMLElement).display).not.toBe('none');
    });

    it('should use navBreakpoint, and never collapse with 0 or a top nav', async () => {
        // Arrange
        const high = await mountAt(900, { navBreakpoint: 1000 });
        const off = await mountAt(300, { navBreakpoint: 0 });
        const top = await mountAt(300, { navPosition: 'top' });

        // Assert
        expect(high.store.get('$.app.compact')).toBe(true);
        expect(off.store.get('$.app.compact')).toBe(false);
        expect(top.store.get('$.app.compact')).toBe(false);
    });

    it('should leave compact and close the nav when the page grows past the breakpoint', async () => {
        // Arrange
        const mounted = await mountAt(390);
        mounted.store.set('$.app.navOpen', true);

        // Act
        mounted.host.style.inlineSize = '1000px';
        await frames(3);

        // Assert
        expect(mounted.store.get('$.app.compact')).toBe(false);
        expect(mounted.store.get('$.app.navOpen')).toBe(false);
    });

    it('should show the German menu label', async () => {
        // Arrange
        const mounted = await mountAt(390);

        // Act
        mounted.setLocale('de');
        await frames(1);

        // Assert
        expect(toggle(mounted.element).textContent).toContain('Menü');
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

    /** Three screens; `orders` needs a `status` */
    const SCREENS = Object.freeze({
        home: { root: text('Home screen') },
        users: { root: text('Users screen') },
        orders: { params: { status: { type: 'string', required: true } }, root: text('Orders screen') }
    });
    const screenItems = Object.freeze({
        home: { ...item('Home'), screen: 'home' },
        users: { ...item('Users'), screen: 'users' },
        orders: { ...item('Orders'), screen: 'orders' },
        open: { ...item('Open orders'), screen: 'orders', params: { status: 'open' } }
    });
    /** A page shell with the nav on top (it never collapses) and an outlet; `element` is the nav */
    const mountWithScreens = () => {
        const mounted = mountComponent(
            'page',
            { navPosition: 'top', nav: { component: 'nav', orientation: 'horizontal', children: JSON.parse(JSON.stringify(screenItems)) }, children: { main: { component: 'outlet' } } },
            { screens: JSON.parse(JSON.stringify(SCREENS)), start: 'home' }
        );
        return { ...mounted, element: root(mounted.element).querySelector('ui-nav') as Element };
    };

    it('should mark the item of the start screen active and navigate when an item with a screen is pressed', async () => {
        // Arrange
        const mounted = mountWithScreens();
        const seen = selects(mounted.element);
        const atStart = mounted.store.get('$.app.nav.active');

        // Act
        await userEvent.click(itemButton(mounted.element, 'users'));

        // Assert
        expect(atStart).toBe('home');
        expect(mounted.store.get('$.route.screen' as never)).toBe('users');
        expect(mounted.store.get('$.app.nav.active')).toBe('users');
        expect(mounted.store.get('$.app.nav.children.users.selected')).toBe(true);
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
        expect(mounted.store.get('$.app.nav.active')).toBe('users');
    });

    it('should keep the current item when the navigation of a pressed item is refused', async () => {
        // Arrange
        const mounted = mountWithScreens();

        // Act
        await userEvent.click(itemButton(mounted.element, 'orders'));

        // Assert
        expect(mounted.store.get('$.route.screen' as never)).toBe('home');
        expect(mounted.store.get('$.app.nav.active')).toBe('home');
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
