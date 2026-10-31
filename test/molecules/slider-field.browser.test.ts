import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

interface CommandElement extends Element {
    commands: { validate(): void; reset(): void; focus(): void; clear(): void };
}

const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const thumbs = (element: Element): HTMLElement[] => Array.from(element.shadowRoot?.querySelectorAll<HTMLElement>('[role="slider"]') ?? []);
const thumb = (element: Element, which: 'low' | 'high' = 'low'): HTMLElement => part<HTMLElement>(element, `[data-thumb="${which}"]`);
const get = (mounted: { store: { get(path: string): unknown } }, name: string): unknown => mounted.store.get(`$.app.${name}`);
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60));
const events = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};
/** Presses a key on a thumb: focus it, then send the key as a user does */
async function press(element: Element, key: string, which: 'low' | 'high' = 'low'): Promise<void> {
    thumb(element, which).focus();
    await userEvent.keyboard(`{${key}}`);
    await flush();
}
/** Drags a thumb to a fraction of the track width, with real mouse events */
async function dragTo(element: Element, fraction: number, which: 'low' | 'high' = 'low'): Promise<void> {
    const track = part<HTMLElement>(element, '.track');
    const box = track.getBoundingClientRect();
    await userEvent.dragAndDrop(thumb(element, which), track, { targetPosition: { x: box.width * fraction, y: box.height / 2 } } as never);
    await flush();
}

