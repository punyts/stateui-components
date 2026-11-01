import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

interface CommandElement extends Element {
    commands: { validate(): void; reset(): void; focus(): void; clear(): void };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async (): Promise<void> => {
    await flush();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await flush();
};

const root = (mounted: MountedComponent): ShadowRoot => mounted.element.shadowRoot as ShadowRoot;
const startInput = (mounted: MountedComponent): HTMLInputElement => root(mounted).querySelector('#control') as HTMLInputElement;
const endInput = (mounted: MountedComponent): HTMLInputElement => root(mounted).querySelector('#end') as HTMLInputElement;
const popup = (mounted: MountedComponent): HTMLElement => root(mounted).querySelector('#popup') as HTMLElement;
const isOpen = (mounted: MountedComponent): boolean => popup(mounted).matches(':popover-open');
const toggle = (mounted: MountedComponent): HTMLElement => root(mounted).querySelector('#open') as HTMLElement;
const cell = (mounted: MountedComponent, iso: string): HTMLElement => root(mounted).querySelector(`.cell[data-date="${iso}"]:not([data-blank])`) as HTMLElement;
const headings = (mounted: MountedComponent): string[] => Array.from(root(mounted).querySelectorAll('.heading')).map((heading) => heading.textContent?.trim() ?? '');
const get = (mounted: MountedComponent, name: string): unknown => mounted.store.get(`$.app.${name}`);
const commands = (mounted: MountedComponent): CommandElement['commands'] => (mounted.element as CommandElement).commands;
const messageOf = (mounted: MountedComponent): string => root(mounted).querySelector('.error')?.textContent?.trim() ?? '';
const events = (mounted: MountedComponent, name: string): unknown[] => {
    const seen: unknown[] = [];
    mounted.element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};
const rangeOf = (mounted: MountedComponent): unknown => mounted.store.get('$.data.range');

const mountField = (extra: Record<string, unknown> = {}, range: unknown = { start: '2026-03-02', end: '2026-03-03' }, options: Parameters<typeof mountComponent>[2] = {}): MountedComponent =>
    mountComponent('dateRangeField', { '<-value': '$.data.range', ...extra }, { data: { range }, ...options });

async function typeInto(input: HTMLInputElement, text: string, leave = true): Promise<void> {
    await userEvent.fill(input, text);
    if (leave) input.blur();
    await flush();
}

describe('dateRangeField typed dates in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should render a labelled group of a start input, an end input and a button', async () => {
        // Arrange and Act
        const mounted = mountField({ _label: 'Stay' });
        await settle();

        // Assert
        expect(root(mounted).querySelector('label')?.textContent).toBe('Stay');
        expect(root(mounted).querySelector('.box')?.getAttribute('role')).toBe('group');
        expect(startInput(mounted).getAttribute('aria-label')).toBe('Start date');
        expect(endInput(mounted).getAttribute('aria-label')).toBe('End date');
        expect(toggle(mounted).getAttribute('aria-label')).toBe('Choose dates');
        expect(toggle(mounted).getAttribute('aria-expanded')).toBe('false');
        expect(isOpen(mounted)).toBe(false);
    });

    it('should show the value in the form of the locale, and in the new form after a language switch', async () => {
        // Arrange
        const mounted = mountField();
        await settle();

        // Assert
        expect([startInput(mounted).value, endInput(mounted).value]).toEqual(['03/02/2026', '03/03/2026']);

        // Act
        mounted.setLocale('de');
        await settle();

        // Assert
        expect([startInput(mounted).value, endInput(mounted).value]).toEqual(['02.03.2026', '03.03.2026']);
    });

    it('should read both dates typed the English way and write ISO dates to the linked data', async () => {
        // Arrange
        const mounted = mountField({}, { start: '', end: '' });
        await settle();

        // Act
        await typeInto(startInput(mounted), '3/14/2026');
        await typeInto(endInput(mounted), '03/20/2026');

        // Assert
        expect(rangeOf(mounted)).toEqual({ start: '2026-03-14', end: '2026-03-20' });
        expect([startInput(mounted).value, endInput(mounted).value]).toEqual(['03/14/2026', '03/20/2026']);
        expect(get(mounted, 'error')).toBe('');
    });

    it('should read both dates typed the German way', async () => {
        // Arrange
        const mounted = mountField({}, { start: '', end: '' }, { locale: 'de' });
        await settle();

        // Act
        await typeInto(startInput(mounted), '14.3.2026');
        await typeInto(endInput(mounted), '20.03.2026');

        // Assert
        expect(rangeOf(mounted)).toEqual({ start: '2026-03-14', end: '2026-03-20' });
        expect([startInput(mounted).value, endInput(mounted).value]).toEqual(['14.03.2026', '20.03.2026']);
    });

