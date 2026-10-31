import { report } from '@punyts/core';
import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent, MountOptions, NodeState } from '../harness/createMountComponent.js';

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
const mountForm = (children: NodeState, extra: NodeState = {}, options: MountOptions = {}): MountedComponent =>
    mountComponent('form', { children, ...extra }, options);
const statuses = (mounted: MountedComponent): unknown[] => {
    const seen: unknown[] = [];
    mounted.store.on(['$.app.status'], () => seen.push(mounted.store.get('$.app.status')));
    return seen;
};

describe('form submit, reset and commit in Chromium', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        mountComponent.unmountAll();
    });

    it('should raise submitted with the values keyed by child key', async () => {
        // Arrange
        const mounted = mountForm({
            box: { component: 'panel', children: { name: field({ required: true }) } },
            note: field()
        });
        const submitted = record(mounted.element, 'submitted');
        await userEvent.type(inputOf(fieldsOf(mounted)[0]), 'Ada');
        await userEvent.type(inputOf(fieldsOf(mounted)[1]), 'Hi');

        // Act
        command(mounted.element, 'submit');

        // Assert
        expect(submitted).toEqual([{ values: { name: 'Ada', note: 'Hi' } }]);
    });

    it('should raise invalid and no submitted when a field fails', () => {
        // Arrange
        const mounted = mountForm({ name: field({ required: true }), note: field() });
        const submitted = record(mounted.element, 'submitted');
        const invalid = record(mounted.element, 'invalid');

        // Act
        command(mounted.element, 'submit');

        // Assert
        expect(submitted).toEqual([]);
        expect(invalid.filter((detail) => 'keys' in (detail as object))).toEqual([{ keys: ['name'] }]);
        expect(mounted.store.get('$.app.status')).toBe('invalid');
    });

    it('should go submitting then submitted, and leave submitted when a field changes', async () => {
        // Arrange
        const mounted = mountForm({ name: field({ value: 'Ada' }) });
        const seen = statuses(mounted);

        // Act
        command(mounted.element, 'submit');

        // Assert
        expect(seen).toEqual(['submitting', 'submitted']);
        await userEvent.type(inputOf(fieldsOf(mounted)[0]), 'x');
        expect(mounted.store.get('$.app.status')).toBe('dirty');
    });

    it('should restore the values at load through the links on reset, and clear errors', async () => {
        // Arrange
        const mounted = mountForm(
            { name: field({ '<-value': '$.data.name', required: true }), note: field({ '<-value': '$.data.note' }) },
            {},
            { data: { name: 'Ada', note: 'x' } }
        );
        await userEvent.clear(inputOf(fieldsOf(mounted)[0]));
        await userEvent.type(inputOf(fieldsOf(mounted)[1]), 'yz');
        command(mounted.element, 'validate');
        expect(mounted.store.get('$.app.errorCount')).toBe(1);

        // Act
        command(mounted.element, 'reset');

        // Assert
        expect(mounted.store.get('$.data.name')).toBe('Ada');
        expect(mounted.store.get('$.data.note')).toBe('x');
        expect(inputOf(fieldsOf(mounted)[0]).value).toBe('Ada');
        expect(mounted.store.get('$.app.errorCount')).toBe(0);
        expect(mounted.store.get('$.app.status')).toBe('pristine');
    });

    it('should not validate fields or raise changed while resetting with validateOn change', async () => {
        // Arrange
        const mounted = mountForm({ name: field({ value: 'Ada', required: true }) }, { validateOn: 'change' });
        await userEvent.clear(inputOf(fieldsOf(mounted)[0]));
        const changed = record(mounted.element, 'changed');

        // Act
        command(mounted.element, 'reset');

        // Assert
        expect(mounted.store.get('$.app.children.name.error')).toBe('');
        expect(changed).toEqual([]);
    });

    it('should reset to the committed values after commit', async () => {
        // Arrange
        const mounted = mountForm({ name: field({ '<-value': '$.data.name' }) }, {}, { data: { name: 'Ada' } });
        const input = (): HTMLInputElement => inputOf(fieldsOf(mounted)[0]);
        await userEvent.type(input(), 'm');

        // Act
        command(mounted.element, 'commit');
        const afterCommit = mounted.store.get('$.app.status');
        await userEvent.type(input(), 'n');
        command(mounted.element, 'reset');

        // Assert
        expect(afterCommit).toBe('pristine');
        expect(mounted.store.get('$.data.name')).toBe('Adam');
        expect(input().value).toBe('Adam');
    });

    it('should not save: $.data already holds the typed values before submit', async () => {
        // Arrange
        const mounted = mountForm({ name: field({ '<-value': '$.data.name' }) }, {}, { data: { name: '' } });

        // Act
        await userEvent.type(inputOf(fieldsOf(mounted)[0]), 'Ada');

        // Assert
        expect(mounted.store.get('$.data.name')).toBe('Ada');
    });

    it('should report a duplicate key as SUI-RUN and let the later field win', () => {
        // Arrange
        const errors = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        const mounted = mountForm({
            one: field({ value: 'first' }),
            box: { component: 'panel', children: { one: field({ value: 'second' }) } }
        });
        const submitted = record(mounted.element, 'submitted');

        // Act
        command(mounted.element, 'submit');

        // Assert
        expect(submitted).toEqual([{ values: { one: 'second' } }]);
        expect(errors).toHaveBeenCalledTimes(1);
        expect(String(errors.mock.calls[0]?.[0])).toContain('"one"');
        expect(errors.mock.calls[0]?.[1]).toMatchObject({ code: 'SUI-RUN-BINDING' });
    });

    it('should reach hooks.onEmit and a set command through on wiring', () => {
        // Arrange
        const onEmit = vi.fn();
        const mounted = mountForm(
            { name: field({ value: 'Ada' }) },
            {
                on: {
                    submitted: [
                        { command: 'emit', target: 'form.saved', value: 1 },
                        { command: 'set', target: '$.data.flag', value: true }
                    ]
                }
            },
            { hooks: { onEmit } }
        );

        // Act
        command(mounted.element, 'submit');

        // Assert
        expect(onEmit).toHaveBeenCalledTimes(1);
        expect(onEmit.mock.calls[0]?.[0]).toBe('form.saved');
        expect(mounted.store.get('$.data.flag')).toBe(true);
    });

    it('should update errorCount at once when a field clear command empties an errored field', () => {
        // Arrange
        const mounted = mountForm({ name: field({ value: 'Ada', minLength: 5 }) });
        command(mounted.element, 'validate');
        expect(mounted.store.get('$.app.errorCount')).toBe(1);

        // Act
        command(fieldsOf(mounted)[0] as Element, 'clear');

        // Assert
        expect(mounted.store.get('$.app.errorCount')).toBe(0);
        expect(mounted.store.get('$.app.status')).toBe('dirty');
    });
});
