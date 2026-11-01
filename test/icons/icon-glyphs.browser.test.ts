import { libraryFromCatalog, mountApp, registerLocaleStep } from '@punyts/stateui-app';
import type { AppDocument } from '@punyts/stateui-app';
import type { Catalog, ComposedCatalogEntry, RootCatalogEntry } from '@punyts/stateui-app/build';
import { afterEach, describe, expect, it } from 'vitest';
import catalog from '../../.test-build/real/components/catalog.json';
import { registerAll } from '../../.test-build/real/components/index.js';
import { mountComponent } from '../harness/mountComponent.js';

const roots = (catalog.components as unknown as RootCatalogEntry[]).filter((entry) => entry.tier === 'root');
const composed = (catalog.components as unknown as ComposedCatalogEntry[]).filter((entry) => entry.tier === 'composed');
const library = libraryFromCatalog(catalog as unknown as Catalog);

/** Every `ui-icon` under the root, looking through open shadow roots */
function iconsIn(root: ParentNode): Element[] {
    const found: Element[] = [];
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        if (candidate.localName === 'ui-icon') found.push(candidate);
        if (candidate.shadowRoot) found.push(...iconsIn(candidate.shadowRoot));
    }
    return found;
}

/** The tag of the component whose shadow root holds the icon, for the failure message */
function ownerOf(icon: Element): string {
    const root = icon.getRootNode();
    return root instanceof ShadowRoot ? root.host.localName : 'document';
}

/** The icons whose glyph draws nothing: no `<svg>` in the `.glyph` span */
function blankIcons(root: ParentNode): string[] {
    return iconsIn(root)
        .filter((icon) => icon.shadowRoot?.querySelector('.glyph svg') === null)
        .map((icon) => `<ui-icon name="${icon.getAttribute('name') ?? ''}" state="${icon.getAttribute('state') ?? ''}"> in <${ownerOf(icon)}>`);
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('every icon of every catalog component draws a glyph in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it.each(roots.map((entry) => [entry.name, entry] as const))('should draw every ui-icon of the %s example', async (_name, entry) => {
        // Arrange
        const mounted = mountComponent(entry.name, entry.example as Record<string, unknown>);

        // Act
        await settle();

        // Assert
        expect(blankIcons(mounted.element.shadowRoot ?? mounted.element)).toEqual([]);
    });

    it.each(composed.map((entry) => [entry.name, entry] as const))('should draw every ui-icon of the %s example', async (_name, entry) => {
        // Arrange
        const host = globalThis.document.body.appendChild(globalThis.document.createElement('div'));
        const locale = registerLocaleStep({});
        const app = mountApp(host, { locale: 'en', app: entry.example } as unknown as AppDocument, library);

        // Act
        await settle();
        const blank = blankIcons(host);
        app.dispose();
        locale.unregister();
        host.remove();

        // Assert
        expect(blank).toEqual([]);
    });
});

const crumbs = { a: { _label: 'Home' }, b: { _label: 'Shop' }, c: { _label: 'Orders' } };
const options = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }];

/** Components whose catalog example draws no icon: the icons appear only with content, so these states show them */
const populated: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['panel', { collapsible: true, _title: 'Details' }],
    ['breadcrumb', { items: crumbs }],
    ['multiSelectField', { _label: 'Tags', options, value: ['a', 'b'] }],
    ['numberField', { _label: 'Amount', value: 1 }],
    ['calendar', {}],
    ['dateRangeField', { _label: 'Period' }],
    ['pagination', { total: 100, pageSize: 10 }],
    ['searchBox', { value: 'abc' }]
];

describe('icons shown only with content draw a glyph in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it.each(populated)('should draw at least one icon in %s and no blank one', async (name, properties) => {
        // Arrange
        const mounted = mountComponent(name, properties);

        // Act
        await settle();
        const root = mounted.element.shadowRoot ?? mounted.element;

        // Assert
        expect(iconsIn(root).length).toBeGreaterThan(0);
        expect(blankIcons(root)).toEqual([]);
    });
});
