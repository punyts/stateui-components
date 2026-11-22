import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

interface CommandElement extends Element {
    commands: { validate(): void; reset(): void; clear(): void; focus(): void };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const control = (element: Element): HTMLInputElement => part<HTMLInputElement>(element, 'input');
const commands = (element: Element): CommandElement['commands'] => (element as CommandElement).commands;

/** Types a wall clock into the control as the browser reports it: the value, then an input event */
const enter = (element: Element, wall: string): void => {
    const input = control(element);
    input.value = wall;
    input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('dateTimeField in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should show a value in the wall clock of its time zone and name the zone', () => {
        // Arrange and Act
        const mounted = mountComponent('dateTimeField', { value: '2026-11-21T13:30:00Z', timeZone: 'Europe/Berlin', _label: 'Starts' });

        // Assert
        expect(control(mounted.element).type).toBe('datetime-local');
        expect(control(mounted.element).value).toBe('2026-11-21T14:30');
        expect(control(mounted.element).labels?.[0]?.textContent).toBe('Starts');
        expect(part(mounted.element, '.zone').textContent).toBe('Europe/Berlin (GMT+1)');
        expect(control(mounted.element).getAttribute('aria-describedby')).toBe('zone');
    });

    it('should write what is typed as an ISO date-time with the zone offset', async () => {
        // Arrange
        const mounted = mountComponent('dateTimeField', { '<-value': '$.data.start', timeZone: 'America/New_York' }, { data: { start: '' } });

        // Act
        enter(mounted.element, '2026-07-04T09:15');
        await flush();

        // Assert
        expect(mounted.store.get('$.data.start')).toBe('2026-07-04T09:15:00-04:00');
    });

    it('should keep the instant and show it anew when the zone changes', async () => {
        // Arrange
        const mounted = mountComponent('dateTimeField', { value: '2026-11-21T14:30:00+01:00', timeZone: 'Europe/Berlin' });

        // Act
        mounted.store.set('$.app.timeZone', 'Asia/Tokyo');
        await flush();

        // Assert
        expect(control(mounted.element).value).toBe('2026-11-21T22:30');
        expect(mounted.store.get('$.app.value')).toBe('2026-11-21T14:30:00+01:00');
    });

    it('should compare min and max as instants and show them in the zone', () => {
        // Arrange
        const mounted = mountComponent('dateTimeField', { value: '2026-11-21T08:00:00+01:00', timeZone: 'Europe/Berlin', min: '2026-11-21T08:00:00Z' });

        // Act
        commands(mounted.element).validate();

        // Assert
        expect(mounted.store.get('$.app.error')).toBe('min');
        expect(control(mounted.element).min).toBe('2026-11-21T09:00');
        expect(part(mounted.element, '.error').textContent).toBe('Too early');
    });

    it('should report a value without an offset as invalid and an empty required one as required', () => {
        // Arrange
        const loose = mountComponent('dateTimeField', { value: '2026-11-21T08:00', timeZone: 'UTC' });
        const empty = mountComponent('dateTimeField', { required: true, timeZone: 'UTC' });

        // Act
        commands(loose.element).validate();
        commands(empty.element).validate();

        // Assert
        expect(loose.store.get('$.app.error')).toBe('invalid');
        expect(empty.store.get('$.app.error')).toBe('required');
    });
});
