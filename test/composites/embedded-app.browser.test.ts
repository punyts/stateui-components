import { libraryFromCatalog } from '@punyts/stateui-app';
import type { AppAsk, AppDocument, AppHost, MountedApp, OpenedApp } from '@punyts/stateui-app';
import type { Catalog } from '@punyts/stateui-app/build';
import type { Store } from '@punyts/state';
import { afterEach, describe, expect, it } from 'vitest';
import catalog from '../../.test-build/real/components/catalog.json';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const library = libraryFromCatalog(catalog as unknown as Catalog);
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** An app of two screens that shows `$.data.name`, emits `saved` and moves itself to `about` */
const SHOP: AppDocument = {
    data: { name: 'Ada' },
    start: 'home',
    app: { component: 'app', _title: 'Shop' },
    screens: {
        home: {
            root: {
                component: 'panel',
                children: {
                    hello: { component: 'text', '<-_text': '$.data.name' },
                    save: { component: 'button', _title: 'Save', on: { press: { command: 'emit', target: 'saved', value: 'yes' } } },
                    more: { component: 'button', _title: 'More', on: { press: { command: 'navigate', target: 'about' } } }
                }
            }
        },
        about: { root: { component: 'text', _text: 'About the shop' } }
    }
} as unknown as AppDocument;

/** Every text node below `root`, crossing shadow roots */
function textOf(root: ParentNode): string {
    let text = '';
    for (const child of Array.from(root.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? '';
        else if (child instanceof Element) {
            text += child.shadowRoot ? textOf(child.shadowRoot) : '';
            text += textOf(child);
        }
    }
    return text;
}

/** Every element with `tag` below `root`, crossing shadow roots */
function findAll(root: ParentNode, tag: string): HTMLElement[] {
    const found: HTMLElement[] = [];
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        if (candidate.localName === tag) found.push(candidate as HTMLElement);
        if (candidate.shadowRoot) found.push(...findAll(candidate.shadowRoot, tag));
    }
    return found;
}

const frame = (mounted: MountedComponent): HTMLElement => mounted.element.shadowRoot!.querySelector('.frame') as HTMLElement;
const holder = (mounted: MountedComponent): HTMLElement => mounted.element.shadowRoot!.querySelector('.app') as HTMLElement;

/** An app host that knows `shop`, refuses anything else, and hands each preview the live app's store */
function shopHost(): AppHost & { asks: AppAsk[]; live?: MountedApp } {
    const host: AppHost & { asks: AppAsk[]; live?: MountedApp } = {
        asks: [],
        open(ask) {
            host.asks.push(ask);
            if (ask.app !== 'shop') return Promise.reject(new Error('No such app'));
            const opened: OpenedApp = ask.live
                ? { document: SHOP, library, mounted: (app) => (host.live = app) }
                : { document: SHOP, library, ...(host.live?.store === undefined ? {} : { follows: host.live.store as unknown as Store<unknown> }) };
            return Promise.resolve(opened);
        }
    };
    return host;
}

