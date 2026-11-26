import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { libraryFromCatalog, mountApp, registerLocaleStep } from '@punyts/stateui-app';
import type { AppDocument, RaisedReport } from '@punyts/stateui-app';
import type { Catalog, ComposedCatalogEntry } from '@punyts/stateui-app/build';
import { validateDocument } from '@punyts/stateui-app/core';
import catalogJson from '../../.test-build/real/components/catalog.json';
import { registerAll } from '../../.test-build/real/components/index.js';
import { overlaysFromFiles } from '../harness/createMountComponent.js';
import { realLocaleFiles } from '../harness/realLocales.js';

const catalog = catalogJson as unknown as Catalog;
const library = libraryFromCatalog(catalog);
const overlays = overlaysFromFiles(realLocaleFiles);

let registered = false;
const mounted: { dispose(): void; host: HTMLElement; unregister(): void }[] = [];

interface Mounted {
    host: HTMLElement;
    store: NonNullable<ReturnType<typeof mountApp>['store']>;
    /** What the host is told: a table's activate, a form's submitted, a delete press and a search, by the ids the app gives them */
    told: RaisedReport[];
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

/** The event of each id the app gives (`table0`, `form0`, `delete0`, `search0`) that the host listens to */
const TOLD: Readonly<Record<string, string>> = { table: 'activate', form: 'submitted', delete: 'press', search: 'search' };

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
    const told: RaisedReport[] = [];
    const tables = Array.from({ length: count }, (_, index): [string, unknown] => [
        `table${index}`,
        {
            component: 'crudTable',
            actions: { children: { search: { '@id': `search${index}` } } },
            children: {
                table: { '@id': `table${index}`, '<-items': `$.data.people${index}` },
                form: { body: { '@id': `form${index}`, children: fields } },
                confirm: { footer: { children: { confirm: { '@id': `delete${index}` } } } }
            }
        }
    ]);
    const document = {
        locale: 'en',
        data: Object.fromEntries([['draft', { name: '' }], ...tables.map((_, index) => [`people${index}`, structuredClone(people)])]),
        app: count === 1 ? tables[0]?.[1] : { component: 'panel', children: Object.fromEntries(tables) }
    } as unknown as AppDocument;
    const app = mountApp(host, document, library, {
        onRaised: (report: RaisedReport) => void (TOLD[report.id.replace(/[0-9]+$/, '')] === report.event ? told.push(report) : undefined)
    });
    if (!app.store) throw new Error(`crudTable did not mount: ${app.errors.map((error) => `${error.code} ${error.message}`).join('; ')}`);
    mounted.push({ host, dispose: () => app.dispose(), unregister: () => locale.unregister() });
    await settle();
    return { host, store: app.store, told, switchTo: (code) => void locale.switchTo(code) };
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
        expect(crud.told).toEqual([]);
    });

    it('should tell the host of an activate with the row key and open the form dialog when a row is activated', async () => {
        // Arrange
        const crud = await mount();
        const [form] = modals(crud.host) as [HTMLElement];

        // Act
        rows(crud.host)[1]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
        await settle();

        // Assert
        expect(crud.told).toEqual([{ id: 'table0', event: 'activate', value: 'p2' }]);
        expect(isOpen(form)).toBe(true);
    });

    it('should tell the host of a submit with the values and close the form dialog when it is submitted', async () => {
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
        expect(crud.told).toEqual([{ id: 'form0', event: 'submitted', value: { values: { name: 'Linus' } } }]);
        expect(isOpen(form)).toBe(false);
    });

    it('should keep the form dialog open and tell the host nothing when Save finds an empty required field', async () => {
        // Arrange
        const crud = await mount();
        const [form] = modals(crud.host) as [HTMLElement];
        press(addButtons(crud.host)[0]);
        await settle();

        // Act
        press(inModal(form, 'Save'));
        await settle();

        // Assert
        expect(crud.told).toEqual([]);
        expect(isOpen(form)).toBe(true);
    });

    it('should close the form dialog on Cancel and tell the host nothing', async () => {
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
        expect(crud.told).toEqual([]);
    });

    it('should select the row and open the confirm dialog from a delete button, and tell the host of the delete press on confirm', async () => {
        // Arrange
        const crud = await mount();
        const [form, confirm] = modals(crud.host) as [HTMLElement, HTMLElement];

        // Act
        press(labelled(rows(crud.host)[1] as HTMLElement, 'Delete')[0]);
        await settle();

        // Assert
        expect([isOpen(form), isOpen(confirm)]).toEqual([false, true]);
        expect(crud.store.get('$.app.children.table.selected')).toBe('p2');
        expect(crud.told).toEqual([]);

        // Act
        press(inModal(confirm, 'Delete'));
        await settle();

        // Assert
        expect(isOpen(confirm)).toBe(false);
        expect(crud.told.map((entry) => entry.id)).toEqual(['delete0']);
    });

    it('should close the confirm dialog on Cancel and tell the host nothing', async () => {
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
        expect(crud.told).toEqual([]);
    });

    it('should tell the host of a search with the typed value when Enter is pressed in the search box', async () => {
        // Arrange
        const crud = await mount();

        // Act
        await userEvent.type(searchInput(crud.host), 'gra{Enter}');
        await settle();

        // Assert
        expect(crud.told).toEqual([{ id: 'search0', event: 'search', value: 'gra' }]);
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
        expect(crud.told.map((entry) => entry.id)).toEqual(['delete1']);
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
            'children.confirm._title',
            'children.form.body.on',
            'children.confirm.footer.children.confirm.on'
        ]);
    });
});
