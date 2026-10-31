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

interface Dialogs {
    host: HTMLElement;
    store: NonNullable<ReturnType<typeof mountApp>['store']>;
    emitted: { name: string; payload: unknown }[];
    switchTo(code: string): void;
}

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

function mount(app: Record<string, unknown>, data: Record<string, unknown> = {}): Dialogs {
    if (!registered) {
        registerAll();
        registered = true;
    }
    const host = globalThis.document.body.appendChild(globalThis.document.createElement('div'));
    const locale = registerLocaleStep(overlays);
    const emitted: { name: string; payload: unknown }[] = [];
    const document = { locale: 'en', data, app } as unknown as AppDocument;
    const result = mountApp(host, document, library, { onEmit: (name: string, payload: unknown) => emitted.push({ name, payload }) });
    if (!result.store) throw new Error(`the dialogs did not mount: ${result.errors.map((error) => error.message).join('; ')}`);
    mounted.push({ host, dispose: () => result.dispose(), unregister: () => locale.unregister() });
    return { host, store: result.store, emitted, switchTo: (code) => void locale.switchTo(code) };
}

const modals = (host: HTMLElement): HTMLElement[] => deep(host, 'ui-modal');
const command = (element: Element, name: string): void => {
    (element as Element & { commands: Record<string, () => void> }).commands[name]?.();
};
const dialogOf = (modal: HTMLElement): HTMLDialogElement => modal.shadowRoot?.querySelector('dialog') as HTMLDialogElement;
const isOpen = (modal: HTMLElement): boolean => dialogOf(modal).open;
const buttons = (modal: HTMLElement): HTMLElement[] => deep(modal.shadowRoot as ShadowRoot, 'ui-button').filter((button) => button.shadowRoot?.querySelector('.label') !== null);
const press = (button: HTMLElement | undefined): void => (button?.shadowRoot?.querySelector('button') as HTMLButtonElement).click();
const labelOf = (button: HTMLElement): string => button.shadowRoot?.querySelector('.label')?.textContent?.trim() ?? '';
const footerButton = (modal: HTMLElement, label: string): HTMLElement | undefined => buttons(modal).find((button) => labelOf(button) === label);
const fieldsOf = (modal: HTMLElement): HTMLElement[] => deep(modal.shadowRoot as ShadowRoot, 'ui-text-field');
const inputOf = (field: HTMLElement | undefined): HTMLInputElement => field?.shadowRoot?.querySelector('input') as HTMLInputElement;
const formOf = (modal: HTMLElement): HTMLElement => deep(modal.shadowRoot as ShadowRoot, 'ui-form')[0] as HTMLElement;
const record = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};
const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

const twoFields = {
    name: { component: 'textField', _label: 'Name', required: true, '<-value': '$.data.name' },
    note: { component: 'textField', _label: 'Note', '<-value': '$.data.note' }
};

