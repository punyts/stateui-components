import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const all = <T extends HTMLElement = HTMLElement>(element: Element, selector: string): T[] => Array.from(element.shadowRoot?.querySelectorAll<T>(selector) ?? []);
const part = <T extends HTMLElement = HTMLElement>(element: Element, selector: string): T | null => element.shadowRoot?.querySelector<T>(selector) ?? null;
const buttons = (element: Element): HTMLButtonElement[] => all<HTMLButtonElement>(element, '.button');
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const command = (element: Element, name: string, value?: unknown): void => {
    (element as Element & { commands: Record<string, (value?: unknown) => void> }).commands[name]?.(value);
};
const selects = (element: Element): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener('select', (event) => seen.push((event as CustomEvent).detail));
    return seen;
};
/** What each marker shows: the number, or `check` for a completed step */
const markers = (element: Element): string[] => all(element, '.marker').map((marker) => (marker.querySelector('ui-icon') ? 'check' : (marker.textContent?.trim() ?? '')));

const steps = {
    details: { _label: 'Details', _description: 'Who you are' },
    options: { _label: 'Options' },
    review: { _label: 'Review' }
};

describe('stepper in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render an ordered list named by its label with a step per key in order', async () => {
        // Arrange
        const mounted = mountComponent('stepper', { _label: 'Checkout', steps });
        await flush();

        // Assert
        expect(part(mounted.element, 'ol')?.getAttribute('aria-label')).toBe('Checkout');
        expect(all(mounted.element, 'ol > li')).toHaveLength(3);
        expect(all(mounted.element, '.label').map((label) => label.textContent)).toEqual(['Details', 'Options', 'Review']);
        expect(part(mounted.element, '.description')?.textContent).toBe('Who you are');
        expect(markers(mounted.element)).toEqual(['1', '2', '3']);
    });

    it('should show the key for a step with no label', async () => {
        // Arrange
        const mounted = mountComponent('stepper', { steps: { one: {}, two: {} } });
        await flush();

        // Assert
        expect(all(mounted.element, '.label').map((label) => label.textContent)).toEqual(['one', 'two']);
    });

    it('should mark the first step current by default and the named one when active is set', async () => {
        // Arrange
        const first = mountComponent('stepper', { steps });
        const named = mountComponent('stepper', { steps, active: 'options', linear: false });
        await flush();
        const current = (element: Element): string[] => all(element, '[aria-current="step"] .label').map((label) => label.textContent ?? '');

        // Assert
        expect(current(first.element)).toEqual(['Details']);
        expect(current(named.element)).toEqual(['Options']);
        expect(all(named.element, 'li[aria-current]')).toHaveLength(1);
    });

    it('should mark no step current when active names no step, and keep completed steps done', async () => {
        // Arrange
        const mounted = mountComponent('stepper', { steps, active: 'Cancelled', completed: ['details'] });
        await flush();

        // Assert
        expect(all(mounted.element, 'li[aria-current]')).toHaveLength(0);
        expect(all(mounted.element, 'li[data-current]')).toHaveLength(0);
        expect(all(mounted.element, 'li[data-done]')).toHaveLength(1);
    });

    it('should block every step after the first incomplete one while linear', async () => {
        // Arrange
        const mounted = mountComponent('stepper', { steps });
        await flush();

        // Assert
        expect(buttons(mounted.element).map((button) => button.disabled)).toEqual([false, true, true]);
    });

    it('should not select a blocked step and should select an open one, writing active and raising select', async () => {
        // Arrange
        const mounted = mountComponent('stepper', { steps, completed: ['details'] });
        await flush();
        const seen = selects(mounted.element);

        // Act
        await userEvent.click(buttons(mounted.element)[1] as HTMLElement);
        await flush();
        buttons(mounted.element)[2]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await flush();

        // Assert
        expect(mounted.store.get('$.app.active')).toBe('options');
        expect(seen).toEqual(['options']);
        expect(part(mounted.element, '[aria-current="step"] .label')?.textContent).toBe('Options');
    });

    it('should neither write nor raise anything for a press on the active step', async () => {
        // Arrange
        const mounted = mountComponent('stepper', { steps });
        await flush();
        const seen = selects(mounted.element);

        // Act
        await userEvent.click(buttons(mounted.element)[0] as HTMLElement);

        // Assert
        expect(seen).toEqual([]);
        expect(mounted.store.get('$.app.active')).toBe('');
    });

    it('should show a check for a completed step and its number otherwise', async () => {
        // Arrange
        const mounted = mountComponent('stepper', { steps, completed: ['details'] });
        await flush();

        // Assert
        expect(markers(mounted.element)).toEqual(['check', '2', '3']);
        expect(all(mounted.element, '.step')[0]?.hasAttribute('data-done')).toBe(true);
        expect(all(mounted.element, '.hidden').map((hidden) => hidden.textContent)).toEqual(['Completed']);
    });

    it('should add a key to completed with the complete command, once, and unblock the next step', async () => {
        // Arrange
        const mounted = mountComponent('stepper', { steps });
        await flush();

        // Act
        command(mounted.element, 'complete', 'details');
        command(mounted.element, 'complete', 'details');
        await flush();

        // Assert
        expect(mounted.store.get('$.app.completed')).toEqual(['details']);
        expect(markers(mounted.element)).toEqual(['check', '2', '3']);
        expect(buttons(mounted.element).map((button) => button.disabled)).toEqual([false, false, true]);

        // Act
        command(mounted.element, 'complete', 'options');
        await flush();

        // Assert
        expect(mounted.store.get('$.app.completed')).toEqual(['details', 'options']);
        expect(buttons(mounted.element).map((button) => button.disabled)).toEqual([false, false, false]);
    });

    it('should refuse a complete for a key that is not a step', async () => {
        // Arrange
        const mounted = mountComponent('stepper', { steps });
        await flush();

        // Assert
        expect(() => command(mounted.element, 'complete', 'nope')).toThrow(/no step has the key "nope"/);
        expect(mounted.store.get('$.app.completed')).toEqual([]);
    });

    it('should follow a completed list and an active key written from outside', async () => {
        // Arrange
        const mounted = mountComponent('stepper', { steps });
        await flush();

        // Act
        mounted.store.set('$.app.completed', ['details', 'options'] as never);
        mounted.store.set('$.app.active', 'review' as never);
        await flush();

        // Assert
        expect(markers(mounted.element)).toEqual(['check', 'check', '3']);
        expect(part(mounted.element, '[aria-current="step"] .label')?.textContent).toBe('Review');
    });

    it('should let every step be selected when not linear', async () => {
        // Arrange
        const mounted = mountComponent('stepper', { steps, linear: false });
        await flush();
        const seen = selects(mounted.element);

        // Act
        await userEvent.click(buttons(mounted.element)[2] as HTMLElement);

        // Assert
        expect(buttons(mounted.element).every((button) => !button.disabled)).toBe(true);
        expect(seen).toEqual(['review']);
    });

    it('should lay the steps out in a row by default and in a column when vertical', async () => {
        // Arrange
        const horizontal = mountComponent('stepper', { steps });
        const vertical = mountComponent('stepper', { steps, orientation: 'vertical' });
        await flush();
        const tops = (element: Element): number[] => all(element, '.step').map((step) => Math.round(step.getBoundingClientRect().top));
        const lefts = (element: Element): number[] => all(element, '.step').map((step) => Math.round(step.getBoundingClientRect().left));

        // Assert
        expect(horizontal.element.getAttribute('orientation')).toBe('horizontal');
        expect(new Set(tops(horizontal.element)).size).toBe(1);
        expect(new Set(lefts(horizontal.element)).size).toBe(3);
        expect(vertical.element.getAttribute('orientation')).toBe('vertical');
        expect(new Set(lefts(vertical.element)).size).toBe(1);
        expect(new Set(tops(vertical.element)).size).toBe(3);
    });

    it('should show German labels, descriptions and the completed text', async () => {
        // Arrange
        const mounted = mountComponent(
            'stepper',
            { steps, completed: ['details'] },
            { locales: { de: { steps: { details: { _label: 'Angaben', _description: 'Wer Sie sind' }, options: { _label: 'Optionen' }, review: { _label: 'Prüfen' } } } } }
        );
        await flush();

        // Act
        mounted.setLocale('de');
        await flush();

        // Assert
        expect(all(mounted.element, '.label').map((label) => label.textContent)).toEqual(['Angaben', 'Optionen', 'Prüfen']);
        expect(part(mounted.element, '.description')?.textContent).toBe('Wer Sie sind');
        expect(part(mounted.element, 'ol')?.getAttribute('aria-label')).toBe('Schritte');
        expect(part(mounted.element, '.hidden')?.textContent).toBe('Abgeschlossen');
    });
});
