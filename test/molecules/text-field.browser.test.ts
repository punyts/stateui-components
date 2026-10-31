import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const control = (element: Element): HTMLInputElement => part<HTMLInputElement>(element, 'input');
const rect = (element: Element): DOMRect => element.getBoundingClientRect();

describe('textField in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render the properties and follow a state write', () => {
        // Arrange
        const mounted = mountComponent('textField', { _label: 'Customer', value: 'Jo', inputType: 'email', _placeholder: 'Name' });

        // Act
        mounted.store.set('$.app.value', 'Jane');

        // Assert
        const input = control(mounted.element);
        expect(input.value).toBe('Jane');
        expect(input.type).toBe('email');
        expect(input.placeholder).toBe('Name');
        expect(part(mounted.element, 'label').textContent).toBe('Customer');
    });

    it('should write $.data.order.customer through a <-value link when the user types', async () => {
        // Arrange
        const mounted = mountComponent('textField', { '<-value': '$.data.order.customer' }, { data: { order: { customer: '' } } });

        // Act
        await userEvent.type(control(mounted.element), 'Ada');

        // Assert
        expect(mounted.store.get('$.data.order.customer')).toBe('Ada');
    });

    it('should show a data write in the input', () => {
        // Arrange
        const mounted = mountComponent('textField', { '<-value': '$.data.order.customer' }, { data: { order: { customer: 'One' } } });

        // Act
        mounted.store.set('$.data.order.customer', 'Two');

        // Assert
        expect(control(mounted.element).value).toBe('Two');
    });

    it('should disable and make the input read-only from the properties', () => {
        // Arrange
        const mounted = mountComponent('textField', { disabled: true, readonly: true });

        // Act
        const input = control(mounted.element);

        // Assert
        expect(input.disabled).toBe(true);
        expect(input.readOnly).toBe(true);
    });

    it('should reflect titlePosition as the title-position host attribute', () => {
        // Arrange
        const mounted = mountComponent('textField', { titlePosition: 'left' });

        // Act
        mounted.store.set('$.app.titlePosition', 'inner');

        // Assert
        expect(mounted.element.getAttribute('title-position')).toBe('inner');
    });

    it('should put the label above the control for titlePosition top', () => {
        // Arrange
        const mounted = mountComponent('textField', { titlePosition: 'top' });

        // Act
        const label = rect(part(mounted.element, 'label'));
        const input = rect(control(mounted.element));

        // Assert
        expect(label.bottom).toBeLessThanOrEqual(input.top);
        expect(label.left).toBeCloseTo(input.left, 0);
    });

    it('should put the label beside the control for titlePosition left', () => {
        // Arrange
        const mounted = mountComponent('textField', { titlePosition: 'left' });

        // Act
        const label = rect(part(mounted.element, 'label'));
        const input = rect(control(mounted.element));

        // Assert
        expect(label.right).toBeLessThanOrEqual(input.left);
        expect(label.top).toBeGreaterThanOrEqual(input.top - 1);
        expect(label.bottom).toBeLessThanOrEqual(input.bottom + 1);
    });

    it('should put the label inside the control for titlePosition inner', () => {
        // Arrange
        const mounted = mountComponent('textField', { titlePosition: 'inner' });

        // Act
        const label = rect(part(mounted.element, 'label'));
        const input = rect(control(mounted.element));

        // Assert
        expect(label.top).toBeGreaterThanOrEqual(input.top);
        expect(label.bottom).toBeLessThanOrEqual(input.bottom);
        expect(label.left).toBeGreaterThanOrEqual(input.left);
        expect(label.right).toBeLessThanOrEqual(input.right);
    });

    it('should hide the label visually and keep it as the accessible name for titlePosition hidden', () => {
        // Arrange
        const mounted = mountComponent('textField', { titlePosition: 'hidden', _label: 'Customer' });

        // Act
        const label = part<HTMLLabelElement>(mounted.element, 'label');
        const input = control(mounted.element);

        // Assert
        expect(rect(label).width).toBeLessThanOrEqual(1);
        expect(rect(label).height).toBeLessThanOrEqual(1);
        expect(input.labels?.[0]).toBe(label);
        expect(label.textContent).toBe('Customer');
    });

    it('should fill the row by default and fit the content for width auto', () => {
        // Arrange
        const mounted = mountComponent('textField');
        const filled = rect(part(mounted.element, '.field')).width;

        // Act
        mounted.store.set('$.app.width', 'auto');

        // Assert
        expect(filled).toBeCloseTo(rect(mounted.element).width, 0);
        expect(rect(part(mounted.element, '.field')).width).toBeLessThan(filled);
    });

    it('should be 20ch wide for width 20', () => {
        // Arrange
        const mounted = mountComponent('textField', { width: 20 });
        const field = part<HTMLElement>(mounted.element, '.field');
        const reference = field.appendChild(document.createElement('span'));
        reference.style.cssText = 'position:absolute;inline-size:20ch;block-size:1px';

        // Act
        const expected = rect(reference).width;
        reference.remove();

        // Assert
        expect(expected).toBeGreaterThan(100);
        expect(rect(control(mounted.element)).width).toBeCloseTo(expected, 0);
    });

    it('should shrink the spacing with density compact', () => {
        // Arrange
        const mounted = mountComponent('textField', { _help: 'Hint' });
        const gap = (): number => parseFloat(getComputedStyle(part(mounted.element, '.field')).rowGap);
        const padding = (): number => parseFloat(getComputedStyle(control(mounted.element)).paddingInlineStart);
        const [normalGap, normalPadding] = [gap(), padding()];

        // Act
        mounted.store.set('$.app.density', 'compact');

        // Assert
        expect(normalGap).toBe(4);
        expect(gap()).toBeLessThan(normalGap);
        expect(padding()).toBeLessThan(normalPadding);
    });

    it('should change the control height with size', () => {
        // Arrange
        const mounted = mountComponent('textField', { size: 'sm' });
        const small = rect(control(mounted.element)).height;

        // Act
        mounted.store.set('$.app.size', 'lg');

        // Assert
        expect(rect(control(mounted.element)).height).toBeGreaterThan(small);
    });

    it('should draw the icon inside the control box and make room for it', () => {
        // Arrange
        const mounted = mountComponent('textField', { icon: 'search' });
        const plain = mountComponent('textField');

        // Act
        const icon = part(mounted.element, 'ui-icon');
        const svg = icon.shadowRoot?.querySelector('svg');

        // Assert
        expect(svg).not.toBeNull();
        expect(rect(icon).left).toBeGreaterThanOrEqual(rect(control(mounted.element)).left);
        expect(rect(icon).right).toBeLessThanOrEqual(rect(control(mounted.element)).right);
        expect(parseFloat(getComputedStyle(control(mounted.element)).paddingInlineStart)).toBeGreaterThan(
            parseFloat(getComputedStyle(control(plain.element)).paddingInlineStart)
        );
        expect(part(plain.element, 'ui-icon')).toBeNull();
    });

    it('should remove the icon when the icon is emptied', () => {
        // Arrange
        const mounted = mountComponent('textField', { icon: 'search' });

        // Act
        mounted.store.set('$.app.icon', '');

        // Assert
        expect(part(mounted.element, 'ui-icon')).toBeNull();
    });

    it('should render help only when it is not empty and link it to the control', () => {
        // Arrange
        const mounted = mountComponent('textField');
        const before = part(mounted.element, '.help');

        // Act
        mounted.store.set('$.app._help', 'Use the name on the invoice');

        // Assert
        expect(before).toBeNull();
        expect(part(mounted.element, '.help')?.textContent).toBe('Use the name on the invoice');
        expect(control(mounted.element).getAttribute('aria-describedby')).toBe('help');
    });

    it('should render the error message politely, link it to the control and remove it when cleared', () => {
        // Arrange
        const mounted = mountComponent('textField', { _help: 'Hint' });
        const live = part(mounted.element, '.alert');

        // Act
        mounted.store.set('$.app.error', 'required');
        const shown = part(mounted.element, '.error')?.textContent;
        const described = control(mounted.element).getAttribute('aria-describedby');
        const invalid = control(mounted.element).getAttribute('aria-invalid');
        mounted.store.set('$.app.error', '');

        // Assert
        expect(live.getAttribute('role')).toBe('status');
        expect(live.getAttribute('aria-live')).toBe('polite');
        expect(shown).toBe('This field is required');
        expect(described).toBe('help error');
        expect(invalid).toBe('true');
        expect(part(mounted.element, '.error')).toBeNull();
        expect(control(mounted.element).getAttribute('aria-describedby')).toBe('help');
        expect(control(mounted.element).hasAttribute('aria-invalid')).toBe(false);
    });

    it('should show a message a node overrides for one rule', () => {
        // Arrange
        const mounted = mountComponent('textField', { _errors: { pattern: 'Not a valid code' } });

        // Act
        mounted.store.set('$.app.error', 'pattern');

        // Assert
        expect(part(mounted.element, '.error')?.textContent).toBe('Not a valid code');
    });

    it('should show the German label, placeholder and error after switching language', () => {
        // Arrange
        const mounted = mountComponent('textField');
        mounted.store.set('$.app.error', 'required');

        // Act
        mounted.setLocale('de');

        // Assert
        expect(part(mounted.element, 'label').textContent).toBe('Beschriftung');
        expect(control(mounted.element).placeholder).toBe('Hier eingeben');
        expect(part(mounted.element, '.error')?.textContent).toBe('Dieses Feld ist erforderlich');
    });

    it('should keep a label the author wrote when the language changes', () => {
        // Arrange
        const mounted = mountComponent('textField', { _label: 'Customer' });

        // Act
        mounted.setLocale('de');

        // Assert
        expect(part(mounted.element, 'label').textContent).toBe('Customer');
    });

    it('should change colours in the dark overlay', () => {
        // Arrange
        const mounted = mountComponent('textField', {}, { mode: 'light' });
        const light = getComputedStyle(control(mounted.element)).backgroundColor;

        // Act
        mounted.setTheme('mode', 'dark');

        // Assert
        expect(getComputedStyle(control(mounted.element)).backgroundColor).not.toBe(light);
    });

    it('should use the label gap token and a node override of it', () => {
        // Arrange
        const mounted = mountComponent('textField');
        const field = part(mounted.element, '.field');
        const before = getComputedStyle(field).rowGap;

        // Act
        (mounted.element as HTMLElement).style.setProperty('--ui-field-label-gap', '10px');

        // Assert
        expect(before).toBe('4px');
        expect(getComputedStyle(field).rowGap).toBe('10px');
    });
});