describe('embeddedApp in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should mount the app its host gives on its screen, follow screen, and leave the page title alone', async () => {
        // Arrange
        const apps = shopHost();
        const title = document.title;

        // Act
        const mounted = mountComponent('embeddedApp', { app: 'shop', appScreen: 'about', live: true, _label: 'Shop' }, { apps });
        await flush();

        // Assert
        expect(apps.asks).toEqual([{ app: 'shop', screen: 'about', live: true }]);
        expect(mounted.element.hasAttribute('mounted')).toBe(true);
        expect(textOf(holder(mounted))).toContain('About the shop');
        expect(document.title).toBe(title);

        // Act
        mounted.store.set('$.app.appScreen', 'home');
        await flush();

        // Assert
        expect(textOf(holder(mounted))).toContain('Ada');
        expect(apps.asks).toHaveLength(1);
    });

    it('should show its label without an app host, and when the host refuses the app', async () => {
        // Arrange
        const apps = shopHost();

        // Act
        const alone = mountComponent('embeddedApp', { app: 'shop', _label: 'Shop' });
        const refused = mountComponent('embeddedApp', { app: 'nowhere', _label: 'Nowhere' }, { apps });
        await flush();

        // Assert
        expect(alone.element.hasAttribute('mounted')).toBe(false);
        expect(getComputedStyle(holder(alone)).display).toBe('none');
        expect(textOf(alone.element.shadowRoot!)).toContain('Shop');
        expect(refused.element.hasAttribute('mounted')).toBe(false);
        expect(textOf(holder(refused))).toBe('');
    });

    it('should mark a live app as taking its own gestures, and a preview not', async () => {
        // Arrange
        const apps = shopHost();

        // Act
        const live = mountComponent('embeddedApp', { app: 'shop', live: true }, { apps });
        const preview = mountComponent('embeddedApp', { app: 'shop' }, { apps });
        await flush();

        // Assert
        expect(frame(live).getAttribute('data-own-gestures')).toBe('all');
        expect(frame(preview).hasAttribute('data-own-gestures')).toBe(false);
    });

    it('should dispose the app when active turns false, and mount it again when it turns true', async () => {
        // Arrange
        const apps = shopHost();
        const mounted = mountComponent('embeddedApp', { app: 'shop', live: true }, { apps });
        await flush();
        const first = apps.live;

        // Act
        mounted.store.set('$.app.active', false);
        await flush();

        // Assert
        expect(mounted.element.hasAttribute('mounted')).toBe(false);
        expect(holder(mounted).childElementCount).toBe(0);
        expect(first?.store?.get('$.data.name')).toBe('Ada');

        // Act
        mounted.store.set('$.app.active', true);
        await flush();

        // Assert
        expect(mounted.element.hasAttribute('mounted')).toBe(true);
        expect(apps.live).not.toBe(first);
        expect(textOf(holder(mounted))).toContain('Ada');
    });

    it('should raise emit and navigated from the live app, and not run the page node for the app’s own presses', async () => {
        // Arrange
        const apps = shopHost();
        const emits: unknown[] = [];
        const screens: unknown[] = [];
        const mounted = mountComponent('embeddedApp', { app: 'shop', live: true, on: { press: { command: 'set', target: '$.data.pressed', value: true } } }, { apps, data: { pressed: false } });
        await flush();
        mounted.element.addEventListener('emit', (event) => emits.push((event as CustomEvent).detail));
        mounted.element.addEventListener('navigated', (event) => screens.push((event as CustomEvent).detail));
        const [save, more] = ['Save', 'More'].map((label) => findAll(holder(mounted), 'ui-button').find((button) => textOf(button.shadowRoot!).includes(label)));

        // Act
        save!.shadowRoot!.querySelector('button')!.click();
        more!.shadowRoot!.querySelector('button')!.click();
        await flush();

        // Assert
        expect(emits).toEqual([{ name: 'saved', payload: 'yes' }]);
        expect(screens).toEqual([{ screen: 'about' }]);
        expect(textOf(holder(mounted))).toContain('About the shop');
        expect(mounted.store.get('$.data.pressed')).toBe(false);
    });

    it('should keep a preview inert, show the live app’s data as it changes, and raise press and menu with its app and screen', async () => {
        // Arrange
        const apps = shopHost();
        const live = mountComponent('embeddedApp', { app: 'shop', live: true }, { apps });
        await flush();
        const preview = mountComponent('embeddedApp', { app: 'shop', appScreen: 'home', _label: 'Home' }, { apps });
        await flush();
        const presses: unknown[] = [];
        const menus: unknown[] = [];
        preview.element.addEventListener('press', (event) => presses.push((event as CustomEvent).detail));
        preview.element.addEventListener('menu', (event) => menus.push((event as CustomEvent).detail));

        // Act
        apps.live?.store?.set('$.data.name', 'Grace');
        frame(preview).click();
        frame(preview).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        frame(preview).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

        // Assert
        expect(holder(preview).inert).toBe(true);
        expect(holder(live).inert).toBe(false);
        expect(frame(preview).getAttribute('role')).toBe('button');
        expect(frame(preview).getAttribute('aria-label')).toBe('Home');
        expect(textOf(holder(preview))).toContain('Grace');
        expect(textOf(holder(live))).toContain('Grace');
        expect(presses).toEqual([{ app: 'shop', screen: 'home' }, { app: 'shop', screen: 'home' }]);
        expect(menus).toEqual([{ app: 'shop', screen: 'home' }]);
    });
});
