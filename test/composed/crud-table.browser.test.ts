import { userEvent } from 'vitest/browser';
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
const mounted: { dispose(): void; host: HTMLElement; unregister(): void }[] = [];

interface Mounted {
    host: HTMLElement;
    store: NonNullable<ReturnType<typeof mountApp>['store']>;
    emitted: { name: string; payload: unknown }[];
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
    { id: 'p1', name: 'Ada' },
    { id: 'p2', name: 'Grace' }
];

const fields = { name: { component: 'textField', _label: 'Name', required: true, '<-value': '$.data.draft.name' } };

/** One crudTable, or `count` of them side by side, each over its own array in `$.data` */
async function mount(count = 1): Promise<Mounted> {
    if (!registered) {
        registerAll();
        registered = true;
    }
    const host = globalThis.document.body.appendChild(globalThis.document.createElement('div'));
    host.style.cssText = 'inline-size: 900px; block-size: 400px';
    const locale = registerLocaleStep(overlays);
    const emitted: { name: string; payload: unknown }[] = [];
    const tables = Array.from({ length: count }, (_, index): [string, unknown] => [
        `table${index}`,
        {
            component: 'crudTable',
            children: { table: { '<-items': `$.data.people${index}` }, form: { body: { children: fields } } }
        }
    ]);
    const document = {
        locale: 'en',
        data: Object.fromEntries([['draft', { name: '' }], ...tables.map((_, index) => [`people${index}`, structuredClone(people)])]),
        app: count === 1 ? tables[0]?.[1] : { component: 'panel', children: Object.fromEntries(tables) }
    } as unknown as AppDocument;
    const app = mountApp(host, document, library, { onEmit: (name: string, payload: unknown) => emitted.push({ name, payload }) });
    if (!app.store) throw new Error(`crudTable did not mount: ${app.errors.map((error) => `${error.code} ${error.message}`).join('; ')}`);
    mounted.push({ host, dispose: () => app.dispose(), unregister: () => locale.unregister() });
    await settle();
    return { host, store: app.store, emitted, switchTo: (code) => void locale.switchTo(code) };
}

const modals = (host: HTMLElement): HTMLElement[] => deep(host, 'ui-modal');
const isOpen = (modal: HTMLElement | undefined): boolean => (modal?.shadowRoot?.querySelector('dialog') as HTMLDialogElement).open;
const labelOf = (button: HTMLElement): string => button.shadowRoot?.querySelector('.label')?.textContent?.trim() ?? '';
const press = (button: HTMLElement | undefined): void => (button?.shadowRoot?.querySelector('button') as HTMLButtonElement).click();
const labelled = (root: ParentNode, label: string): HTMLElement[] => deep(root, 'ui-button').filter((button) => labelOf(button) === label);
const inModal = (modal: HTMLElement | undefined, label: string): HTMLElement | undefined => labelled(modal?.shadowRoot as ShadowRoot, label)[0];
const rows = (host: HTMLElement): HTMLElement[] => {
    const view = deep(host, 'ui-record-list')[0] as HTMLElement;
    return Array.from(view.shadowRoot?.querySelectorAll<HTMLElement>('.slot') ?? []).filter((slot) => !slot.hidden);
};
const searchInput = (host: HTMLElement): HTMLInputElement => deep(host, 'ui-search-box')[0]?.shadowRoot?.querySelector('input') as HTMLInputElement;
const addButtons = (host: HTMLElement): HTMLElement[] => labelled(host, 'Add');

