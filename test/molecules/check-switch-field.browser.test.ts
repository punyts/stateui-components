import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { NodeState } from '../harness/createMountComponent.js';
import type { FieldConnect } from '../../src/shared/field/field.js';

interface CommandElement extends Element {
    commands: { validate(): void; reset(): void; focus(): void; clear(): void };
}

const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const control = (element: Element): HTMLInputElement => part<HTMLInputElement>(element, 'input');
const commands = (element: Element): CommandElement['commands'] => (element as CommandElement).commands;
const record = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};
const touch = (element: Element): void => {
    control(element).focus();
    control(element).blur();
};

const mountWithForm = (name: string, node: NodeState): { mounted: ReturnType<typeof mountComponent>; field: FieldConnect } => {
    const connected: FieldConnect[] = [];
    const listen = (event: Event): void => {
        connected.push((event as CustomEvent<FieldConnect>).detail);
    };
    document.addEventListener('ui-field-connect', listen);
    try {
        const mounted = mountComponent(name, node);
        return { mounted, field: connected[0] as FieldConnect };
    } finally {
        document.removeEventListener('ui-field-connect', listen);
    }
};

describe.each([
    ['checkField', 'Accept', 'Akzeptieren'],
    ['switchField', 'Active', 'Aktiv']
])('%s in Chromium', (name, english, german) => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render the label tied to the control and follow a state write', () => {
        // Arrange
        const mounted = mountComponent(name, { _label: 'Terms', checked: false });

        // Act
        mounted.store.set('$.app.checked', true);

        // Assert
        expect(control(mounted.element).checked).toBe(true);
        expect(control(mounted.element).id).toBe('control');
        expect(part<HTMLLabelElement>(mounted.element, 'label').textContent).toBe('Terms');
        expect(control(mounted.element).labels?.[0]).toBe(part(mounted.element, 'label'));
    });

    it('should use the English default label and give the switch its role', () => {
        // Arrange
        const mounted = mountComponent(name);

        // Act
        const role = control(mounted.element).getAttribute('role');

        // Assert
        expect(part(mounted.element, 'label').textContent).toBe(english);
        expect(role).toBe(name === 'switchField' ? 'switch' : null);
    });

    it('should write $.data through a <-checked link when toggled and show a data write', async () => {
        // Arrange
        const mounted = mountComponent(name, { '<-checked': '$.data.terms' }, { data: { terms: false } });
        const change = record(mounted.element, 'change');

        // Act
        await userEvent.click(control(mounted.element));
        const written = mounted.store.get('$.data.terms');
        mounted.store.set('$.data.terms', false);

        // Assert
        expect(written).toBe(true);
        expect(control(mounted.element).checked).toBe(false);
        expect(change).toEqual([{ value: true }, { value: false }]);
    });

    it('should toggle when the label is clicked', async () => {
        // Arrange
        const mounted = mountComponent(name);

        // Act
        await userEvent.click(part(mounted.element, 'label'));

        // Assert
        expect(mounted.store.get('$.app.checked')).toBe(true);
    });

    it('should restore the baseline on reset and clear touched, dirty and error', async () => {
        // Arrange
        const mounted = mountComponent(name, { checked: true });
        touch(mounted.element);
        await userEvent.click(control(mounted.element));
        const dirty = mounted.store.get('$.app.dirty');

        // Act
        commands(mounted.element).reset();

        // Assert
        expect(dirty).toBe(true);
        expect(mounted.store.get('$.app.checked')).toBe(true);
        expect(control(mounted.element).checked).toBe(true);
        expect(mounted.store.get('$.app.dirty')).toBe(false);
        expect(mounted.store.get('$.app.touched')).toBe(false);
        expect(mounted.store.get('$.app.error')).toBe('');
    });

    it('should block with required while unchecked, then pass once checked and raise invalid then valid', () => {
        // Arrange
        const mounted = mountComponent(name, { required: true });
        const invalid = record(mounted.element, 'invalid');
        const valid = record(mounted.element, 'valid');

        // Act
        commands(mounted.element).validate();
        const error = mounted.store.get('$.app.error');
        const shown = part(mounted.element, '.error')?.textContent;
        const described = control(mounted.element).getAttribute('aria-describedby');
        mounted.store.set('$.app.checked', true);
        commands(mounted.element).validate();

        // Assert
        expect(error).toBe('required');
        expect(shown).toBe('This field is required');
        expect(described).toBe('error');
        expect(control(mounted.element).getAttribute('aria-required')).toBe('true');
        expect(invalid).toEqual([{ rule: 'required' }]);
        expect(valid).toEqual([{ value: true }]);
        expect(mounted.store.get('$.app.error')).toBe('');
        expect(part(mounted.element, '.error')).toBeNull();
    });

    it('should validate itself on change once touched', async () => {
        // Arrange
        const mounted = mountComponent(name, { required: true, checked: true });
        touch(mounted.element);

        // Act
        await userEvent.click(control(mounted.element));

        // Assert
        expect(mounted.store.get('$.app.error')).toBe('required');
    });

    it('should clear to false, write data and clear error', () => {
        // Arrange
        const mounted = mountComponent(name, { '<-checked': '$.data.terms', required: true }, { data: { terms: true } });
        mounted.store.set('$.data.terms', true);
        mounted.store.set('$.app.error', 'required');

        // Act
        commands(mounted.element).clear();

        // Assert
        expect(mounted.store.get('$.data.terms')).toBe(false);
        expect(control(mounted.element).checked).toBe(false);
        expect(mounted.store.get('$.app.error')).toBe('');
    });

    it('should move focus to the control on the focus command', () => {
        // Arrange
        const mounted = mountComponent(name);

        // Act
        commands(mounted.element).focus();

        // Assert
        expect(mounted.element.shadowRoot?.activeElement).toBe(control(mounted.element));
    });

    it('should disable the control for disabled and keep a readonly one unchanged', async () => {
        // Arrange
        const disabled = mountComponent(name, { disabled: true });
        const readonly = mountComponent(name, { readonly: true });

        // Act
        await userEvent.click(control(readonly.element));

        // Assert
        expect(control(disabled.element).disabled).toBe(true);
        expect(readonly.store.get('$.app.checked')).toBe(false);
        expect(control(readonly.element).checked).toBe(false);
    });

    it('should let a form disable the control and reset it', () => {
        // Arrange
        const { mounted, field } = mountWithForm(name, { checked: true });

        // Act
        field.setDisabled(true);
        const locked = control(mounted.element).disabled;
        field.setDisabled(false);
        mounted.store.set('$.app.checked', false);
        const value = field.value;
        field.reset();

        // Assert
        expect(locked).toBe(true);
        expect(control(mounted.element).disabled).toBe(false);
        expect(value).toBe(false);
        expect(field.value).toBe(true);
        expect(field.element.localName).toBe(name === 'checkField' ? 'ui-check-field' : 'ui-switch-field');
    });

    it('should change the control size with size', () => {
        // Arrange
        const mounted = mountComponent(name, { size: 'sm' });
        const small = control(mounted.element).getBoundingClientRect().height;

        // Act
        mounted.store.set('$.app.size', 'lg');

        // Assert
        expect(control(mounted.element).getBoundingClientRect().height).toBeGreaterThan(small);
    });

    it('should shrink the spacing with density compact', () => {
        // Arrange
        const mounted = mountComponent(name, { _help: 'Hint' });
        const gap = (): number => parseFloat(getComputedStyle(part(mounted.element, '.field')).rowGap);
        const normal = gap();

        // Act
        mounted.store.set('$.app.density', 'compact');

        // Assert
        expect(normal).toBe(4);
        expect(gap()).toBeLessThan(normal);
    });

    it('should put the control beside its label', () => {
        // Arrange
        const mounted = mountComponent(name);

        // Act
        const box = control(mounted.element).getBoundingClientRect();
        const label = part(mounted.element, 'label').getBoundingClientRect();

        // Assert
        expect(box.right).toBeLessThanOrEqual(label.left);
    });

    it('should show the German label and error after switching language', () => {
        // Arrange
        const mounted = mountComponent(name);
        mounted.store.set('$.app.error', 'required');

        // Act
        mounted.setLocale('de');

        // Assert
        expect(part(mounted.element, 'label').textContent).toBe(german);
        expect(part(mounted.element, '.error')?.textContent).toBe('Dieses Feld ist erforderlich');
    });

    it('should keep a label the author wrote when the language changes', () => {
        // Arrange
        const mounted = mountComponent(name, { _label: 'Terms' });

        // Act
        mounted.setLocale('de');

        // Assert
        expect(part(mounted.element, 'label').textContent).toBe('Terms');
    });
});
