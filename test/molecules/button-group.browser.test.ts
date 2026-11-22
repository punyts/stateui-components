import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;
const part = <T extends HTMLElement>(element: Element, selector: string): T => root(element).querySelector(selector) as T;
const all = (element: Element, selector: string): HTMLButtonElement[] => Array.from(root(element).querySelectorAll<HTMLButtonElement>(selector));
const shown = (element: Element, selector: string): string[] => all(element, selector).filter((button) => !button.hidden).map((button) => button.textContent?.trim() ?? '');
const isOpen = (element: Element): boolean => part(element, '.menu').matches(':popover-open');
const active = (element: Element): string | undefined => root(element).activeElement?.textContent?.trim();

const actions = {
    save: { _label: 'Save', icon: 'check' },
    saveAs: { _label: 'Save as copy' },
    saveDraft: { _label: 'Save as draft' },
    discard: { _label: 'Discard', disabled: true }
};

describe('buttonGroup in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should join its actions into one group and raise action with a key', async () => {
        // Arrange
        const mounted = mountComponent('buttonGroup', { actions: { day: { _label: 'Day' }, week: { _label: 'Week' }, month: { _label: 'Month' } }, _label: 'Range' });
        const raised: unknown[] = [];
        mounted.element.addEventListener('action', (event) => raised.push((event as CustomEvent).detail));
        await flush();
        const [day, week, month] = all(mounted.element, '.action');

        // Act
        week?.click();

        // Assert
        expect(part(mounted.element, '.group').getAttribute('aria-label')).toBe('Range');
        expect(shown(mounted.element, '.action')).toEqual(['Day', 'Week', 'Month']);
        expect(part(mounted.element, '.more')).toBeNull();
        expect(raised).toEqual(['week']);
        expect(Math.round((week as HTMLElement).getBoundingClientRect().left)).toBe(Math.round((day as HTMLElement).getBoundingClientRect().right - 1));
        expect(getComputedStyle(day as HTMLElement).borderStartEndRadius).toBe('0px');
        expect(getComputedStyle(month as HTMLElement).borderStartEndRadius).not.toBe('0px');
    });

    it('should show only the first action with a chevron in a split button, and the rest in its menu', async () => {
        // Arrange
        const mounted = mountComponent('buttonGroup', { actions, split: true });
        await flush();

        // Act
        await userEvent.click(part(mounted.element, '.more'));
        await flush();

        // Assert
        expect(shown(mounted.element, '.action')).toEqual(['Save']);
        expect(part(mounted.element, '.more').getAttribute('aria-expanded')).toBe('true');
        expect(isOpen(mounted.element)).toBe(true);
        expect(shown(mounted.element, '.item')).toEqual(['Save as copy', 'Save as draft', 'Discard']);
        expect(active(mounted.element)).toBe('Save as copy');
        expect(getComputedStyle(all(mounted.element, '.action')[0] as HTMLElement).borderStartEndRadius).toBe('0px');
    });

    it('should move through the menu with the arrows, skip disabled items and raise action for a choice', async () => {
        // Arrange
        const mounted = mountComponent('buttonGroup', { actions, split: true });
        const raised: unknown[] = [];
        mounted.element.addEventListener('action', (event) => raised.push((event as CustomEvent).detail));
        await flush();
        part(mounted.element, '.more').focus();

        // Act
        await userEvent.keyboard('{ArrowUp}');
        await flush();
        const opened = active(mounted.element);
        await userEvent.keyboard('{ArrowUp}');
        const moved = active(mounted.element);
        await userEvent.keyboard('{Enter}');
        await flush();

        // Assert
        expect(opened).toBe('Save as draft');
        expect(moved).toBe('Save as copy');
        expect(raised).toEqual(['saveAs']);
        expect(isOpen(mounted.element)).toBe(false);
        expect(root(mounted.element).activeElement).toBe(part(mounted.element, '.more'));
    });

    it('should close the menu on Escape and return the focus to the chevron', async () => {
        // Arrange
        const mounted = mountComponent('buttonGroup', { actions, split: true });
        await flush();
        await userEvent.click(part(mounted.element, '.more'));
        await flush();

        // Act
        await userEvent.keyboard('{Escape}');
        await flush();

        // Assert
        expect(isOpen(mounted.element)).toBe(false);
        expect(mounted.store.get('$.app.open')).toBe(false);
        expect(root(mounted.element).activeElement).toBe(part(mounted.element, '.more'));
    });

    it('should name the chevron in German after switching language', async () => {
        // Arrange
        const mounted = mountComponent('buttonGroup', { actions, split: true });

        // Act
        mounted.setLocale('de');
        await flush();

        // Assert
        expect(part(mounted.element, '.more').getAttribute('aria-label')).toBe('Weitere Aktionen');
    });
});