    it('should write a date as soon as it parses, while the user is still in the input, and not rewrite the typed text', async () => {
        // Arrange
        const mounted = mountField({}, { start: '', end: '' });
        await settle();

        // Act
        await typeInto(startInput(mounted), '3/4/2026', false);

        // Assert
        expect(rangeOf(mounted)).toEqual({ start: '2026-03-04', end: '' });
        expect(startInput(mounted).value).toBe('3/4/2026');
    });

    it('should empty a side when its text is cleared', async () => {
        // Arrange
        const mounted = mountField();
        await settle();

        // Act
        await typeInto(endInput(mounted), '');

        // Assert
        expect(rangeOf(mounted)).toEqual({ start: '2026-03-02', end: '' });
    });

    it('should put a reversed typed range in order when the input is committed', async () => {
        // Arrange
        const mounted = mountField({}, { start: '', end: '' });
        await settle();

        // Act
        await typeInto(startInput(mounted), '03/20/2026');
        await typeInto(endInput(mounted), '03/14/2026');

        // Assert
        expect(rangeOf(mounted)).toEqual({ start: '2026-03-14', end: '2026-03-20' });
        expect([startInput(mounted).value, endInput(mounted).value]).toEqual(['03/14/2026', '03/20/2026']);
    });

    it('should keep text that is not a date, write nothing and report the format rule, then clear it when fixed', async () => {
        // Arrange
        const mounted = mountField();
        await settle();

        // Act
        await typeInto(startInput(mounted), '31/02/2026');

        // Assert
        expect(startInput(mounted).value).toBe('31/02/2026');
        expect(rangeOf(mounted)).toEqual({ start: '2026-03-02', end: '2026-03-03' });
        expect(get(mounted, 'error')).toBe('format');
        expect(messageOf(mounted)).toBe('Enter a valid date');
        expect(startInput(mounted).getAttribute('aria-invalid')).toBe('true');

        // Act
        await typeInto(startInput(mounted), '03/01/2026');

        // Assert
        expect(get(mounted, 'error')).toBe('');
        expect(rangeOf(mounted)).toEqual({ start: '2026-03-01', end: '2026-03-03' });
    });

    it('should follow a write to one side of the value from outside', async () => {
        // Arrange
        const mounted = mountField();
        await settle();

        // Act
        mounted.store.set('$.data.range.end', '2026-03-09');
        await settle();

        // Assert
        expect(endInput(mounted).value).toBe('03/09/2026');
        expect(get(mounted, 'dirty')).toBe(true);
    });

    it('should raise change with the range, and clear and reset it', async () => {
        // Arrange
        const mounted = mountField();
        await settle();
        const changes = events(mounted, 'change');

        // Act
        await typeInto(endInput(mounted), '03/09/2026');
        commands(mounted).clear();
        await settle();

        // Assert
        expect(changes).toEqual([{ value: { start: '2026-03-02', end: '2026-03-09' } }, { value: { start: '', end: '' } }]);
        expect(rangeOf(mounted)).toEqual({ start: '', end: '' });
        expect(startInput(mounted).value).toBe('');

        // Act
        commands(mounted).reset();
        await settle();

        // Assert
        expect(rangeOf(mounted)).toEqual({ start: '2026-03-02', end: '2026-03-03' });
        expect(startInput(mounted).value).toBe('03/02/2026');
    });
});

