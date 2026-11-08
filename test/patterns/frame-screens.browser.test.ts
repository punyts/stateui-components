import { afterEach, describe, expect, it } from 'vitest';
import { libraryFromCatalog, mountApp } from '@punyts/stateui-app';
import type { AppDocument } from '@punyts/stateui-app';
import type { Catalog, PatternCatalogEntry } from '@punyts/stateui-app/build';
import { applyPattern, validateDocument } from '@punyts/stateui-app/core';
import catalogJson from '../../.test-build/real/components/catalog.json';
import { registerAll } from '../../.test-build/real/components/index.js';

const catalog = catalogJson as unknown as Catalog;
const library = libraryFromCatalog(catalog);

const STUB = 'The stub screen';

let registered = false;
const mounted: { dispose(): void; host: HTMLElement }[] = [];

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const settle = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await frame();
    await new Promise((resolve) => setTimeout(resolve, 0));
};

/** Every element with this tag under the root, through the shadow roots, in document order */
function deep(root: ParentNode, tag: string): HTMLElement[] {
    const found: HTMLElement[] = [];
    for (const child of Array.from(root.children)) {
        if (child.localName === tag) found.push(child as HTMLElement);
        if (child.shadowRoot) found.push(...deep(child.shadowRoot, tag));
        found.push(...deep(child, tag));
    }
    return found;
}

/** The text a person sees under the root, through the shadow roots, leaving out hidden elements */
function visibleText(root: Node): string {
    if (root.nodeType === Node.TEXT_NODE) return root.textContent ?? '';
    if (root instanceof HTMLElement && (root.hidden || getComputedStyle(root).display === 'none')) return '';
    const parts: string[] = [];
    if (root instanceof Element && root.shadowRoot) parts.push(visibleText(root.shadowRoot));
    else for (const child of Array.from(root.childNodes)) parts.push(visibleText(child));
    if (root instanceof Element && root.shadowRoot) {
        // Slotted light children show through the shadow root's slots
        for (const child of Array.from(root.childNodes)) if (child instanceof Element && child.assignedSlot) parts.push(visibleText(child));
    }
    return parts.join(' ');
}

function pattern(name: string): PatternCatalogEntry {
    const found = catalog.patterns.find((entry) => entry.name === name);
    if (found === undefined) throw new Error(`pattern ${name} is not in the catalog`);
    return found;
}

interface Mounted {
    host: HTMLElement;
    store: NonNullable<ReturnType<typeof mountApp>['store']>;
}

/** Copies the frame pattern with its default params as the root of the screen `home`, with a stub in its content, and mounts it in a host of the given width */
async function mountFrame(name: string, width: number): Promise<Mounted> {
    if (!registered) {
        registerAll();
        registered = true;
    }
    const applied = applyPattern(pattern(name));
    expect(applied.errors).toEqual([]);
    const root = applied.tree as unknown as { children: { content: { children: Record<string, unknown> } } };
    root.children.content.children['stub'] = { component: 'text', _text: STUB };
    const document = {
        locale: 'en',
        data: {},
        app: { component: 'app' },
        screens: { home: { root } },
        start: 'home'
    } as unknown as AppDocument;
    expect(validateDocument(document, catalog).errors.filter((error) => error.severity !== 'warning')).toEqual([]);
    const host = globalThis.document.body.appendChild(globalThis.document.createElement('div'));
    host.style.cssText = `inline-size: ${width}px; block-size: 700px`;
    const app = mountApp(host, document, library);
    if (!app.store) throw new Error(`${name} did not mount: ${app.errors.map((error) => `${error.code} ${error.message}`).join('; ')}`);
    mounted.push({ host, dispose: () => app.dispose() });
    await settle();
    return { host, store: app.store };
}

/** The top of the screen's title text and of its menu */
function tops(host: HTMLElement, title: string): { title: number; menu: number } {
    const text = deep(host, 'ui-text').find((element) => visibleText(element).includes(title)) as HTMLElement;
    const menu = deep(host, 'ui-nav')[0] as HTMLElement;
    return { title: text.getBoundingClientRect().top, menu: menu.getBoundingClientRect().top };
}

afterEach(() => {
    for (const entry of mounted.splice(0)) {
        entry.dispose();
        entry.host.remove();
    }
});

const FRAMES = ['marketing', 'side-navigation', 'top-navigation'] as const;
const MENU = '$.screens.home.children.menu';

describe('frame screen patterns', () => {
    it.each(FRAMES)('should show the content and the title in %s', async (name) => {
        // Arrange and Act
        const { host } = await mountFrame(name, 1100);

        // Assert
        expect(visibleText(host)).toContain(STUB);
        expect(visibleText(host)).toContain(pattern(name).params['title']?.default as string);
    });

    it.each(['marketing', 'top-navigation'] as const)('should put the menu beside the title in %s, and below it at phone width', async (name) => {
        // Arrange
        const title = pattern(name).params['title']?.default as string;

        // Act
        const wide = tops((await mountFrame(name, 1100)).host, title);
        const phone = tops((await mountFrame(name, 375)).host, title);

        // Assert
        expect(Math.abs(wide.menu - wide.title)).toBeLessThan(24);
        expect(phone.menu).toBeGreaterThan(phone.title + 16);
    });

    it('should fold the side menu of side-navigation behind a button at phone width', async () => {
        // Arrange and Act
        const wide = await mountFrame('side-navigation', 1100);
        const phone = await mountFrame('side-navigation', 375);

        // Assert
        expect(wide.store.get(`${MENU}.compact`)).not.toBe(true);
        expect(phone.store.get(`${MENU}.compact`)).toBe(true);
        const navOf = (host: HTMLElement): HTMLElement => (deep(host, 'ui-nav')[0] as HTMLElement).shadowRoot?.querySelector('.nav') as HTMLElement;
        expect(getComputedStyle(navOf(wide.host)).display).not.toBe('none');
        expect(getComputedStyle(navOf(phone.host)).display).toBe('none');
        expect(deep(phone.host, 'button').some((button) => button.classList.contains('toggle'))).toBe(true);
    });
});
