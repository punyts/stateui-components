import { afterEach, describe, expect, it } from 'vitest';
import { libraryFromCatalog, mountApp } from '@punyts/stateui-app';
import type { AppDocument } from '@punyts/stateui-app';
import type { Catalog, PatternCatalogEntry } from '@punyts/stateui-app/build';
import { applyPattern, validateDocument } from '@punyts/stateui-app/core';
import catalogJson from '../../.test-build/real/components/catalog.json';
import { registerAll } from '../../.test-build/real/components/index.js';

const catalog = catalogJson as unknown as Catalog;
const library = libraryFromCatalog(catalog);

const SALES = Object.freeze([
    Object.freeze({ id: 'jan', month: 'Jan', amount: 120 }),
    Object.freeze({ id: 'feb', month: 'Feb', amount: 150 }),
    Object.freeze({ id: 'mar', month: 'Mar', amount: 90 })
]);
const ITEMS = Object.freeze([
    Object.freeze({ id: 'a', title: 'Alder', description: 'A tree by the river' }),
    Object.freeze({ id: 'b', title: 'Birch', description: 'A tree with white bark' })
]);

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
        data: { sales: structuredClone(SALES), items: structuredClone(ITEMS) },
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

describe('first screen patterns', () => {
    it('should show three stat tiles and a chart in dashboard', async () => {
        // Arrange and Act
        const { host } = await mountPattern('dashboard');

        // Assert
        expect(deep(host, 'ui-stat')).toHaveLength(3);
        expect(deep(host, 'ui-chart')).toHaveLength(1);
        expect(visibleText(host)).toContain('Revenue');
    });

    it('should show a list and the details of the picked record in master-detail', async () => {
        // Arrange
        const { host, store } = await mountPattern('master-detail');

        // Act
        store.set('$.app.children.list.selected', 'b');
        await settle();

        // Assert
        expect(deep(host, 'ui-list')).toHaveLength(1);
        expect(deep(host, 'ui-description-list')).toHaveLength(1);
        expect(visibleText(deep(host, 'ui-list')[0] as HTMLElement)).toContain('Alder');
        expect(visibleText(deep(host, 'ui-description-list')[0] as HTMLElement)).toContain('A tree with white bark');
    });

    it('should show the general form with a save button in settings', async () => {
        // Arrange and Act
        const { host } = await mountPattern('settings');

        // Assert
        const text = visibleText(host);
        expect(deep(host, 'ui-form').length).toBeGreaterThanOrEqual(1);
        expect(text).toContain('Display name');
        expect(text).toContain('Save');
        expect(text).not.toContain('Digest time');
    });
});
