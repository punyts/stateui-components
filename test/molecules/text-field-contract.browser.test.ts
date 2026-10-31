import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { NodeState } from '../harness/createMountComponent.js';
import type { FieldConnect } from '../../src/shared/field/field.js';

interface CommandElement extends Element {
    commands: { validate(): void; reset(): void; focus(): void; clear(): void };
}

interface Connected {
    field: FieldConnect;
    shadowRoots: number;
}

const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const control = (element: Element): HTMLInputElement => part<HTMLInputElement>(element, 'input');
const commands = (element: Element): CommandElement['commands'] => (element as CommandElement).commands;
const touch = (element: Element): void => {
    control(element).focus();
    control(element).blur();
};
const record = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};
const field = (node: NodeState): NodeState => ({ component: 'textField', ...node });
const card = (children: NodeState): NodeState => ({ component: 'card', children });

/** Mounts a node while a form-like listener on the document collects every `ui-field-connect` */
const mountWithForm = (name: string, node: NodeState): { mounted: ReturnType<typeof mountComponent>; connected: Connected[] } => {
    const connected: Connected[] = [];
    const listen = (event: Event): void => {
        const shadowRoots = event.composedPath().filter((target) => target instanceof ShadowRoot).length;
        connected.push({ field: (event as CustomEvent<FieldConnect>).detail, shadowRoots });
    };
    document.addEventListener('ui-field-connect', listen);
    try {
        return { mounted: mountComponent(name, node), connected };
    } finally {
        document.removeEventListener('ui-field-connect', listen);
    }
};

describe('textField contract in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should raise invalid with the rule name on each failure, then valid once the value passes', async () => {
        // Arrange
        const mounted = mountComponent('textField', { minLength: 3 });
        const invalid = record(mounted.element, 'invalid');
        const valid = record(mounted.element, 'valid');
        const change = record(mounted.element, 'change');
        touch(mounted.element);

        // Act
        await userEvent.type(control(mounted.element), 'ab');
        await userEvent.type(control(mounted.element), 'c');

        // Assert
        expect(change).toEqual([{ value: 'a' }, { value: 'ab' }, { value: 'abc' }]);
        expect(invalid).toEqual([{ rule: 'minLength' }, { rule: 'minLength' }]);
        expect(valid).toEqual([{ value: 'abc' }]);
    });

    it('should not raise valid for a pass that follows no failure', () => {
        // Arrange
        const mounted = mountComponent('textField', { value: 'fine' });
        const valid = record(mounted.element, 'valid');

        // Act
        commands(mounted.element).validate();

        // Assert
        expect(valid).toEqual([]);
    });

    it('should move focus to the control on the focus command', () => {
        // Arrange
        const mounted = mountComponent('textField');

        // Act
        commands(mounted.element).focus();

        // Assert
        expect(mounted.element.shadowRoot?.activeElement).toBe(control(mounted.element));
    });

    it('should empty the value, write data and clear error on the clear command', () => {
        // Arrange
        const mounted = mountComponent(
            'textField',
            { '<-value': '$.data.order.customer', required: true },
            { data: { order: { customer: 'Ada' } } }
        );
        mounted.store.set('$.app.value', '');
        commands(mounted.element).validate();
        const before = mounted.store.get('$.app.error');
        mounted.store.set('$.app.value', 'Grace');

        // Act
        commands(mounted.element).clear();

        // Assert
        expect(before).toBe('required');
        expect(mounted.store.get('$.data.order.customer')).toBe('');
        expect(control(mounted.element).value).toBe('');
        expect(mounted.store.get('$.app.error')).toBe('');
    });

    it('should leave error empty after clear on a touched required field', () => {
        // Arrange
        const mounted = mountComponent('textField', { required: true, value: 'x' });
        touch(mounted.element);

        // Act
        commands(mounted.element).clear();

        // Assert
        expect(mounted.store.get('$.app.error')).toBe('');
    });

    it('should reach a listener on the document from three shadow roots down with the documented members', () => {
        // Act
        const { connected } = mountWithForm('card', {
            children: { outer: card({ inner: card({ name: field({ value: 'Ada', minLength: 5 }) }) }) }
        });
        const [first] = connected;

        // Assert
        expect(connected).toHaveLength(1);
        expect(first?.shadowRoots).toBeGreaterThanOrEqual(3);
        expect(Object.keys(first?.field ?? {}).sort()).toEqual(
            ['dirty', 'element', 'error', 'focus', 'key', 'onRelease', 'rebase', 'reset', 'setDisabled', 'setManaged', 'validate', 'value'].sort()
        );
        expect(first?.field.key).toBe('name');
        expect(first?.field.value).toBe('Ada');
        expect(first?.field.error).toBe('');
        expect(first?.field.validate()).toBe('minLength');
        expect(first?.field.error).toBe('minLength');
        expect(first?.field.element.localName).toBe('ui-text-field');
    });

    it('should let a form disable the control, take over validation, rebase and reset', async () => {
        // Arrange
        const { mounted, connected } = mountWithForm('textField', { value: 'Jo', minLength: 5 });
        const form = connected[0]?.field as FieldConnect;

        // Act
        form.setDisabled(true);
        const locked = control(mounted.element).disabled;
        form.setDisabled(false);
        form.setManaged('submit');
        touch(mounted.element);
        await userEvent.type(control(mounted.element), 'e');
        const managedError = mounted.store.get('$.app.error');
        form.rebase();
        const rebasedDirty = mounted.store.get('$.app.dirty');
        await userEvent.type(control(mounted.element), 'x');
        form.reset();

        // Assert
        expect(locked).toBe(true);
        expect(control(mounted.element).disabled).toBe(false);
        expect(managedError).toBe('');
        expect(rebasedDirty).toBe(false);
        expect(mounted.store.get('$.app.value')).toBe('Joe');
        expect(form.value).toBe('Joe');
    });

    it('should release the connect interface when the field is removed', () => {
        // Arrange
        const { mounted, connected } = mountWithForm('textField', {});
        let live = 1;
        connected[0]?.field.onRelease(() => {
            live -= 1;
        });
        const before = live;

        // Act
        mounted.dispose();

        // Assert
        expect(before).toBe(1);
        expect(live).toBe(0);
    });

    it('should work alone: events and commands still work and nothing is reported', async () => {
        // Arrange
        const mounted = mountComponent('textField', { required: true });
        const change = record(mounted.element, 'change');

        // Act
        await userEvent.type(control(mounted.element), 'a');
        commands(mounted.element).reset();
        commands(mounted.element).validate();

        // Assert
        expect(change).toEqual([{ value: 'a' }, { value: '' }]);
        expect(mounted.store.get('$.app.error')).toBe('required');
    });
});
