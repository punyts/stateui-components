import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

interface CommandElement extends Element {
    commands: { validate(): void; reset(): void; clear(): void; focus(): void };
}

const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const control = (element: Element): HTMLElement => part<HTMLElement>(element, '#control');
const stars = (element: Element): HTMLElement[] => Array.from(element.shadowRoot?.querySelectorAll<HTMLElement>('.star') ?? []);
const lit = (element: Element): number => stars(element).filter((star) => star.hasAttribute('data-on')).length;
const commands = (element: Element): CommandElement['commands'] => (element as CommandElement).commands;

const record = (element: Element, name: string): unknown[] => {
    const details: unknown[] = [];
    element.addEventListener(name, (event) => details.push((event as CustomEvent).detail));
    return details;
};

describe('rating in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should draw max stars as one labelled slider with the value and its text', () => {
        // Arrange and Act
        const mounted = mountComponent('rating', { value: 3, _label: 'Service' });
        const slider = control(mounted.element);

        // Assert
        expect(stars(mounted.element)).toHaveLength(5);
        expect(lit(mounted.element)).toBe(3);
        expect(slider.getAttribute('role')).toBe('slider');
        expect(slider.tabIndex).toBe(0);
        expect(part(mounted.element, `#${slider.getAttribute('aria-labelledby')}`).textContent).toBe('Service');
        expect(slider.getAttribute('aria-valuenow')).toBe('3');
        expect(slider.getAttribute('aria-valuemax')).toBe('5');
        expect(slider.getAttribute('aria-valuetext')).toBe('3 of 5 stars');
    });

    it('should follow max and say "Not rated" at 0', () => {
        // Arrange
        const mounted = mountComponent('rating', { max: 10 });

        // Assert
        expect(stars(mounted.element)).toHaveLength(10);
        expect(control(mounted.element).getAttribute('aria-valuetext')).toBe('Not rated');
    });

    it('should step with the arrows, go to 0 on Home and to max on End, raising change and writing data', async () => {
        // Arrange
        const mounted = mountComponent('rating', { '<-value': '$.data.score' }, { data: { score: 2 } });
        const changes = record(mounted.element, 'change');
        commands(mounted.element).focus();

        // Act
        await userEvent.keyboard('{ArrowRight}');
        await userEvent.keyboard('{ArrowUp}');
        await userEvent.keyboard('{ArrowLeft}');
        await userEvent.keyboard('{End}');
        const end = mounted.store.get('$.data.score');
        await userEvent.keyboard('{Home}');

        // Assert
        expect(end).toBe(5);
        expect(mounted.store.get('$.data.score')).toBe(0);
        expect(changes).toEqual([{ value: 3 }, { value: 4 }, { value: 3 }, { value: 5 }, { value: 0 }]);
        expect(lit(mounted.element)).toBe(0);
    });

    it('should swap Left and Right in right-to-left text', async () => {
        // Arrange
        const mounted = mountComponent('rating', { value: 2 });
        mounted.element.setAttribute('dir', 'rtl');
        commands(mounted.element).focus();

        // Act
        await userEvent.keyboard('{ArrowLeft}');

        // Assert
        expect(mounted.store.get('$.app.value')).toBe(3);
    });

    it('should set the rating of the pressed star and preview the star under the pointer', async () => {
        // Arrange
        const mounted = mountComponent('rating', {});
        const fourth = stars(mounted.element)[3] as HTMLElement;

        // Act
        await userEvent.hover(fourth);
        const preview = lit(mounted.element);
        const previewing = control(mounted.element).hasAttribute('data-preview');
        await userEvent.click(stars(mounted.element)[1] as HTMLElement);
        await userEvent.unhover(control(mounted.element));

        // Assert
        expect(preview).toBe(4);
        expect(previewing).toBe(true);
        expect(mounted.store.get('$.app.value')).toBe(2);
        expect(mounted.store.get('$.app.preview')).toBe(0);
        expect(lit(mounted.element)).toBe(2);
    });

    it('should show the rating and take no input when readonly', async () => {
        // Arrange
        const mounted = mountComponent('rating', { value: 4, readonly: true });
        commands(mounted.element).focus();

        // Act
        await userEvent.keyboard('{ArrowLeft}');
        await userEvent.click(stars(mounted.element)[0] as HTMLElement);

        // Assert
        expect(control(mounted.element).getAttribute('aria-readonly')).toBe('true');
        expect(mounted.store.get('$.app.value')).toBe(4);
        expect(lit(mounted.element)).toBe(4);
    });

    it('should leave the tab order and ignore keys and presses when disabled', async () => {
        // Arrange
        const mounted = mountComponent('rating', { value: 1, disabled: true });
        const changes = record(mounted.element, 'change');
        control(mounted.element).focus();

        // Act
        await userEvent.keyboard('{End}');
        await userEvent.click(stars(mounted.element)[4] as HTMLElement);

        // Assert
        expect(control(mounted.element).tabIndex).toBe(-1);
        expect(control(mounted.element).getAttribute('aria-disabled')).toBe('true');
        expect(mounted.store.get('$.app.value')).toBe(1);
        expect(changes).toEqual([]);
    });

    it('should fail required at 0, pass once rated and set 0 on clear', () => {
        // Arrange
        const mounted = mountComponent('rating', { required: true });

        // Act
        commands(mounted.element).validate();
        const empty = mounted.store.get('$.app.error');
        const message = part(mounted.element, '.error')?.textContent;
        mounted.store.set('$.app.value', 4);
        commands(mounted.element).validate();
        const rated = mounted.store.get('$.app.error');
        commands(mounted.element).clear();

        // Assert
        expect(empty).toBe('required');
        expect(message).toBe('Choose a rating');
        expect(rated).toBe('');
        expect(mounted.store.get('$.app.value')).toBe(0);
    });

    it('should take part in a form: the form validates it and counts its error', () => {
        // Arrange
        const mounted = mountComponent('form', { children: { score: { component: 'rating', required: true } } });
        const form = mounted.element as Element & { commands: Record<string, () => void> };

        // Act
        form.commands['validate']?.();
        const failed = mounted.store.get('$.app.errorCount');
        mounted.store.set('$.app.children.score.value', 4);
        form.commands['validate']?.();

        // Assert
        expect(failed).toBe(1);
        expect(mounted.store.get('$.app.children.score.error')).toBe('');
        expect(mounted.store.get('$.app.errorCount')).toBe(0);
    });

    it('should speak German after switching language', () => {
        // Arrange
        const mounted = mountComponent('rating', { value: 2 });

        // Act
        mounted.setLocale('de');

        // Assert
        expect(part(mounted.element, '.label').textContent).toBe('Bewertung');
        expect(control(mounted.element).getAttribute('aria-valuetext')).toBe('2 von 5 Sternen');
    });
});
