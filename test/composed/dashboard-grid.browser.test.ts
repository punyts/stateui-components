import { afterEach, describe, expect, it } from 'vitest';
import { libraryFromCatalog, mountApp, registerLocaleStep } from '@punyts/stateui-app';
import type { AppDocument } from '@punyts/stateui-app';
import type { Catalog, ComposedCatalogEntry } from '@punyts/stateui-app/build';
import { validateDocument } from '@punyts/stateui-app/core';
import catalogJson from '../../.test-build/real/components/catalog.json';
import { registerAll } from '../../.test-build/real/components/index.js';
import { overlaysFromFiles } from '../harness/createMountComponent.js';
import type { ComponentBuild } from '../harness/createMountComponent.js';

const catalog = catalogJson as unknown as Catalog;
const library = libraryFromCatalog(catalog);
const overlays = overlaysFromFiles(
    import.meta.glob<ComponentBuild['localeFiles'][string]>('../../.test-build/real/components/*.locale.*.json', { eager: true, import: 'default' })
);

let registered = false;
const hosts: { dispose(): void; host: HTMLElement; unregister(): void }[] = [];

interface Mounted {
    host: HTMLElement;
    grid: HTMLElement;
    switchTo(code: string): void;
}

function findByTag(root: ParentNode, tag: string): HTMLElement | undefined {
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        if (candidate.localName === tag) return candidate as HTMLElement;
        const inner = candidate.shadowRoot ? findByTag(candidate.shadowRoot, tag) : undefined;
        if (inner) return inner;
    }
    return undefined;
}

/** Mounts `{ component: "dashboardGrid" }` in a box of the given width, because the grid collapses by the width of its container */
function mount(width: number, node: Record<string, unknown> = {}): Mounted {
    if (!registered) {
        registerAll();
        registered = true;
    }
    const host = globalThis.document.body.appendChild(globalThis.document.createElement('div'));
    host.style.width = `${width}px`;
    const locale = registerLocaleStep(overlays);
    const app = mountApp(host, { locale: 'en', app: { component: 'dashboardGrid', ...node } } as unknown as AppDocument, library);
    if (!app.store) throw new Error(`dashboardGrid did not mount: ${app.errors.map((error) => error.message).join('; ')}`);
    hosts.push({ host, dispose: () => app.dispose(), unregister: () => locale.unregister() });
    const grid = findByTag(host, 'ui-page');
    if (!grid) throw new Error('no ui-page was rendered');
    return { host, grid, switchTo: (code) => void locale.switchTo(code) };
}

const body = (grid: HTMLElement): HTMLElement => grid.shadowRoot?.querySelector('.body') as HTMLElement;
const cards = (grid: HTMLElement): HTMLElement[] => Array.from(body(grid).querySelectorAll('sui-node')).flatMap((node) => {
    const card = node.shadowRoot ? findByTag(node.shadowRoot, 'ui-card') : (node.querySelector('ui-card') as HTMLElement | null);
    return card ? [card] : [];
});
const columns = (grid: HTMLElement): number => new Set(cards(grid).map((card) => Math.round(card.getBoundingClientRect().left))).size;
const rows = (grid: HTMLElement): number => new Set(cards(grid).map((card) => Math.round(card.getBoundingClientRect().top))).size;

describe('dashboardGrid in Chromium', () => {
    afterEach(() => {
        for (const entry of hosts.splice(0)) {
            entry.dispose();
            entry.unregister();
            entry.host.remove();
        }
    });

    it('should keep three columns above 768 px', () => {
        // Arrange
        const mounted = mount(1000);

        // Assert
        expect(cards(mounted.grid)).toHaveLength(3);
        expect(columns(mounted.grid)).toBe(3);
        expect(rows(mounted.grid)).toBe(1);
    });

    it('should collapse to one column below 768 px', () => {
        // Arrange
        const mounted = mount(600);

        // Assert
        expect(cards(mounted.grid)).toHaveLength(3);
        expect(columns(mounted.grid)).toBe(1);
        expect(rows(mounted.grid)).toBe(3);
    });

    it('should show a stat in each card', () => {
        // Arrange
        const mounted = mount(1000);

        // Assert
        for (const card of cards(mounted.grid)) expect(findByTag(card.shadowRoot as ShadowRoot, 'ui-stat')).toBeDefined();
    });

    it('should apply an override of the exposed layout.cols', () => {
        // Arrange
        const mounted = mount(1000, { layout: { cols: 2 } });

        // Assert
        expect(columns(mounted.grid)).toBe(2);
        expect(rows(mounted.grid)).toBe(2);
    });

    it('should show the German titles after switching to de', () => {
        // Arrange
        const mounted = mount(1000);

        // Act
        mounted.switchTo('de');

        // Assert
        const titles = cards(mounted.grid).map((card) => card.shadowRoot?.querySelector('.title')?.textContent?.trim());
        expect(titles).toEqual(['Umsatz', 'Bestellungen', 'Kunden']);
    });

    it('should validate its catalog example and list its exposed paths', () => {
        // Arrange
        const entry = catalog.components.find((component) => component.name === 'dashboardGrid') as ComposedCatalogEntry;

        // Act
        const result = validateDocument({ locale: 'en', app: entry.example }, catalog);

        // Assert
        expect(result.errors).toEqual([]);
        expect(entry.exposes?.map((exposed) => exposed.path)).toEqual(['children', 'layout.cols']);
    });
});
