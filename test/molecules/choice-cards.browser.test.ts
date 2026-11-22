import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const all = (element: Element, selector: string): HTMLElement[] => Array.from(element.shadowRoot?.querySelectorAll<HTMLElement>(selector) ?? []);
const part = (element: Element, selector: string): HTMLElement => element.shadowRoot?.querySelector(selector) as HTMLElement;

const plans = {
    starter: { _label: 'Starter', _description: 'One project, community support' },
    team: { _label: 'Team', _description: 'Ten projects and shared folders' },
    custom: { _label: 'Custom' }
};

describe('choice cards in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should draw each radio option as a bordered card with its description', async () => {
        // Arrange
        const mounted = mountComponent('radioField', { appearance: 'card', options: plans, _label: 'Plan' });
        await flush();
        const cards = all(mounted.element, '.option');

        // Assert
        expect(mounted.element.getAttribute('appearance')).toBe('card');
        expect(cards).toHaveLength(3);
        expect(getComputedStyle(cards[0] as HTMLElement).borderTopStyle).toBe('solid');
        expect(all(mounted.element, '.description').map((node) => (node.hidden ? '' : node.textContent))).toEqual([
            'One project, community support',
            'Ten projects and shared folders',
            ''
        ]);
    });

    it('should choose a card on a press anywhere on it and mark the chosen card', async () => {
        // Arrange
        const mounted = mountComponent('radioField', { appearance: 'card', options: plans });
        await flush();
        const team = all(mounted.element, '.option')[1] as HTMLElement;
        const before = getComputedStyle(team).borderTopColor;

        // Act
        await userEvent.click(part(mounted.element, '.option:nth-child(2) .description'));
        await flush();

        // Assert
        expect(mounted.store.get('$.app.value')).toBe('team');
        expect(getComputedStyle(team).borderTopColor).not.toBe(before);
    });

    it('should read descriptions from records with optionDescription and lay cards out across when horizontal', async () => {
        // Arrange
        const mounted = mountComponent('radioField', {
            appearance: 'card',
            orientation: 'horizontal',
            options: [
                { value: 'ground', label: 'Ground', blurb: 'Five days' },
                { value: 'air', label: 'Air', blurb: 'Two days' }
            ],
            optionDescription: 'blurb'
        });
        (mounted.element as HTMLElement).style.inlineSize = '800px';
        await flush();
        const [ground, air] = all(mounted.element, '.option');

        // Assert
        expect(all(mounted.element, '.description').map((node) => node.textContent)).toEqual(['Five days', 'Two days']);
        expect(Math.round((ground as HTMLElement).getBoundingClientRect().top)).toBe(Math.round((air as HTMLElement).getBoundingClientRect().top));
    });

    it('should make a checkField a card that toggles on a press anywhere on it, its description describing the control', async () => {
        // Arrange
        const mounted = mountComponent('checkField', { appearance: 'card', _label: 'Priority support', _description: 'Answers within an hour' });
        await flush();

        // Act
        const description = part(mounted.element, '.description').getBoundingClientRect();
        await userEvent.click(mounted.element, { position: { x: description.right - (mounted.element as HTMLElement).getBoundingClientRect().left - 2, y: description.top + description.height / 2 - (mounted.element as HTMLElement).getBoundingClientRect().top } });
        await flush();

        // Assert
        expect(mounted.store.get('$.app.checked')).toBe(true);
        expect(part(mounted.element, 'input').getAttribute('aria-describedby')).toBe('description');
        expect(getComputedStyle(part(mounted.element, '.field')).borderTopStyle).toBe('solid');
    });

    it('should leave a plain checkField without a border', async () => {
        // Arrange and Act
        const mounted = mountComponent('checkField', { _label: 'Accept' });
        await flush();

        // Assert
        expect(getComputedStyle(part(mounted.element, '.field')).borderTopStyle).toBe('none');
        expect(part(mounted.element, 'input').getAttribute('aria-describedby')).toBeNull();
    });
});
