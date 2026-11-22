import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const part = <T extends Element>(element: Element, selector: string): T | null => element.shadowRoot?.querySelector<T>(selector) ?? null;
const all = <T extends Element>(element: Element, selector: string): T[] => Array.from(element.shadowRoot?.querySelectorAll<T>(selector) ?? []);
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const events = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail ?? null));
    return seen;
};

const DETAILS = { to: { _label: 'To', _value: 'team@example.com' }, subject: { _label: 'Subject', _value: 'Weekly report' } };

describe('actionConfirm in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should show the proposal with its details and the approve and reject buttons', async () => {
        // Act
        const mounted = mountComponent('actionConfirm', { _title: 'Send this email?', details: DETAILS });
        await flush();

        // Assert
        expect(part(mounted.element, '.title')?.textContent).toBe('Send this email?');
        expect(all(mounted.element, 'dt').map((term) => term.textContent)).toEqual(['To', 'Subject']);
        expect(all(mounted.element, 'dd').map((value) => value.textContent)).toEqual(['team@example.com', 'Weekly report']);
        expect(all(mounted.element, 'button').map((button) => button.textContent)).toEqual(['Reject', 'Approve']);
    });

    it('should raise approve once and show the outcome in place of the buttons', async () => {
        // Arrange
        const mounted = mountComponent('actionConfirm', { details: DETAILS });
        const approvals = events(mounted.element, 'approve');
        await flush();

        // Act
        part<HTMLButtonElement>(mounted.element, '.approve')?.click();
        await flush();

        // Assert
        expect(approvals).toHaveLength(1);
        expect(mounted.store.get('$.app.status')).toBe('approved');
        expect(mounted.element.getAttribute('status')).toBe('approved');
        expect(part(mounted.element, '.actions')).toBeNull();
        expect(part(mounted.element, '.outcome')?.textContent?.trim()).toBe('Approved');
    });

    it('should raise reject and record it', async () => {
        // Arrange
        const mounted = mountComponent('actionConfirm', { details: DETAILS });
        const rejections = events(mounted.element, 'reject');
        await flush();

        // Act
        part<HTMLButtonElement>(mounted.element, '.reject')?.click();
        await flush();

        // Assert
        expect(rejections).toHaveLength(1);
        expect(part(mounted.element, '.outcome ui-icon')?.getAttribute('name')).toBe('circle-x');
    });

    it('should ignore a press while disabled', async () => {
        // Arrange
        const mounted = mountComponent('actionConfirm', { disabled: true });
        const approvals = events(mounted.element, 'approve');
        await flush();

        // Act
        part<HTMLButtonElement>(mounted.element, '.approve')?.click();
        await flush();

        // Assert
        expect(approvals).toEqual([]);
        expect(mounted.store.get('$.app.status')).toBe('pending');
    });
});
