import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import type { ComposedCatalogEntry } from '@punyts/stateui-app/build';
import { validateDocument } from '@punyts/stateui-app/core';
import { deepAll, mountOrderDocument, orderData, orderEditorCatalog, unmountOrderDocuments } from '../harness/orderEditor.js';
import type { MountedOrderDocument } from '../harness/orderEditor.js';

interface CommandElement extends HTMLElement {
    commands: Record<string, () => void>;
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};

/** One order editor of the mounted document: its modal and the parts the tests touch */
interface Editor {
    modal: CommandElement;
    form: HTMLElement;
    customer: HTMLInputElement;
    status: HTMLSelectElement;
    list: HTMLElement;
    button(label: string): HTMLElement;
}

const inside = (element: HTMLElement, tag: string): HTMLElement => {
    const found = deepAll(element.shadowRoot as ShadowRoot, tag)[0];
    if (!found) throw new Error(`no <${tag}> in <${element.localName}>`);
    return found;
};
const labelOf = (button: HTMLElement): string => button.shadowRoot?.querySelector('.label')?.textContent?.trim() ?? '';

function editorOf(modal: HTMLElement): Editor {
    return {
        modal: modal as CommandElement,
        form: inside(modal, 'ui-form'),
        customer: inside(modal, 'ui-text-field').shadowRoot?.querySelector('input') as HTMLInputElement,
        status: inside(modal, 'ui-select-field').shadowRoot?.querySelector('select') as HTMLSelectElement,
        list: inside(modal, 'ui-list'),
        button(label) {
            const found = deepAll(modal.shadowRoot as ShadowRoot, 'ui-button').find((button) => labelOf(button) === label);
            if (!found) throw new Error(`no button "${label}"`);
            return found;
        }
    };
}

const editors = (mounted: MountedOrderDocument): Editor[] => deepAll(mounted.host, 'ui-modal').map(editorOf);
const isOpen = (editor: Editor): boolean => (editor.modal.shadowRoot?.querySelector('dialog') as HTMLDialogElement).open;
const press = (button: HTMLElement): void => (button.shadowRoot?.querySelector('button') as HTMLButtonElement).click();
const record = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};
const rowTexts = (list: HTMLElement): string[] => {
    const slots = Array.from(list.shadowRoot?.querySelector('ui-record-list')?.shadowRoot?.querySelectorAll<HTMLElement>('.slot') ?? []);
    return slots
        .filter((slot) => !slot.hidden)
        .map((slot) => (slot.firstElementChild?.firstElementChild as Element | null)?.shadowRoot?.textContent?.trim() ?? '');
};

/**
 * The document of the story: the order editor at two depths with different instance keys, `editor` directly in the
 * page and `nested` two panels down. The outer one emits `order.saved` with the submitted values
 */
function orderDocument(): Record<string, unknown> {
    return {
        locale: 'en',
        data: orderData(),
        app: {
            component: 'panel',
            children: {
                editor: {
                    component: 'orderEditor',
                    body: { children: { form: { on: { submitted: { command: 'emit', target: 'order.saved' } } } } }
                },
                box: {
                    component: 'panel',
                    children: {
                        inner: { component: 'panel', children: { nested: { component: 'orderEditor', _title: 'Edit nested order' } } }
                    }
                }
            }
        }
    };
}

/**
 * Mounts the document, opens both editors and waits for the lines list to lay out its rows. Both are native modal
 * dialogs, so the one opened last (`nested`) is the top layer and the outer one is inert to user input until it closes
 */
async function mountOpen(): Promise<{ mounted: MountedOrderDocument; outer: Editor; nested: Editor }> {
    const mounted = mountOrderDocument(orderDocument());
    const [outer, nested] = editors(mounted) as [Editor, Editor];
    outer.modal.commands.open?.();
    nested.modal.commands.open?.();
    await flush();
    await frames(3);
    return { mounted, outer, nested };
}

