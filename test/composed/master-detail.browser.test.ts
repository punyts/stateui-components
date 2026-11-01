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

const CURRENT = '$.runtime.nodes.app.children.list.current';

let registered = false;
const mounted: { dispose(): void; host: HTMLElement; unregister(): void }[] = [];

interface Mounted {
    host: HTMLElement;
    store: NonNullable<ReturnType<typeof mountApp>['store']>;
    document: AppDocument;
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

const people = [
    { id: 'p1', name: 'Ada', description: 'Mathematician' },
    { id: 'p2', name: 'Grace', description: 'Admiral' },
    { id: 'p3', name: 'Linus', description: 'Kernel' }
];

/** Mounts `{ component: "masterDetail" }` linked to `$.data.people` and `$.data.picked` */
async function mount(overrides: Record<string, unknown> = {}, picked = ''): Promise<Mounted> {
    if (!registered) {
        registerAll();
        registered = true;
    }
    const host = globalThis.document.body.appendChild(globalThis.document.createElement('div'));
    host.style.cssText = 'inline-size: 900px; block-size: 400px';
    const locale = registerLocaleStep(overlays);
    const document = {
        locale: 'en',
        data: { people: structuredClone(people), picked },
        app: {
            component: 'masterDetail',
            children: { list: { '<-items': '$.data.people', '<-selected': '$.data.picked' } },
            ...overrides
        }
    } as unknown as AppDocument;
    const app = mountApp(host, document, library);
    if (!app.store) throw new Error(`masterDetail did not mount: ${app.errors.map((error) => `${error.code} ${error.message}`).join('; ')}`);
    mounted.push({ host, dispose: () => app.dispose(), unregister: () => locale.unregister() });
    await settle();
    return { host, store: app.store, document, switchTo: (code) => void locale.switchTo(code) };
}

const rows = (host: HTMLElement): HTMLElement[] => {
    const view = deep(host, 'ui-record-list')[0] as HTMLElement;
    return Array.from(view.shadowRoot?.querySelectorAll<HTMLElement>('.slot') ?? []).filter((slot) => !slot.hidden);
};
const rowText = (slot: HTMLElement): string => deep(slot, 'ui-text').map((text) => text.shadowRoot?.textContent?.trim() ?? '').join(' ');
const rowFor = (host: HTMLElement, name: string): HTMLElement => rows(host).find((slot) => rowText(slot) === name) as HTMLElement;
const values = (host: HTMLElement): string[] => {
    const list = deep(host, 'ui-description-list')[0] as HTMLElement;
    return Array.from(list.shadowRoot?.querySelectorAll('.value') ?? []).map((value) => value.textContent?.trim() ?? '');
};
const inputs = (host: HTMLElement): HTMLInputElement[] =>
    deep(host, 'ui-text-field').map((field) => field.shadowRoot?.querySelector('input') as HTMLInputElement);
const editButton = (host: HTMLElement): HTMLButtonElement =>
    deep(host, 'ui-button')
        .map((button) => button.shadowRoot?.querySelector('button') as HTMLButtonElement)
        .find((button) => button.textContent?.trim() === 'Edit') as HTMLButtonElement;
const type = (input: HTMLInputElement, text: string): void => {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
};

describe('masterDetail in Chromium', () => {
    afterEach(() => {
        for (const entry of mounted.splice(0)) {
            entry.dispose();
            entry.unregister();
            entry.host.remove();
        }
    });

    it('should write the key of a selected row to $.data through the linked selected', async () => {
        // Arrange
        const detail = await mount();

        // Act
        rowFor(detail.host, 'Grace').click();
        await settle();

        // Assert
        expect(detail.store.get<string>('$.data.picked')).toBe('p2');
        expect(detail.store.get<string>(`${CURRENT}.name`)).toBe('Grace');
    });

    it('should show the selected record in the detail and follow another selection', async () => {
        // Arrange
        const detail = await mount();

        // Act
        rowFor(detail.host, 'Ada').click();
        await settle();
        const first = values(detail.host);
        rowFor(detail.host, 'Linus').click();
        await settle();
        const second = values(detail.host);

        // Assert
        expect(first).toEqual(['Ada', 'Mathematician']);
        expect(second).toEqual(['Linus', 'Kernel']);
    });

    it('should show the record picked in the data when it mounts', async () => {
        // Arrange and Act
        const detail = await mount({}, 'p3');

        // Assert
        expect(values(detail.host)).toEqual(['Linus', 'Kernel']);
    });

    it('should show empty values and refuse writes while nothing is selected', async () => {
        // Arrange and Act
        const detail = await mount();
        const written = detail.store.set(`${CURRENT}.name`, 'Ghost');

        // Assert
        expect(values(detail.host)).toEqual(['—', '—']);
        expect(written).toBe(false);
        expect(detail.store.get<unknown>('$.runtime.empty')).toEqual({});
        expect(detail.store.get<unknown>('$.data.people.0.name')).toBe('Ada');
    });

    it('should edit the selected record in place through the Edit form and then show it again', async () => {
        // Arrange
        const detail = await mount();
        rowFor(detail.host, 'Grace').click();
        await settle();

        // Act
        editButton(detail.host).click();
        await settle();
        const [name] = inputs(detail.host) as [HTMLInputElement];
        const shownInForm = name.value;
        type(name, 'Grace Hopper');
        await settle();

        // Assert
        expect(shownInForm).toBe('Grace');
        expect(detail.store.get<string>('$.data.people.1.name')).toBe('Grace Hopper');
        expect(detail.store.get<string>('$.data.people.0.name')).toBe('Ada');
        expect(detail.store.get<boolean>('$.app.children.detail.children.form.hidden')).toBe(false);
        expect(detail.store.get<boolean>('$.app.children.detail.children.view.hidden')).toBe(true);
    });

    it('should leave the data alone when the form is edited with nothing selected', async () => {
        // Arrange
        const detail = await mount();
        editButton(detail.host).click();
        await settle();
        const [name] = inputs(detail.host) as [HTMLInputElement];

        // Act
        type(name, 'Ghost');
        await settle();

        // Assert
        expect(detail.store.get<unknown>('$.data.people')).toEqual(people);
        expect(detail.store.get<unknown>('$.runtime.empty')).toEqual({});
    });

    it('should place the list west of the detail', async () => {
        // Arrange and Act
        const detail = await mount();
        const list = (deep(detail.host, 'ui-list')[0] as HTMLElement).getBoundingClientRect();
        const panel = (deep(detail.host, 'ui-description-list')[0] as HTMLElement).getBoundingClientRect();

        // Assert
        expect(list.right).toBeLessThanOrEqual(panel.left + 1);
    });

    it('should show the German texts after switching to de and keep the data', async () => {
        // Arrange
        const detail = await mount();

        // Act
        detail.switchTo('de');
        await settle();

        // Assert
        const labels = deep(detail.host, 'ui-button').map((button) => button.shadowRoot?.querySelector('button')?.textContent?.trim());
        expect(labels).toContain('Bearbeiten');
        expect(detail.store.get<unknown>('$.data.people')).toEqual(people);
    });

    it('should validate its catalog example and list its exposed paths', () => {
        // Arrange
        const entry = catalog.components.find((component) => component.name === 'masterDetail') as ComposedCatalogEntry;

        // Act
        const result = validateDocument({ locale: 'en', app: entry.example }, catalog);
        const linked = validateDocument(
            {
                locale: 'en',
                data: { people, picked: '' },
                app: { component: 'masterDetail', children: { list: { '<-items': '$.data.people', '<-selected': '$.data.picked' } } }
            },
            catalog
        );

        // Assert
        expect(result.errors).toEqual([]);
        expect(linked.errors).toEqual([]);
        expect(entry.exposes?.map((exposed) => exposed.path)).toEqual([
            'children.list.items',
            'children.list.row',
            'children.list.selected',
            'children.detail.children'
        ]);
    });
});

describe('the masterDetail master pane width in Chromium', () => {
    afterEach(() => {
        for (const entry of mounted.splice(0)) {
            entry.dispose();
            entry.unregister();
            entry.host.remove();
        }
    });

    /** Mounts the catalog example of masterDetail in a container of the given width, with the people in the list */
    async function mountExample(width: number): Promise<HTMLElement> {
        if (!registered) {
            registerAll();
            registered = true;
        }
        const entry = (catalog.components as unknown as ComposedCatalogEntry[]).find((candidate) => candidate.name === 'masterDetail');
        const host = globalThis.document.body.appendChild(globalThis.document.createElement('div'));
        host.style.cssText = `inline-size: ${width}px; block-size: 400px`;
        const locale = registerLocaleStep(overlays);
        const example = structuredClone(entry?.example) as { children?: Record<string, Record<string, unknown>> };
        example.children = { ...example.children, list: { ...example.children?.list, '<-items': '$.data.people' } };
        const app = mountApp(host, { locale: 'en', data: { people: structuredClone(people) }, app: example } as unknown as AppDocument, library);
        mounted.push({ host, dispose: () => app.dispose(), unregister: () => locale.unregister() });
        await settle();
        return host;
    }

    const masterWidth = (host: HTMLElement): number => (deep(host, 'ui-list')[0] as HTMLElement).getBoundingClientRect().width;

    it('should give the master pane a usable width in a 1000 px container', async () => {
        // Act
        const host = await mountExample(1000);

        // Assert
        expect(masterWidth(host)).toBeGreaterThanOrEqual(200);
    });

    it('should leave the detail pane the rest of the width beside the master', async () => {
        // Act
        const host = await mountExample(1000);
        const detail = (deep(host, 'ui-panel').find((panel) => panel.getAttribute('_title') !== null || panel.shadowRoot?.textContent?.includes('Details')) as HTMLElement).getBoundingClientRect();

        // Assert
        expect(detail.left).toBeGreaterThanOrEqual((deep(host, 'ui-list')[0] as HTMLElement).getBoundingClientRect().right);
        expect(detail.width).toBeGreaterThan(masterWidth(host));
    });

    it('should stack the master over the detail at the full width below the breakpoint', async () => {
        // Act
        const host = await mountExample(600);
        const list = (deep(host, 'ui-list')[0] as HTMLElement).getBoundingClientRect();

        // Assert
        expect(list.width).toBeGreaterThanOrEqual(500);
    });
});
