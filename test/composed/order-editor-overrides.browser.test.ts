import { afterEach, describe, expect, it } from 'vitest';
import { validateDocument } from '@punyts/stateui-app/core';
import { deepAll, mountOrderDocument, orderData, orderEditorCatalog, unmountOrderDocuments } from '../harness/orderEditor.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};

const GREEN = '#2f6f4f';

/** The page of the story: one order editor under the key `editor`; `extra` adds sibling nodes to the page */
function orderDocument(editor: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        locale: 'en',
        data: orderData(),
        app: { component: 'panel', children: { editor: { component: 'orderEditor', ...editor }, ...extra } }
    };
}

/** The errors `validateDocument` gives for the document, as `[code, statePath]` pairs */
function errorsOf(document: Record<string, unknown>): [string, string | undefined][] {
    const result = validateDocument(document, orderEditorCatalog);
    return result.errors.map((error) => [error.code, error.statePath]);
}

const modalOf = (host: HTMLElement): HTMLElement => deepAll(host, 'ui-modal')[0] as HTMLElement;
const customerLabel = (modal: HTMLElement): string => {
    const field = deepAll(modal.shadowRoot as ShadowRoot, 'ui-text-field')[0] as HTMLElement;
    return field.shadowRoot?.querySelector('label, .label')?.textContent?.trim() ?? '';
};
const buttonLabels = (modal: HTMLElement): string[] =>
    deepAll(modal.shadowRoot as ShadowRoot, 'ui-button').map((button) => button.shadowRoot?.querySelector('.label')?.textContent?.trim() ?? '');
const accentOf = (element: HTMLElement): string => getComputedStyle(element).getPropertyValue('--ui-color-accent-base').trim().toLowerCase();
const surfaceOf = (element: HTMLElement): string => {
    const probe = (element.shadowRoot as ShadowRoot).appendChild(document.createElement('span'));
    probe.style.color = 'var(--ui-color-surface-base)';
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
};

describe('orderEditor (E5.27): overrides, theme and locale in Chromium', () => {
    afterEach(() => {
        unmountOrderDocuments();
    });

    it('should change the Customer label and the accent token when the node overrides them', async () => {
        // Arrange
        const plain = mountOrderDocument(orderDocument());
        await flush();
        const plainModal = modalOf(plain.host);
        const before = { accent: accentOf(plainModal), label: customerLabel(plainModal) };
        plain.dispose();

        // Act
        const custom = mountOrderDocument(
            orderDocument({
                body: { children: { form: { children: { customer: { _label: 'Client name' } } } } },
                theme: { color: { accent: { base: '#aa3300' } } }
            })
        );
        await flush();
        const modal = modalOf(custom.host);

        // Assert
        expect(before).toEqual({ accent: GREEN, label: 'Customer' });
        expect(customerLabel(modal)).toBe('Client name');
        expect(accentOf(modal)).toBe('#aa3300');
        expect(String(custom.store.get('$.theme.tokens.color.accent.base')).toLowerCase()).not.toBe(GREEN);
        expect(custom.store.get('$.app.children.editor.body.children.form.children.customer._label')).toBe('Client name');
    });

    it('should switch the editor text to German and leave $.data unchanged', async () => {
        // Arrange
        const mounted = mountOrderDocument(orderDocument());
        await flush();
        const data = JSON.parse(JSON.stringify(mounted.store.get('$.data')));
        const english = { text: modalOf(mounted.host).shadowRoot?.textContent ?? '', label: customerLabel(modalOf(mounted.host)) };

        // Act
        mounted.switchTo('de');
        await flush();
        await frames(2);
        const german = modalOf(mounted.host);

        // Assert
        expect(english.text).toContain('Edit order');
        expect(english.label).toBe('Customer');
        expect(german.shadowRoot?.textContent).toContain('Bestellung bearbeiten');
        expect(buttonLabels(german)).toEqual(['Speichern', 'Abbrechen']);
        expect(customerLabel(german)).toBe('Kunde');
        expect(mounted.store.get('$.data')).toEqual(data);
    });

    it('should change the surface token when the dark mode overlay is active', async () => {
        // Arrange
        const mounted = mountOrderDocument(orderDocument());
        await flush();
        const modal = modalOf(mounted.host);
        const light = surfaceOf(modal);

        // Act
        mounted.store.set('$.theme.active.mode', 'dark');
        await flush();

        // Assert
        expect(surfaceOf(modal)).not.toBe(light);
    });
});

describe('orderEditor (E5.27): validation errors', () => {
    it('should accept the baseline document', () => {
        // Arrange and Act
        const errors = errorsOf(orderDocument());

        // Assert
        expect(errors).toEqual([]);
    });

    it('should report SUI-NODE-UNKNOWN for a typo in a component name', () => {
        // Arrange
        const document = orderDocument({ component: 'orderEditr' });

        // Act
        const errors = errorsOf(document);

        // Assert
        expect(errors).toEqual([['SUI-NODE-UNKNOWN', '$.app.children.editor']]);
    });

    it('should report SUI-LAYOUT-PLACEMENT for a placement region the layout does not have', () => {
        // Arrange
        const document = orderDocument({ body: { children: { form: { placement: { region: 'up' } } } } });

        // Act
        const errors = errorsOf(document);

        // Assert
        expect(errors).toEqual([['SUI-LAYOUT-PLACEMENT', '$.app.children.editor.body.children.form.placement.region']]);
    });

    it('should report SUI-ON-TARGET for an on entry whose target does not resolve', () => {
        // Arrange
        const document = orderDocument({}, { help: { component: 'button', on: { press: { command: 'open', target: '^missing' } } } });

        // Act
        const errors = errorsOf(document);

        // Assert
        expect(errors).toEqual([['SUI-ON-TARGET', '$.app.children.help.on.press']]);
    });

    it('should report SUI-LINK-MISSING for a link to a node path that does not exist', () => {
        // Arrange
        const document = orderDocument({}, { note: { component: 'text', '<-_text': '^editor.body.children.nope._text' } });

        // Act
        const errors = errorsOf(document);

        // Assert
        expect(errors).toEqual([['SUI-LINK-MISSING', '$.app.children.note']]);
    });

    it('should report SUI-THEME-LAYER for a primitive token in a node theme', () => {
        // Arrange
        const document = orderDocument({ theme: { palette: { blue: { 600: '#ff0000' } } } });

        // Act
        const errors = errorsOf(document);

        // Assert
        expect(errors).toEqual([['SUI-THEME-LAYER', '$.app.children.editor.theme.palette.blue.600']]);
    });

    it('should report SUI-STATE-SHARED for a tone on a component that does not support it', () => {
        // Arrange
        const document = orderDocument({ body: { tone: 'danger' } });

        // Act
        const errors = errorsOf(document);

        // Assert
        expect(errors).toEqual([['SUI-STATE-SHARED', '$.app.children.editor.body.tone']]);
    });

    it('should report SUI-STATE-RUNTIME for a node that sets a runtime property', () => {
        // Arrange
        const document = orderDocument({}, { dialog: { component: 'modal', closeGlyph: 'plus' } });

        // Act
        const errors = errorsOf(document);

        // Assert
        expect(errors).toEqual([['SUI-STATE-RUNTIME', '$.app.children.dialog.closeGlyph']]);
    });
});
