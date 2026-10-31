import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const input = (element: Element): HTMLInputElement => part<HTMLInputElement>(element, 'input');
const popup = (element: Element): HTMLElement => part<HTMLElement>(element, '.popup');
const optionTexts = (element: Element): string[] => Array.from(element.shadowRoot?.querySelectorAll('.option') ?? []).map((option) => option.textContent ?? '');
const busyRow = (element: Element): Element | null => element.shadowRoot?.querySelector('.busy') ?? null;
const get = (mounted: { store: { get(path: string): unknown } }, name: string): unknown => mounted.store.get(`$.app.${name}`);
const events = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};
/** Puts the text into the input in one input event, as a user typing does, and stays in the field */
const type = async (element: Element, text: string): Promise<void> => {
    input(element).focus();
    input(element).value = text;
    input(element).dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await vi.advanceTimersByTimeAsync(0);
};
const wait = async (ms: number): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms);
};

const cities = [
    { value: 'zh', label: 'Zürich' },
    { value: 'be', label: 'Bern' },
    { value: 'ba', label: 'Basel' }
];
const results = [
    { value: 'bk', label: 'Berkeley' },
    { value: 'bn', label: 'Bonn' },
    { value: 'be', label: 'Bern' }
];

describe('comboboxField server-side search in Chromium', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });
    afterEach(() => {
        mountComponent.unmountAll();
        vi.useRealTimers();
    });

    it('should raise query once, with the last text, after typing paused for 300 ms', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { '<-options': '$.data.cities' }, { data: { cities } });
        await wait(0);
        const queries = events(mounted.element, 'query');

        // Act
        await type(mounted.element, 'b');
        await wait(299);
        const early = queries.length;
        await type(mounted.element, 'be');
        await wait(299);
        const restarted = queries.length;
        await wait(1);

        // Assert
        expect(early).toBe(0);
        expect(restarted).toBe(0);
        expect(queries).toEqual(['be']);
    });

    it('should raise query only once minChars is reached', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { minChars: 3, '<-options': '$.data.cities' }, { data: { cities } });
        await wait(0);
        const queries = events(mounted.element, 'query');

        // Act
        await type(mounted.element, 'be');
        await wait(1000);
        const short = queries.length;
        await type(mounted.element, 'ber');
        await wait(300);

        // Assert
        expect(short).toBe(0);
        expect(queries).toEqual(['ber']);
    });

    it('should raise query for empty text when minChars is 0, and not for a value written from outside', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { '<-options': '$.data.cities', '<-value': '$.data.city' }, { data: { cities, city: '' } });
        await wait(0);
        const queries = events(mounted.element, 'query');

        // Act
        mounted.store.set('$.data.city', 'zh');
        await wait(1000);
        const written = queries.length;
        await type(mounted.element, '');
        await wait(300);

        // Assert
        expect(written).toBe(0);
        expect(queries).toEqual(['']);
    });

    it('should not raise query when the user leaves before the pause is over', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { '<-options': '$.data.cities' }, { data: { cities } });
        await wait(0);
        const queries = events(mounted.element, 'query');

        // Act
        await type(mounted.element, 'be');
        input(mounted.element).blur();
        await wait(1000);

        // Assert
        expect(queries).toEqual([]);
        expect(get(mounted, 'busy')).toBe(false);
    });

    it('should set busy when it raises query, show a spinner row, and clear busy on the next write to options', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { '<-options': '$.data.cities' }, { data: { cities } });
        await wait(0);
        await type(mounted.element, 'zzz');
        const before = get(mounted, 'busy');
        const emptyHint = part(mounted.element, '.hint')?.textContent;

        // Act
        await wait(300);
        const during = get(mounted, 'busy');
        const row = busyRow(mounted.element)?.textContent;
        const hintWhileBusy = part(mounted.element, '.hint');
        mounted.store.set('$.data.cities', results);
        await wait(0);

        // Assert
        expect(before).toBe(false);
        expect(emptyHint).toBe('No matches');
        expect(during).toBe(true);
        expect(row).toBe('Searching');
        expect(hintWhileBusy).toBeNull();
        expect(get(mounted, 'busy')).toBe(false);
        expect(busyRow(mounted.element)).toBeNull();
    });

    it('should clear busy after 5 seconds when no options are written', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { '<-options': '$.data.cities' }, { data: { cities } });
        await wait(0);
        await type(mounted.element, 'be');
        await wait(300);

        // Act
        await wait(4999);
        const before = get(mounted, 'busy');
        await wait(1);

        // Assert
        expect(before).toBe(true);
        expect(get(mounted, 'busy')).toBe(false);
        expect(busyRow(mounted.element)).toBeNull();
    });

    it('should restart the 5 second limit when a newer query is raised', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { '<-options': '$.data.cities' }, { data: { cities } });
        await wait(0);
        await type(mounted.element, 'be');
        await wait(300);
        await wait(3000);

        // Act
        await type(mounted.element, 'ber');
        await wait(300);
        await wait(4000);
        const stillBusy = get(mounted, 'busy');
        await wait(1000);

        // Assert
        expect(stillBusy).toBe(true);
        expect(get(mounted, 'busy')).toBe(false);
    });

    it('should update the open list in place and keep the active option while its value is present', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { '<-options': '$.data.cities' }, { data: { cities } });
        await wait(0);
        await type(mounted.element, 'b');
        await wait(0);
        const before = { texts: optionTexts(mounted.element), active: input(mounted.element).getAttribute('aria-activedescendant') };

        // Act
        mounted.store.set('$.data.cities', results);
        await wait(0);

        // Assert
        expect(before).toEqual({ texts: ['Bern', 'Basel'], active: 'option-0' });
        expect(popup(mounted.element).matches(':popover-open')).toBe(true);
        expect(optionTexts(mounted.element)).toEqual(['Berkeley', 'Bonn', 'Bern']);
        expect(input(mounted.element).getAttribute('aria-activedescendant')).toBe('option-2');
        expect(part(mounted.element, '#option-2').textContent).toBe('Bern');
        expect(part(mounted.element, '#option-2').hasAttribute('data-active')).toBe(true);
    });

    it('should fall back to the first match when the active option is not in the new options', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { '<-options': '$.data.cities' }, { data: { cities } });
        await wait(0);
        await type(mounted.element, 'b');
        input(mounted.element).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }));
        await wait(0);

        // Act
        mounted.store.set('$.data.cities', [{ value: 'bk', label: 'Berkeley' }]);
        await wait(0);

        // Assert
        expect(optionTexts(mounted.element)).toEqual(['Berkeley']);
        expect(input(mounted.element).getAttribute('aria-activedescendant')).toBe('option-0');
    });

    it('should keep the label of the chosen option after options is replaced by results without it', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { '<-options': '$.data.cities', '<-value': '$.data.city' }, { data: { cities, city: '' } });
        await wait(0);
        await type(mounted.element, 'zür');
        input(mounted.element).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }));
        input(mounted.element).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
        await wait(0);

        // Act
        mounted.store.set('$.data.cities', results);
        await wait(0);
        input(mounted.element).blur();
        await wait(0);

        // Assert
        expect(mounted.store.get('$.data.city')).toBe('zh');
        expect(input(mounted.element).value).toBe('Zürich');
    });

    it('should send an on.query emit to hooks.onEmit with the typed text', async () => {
        // Arrange
        const onEmit = vi.fn();
        const mounted = mountComponent(
            'comboboxField',
            { '<-options': '$.data.cities', on: { query: { command: 'emit', target: 'cities.search' } } },
            { data: { cities }, hooks: { onEmit } }
        );
        await wait(0);

        // Act
        await type(mounted.element, 'ber');
        await wait(300);

        // Assert
        expect(onEmit).toHaveBeenCalledTimes(1);
        expect(onEmit.mock.calls[0]).toEqual(['cities.search', 'ber']);
    });

    it('should show the spinner row text in German', async () => {
        // Arrange
        const mounted = mountComponent('comboboxField', { '<-options': '$.data.cities' }, { data: { cities }, locale: 'de' });
        await wait(0);

        // Act
        await type(mounted.element, 'zzz');
        await wait(300);

        // Assert
        expect(busyRow(mounted.element)?.textContent).toBe('Suche läuft');
    });
});