describe('dateRangeField popup in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should open two months side by side, the first the month of the start', async () => {
        // Arrange
        const mounted = mountField();
        await settle();

        // Act
        toggle(mounted).click();
        await settle();

        // Assert
        expect(isOpen(mounted)).toBe(true);
        expect(get(mounted, 'open')).toBe(true);
        expect(toggle(mounted).getAttribute('aria-expanded')).toBe('true');
        expect(headings(mounted)).toEqual(['March 2026', 'April 2026']);
        expect(root(mounted).querySelectorAll('.grid')).toHaveLength(2);
        expect(root(mounted).querySelectorAll('.month .cell:not([data-blank])')).toHaveLength(31 + 30);
        expect(root(mounted).querySelector('.status')?.textContent).toBe('Pick the start date');
    });

    it('should set the start with the first press and the end with the second, and highlight the range between', async () => {
        // Arrange
        const mounted = mountField();
        await settle();
        const changes = events(mounted, 'change');
        toggle(mounted).click();
        await settle();

        // Act
        cell(mounted, '2026-03-10').click();
        await settle();

        // Assert
        expect(rangeOf(mounted)).toEqual({ start: '2026-03-02', end: '2026-03-03' });
        expect(get(mounted, 'picking')).toBe(true);
        expect(cell(mounted, '2026-03-10').hasAttribute('data-pending')).toBe(true);
        expect(root(mounted).querySelector('.status')?.textContent).toBe('Pick the end date');
        expect(isOpen(mounted)).toBe(true);

        // Act
        cell(mounted, '2026-03-14').click();
        await settle();

        // Assert
        expect(rangeOf(mounted)).toEqual({ start: '2026-03-10', end: '2026-03-14' });
        expect(changes).toEqual([{ value: { start: '2026-03-10', end: '2026-03-14' } }]);
        expect(isOpen(mounted)).toBe(false);
        expect([startInput(mounted).value, endInput(mounted).value]).toEqual(['03/10/2026', '03/14/2026']);
        expect(root(mounted).activeElement).toBe(startInput(mounted));

        // Act
        toggle(mounted).click();
        await settle();

        // Assert
        const inRange = Array.from(root(mounted).querySelectorAll<HTMLElement>('.cell[data-in-range]')).map((day) => day.dataset['date']);
        expect(inRange).toEqual(['2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14']);
        expect(cell(mounted, '2026-03-10').dataset['edge']).toBe('start');
        expect(cell(mounted, '2026-03-14').dataset['edge']).toBe('end');
        expect(cell(mounted, '2026-03-12').getAttribute('aria-selected')).toBe('true');
        expect(cell(mounted, '2026-03-15').getAttribute('aria-selected')).toBe('false');
    });

    it('should swap a reversed pick so the range is in order', async () => {
        // Arrange
        const mounted = mountField();
        await settle();
        toggle(mounted).click();
        await settle();

        // Act
        cell(mounted, '2026-03-20').click();
        await settle();
        cell(mounted, '2026-03-12').click();
        await settle();

        // Assert
        expect(rangeOf(mounted)).toEqual({ start: '2026-03-12', end: '2026-03-20' });
        expect([startInput(mounted).value, endInput(mounted).value]).toEqual(['03/12/2026', '03/20/2026']);
    });

    it('should make a range of one day when the same day is pressed twice, and pick across the two months', async () => {
        // Arrange
        const mounted = mountField();
        await settle();
        toggle(mounted).click();
        await settle();

        // Act
        cell(mounted, '2026-03-31').click();
        await settle();
        cell(mounted, '2026-03-31').click();
        await settle();

        // Assert
        expect(rangeOf(mounted)).toEqual({ start: '2026-03-31', end: '2026-03-31' });

        // Act
        toggle(mounted).click();
        await settle();
        cell(mounted, '2026-03-28').click();
        await settle();
        cell(mounted, '2026-04-03').click();
        await settle();

        // Assert
        expect(rangeOf(mounted)).toEqual({ start: '2026-03-28', end: '2026-04-03' });
    });

    it('should move both months with the previous and next buttons', async () => {
        // Arrange
        const mounted = mountField();
        await settle();
        toggle(mounted).click();
        await settle();
        const next = Array.from(root(mounted).querySelectorAll<HTMLElement>('.nav[data-nav="next"]')).find((button) => !button.hidden) as HTMLElement;

        // Act
        next.click();
        await settle();

        // Assert
        expect(headings(mounted)).toEqual(['April 2026', 'May 2026']);

        // Act
        const previous = Array.from(root(mounted).querySelectorAll<HTMLElement>('.nav[data-nav="previous"]')).find((button) => !button.hidden) as HTMLElement;
        previous.click();
        previous.click();
        await settle();
        expect(headings(mounted).length).toBe(2);
    });

    it('should open with the Down arrow, move the day with the arrow keys, press with Enter and close with Escape', async () => {
        // Arrange
        const mounted = mountField();
        await settle();
        startInput(mounted).focus();

        // Act
        await userEvent.keyboard('{ArrowDown}');
        await settle();

        // Assert
        expect(isOpen(mounted)).toBe(true);
        expect((root(mounted).activeElement as HTMLElement).dataset['date']).toBe('2026-03-02');

        // Act
        await userEvent.keyboard('{ArrowRight}{ArrowDown}');
        await settle();

        // Assert
        expect((root(mounted).activeElement as HTMLElement).dataset['date']).toBe('2026-03-10');

        // Act
        await userEvent.keyboard('{Enter}');
        await settle();
        await userEvent.keyboard('{ArrowRight}{Enter}');
        await settle();

        // Assert
        expect(rangeOf(mounted)).toEqual({ start: '2026-03-10', end: '2026-03-11' });
        expect(isOpen(mounted)).toBe(false);

        // Act
        await userEvent.keyboard('{ArrowDown}');
        await settle();
        await userEvent.keyboard('{Escape}');
        await settle();

        // Assert
        expect(isOpen(mounted)).toBe(false);
        expect(root(mounted).activeElement).toBe(startInput(mounted));
        expect(get(mounted, 'open')).toBe(false);
    });

    it('should show other months when the keyboard leaves the two shown, and use Page Down for a month', async () => {
        // Arrange
        const mounted = mountField();
        await settle();
        startInput(mounted).focus();
        await userEvent.keyboard('{ArrowDown}');
        await settle();

        // Act
        await userEvent.keyboard('{PageDown}{PageDown}');
        await settle();

        // Assert
        expect(headings(mounted)).toEqual(['April 2026', 'May 2026']);
        expect((root(mounted).activeElement as HTMLElement).dataset['date']).toBe('2026-05-02');

        // Act
        await userEvent.keyboard('{PageUp}{PageUp}{PageUp}');
        await settle();

        // Assert
        expect(headings(mounted)).toEqual(['February 2026', 'March 2026']);
    });

    it('should close when a press lands outside, and drop a start that was waiting for its end', async () => {
        // Arrange
        const mounted = mountField();
        await settle();
        toggle(mounted).click();
        await settle();
        cell(mounted, '2026-03-10').click();
        await settle();

        // Act
        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
        await settle();

        // Assert
        expect(isOpen(mounted)).toBe(false);
        expect(get(mounted, 'picking')).toBe(false);
        expect(rangeOf(mounted)).toEqual({ start: '2026-03-02', end: '2026-03-03' });
    });

    it('should show days outside min and max but not let them be picked', async () => {
        // Arrange
        const mounted = mountField({ min: '2026-03-05', max: '2026-04-10' });
        await settle();
        toggle(mounted).click();
        await settle();

        // Act
        cell(mounted, '2026-03-04').click();
        cell(mounted, '2026-04-11').click();
        await settle();

        // Assert
        expect(cell(mounted, '2026-03-04').getAttribute('aria-disabled')).toBe('true');
        expect(cell(mounted, '2026-03-05').hasAttribute('aria-disabled')).toBe(false);
        expect(get(mounted, 'picking')).toBe(false);

        // Act
        cell(mounted, '2026-03-05').click();
        cell(mounted, '2026-04-10').click();
        await settle();

        // Assert
        expect(rangeOf(mounted)).toEqual({ start: '2026-03-05', end: '2026-04-10' });
    });

    it('should show German month names, the Monday start and German content', async () => {
        // Arrange
        const mounted = mountField({}, { start: '2026-03-02', end: '2026-03-03' }, { locale: 'de' });
        await settle();

        // Act
        toggle(mounted).click();
        await settle();

        // Assert
        expect(headings(mounted)).toEqual(['März 2026', 'April 2026']);
        expect(root(mounted).querySelector('.weekday')?.getAttribute('aria-label')).toBe('Montag');
        expect(cell(mounted, '2026-03-14').getAttribute('aria-label')).toBe('Samstag, 14. März 2026');
        expect(root(mounted).querySelector('.status')?.textContent).toBe('Startdatum wählen');
        expect(toggle(mounted).getAttribute('aria-label')).toBe('Daten wählen');
        expect(root(mounted).querySelector('label')?.textContent).toBe('Zeitraum');
    });

    it('should not open while the field is read only or disabled', async () => {
        // Arrange
        const readonly = mountField({ readonly: true });
        const disabled = mountField({ disabled: true });
        await settle();

        // Assert
        expect((toggle(readonly) as HTMLButtonElement).disabled).toBe(true);
        expect((toggle(disabled) as HTMLButtonElement).disabled).toBe(true);
        expect(startInput(disabled).disabled).toBe(true);
        expect(startInput(readonly).readOnly).toBe(true);
    });
});