describe('confirmDialog and formDialog in Chromium', () => {
    afterEach(() => {
        for (const entry of mounted.splice(0)) {
            entry.dispose();
            entry.unregister();
            entry.host.remove();
        }
    });

    describe('confirmDialog', () => {
        it('should close the instance whose button was pressed, at two depths', async () => {
            // Arrange
            const dialogs = mount({
                component: 'panel',
                children: {
                    outer: { component: 'confirmDialog' },
                    box: { component: 'panel', children: { inner: { component: 'confirmDialog', _title: 'Inner' } } }
                }
            });
            const [outer, inner] = modals(dialogs.host) as [HTMLElement, HTMLElement];
            command(outer, 'open');
            command(inner, 'open');
            await frame();
            expect([isOpen(outer), isOpen(inner)]).toEqual([true, true]);

            // Act
            press(footerButton(inner, 'Cancel'));
            await frame();

            // Assert
            expect([isOpen(outer), isOpen(inner)]).toEqual([true, false]);

            // Act
            press(footerButton(outer, 'Delete'));
            await frame();

            // Assert
            expect([isOpen(outer), isOpen(inner)]).toEqual([false, false]);
        });

        it('should show a text body and the default confirm tone', () => {
            // Arrange
            const dialogs = mount({ component: 'confirmDialog' });
            const modal = modals(dialogs.host)[0] as HTMLElement;

            // Assert
            expect(modal.getAttribute('width')).toBe('sm');
            expect(deep(modal.shadowRoot as ShadowRoot, 'ui-text')[0]?.shadowRoot?.textContent).toContain('This cannot be undone.');
            expect(footerButton(modal, 'Delete')?.getAttribute('tone')).toBe('danger');
        });

        it('should run an overridden confirm list after the close command', async () => {
            // Arrange
            const dialogs = mount({
                component: 'confirmDialog',
                footer: {
                    children: {
                        confirm: {
                            on: {
                                press: [
                                    { command: 'close', target: '^confirmDialog' },
                                    { command: 'emit', target: 'record.delete', value: 7 }
                                ]
                            }
                        }
                    }
                }
            });
            const modal = modals(dialogs.host)[0] as HTMLElement;
            command(modal, 'open');
            await frame();

            // Act
            press(footerButton(modal, 'Delete'));
            await frame();

            // Assert
            expect(isOpen(modal)).toBe(false);
            expect(dialogs.emitted).toEqual([{ name: 'record.delete', payload: 7 }]);
        });

        it('should apply overrides of the exposed text paths', () => {
            // Arrange
            const dialogs = mount({
                component: 'confirmDialog',
                _title: 'Remove order',
                body: { _text: 'Remove order 12?' },
                footer: { children: { confirm: { _title: 'Remove', tone: 'warning' } } }
            });
            const modal = modals(dialogs.host)[0] as HTMLElement;

            // Assert
            expect(footerButton(modal, 'Remove')?.getAttribute('tone')).toBe('warning');
            expect(modal.shadowRoot?.textContent).toContain('Remove order');
        });

        it('should show the German texts after switching to de', async () => {
            // Arrange
            const dialogs = mount({ component: 'confirmDialog' });
            const modal = modals(dialogs.host)[0] as HTMLElement;

            // Act
            dialogs.switchTo('de');
            await frame();

            // Assert
            expect(buttons(modal).map(labelOf)).toEqual(['Abbrechen', 'Löschen']);
        });

        it('should validate its catalog example and list its exposed paths', () => {
            // Arrange
            const entry = catalog.components.find((component) => component.name === 'confirmDialog') as ComposedCatalogEntry;

            // Act
            const result = validateDocument({ locale: 'en', app: entry.example }, catalog);

            // Assert
            expect(result.errors).toEqual([]);
            expect(entry.exposes?.map((exposed) => exposed.path)).toEqual([
                '_title',
                'body._text',
                'footer.children.confirm._title',
                'footer.children.confirm.tone',
                'footer.children.confirm.on.press'
            ]);
            expect(JSON.stringify(entry.exposes?.at(-1))).toContain('replaces the default');
        });
    });

    describe('formDialog', () => {
        const mountForm = (): { dialogs: Dialogs; modal: HTMLElement } => {
            const dialogs = mount({ component: 'formDialog', body: { children: { ...twoFields } } }, { name: '', note: '' });
            return { dialogs, modal: modals(dialogs.host)[0] as HTMLElement };
        };

        it('should stay open and raise invalid when Save finds an empty required field', async () => {
            // Arrange
            const { modal } = mountForm();
            command(modal, 'open');
            await frame();
            const form = formOf(modal);
            const invalid = record(form, 'invalid');
            const submitted = record(form, 'submitted');

            // Act
            press(footerButton(modal, 'Save'));
            await frame();

            // Assert
            expect(invalid.filter((detail) => 'keys' in (detail as object))).toEqual([{ keys: ['name'] }]);
            expect(submitted).toEqual([]);
            expect(isOpen(modal)).toBe(true);
        });

        it('should raise submitted with the values keyed by field and then close', async () => {
            // Arrange
            const { dialogs, modal } = mountForm();
            command(modal, 'open');
            await frame();
            const submitted = record(formOf(modal), 'submitted');
            await userEvent.type(inputOf(fieldsOf(modal)[0]), 'Ada');
            await userEvent.type(inputOf(fieldsOf(modal)[1]), 'Hello');

            // Act
            press(footerButton(modal, 'Save'));
            await frame();

            // Assert
            expect(submitted).toEqual([{ values: { name: 'Ada', note: 'Hello' } }]);
            expect(isOpen(modal)).toBe(false);
            expect(dialogs.store.get('$.data.name')).toBe('Ada');
        });

        it('should close on Cancel without submitting', async () => {
            // Arrange
            const { modal } = mountForm();
            command(modal, 'open');
            await frame();
            const submitted = record(formOf(modal), 'submitted');
            await userEvent.type(inputOf(fieldsOf(modal)[0]), 'Ada');

            // Act
            press(footerButton(modal, 'Cancel'));
            await frame();

            // Assert
            expect(submitted).toEqual([]);
            expect(isOpen(modal)).toBe(false);
        });

        it('should keep the fields data when the dialog is reopened', async () => {
            // Arrange
            const { dialogs, modal } = mountForm();
            command(modal, 'open');
            await frame();
            await userEvent.type(inputOf(fieldsOf(modal)[0]), 'Ada');
            press(footerButton(modal, 'Cancel'));
            await frame();

            // Act
            command(modal, 'open');
            await frame();

            // Assert
            expect(isOpen(modal)).toBe(true);
            expect(dialogs.store.get('$.data.name')).toBe('Ada');
            expect(inputOf(fieldsOf(modal)[0]).value).toBe('Ada');
        });

        it('should keep two form dialogs separate', async () => {
            // Arrange
            const dialogs = mount({
                component: 'panel',
                children: {
                    one: { component: 'formDialog', body: { children: { name: { value: 'Ada' } } } },
                    two: { component: 'formDialog', body: { children: { name: { value: 'Bob' } } } }
                }
            });
            const [one, two] = modals(dialogs.host) as [HTMLElement, HTMLElement];
            command(one, 'open');
            command(two, 'open');
            await frame();

            // Act
            press(footerButton(two, 'Save'));
            await frame();

            // Assert
            expect([isOpen(one), isOpen(two)]).toEqual([true, false]);
        });

        it('should show the German texts after switching to de', async () => {
            // Arrange
            const { dialogs, modal } = mountForm();

            // Act
            dialogs.switchTo('de');
            await frame();

            // Assert
            expect(buttons(modal).map(labelOf)).toEqual(['Abbrechen', 'Speichern']);
        });

        it('should validate its catalog example and list its exposed paths', () => {
            // Arrange
            const entry = catalog.components.find((component) => component.name === 'formDialog') as ComposedCatalogEntry;

            // Act
            const result = validateDocument({ locale: 'en', app: entry.example }, catalog);

            // Assert
            expect(result.errors).toEqual([]);
            expect(entry.exposes?.map((exposed) => exposed.path)).toEqual(['_title', 'body.children', 'footer.children.save._title']);
        });
    });
});
