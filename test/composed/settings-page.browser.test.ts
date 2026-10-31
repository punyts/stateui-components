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

const SECTIONS = ['general', 'notifications', 'appearance'] as const;

let registered = false;
const mounted: { dispose(): void; host: HTMLElement; unregister(): void }[] = [];

interface Mounted {
    host: HTMLElement;
    store: NonNullable<ReturnType<typeof mountApp>['store']>;
    switchTo(code: string): void;
}

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const settle = async (): Promise<void> => {
    for (let i = 0; i < 3; i++) await frame();
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

async function mount(app: Record<string, unknown> = {}, data: Record<string, unknown> = {}): Promise<Mounted> {
    if (!registered) {
        registerAll();
        registered = true;
    }
    const host = globalThis.document.body.appendChild(globalThis.document.createElement('div'));
    host.style.cssText = 'inline-size: 900px';
    const locale = registerLocaleStep(overlays);
    const document = { locale: 'en', data, app: { component: 'settingsPage', ...app } } as unknown as AppDocument;
    const result = mountApp(host, document, library);
    if (!result.store) throw new Error(`settingsPage did not mount: ${result.errors.map((error) => `${error.code} ${error.message}`).join('; ')}`);
    mounted.push({ host, dispose: () => result.dispose(), unregister: () => locale.unregister() });
    await settle();
    return { host, store: result.store, switchTo: (code) => void locale.switchTo(code) };
}

const hiddenOf = (page: Mounted, section: string): boolean =>
    page.store.get<boolean | undefined>(`$.app.children.${section}.hidden`) === true;
const visibleSections = (page: Mounted): string[] => SECTIONS.filter((section) => !hiddenOf(page, section));
const navButton = (page: Mounted, label: string): HTMLButtonElement =>
    deep(page.host, 'ui-menu-item')
        .map((item) => item.shadowRoot?.querySelector('button') as HTMLButtonElement)
        .find((button) => button.textContent?.includes(label) === true) as HTMLButtonElement;
const panelOf = (page: Mounted, title: string): HTMLElement =>
    deep(page.host, 'ui-panel').find((panel) => panel.shadowRoot?.querySelector('.title')?.textContent?.trim() === title) as HTMLElement;
const isShown = (element: HTMLElement): boolean => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
const record = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};
const saveButton = (panel: HTMLElement): HTMLButtonElement =>
    deep(panel.shadowRoot as ShadowRoot, 'ui-button')
        .map((button) => button.shadowRoot?.querySelector('button') as HTMLButtonElement)
        .find((button) => button.textContent?.trim() === 'Save') as HTMLButtonElement;
const type = (input: HTMLInputElement, text: string): void => {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
};

describe('settingsPage in Chromium', () => {
    afterEach(() => {
        for (const entry of mounted.splice(0)) {
            entry.dispose();
            entry.unregister();
            entry.host.remove();
        }
    });

    it('should show only the general section at first', async () => {
        // Arrange and Act
        const page = await mount();

        // Assert
        expect(visibleSections(page)).toEqual(['general']);
        expect(isShown(panelOf(page, 'General'))).toBe(true);
        expect(isShown(panelOf(page, 'Notifications'))).toBe(false);
        expect(isShown(panelOf(page, 'Appearance'))).toBe(false);
    });

    it('should show exactly one section for each nav item', async () => {
        // Arrange
        const page = await mount();
        const titles = { general: 'General', notifications: 'Notifications', appearance: 'Appearance' } as const;

        // Act and Assert
        for (const section of ['notifications', 'appearance', 'general', 'appearance'] as const) {
            navButton(page, titles[section]).click();
            await settle();
            expect(visibleSections(page)).toEqual([section]);
            for (const other of SECTIONS) expect(isShown(panelOf(page, titles[other]))).toBe(other === section);
        }
    });

    it('should block a section form with an empty required field and raise invalid', async () => {
        // Arrange
        const page = await mount();
        const form = deep(panelOf(page, 'General').shadowRoot as ShadowRoot, 'ui-form')[0] as HTMLElement;
        const invalid = record(form, 'invalid');
        const submitted = record(form, 'submitted');

        // Act
        saveButton(panelOf(page, 'General')).click();
        await settle();

        // Assert
        expect(invalid).toContainEqual({ keys: ['name'] });
        expect(submitted).toEqual([]);
    });

    it('should raise submitted with the values of a valid section form', async () => {
        // Arrange
        const page = await mount();
        navButton(page, 'Notifications').click();
        await settle();
        const panel = panelOf(page, 'Notifications');
        const form = deep(panel.shadowRoot as ShadowRoot, 'ui-form')[0] as HTMLElement;
        const submitted = record(form, 'submitted');
        const digest = deep(panel.shadowRoot as ShadowRoot, 'ui-text-field')[0]?.shadowRoot?.querySelector('input') as HTMLInputElement;

        // Act
        type(digest, '08:00');
        await settle();
        saveButton(panel).click();
        await settle();

        // Assert
        expect(submitted).toEqual([{ values: { email: false, digest: '08:00' } }]);
    });

    it('should show the German texts after switching to de', async () => {
        // Arrange
        const page = await mount();

        // Act
        page.switchTo('de');
        await settle();

        // Assert
        expect(navButton(page, 'Benachrichtigungen')).toBeDefined();
        expect(panelOf(page, 'Allgemein')).toBeDefined();
    });

    it('should validate its catalog example and list its exposed paths', () => {
        // Arrange
        const entry = catalog.components.find((component) => component.name === 'settingsPage') as ComposedCatalogEntry;

        // Act
        const result = validateDocument({ locale: 'en', app: entry.example }, catalog);

        // Assert
        expect(result.errors).toEqual([]);
        expect(entry.exposes?.map((exposed) => exposed.path)).toEqual(['_title', 'nav.children', 'children']);
    });
});