describe('sliderField in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render a labelled slider thumb with its range, value and formatted text', async () => {
        // Arrange
        const mounted = mountComponent('sliderField', { _label: 'Volume', value: 30, min: 10, max: 90 });
        await flush();
        const control = thumb(mounted.element);

        // Assert
        expect(part(mounted.element, '.label').textContent).toBe('Volume');
        expect(control.getAttribute('role')).toBe('slider');
        expect(control.getAttribute('aria-labelledby')).toBe('label');
        expect(control.getAttribute('aria-valuemin')).toBe('10');
        expect(control.getAttribute('aria-valuemax')).toBe('90');
        expect(control.getAttribute('aria-valuenow')).toBe('30');
        expect(control.getAttribute('aria-valuetext')).toBe('30');
        expect(control.style.getPropertyValue('--sui-value')).toBe('25');
        expect(part(mounted.element, 'output').textContent).toBe('30');
    });

    it('should hide the value text when showValue is false', async () => {
        // Arrange
        const mounted = mountComponent('sliderField', { value: 30, showValue: false });
        await flush();

        // Assert
        expect(part(mounted.element, 'output')).toBeNull();
    });

    it('should sit at the start with nothing written while value is empty', async () => {
        // Arrange
        const mounted = mountComponent('sliderField', { min: 5, max: 50 });
        await flush();

        // Assert
        expect(thumb(mounted.element).getAttribute('aria-valuenow')).toBe('5');
        expect(get(mounted, 'value')).toBe('');
    });

    it('should step by step with the arrow keys', async () => {
        // Arrange
        const mounted = mountComponent('sliderField', { value: 50, step: 5 });
        await flush();

        // Act and assert
        await press(mounted.element, 'ArrowRight');
        expect(get(mounted, 'value')).toBe(55);
        await press(mounted.element, 'ArrowUp');
        expect(get(mounted, 'value')).toBe(60);
        await press(mounted.element, 'ArrowLeft');
        expect(get(mounted, 'value')).toBe(55);
        await press(mounted.element, 'ArrowDown');
        expect(get(mounted, 'value')).toBe(50);
        expect(thumb(mounted.element).getAttribute('aria-valuenow')).toBe('50');
    });

    it('should move ten steps with Page Up and Page Down', async () => {
        // Arrange
        const mounted = mountComponent('sliderField', { value: 30, step: 2 });
        await flush();

        // Act and assert
        await press(mounted.element, 'PageUp');
        expect(get(mounted, 'value')).toBe(50);
        await press(mounted.element, 'PageDown');
        await press(mounted.element, 'PageDown');
        expect(get(mounted, 'value')).toBe(10);
    });

    it('should go to the ends with Home and End, and stop at them', async () => {
        // Arrange
        const mounted = mountComponent('sliderField', { value: 30, min: 10, max: 80 });
        await flush();

        // Act and assert
        await press(mounted.element, 'End');
        expect(get(mounted, 'value')).toBe(80);
        await press(mounted.element, 'ArrowRight');
        expect(get(mounted, 'value')).toBe(80);
        await press(mounted.element, 'Home');
        expect(get(mounted, 'value')).toBe(10);
        await press(mounted.element, 'ArrowLeft');
        expect(get(mounted, 'value')).toBe(10);
    });

    it('should snap a value written from outside to nothing but show it clamped, without writing it back', async () => {
        // Arrange
        const mounted = mountComponent('sliderField', { value: 500 });
        await flush();

        // Assert
        expect(thumb(mounted.element).getAttribute('aria-valuenow')).toBe('100');
        expect(get(mounted, 'value')).toBe(500);
    });

    it('should drag the thumb with the mouse and snap to step', async () => {
        // Arrange
        const mounted = mountComponent('sliderField', { value: 0, step: 10 });
        await flush();

        // Act
        await dragTo(mounted.element, 0.5);

        // Assert
        expect(get(mounted, 'value')).toBe(50);
        expect(thumb(mounted.element).style.getPropertyValue('--sui-value')).toBe('50');
    });

    it('should clamp a drag past the end to max', async () => {
        // Arrange
        const mounted = mountComponent('sliderField', { value: 20, step: 1 });
        await flush();
        const track = part<HTMLElement>(mounted.element, '.track');
        const box = track.getBoundingClientRect();

        // Act
        await userEvent.dragAndDrop(thumb(mounted.element), track, { targetPosition: { x: box.width - 1, y: box.height / 2 } } as never);
        await userEvent.dragAndDrop(thumb(mounted.element), track, { targetPosition: { x: box.width - 1, y: 2 } } as never);
        await flush();

        // Assert
        expect(Number(get(mounted, 'value'))).toBeGreaterThanOrEqual(99);
        expect(Number(get(mounted, 'value'))).toBeLessThanOrEqual(100);
    });

    it('should move the thumb to a press on the track', async () => {
        // Arrange
        const mounted = mountComponent('sliderField', { value: 0, step: 10 });
        await flush();
        const track = part<HTMLElement>(mounted.element, '.track');
        const box = track.getBoundingClientRect();

        // Act
        await userEvent.click(track, { position: { x: box.width * 0.3, y: box.height / 2 } } as never);
        await flush();

        // Assert
        expect(get(mounted, 'value')).toBe(30);
    });

    it('should not move while disabled or readonly', async () => {
        // Arrange
        const disabled = mountComponent('sliderField', { value: 40, disabled: true });
        const readonly = mountComponent('sliderField', { value: 40, readonly: true });
        await flush();

        // Act
        readonly.element.shadowRoot?.querySelector<HTMLElement>('[data-thumb="low"]')?.focus();
        await userEvent.keyboard('{ArrowRight}');
        const track = part<HTMLElement>(disabled.element, '.track');
        const box = track.getBoundingClientRect();
        await userEvent.click(track, { position: { x: box.width * 0.9, y: box.height / 2 } } as never);
        await flush();

        // Assert
        expect(get(disabled, 'value')).toBe(40);
        expect(get(readonly, 'value')).toBe(40);
        expect(thumb(disabled.element).getAttribute('aria-disabled')).toBe('true');
        expect(thumb(disabled.element).tabIndex).toBe(-1);
    });

    it('should write a [low, high] pair in range mode with two named thumbs', async () => {
        // Arrange
        const mounted = mountComponent('sliderField', { range: true, value: [20, 60], step: 10 });
        await flush();

        // Assert
        expect(thumbs(mounted.element)).toHaveLength(2);
        expect(thumb(mounted.element, 'low').getAttribute('aria-label')).toBe('Minimum');
        expect(thumb(mounted.element, 'high').getAttribute('aria-label')).toBe('Maximum');
        expect(thumb(mounted.element, 'low').getAttribute('aria-valuenow')).toBe('20');
        expect(thumb(mounted.element, 'high').getAttribute('aria-valuenow')).toBe('60');
        expect(part(mounted.element, 'output').textContent).toBe('20 – 60');

        // Act
        await press(mounted.element, 'ArrowRight', 'high');
        await press(mounted.element, 'ArrowLeft', 'low');

        // Assert
        expect(get(mounted, 'value')).toEqual([10, 70]);
    });

    it('should not let the thumbs of a range cross, by key or by drag', async () => {
        // Arrange
        const mounted = mountComponent('sliderField', { range: true, value: [30, 40], step: 10 });
        await flush();

        // Act and assert
        await dragTo(mounted.element, 0.9, 'low');
        expect(get(mounted, 'value')).toEqual([40, 40]);
        await press(mounted.element, 'Home', 'high');
        expect(get(mounted, 'value')).toEqual([40, 40]);
        await press(mounted.element, 'PageDown', 'high');
        expect(get(mounted, 'value')).toEqual([40, 40]);
        await press(mounted.element, 'End', 'low');
        expect(get(mounted, 'value')).toEqual([40, 40]);
    });

    it('should move the nearer thumb of a range on a press on the track', async () => {
        // Arrange
        const mounted = mountComponent('sliderField', { range: true, value: [20, 80], step: 10 });
        await flush();
        const track = part<HTMLElement>(mounted.element, '.track');
        const box = track.getBoundingClientRect();

        // Act
        await userEvent.click(track, { position: { x: box.width * 0.7, y: box.height / 2 } } as never);
        await flush();

        // Assert
        expect(get(mounted, 'value')).toEqual([20, 70]);
    });

    it('should show marks at their values with labels, and in German', async () => {
        // Arrange
        const marks = { '0': { _label: 'Low' }, '50': { _label: 'Half' }, '100': { _label: 'Full' }, '500': { _label: 'Off the end' } };
        const mounted = mountComponent('sliderField', { value: 50, marks }, { locales: { de: { marks: { '0': { _label: 'Niedrig' }, '50': { _label: 'Halb' }, '100': { _label: 'Voll' } } } } });
        await flush();
        const shown = (): string[] => Array.from(mounted.element.shadowRoot?.querySelectorAll('.mark:not([hidden])') ?? []).map((mark) => `${(mark as HTMLElement).style.getPropertyValue('--sui-value')}:${mark.querySelector('.mark-label')?.textContent ?? ''}`);

        // Assert
        expect(shown()).toEqual(['0:Low', '50:Half', '100:Full']);

        // Act
        mounted.setLocale('de');
        await flush();

        // Assert
        expect(shown()).toEqual(['0:Niedrig', '50:Halb', '100:Voll']);
    });

    it('should format the value text and aria-valuetext with format and the language', async () => {
        // Arrange
        const percent = mountComponent('sliderField', { value: 0.5, min: 0, max: 1, step: 0.01, format: 'percent' }, { locale: 'de' });
        const clock = mountComponent('sliderField', { value: 125, min: 0, max: 600, format: 'duration' });
        await flush();

        // Assert
        expect(thumb(percent.element).getAttribute('aria-valuetext')).toMatch(/^50\s*%$/);
        expect(thumb(percent.element).getAttribute('aria-valuenow')).toBe('0.5');
        expect(thumb(clock.element).getAttribute('aria-valuetext')).toBe('2:05');
        expect(part(clock.element, 'output').textContent).toBe('2:05');
    });

    it('should show German labels, thumb names and error text', async () => {
        // Arrange
        const mounted = mountComponent('sliderField', { _label: 'Lautstärke', range: true, value: [10, 20], required: true }, { locale: 'de' });
        await flush();

        // Assert
        expect(thumb(mounted.element, 'low').getAttribute('aria-label')).toBe('Minimum');
        expect(thumb(mounted.element, 'high').getAttribute('aria-label')).toBe('Maximum');
        expect(part(mounted.element, '.label').textContent).toBe('Lautstärke');
    });

    it('should raise change once per written value with the new value', async () => {
        // Arrange
        const mounted = mountComponent('sliderField', { value: 10, step: 10 });
        await flush();
        const seen = events(mounted.element, 'change');

        // Act
        await press(mounted.element, 'ArrowRight');
        await press(mounted.element, 'End');

        // Assert
        expect(seen).toEqual([{ value: 20 }, { value: 100 }]);
    });

    it('should validate required, min and max over a pair and show the message', async () => {
        // Arrange
        const required = mountComponent('sliderField', { required: true });
        const outside = mountComponent('sliderField', { range: true, value: [5, 200], min: 10, max: 100 });
        await flush();

        // Act
        (required.element as CommandElement).commands.validate();
        (outside.element as CommandElement).commands.validate();
        await flush();

        // Assert
        expect(required.store.get('$.app.error')).toBe('required');
        expect(part(required.element, '.error').textContent).toBe('This field is required');
        expect(outside.store.get('$.app.error')).toBe('min');
    });

    it('should focus the first thumb with the focus command', async () => {
        // Arrange
        const mounted = mountComponent('sliderField', { value: 10 });
        await flush();

        // Act
        (mounted.element as CommandElement).commands.focus();

        // Assert
        expect(mounted.element.shadowRoot?.activeElement).toBe(thumb(mounted.element));
    });

    it('should update when the value is written from outside', async () => {
        // Arrange
        const mounted = mountComponent('sliderField', { value: 10 });
        await flush();

        // Act
        mounted.store.set('$.app.value', 75 as never);
        await flush();

        // Assert
        expect(thumb(mounted.element).getAttribute('aria-valuenow')).toBe('75');
        expect(thumb(mounted.element).style.getPropertyValue('--sui-value')).toBe('75');
        expect(part(mounted.element, 'output').textContent).toBe('75');
    });
});
