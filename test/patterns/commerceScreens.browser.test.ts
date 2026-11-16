import { afterEach, describe, expect, it } from 'vitest';
import { libraryFromCatalog, mountApp } from '@punyts/stateui-app';
import type { AppDocument } from '@punyts/stateui-app';
import type { Catalog, PatternCatalogEntry } from '@punyts/stateui-app/build';
import { applyPattern, validateDocument } from '@punyts/stateui-app/core';
import catalogJson from '../../.test-build/real/components/catalog.json';
import { registerAll } from '../../.test-build/real/components/index.js';

const catalog = catalogJson as unknown as Catalog;
const library = libraryFromCatalog(catalog);

/** A one-pixel PNG, so the tests load no network picture */
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const PRODUCTS = Object.freeze([
    Object.freeze({ id: 'p1', title: 'Fern', price: 12, description: 'A green fern', image: PIXEL }),
    Object.freeze({ id: 'p2', title: 'Cactus', price: 8, description: 'A small cactus', image: PIXEL }),
    Object.freeze({ id: 'p3', title: 'Orchid', price: 30, description: 'A white orchid', image: '' })
]);
const BAG = Object.freeze([Object.freeze({ id: 'p2', title: 'Cactus' })]);

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

/** Copies the pattern with its default params and mounts it as the root of an app with the fixture datasets */
async function mountPattern(name: string): Promise<Mounted> {
    if (!registered) {
        registerAll();
        registered = true;
    }
    const applied = applyPattern(pattern(name));
    expect(applied.errors).toEqual([]);
    const document = {
        locale: 'en',
        data: { products: structuredClone(PRODUCTS), bag: structuredClone(BAG), signIn: { email: '' } },
        app: applied.tree
    } as unknown as AppDocument;
    expect(validateDocument(document, catalog).errors.filter((error) => error.severity !== 'warning')).toEqual([]);
    const host = globalThis.document.body.appendChild(globalThis.document.createElement('div'));
    host.style.cssText = 'inline-size: 900px; block-size: 700px';
    const app = mountApp(host, document, library);
    if (!app.store) throw new Error(`${name} did not mount: ${app.errors.map((error) => `${error.code} ${error.message}`).join('; ')}`);
    mounted.push({ host, dispose: () => app.dispose() });
    await settle();
    return { host, store: app.store };
}

afterEach(() => {
    for (const entry of mounted.splice(0)) {
        entry.dispose();
        entry.host.remove();
    }
});

describe('commerce screen patterns', () => {
    it('should show the three product titles and a picture on each card in product-grid', async () => {
        // Arrange and Act
        const { host } = await mountPattern('product-grid');

        // Assert
        const text = visibleText(host);
        for (const product of PRODUCTS) expect(text).toContain(product.title);
        expect(deep(host, 'ui-image').filter((image) => image.checkVisibility())).toHaveLength(3);
    });

    it('should show the first product title in product-detail', async () => {
        // Arrange and Act
        const { host } = await mountPattern('product-detail');

        // Assert
        const text = visibleText(host);
        expect(text).toContain('Fern');
        expect(text).not.toContain('Cactus');
        expect(deep(host, 'ui-image').filter((image) => image.checkVisibility())).toHaveLength(1);
    });

    it('should show bag-and-checkout at its first step', async () => {
        // Arrange and Act
        const { host, store } = await mountPattern('bag-and-checkout');

        // Assert
        expect(deep(host, 'ui-stepper')).toHaveLength(1);
        expect(store.get('$.app.children.steps.active')).toBe('bag');
        const text = visibleText(host);
        expect(text).toContain('Cactus');
        expect(text).toContain('Check out');
        expect(text).not.toContain('Name on card');
    });

    it('should have two fields and a submit button in sign-in-form', async () => {
        // Arrange and Act
        const { host } = await mountPattern('sign-in-form');

        // Assert
        expect(deep(host, 'ui-text-field')).toHaveLength(2);
        const buttons = deep(host, 'ui-button');
        expect(buttons).toHaveLength(1);
        expect(visibleText(buttons[0] as HTMLElement)).toContain('Sign in');
    });
});