describe('crudTable in Chromium', () => {
    afterEach(() => {
        for (const entry of mounted.splice(0)) {
            entry.dispose();
            entry.unregister();
            entry.host.remove();
        }
    });

    it('should show the records and keep both dialogs closed', async () => {
        // Arrange
        const crud = await mount();

        // Assert
        const names = rows(crud.host).map((row) => deep(row, 'ui-table-row')[0]?.shadowRoot?.querySelector('.text')?.textContent?.trim());
        expect(names).toEqual(['Ada', 'Grace']);
        expect(modals(crud.host).map(isOpen)).toEqual([false, false]);
    });

    it('should open the form dialog when Add is pressed', async () => {
        // Arrange
        const crud = await mount();
        const [form, confirm] = modals(crud.host) as [HTMLElement, HTMLElement];

        // Act
        press(addButtons(crud.host)[0]);
        await settle();

        // Assert
        expect([isOpen(form), isOpen(confirm)]).toEqual([true, false]);
        expect(crud.emitted).toEqual([]);
    });

    it('should emit edit with the row key and open the form dialog when a row is activated', async () => {
        // Arrange
        const crud = await mount();
        const [form] = modals(crud.host) as [HTMLElement];

        // Act
        rows(crud.host)[1]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
        await settle();

        // Assert
        expect(crud.emitted).toEqual([{ name: 'crudTable.edit', payload: 'p2' }]);
        expect(isOpen(form)).toBe(true);
    });

    it('should emit save with the values and close the form dialog when it is submitted', async () => {
        // Arrange
        const crud = await mount();
        const [form] = modals(crud.host) as [HTMLElement];
        press(addButtons(crud.host)[0]);
        await settle();
        const input = deep(form.shadowRoot as ShadowRoot, 'ui-text-field')[0]?.shadowRoot?.querySelector('input') as HTMLInputElement;
        await userEvent.type(input, 'Linus');

        // Act
        press(inModal(form, 'Save'));
        await settle();

        // Assert
        expect(crud.emitted).toEqual([{ name: 'crudTable.save', payload: { values: { name: 'Linus' } } }]);
        expect(isOpen(form)).toBe(false);
    });

    it('should keep the form dialog open and emit nothing when Save finds an empty required field', async () => {
        // Arrange
        const crud = await mount();
        const [form] = modals(crud.host) as [HTMLElement];
        press(addButtons(crud.host)[0]);
        await settle();

        // Act
        press(inModal(form, 'Save'));
        await settle();

        // Assert
        expect(crud.emitted).toEqual([]);
        expect(isOpen(form)).toBe(true);
    });

    it('should close the form dialog on Cancel without emitting', async () => {
        // Arrange
        const crud = await mount();
        const [form] = modals(crud.host) as [HTMLElement];
        press(addButtons(crud.host)[0]);
        await settle();

        // Act
        press(inModal(form, 'Cancel'));
        await settle();

        // Assert
        expect(isOpen(form)).toBe(false);
        expect(crud.emitted).toEqual([]);
    });

    it('should select the row and open the confirm dialog from a delete button, and emit delete on confirm', async () => {
        // Arrange
        const crud = await mount();
        const [form, confirm] = modals(crud.host) as [HTMLElement, HTMLElement];

        // Act
        press(labelled(rows(crud.host)[1] as HTMLElement, 'Delete')[0]);
        await settle();

        // Assert
        expect([isOpen(form), isOpen(confirm)]).toEqual([false, true]);
        expect(crud.store.get('$.app.children.table.selected')).toBe('p2');
        expect(crud.emitted).toEqual([]);

        // Act
        press(inModal(confirm, 'Delete'));
        await settle();

        // Assert
        expect(isOpen(confirm)).toBe(false);
        expect(crud.emitted.map((entry) => entry.name)).toEqual(['crudTable.delete']);
    });

    it('should close the confirm dialog on Cancel without emitting', async () => {
        // Arrange
        const crud = await mount();
        const [, confirm] = modals(crud.host) as [HTMLElement, HTMLElement];
        press(labelled(rows(crud.host)[0] as HTMLElement, 'Delete')[0]);
        await settle();

        // Act
        press(inModal(confirm, 'Cancel'));
        await settle();

        // Assert
        expect(isOpen(confirm)).toBe(false);
        expect(crud.emitted).toEqual([]);
    });

    it('should emit search with the typed value when Enter is pressed in the search box', async () => {
        // Arrange
        const crud = await mount();

        // Act
        await userEvent.type(searchInput(crud.host), 'gra{Enter}');
        await settle();

        // Assert
        expect(crud.emitted.filter((entry) => entry.name === 'crudTable.search')).toEqual([{ name: 'crudTable.search', payload: 'gra' }]);
    });

    it('should keep the dialogs of two tables separate', async () => {
        // Arrange
        const crud = await mount(2);
        const all = modals(crud.host);
        expect(all).toHaveLength(4);
        const [form0, confirm0, form1, confirm1] = all as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
        const adds = addButtons(crud.host);
        const states = (): boolean[] => [form0, confirm0, form1, confirm1].map(isOpen);

        // Act
        press(adds[1]);
        await settle();

        // Assert
        expect(states()).toEqual([false, false, true, false]);

        // Act
        press(inModal(form1, 'Cancel'));
        press(adds[0]);
        await settle();

        // Assert
        expect(states()).toEqual([true, false, false, false]);

        // Act
        press(inModal(form0, 'Cancel'));
        const views = deep(crud.host, 'ui-record-list');
        press(labelled(views[1]?.shadowRoot as ShadowRoot, 'Delete')[0]);
        await settle();

        // Assert
        expect(states()).toEqual([false, false, false, true]);
        expect(crud.store.get('$.app.children.table1.children.table.selected')).toBe('p1');
        expect(crud.store.get('$.app.children.table0.children.table.selected')).toBeUndefined();

        // Act
        press(inModal(confirm1, 'Delete'));
        await settle();

        // Assert
        expect(crud.emitted.map((entry) => entry.name)).toEqual(['crudTable.delete']);
    });

    it('should show the German texts after switching to de', async () => {
        // Arrange
        const crud = await mount();

        // Act
        crud.switchTo('de');
        await settle();

        // Assert
        const [form, confirm] = modals(crud.host) as [HTMLElement, HTMLElement];
        expect(deep(crud.host, 'ui-button').some((button) => labelOf(button) === 'Hinzufügen')).toBe(true);
        expect(form.shadowRoot?.textContent).toContain('Datensatz bearbeiten');
        expect(confirm.shadowRoot?.textContent).toContain('Datensatz löschen?');
        expect(inModal(form, 'Speichern')).toBeDefined();
    });

    it('should validate its catalog example and list its exposed paths', () => {
        // Arrange
        const entry = catalog.components.find((component) => component.name === 'crudTable') as ComposedCatalogEntry;

        // Act
        const result = validateDocument({ locale: 'en', app: entry.example }, catalog);

        // Assert
        expect(result.errors).toEqual([]);
        expect(entry.exposes?.map((exposed) => exposed.path)).toEqual([
            'children.table.items',
            'children.table.columns',
            'children.form.body.children',
            'children.form._title',
            'children.confirm._title'
        ]);
    });
});
