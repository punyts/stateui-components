import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent, NodeState } from '../harness/createMountComponent.js';

/** Every element with this tag under the node, through the shadow roots, in document order */
const deep = (root: ParentNode, tag: string): Element[] => {
    const found: Element[] = [];
    for (const child of Array.from(root.children)) {
        if (child.localName === tag) found.push(child);
        if (child.shadowRoot) found.push(...deep(child.shadowRoot, tag));
        found.push(...deep(child, tag));
    }
    return found;
};
const fieldsOf = (mounted: MountedComponent): Element[] => deep(mounted.element.shadowRoot as ShadowRoot, 'ui-text-field');
const inputOf = (field: Element | undefined): HTMLInputElement => field?.shadowRoot?.querySelector('input') as HTMLInputElement;
const command = (element: Element, name: string): void => {
    (element as Element & { commands: Record<string, () => void> }).commands[name]?.();
};
const record = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};
const field = (extra: NodeState = {}): NodeState => ({ component: 'textField', ...extra });
const summaryOf = (mounted: MountedComponent): HTMLElement | null => mounted.element.shadowRoot?.querySelector('.summary') ?? null;
const mountForm = (children: NodeState, extra: NodeState = {}, locale?: string): MountedComponent =>
    mountComponent('form', { children, ...extra }, locale ? { locale } : {});

describe('form in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should block on a required field: errorCount, status and the summary follow the failed validation', () => {
        // Arrange
        const mounted = mountForm({ name: field({ required: true }), note: field() });
        const invalid = record(mounted.element, 'invalid');

        // Act
        command(mounted.element, 'validate');

        // Assert
        expect(mounted.store.get('$.app.children.name.error')).toBe('required');
        expect(mounted.store.get('$.app.errorCount')).toBe(1);
        expect(mounted.store.get('$.app.status')).toBe('invalid');
        expect(invalid.filter((detail) => 'keys' in (detail as object))).toEqual([{ keys: ['name'] }]);
        expect(summaryOf(mounted)?.textContent?.trim()).toBe('Please correct the highlighted fields');
    });

    it('should hide the summary and return the status once the error is fixed', async () => {
        // Arrange
        const mounted = mountForm({ name: field({ required: true }) });
        command(mounted.element, 'validate');

        // Act
        await userEvent.type(inputOf(fieldsOf(mounted)[0]), 'Ada');

        // Assert
        expect(mounted.store.get('$.app.errorCount')).toBe(0);
        expect(mounted.store.get('$.app.status')).toBe('dirty');
        expect(summaryOf(mounted)).toBeNull();
    });

    it('should show no summary before any validation and report pristine', () => {
        // Arrange
        const mounted = mountForm({ name: field({ required: true }) });

        // Assert
        expect(summaryOf(mounted)).toBeNull();
        expect(mounted.store.get('$.app.status')).toBe('pristine');
        expect(mounted.store.get('$.app.errorCount')).toBe(0);
    });

    it('should focus the first field with an error in document order', () => {
        // Arrange
        const mounted = mountForm({
            first: field({ value: 'ok', required: true }),
            second: field({ required: true }),
            third: field({ required: true })
        });
        command(mounted.element, 'validate');

        // Act
        command(mounted.element, 'focusFirstError');

        // Assert
        const fields = fieldsOf(mounted);
        expect(inputOf(fields[1]).matches(':focus')).toBe(true);
    });

    it('should find a field nested in a panel', () => {
        // Arrange
        const mounted = mountForm({
            box: { component: 'panel', children: { name: field({ required: true }) } }
        });

        // Act
        command(mounted.element, 'validate');

        // Assert
        expect(mounted.store.get('$.app.children.box.children.name.error')).toBe('required');
        expect(mounted.store.get('$.app.errorCount')).toBe(1);
    });

    it('should drop a field that is removed', () => {
        // Arrange
        const mounted = mountForm({ a: field({ required: true }), b: field() });
        command(mounted.element, 'validate');
        expect(mounted.store.get('$.app.errorCount')).toBe(1);

        // Act
        mounted.store.set('$.app.children', { b: field() } as never);

        // Assert
        expect(fieldsOf(mounted)).toHaveLength(1);
        expect(mounted.store.get('$.app.errorCount')).toBe(0);
        expect(mounted.store.get('$.app.status')).toBe('pristine');
    });

    it('should not validate on blur or change with validateOn submit until the first validation', async () => {
        // Arrange
        const mounted = mountForm({ name: field({ required: true }) }, { validateOn: 'submit' });
        const input = inputOf(fieldsOf(mounted)[0]);

        // Act
        input.focus();
        await userEvent.type(input, 'a');
        await userEvent.clear(input);
        input.blur();

        // Assert
        expect(mounted.store.get('$.app.children.name.error')).toBe('');
        expect(mounted.store.get('$.app.errorCount')).toBe(0);
        command(mounted.element, 'validate');
        expect(mounted.store.get('$.app.errorCount')).toBe(1);
    });

    it('should validate a field on blur with validateOn blur', async () => {
        // Arrange
        const mounted = mountForm({ name: field({ required: true }) }, { validateOn: 'blur' });
        const input = inputOf(fieldsOf(mounted)[0]);

        // Act
        input.focus();
        input.blur();

        // Assert
        expect(mounted.store.get('$.app.children.name.error')).toBe('required');
        expect(mounted.store.get('$.app.errorCount')).toBe(1);
        expect(mounted.store.get('$.app.status')).toBe('invalid');
    });

    it('should validate a field on change with validateOn change, before it is touched', async () => {
        // Arrange
        const mounted = mountForm({ name: field({ minLength: 3 }) }, { validateOn: 'change' });
        const input = inputOf(fieldsOf(mounted)[0]);

        // Act
        await userEvent.type(input, 'ab');

        // Assert
        expect(mounted.store.get('$.app.children.name.error')).toBe('minLength');
        expect(mounted.store.get('$.app.errorCount')).toBe(1);
    });

    it('should hand validation to the form when validateOn is written later', async () => {
        // Arrange
        const mounted = mountForm({ name: field({ required: true }) }, { validateOn: 'submit' });
        const input = inputOf(fieldsOf(mounted)[0]);
        mounted.store.set('$.app.validateOn', 'change' as never);

        // Act
        await userEvent.type(input, 'a');
        await userEvent.clear(input);

        // Assert
        expect(mounted.store.get('$.app.children.name.error')).toBe('required');
    });

    it('should disable every field with disabled and enable them again', () => {
        // Arrange
        const mounted = mountForm({ a: field(), b: field() }, { disabled: true });
        const states = (): boolean[] => fieldsOf(mounted).map((item) => inputOf(item).disabled);

        // Assert
        expect(states()).toEqual([true, true]);
        mounted.store.set('$.app.disabled', false as never);
        expect(states()).toEqual([false, false]);
    });

    it('should raise changed with the key and value when a field changes', async () => {
        // Arrange
        const mounted = mountForm({ name: field() });
        const changed = record(mounted.element, 'changed');

        // Act
        await userEvent.type(inputOf(fieldsOf(mounted)[0]), 'A');

        // Assert
        expect(changed).toEqual([{ key: 'name', value: 'A' }]);
        expect(mounted.store.get('$.app.status')).toBe('dirty');
    });

    it('should show the German summary', () => {
        // Arrange
        const mounted = mountForm({ name: field({ required: true }) }, {}, 'de');

        // Act
        command(mounted.element, 'validate');

        // Assert
        expect(summaryOf(mounted)?.textContent?.trim()).toBe('Bitte korrigieren Sie die markierten Felder');
    });
});