describe('orderEditor (E5.18) in Chromium', () => {
    afterEach(() => {
        unmountOrderDocuments();
    });

    it('should validate the mounted document with no errors', () => {
        // Arrange
        const document = orderDocument();

        // Act
        const result = validateDocument(document, orderEditorCatalog);

        // Assert
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
    });

    it('should build the fixture into a composed catalog entry with its exposes and the German overlay', () => {
        // Arrange
        const entry = orderEditorCatalog.components.find((component) => component.name === 'orderEditor') as ComposedCatalogEntry;

        // Act
        const paths = entry.exposes?.map((exposed) => exposed.path);

        // Assert
        expect(entry.tier).toBe('composed');
        expect(entry.tree).toMatchObject({ component: 'modal', theme: { color: { accent: { base: '#2f6f4f' } } } });
        expect(paths).toContain('body.children.form.children.customer._label');
        expect(paths).toContain('footer.children.save._title');
        expect(orderEditorCatalog.locales).toContain('de');
    });

    it('should render the order editor at both depths, each with its own form', async () => {
        // Arrange and Act
        const { outer, nested } = await mountOpen();

        // Assert
        expect([isOpen(outer), isOpen(nested)]).toEqual([true, true]);
        expect(outer.form).not.toBe(nested.form);
        expect(outer.modal.shadowRoot?.textContent).toContain('Edit order');
        expect(nested.modal.shadowRoot?.textContent).toContain('Edit nested order');
    });

    it('should write $.data.order.customer when the user types in Customer', async () => {
        // Arrange
        const { mounted, nested } = await mountOpen();

        // Act
        await userEvent.type(nested.customer, 'Ada Lovelace');

        // Assert
        expect(mounted.store.get('$.data.order.customer')).toBe('Ada Lovelace');
    });

    it('should list $.data.statuses in the status select and write the choice to status', async () => {
        // Arrange
        const { mounted, outer } = await mountOpen();
        const before = outer.status.value;

        // Act
        await userEvent.selectOptions(outer.status, 'shipped');

        // Assert
        expect(Array.from(outer.status.options).map((option) => option.text)).toEqual(['Open', 'Shipped', 'Closed']);
        expect(before).toBe('open');
        expect(mounted.store.get('$.data.order.status')).toBe('shipped');
    });

    it('should show the status label on the left', async () => {
        // Arrange and Act
        const { outer } = await mountOpen();

        // Assert
        expect(inside(outer.modal, 'ui-select-field').getAttribute('title-position')).toBe('left');
    });

    it('should show the description of every line in the lines list', async () => {
        // Arrange and Act
        const { outer, nested } = await mountOpen();

        // Assert
        expect(rowTexts(outer.list)).toEqual(['Oak table', 'Four chairs']);
        expect(rowTexts(nested.list)).toEqual(['Oak table', 'Four chairs']);
    });

    it('should submit only the form of the editor whose Save was pressed, invalid when Customer is empty and submitted when it is set', async () => {
        // Arrange
        const { mounted, outer, nested } = await mountOpen();
        const seen = {
            outer: { invalid: record(outer.form, 'invalid'), submitted: record(outer.form, 'submitted') },
            nested: { invalid: record(nested.form, 'invalid'), submitted: record(nested.form, 'submitted') }
        };
        const keyed = (details: unknown[]): unknown[] => details.filter((detail) => typeof detail === 'object' && detail !== null && 'keys' in detail);

        // Act: an empty required Customer, Save in each editor in turn
        press(outer.button('Save'));
        await flush();
        const afterOuterEmpty = { outer: keyed(seen.outer.invalid).length, nested: keyed(seen.nested.invalid).length };
        press(nested.button('Save'));
        await flush();
        const afterNestedEmpty = { outer: keyed(seen.outer.invalid).length, nested: keyed(seen.nested.invalid).length };

        // Assert
        expect(afterOuterEmpty).toEqual({ outer: 1, nested: 0 });
        expect(afterNestedEmpty).toEqual({ outer: 1, nested: 1 });
        expect(keyed(seen.outer.invalid)).toEqual([{ keys: ['customer'] }]);
        expect(seen.outer.submitted).toEqual([]);
        expect(seen.nested.submitted).toEqual([]);

        // Act: a valid Customer, Save in each editor in turn
        mounted.store.set('$.data.order.customer', 'Ada');
        await flush();
        press(nested.button('Save'));
        await flush();
        const afterNestedValid = { outer: seen.outer.submitted.length, nested: seen.nested.submitted.length };
        press(outer.button('Save'));
        await flush();

        // Assert
        expect(afterNestedValid).toEqual({ outer: 0, nested: 1 });
        expect(seen.outer.submitted).toEqual([{ values: { customer: 'Ada', status: 'open' } }]);
        expect(seen.nested.submitted).toEqual([{ values: { customer: 'Ada', status: 'open' } }]);
    });

    it('should send the outer editor submission to hooks.onEmit through its emit command', async () => {
        // Arrange
        const { mounted, outer, nested } = await mountOpen();
        mounted.store.set('$.data.order.customer', 'Ada');
        await flush();

        // Act
        press(nested.button('Save'));
        await flush();
        press(outer.button('Save'));
        await flush();

        // Assert
        expect(mounted.emitted).toEqual([{ name: 'order.saved', payload: { values: { customer: 'Ada', status: 'open' } } }]);
    });

    it('should close only the modal whose Cancel was pressed and reset its form on close', async () => {
        // Arrange
        const { mounted, outer, nested } = await mountOpen();
        await userEvent.type(nested.customer, 'Ada');

        // Act
        press(nested.button('Cancel'));
        await flush();

        // Assert
        expect([isOpen(outer), isOpen(nested)]).toEqual([true, false]);
        expect(mounted.store.get('$.data.order.customer')).toBe('');
    });
});