describe('dateRangeField rules in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    const check = async (mounted: MountedComponent): Promise<string> => {
        await settle();
        commands(mounted).validate();
        await settle();
        return String(get(mounted, 'error'));
    };

    it('should fail required for an empty range and for a range with one date, and pass a full one', async () => {
        // Arrange
        const empty = mountField({ required: true }, { start: '', end: '' });
        const partial = mountField({ required: true }, { start: '2026-03-02', end: '' });
        const full = mountField({ required: true });

        // Assert
        expect(await check(empty)).toBe('required');
        expect(messageOf(empty)).toBe('Enter a start and an end date');
        expect(await check(partial)).toBe('required');
        expect(await check(full)).toBe('');
    });

    it('should not fail an empty range that is not required', async () => {
        // Arrange and Act
        const mounted = mountField({}, { start: '', end: '' });

        // Assert
        expect(await check(mounted)).toBe('');
    });

    it('should fail min when a date is before it, in either side, and show the message', async () => {
        // Arrange
        const mounted = mountField({ min: '2026-03-05' }, { start: '2026-03-02', end: '2026-03-10' });
        const late = mountField({ min: '2026-03-05' }, { start: '2026-03-06', end: '2026-03-10' });

        // Assert
        expect(await check(mounted)).toBe('min');
        expect(messageOf(mounted)).toBe('Too early');
        expect(await check(late)).toBe('');
    });

    it('should fail max when a date is after it', async () => {
        // Arrange
        const mounted = mountField({ max: '2026-03-08' }, { start: '2026-03-02', end: '2026-03-10' });
        const inside = mountField({ max: '2026-03-10' }, { start: '2026-03-02', end: '2026-03-10' });

        // Assert
        expect(await check(mounted)).toBe('max');
        expect(messageOf(mounted)).toBe('Too late');
        expect(await check(inside)).toBe('');
    });

    it('should fail minDays for a range with fewer days, counting both ends', async () => {
        // Arrange
        const short = mountField({ minDays: 4 }, { start: '2026-03-01', end: '2026-03-03' });
        const enough = mountField({ minDays: 3 }, { start: '2026-03-01', end: '2026-03-03' });

        // Assert
        expect(await check(short)).toBe('minDays');
        expect(messageOf(short)).toBe('The range is too short');
        expect(await check(enough)).toBe('');
    });

    it('should fail maxDays for a range with more days, counting both ends', async () => {
        // Arrange
        const long = mountField({ maxDays: 2 }, { start: '2026-03-01', end: '2026-03-03' });
        const fits = mountField({ maxDays: 3 }, { start: '2026-03-01', end: '2026-03-03' });

        // Assert
        expect(await check(long)).toBe('maxDays');
        expect(messageOf(long)).toBe('The range is too long');
        expect(await check(fits)).toBe('');
    });

    it('should check the rules in order: required, then min and max, then minDays and maxDays', async () => {
        // Arrange
        const mounted = mountField({ min: '2026-03-05', minDays: 5 }, { start: '2026-03-02', end: '2026-03-03' });

        // Assert
        expect(await check(mounted)).toBe('min');
    });

    it('should validate on change once the field has been left, and raise invalid and valid', async () => {
        // Arrange
        const mounted = mountField({ maxDays: 3 }, { start: '2026-03-01', end: '2026-03-03' });
        await settle();
        const invalid = events(mounted, 'invalid');
        const valid = events(mounted, 'valid');
        startInput(mounted).focus();
        startInput(mounted).blur();
        await settle();

        // Act
        await typeInto(endInput(mounted), '03/09/2026');

        // Assert
        expect(get(mounted, 'error')).toBe('maxDays');
        expect(invalid).toEqual([{ rule: 'maxDays' }]);

        // Act
        await typeInto(endInput(mounted), '03/03/2026');

        // Assert
        expect(get(mounted, 'error')).toBe('');
        expect(valid).toEqual([{ value: { start: '2026-03-01', end: '2026-03-03' } }]);
    });

    it('should be touched when the focus leaves the field, not when it moves between its own inputs and button', async () => {
        // Arrange
        const mounted = mountField({ required: true }, { start: '', end: '' });
        await settle();

        // Act
        startInput(mounted).focus();
        endInput(mounted).focus();
        toggle(mounted).focus();
        await settle();

        // Assert
        expect(get(mounted, 'touched')).toBe(false);

        // Act
        toggle(mounted).blur();
        await settle();

        // Assert
        expect(get(mounted, 'touched')).toBe(true);
    });

    it('should show the German messages', async () => {
        // Arrange
        const mounted = mountField({ minDays: 5 }, { start: '2026-03-01', end: '2026-03-03' }, { locale: 'de' });

        // Act
        await check(mounted);

        // Assert
        expect(messageOf(mounted)).toBe('Der Zeitraum ist zu kurz');
    });
});
