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

/** Copies the shell with its default params and mounts it, with one stub screen, in a host of the given width */
async function mountShell(name: string, width: number): Promise<Mounted> {
    if (!registered) {
        registerAll();
        registered = true;
    }
    const applied = applyPattern(pattern(name));
    expect(applied.errors).toEqual([]);
    const document = {
        locale: 'en',
        data: {},
        app: applied.tree,
        screens: { home: { root: { component: 'text', _text: STUB } } },
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

/** The top of the shell's title text and of its menu */
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

const SHELLS = ['marketing', 'side-navigation', 'top-navigation'] as const;

describe('shell patterns', () => {
    it.each(SHELLS)('should show the stub screen in %s and its title in the header', async (name) => {
        // Arrange and Act
        const { host } = await mountShell(name, 1100);

        // Assert
        expect(visibleText(host)).toContain(STUB);
        const header = deep(host, 'header')[0] as HTMLElement;
        expect(visibleText(header)).toContain(pattern(name).params['title']?.default as string);
    });

    it.each(['marketing', 'top-navigation'] as const)('should put the menu beside the title in %s, and below it at phone width', async (name) => {
        // Arrange
        const title = pattern(name).params['title']?.default as string;

        // Act
        const wide = tops((await mountShell(name, 1100)).host, title);
        const phone = tops((await mountShell(name, 375)).host, title);

        // Assert
        expect(Math.abs(wide.menu - wide.title)).toBeLessThan(24);
        expect(phone.menu).toBeGreaterThan(phone.title + 16);
    });

    it('should fold the side menu of side-navigation behind a button at phone width', async () => {
        // Arrange and Act
        const wide = await mountShell('side-navigation', 1100);
        const phone = await mountShell('side-navigation', 375);

        // Assert
        expect(wide.store.get('$.app.compact')).toBe(false);
        expect(phone.store.get('$.app.compact')).toBe(true);
        const navOf = (host: HTMLElement): HTMLElement => (deep(host, 'ui-page')[0] as HTMLElement).shadowRoot?.querySelector('.nav') as HTMLElement;
        expect(getComputedStyle(navOf(wide.host)).display).not.toBe('none');
        expect(getComputedStyle(navOf(phone.host)).display).toBe('none');
        expect(deep(phone.host, 'button').some((button) => button.classList.contains('toggle'))).toBe(true);
    });
});
