import { userEvent } from 'vitest/browser';
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
const REF = { id: 'f1', name: 'notes.pdf', size: 2048, type: 'application/pdf' };

describe('composer in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should send the typed text on Enter, then clear itself', async () => {
        // Arrange
        const mounted = mountComponent('composer', {});
        const sent = events(mounted.element, 'send');
        await flush();
        part<HTMLTextAreaElement>(mounted.element, '.input')?.focus();

        // Act
        await userEvent.keyboard('Hello  ');
        await userEvent.keyboard('{Enter}');
        await flush();

        // Assert
        expect(sent).toEqual([{ text: 'Hello', attachments: [] }]);
        expect(mounted.store.get('$.app.value')).toBe('');
    });

    it('should add a line on Shift+Enter and keep the send button off while the text is empty', async () => {
        // Arrange
        const mounted = mountComponent('composer', {});
        const sent = events(mounted.element, 'send');
        await flush();
        const disabled = part<HTMLButtonElement>(mounted.element, '.send')?.disabled;
        part<HTMLTextAreaElement>(mounted.element, '.input')?.focus();

        // Act
        await userEvent.keyboard('a{Shift>}{Enter}{/Shift}b');
        await flush();

        // Assert
        expect(disabled).toBe(true);
        expect(sent).toEqual([]);
        expect(mounted.store.get('$.app.value')).toBe('a\nb');
        expect(part<HTMLButtonElement>(mounted.element, '.send')?.disabled).toBe(false);
    });

    it('should send the attachments with the text and let one be removed first', async () => {
        // Arrange
        const mounted = mountComponent('composer', { value: 'See these', attachments: [REF, { ...REF, id: 'f2', name: 'plan.pdf' }] });
        const sent = events(mounted.element, 'send');
        await flush();
        const names = all(mounted.element, '.attachment .name').map((name) => name.textContent);

        // Act
        all<HTMLButtonElement>(mounted.element, '.remove')[1]?.click();
        await flush();
        part<HTMLButtonElement>(mounted.element, '.send')?.click();
        await flush();

        // Assert
        expect(names).toEqual(['notes.pdf', 'plan.pdf']);
        expect(sent).toEqual([{ text: 'See these', attachments: [REF] }]);
        expect(mounted.store.get('$.app.attachments')).toEqual([]);
    });

    it('should hand a picked file to the host and keep the reference it answers', async () => {
        // Arrange
        const mounted = mountComponent('composer', {});
        mounted.element.addEventListener('ui-file-transfer', (event) => {
            const detail = (event as CustomEvent).detail as { file: File; respond: (result: Promise<unknown>) => void };
            detail.respond(Promise.resolve({ id: 'f9', name: detail.file.name, size: detail.file.size, type: detail.file.type }));
        });
        await flush();
        const picker = part<HTMLInputElement>(mounted.element, '.picker');

        // Act
        await userEvent.upload(picker as HTMLInputElement, new File(['hi'], 'hello.txt', { type: 'text/plain' }));
        await flush();
        await flush();

        // Assert
        expect(mounted.store.get('$.app.attachments')).toEqual([{ id: 'f9', name: 'hello.txt', size: 2, type: 'text/plain' }]);
        expect(part(mounted.element, '.attachment .name')?.textContent).toBe('hello.txt');
    });

    it('should show why a file was refused when no host takes it', async () => {
        // Arrange
        const mounted = mountComponent('composer', {});
        await flush();

        // Act
        await userEvent.upload(part<HTMLInputElement>(mounted.element, '.picker') as HTMLInputElement, new File(['hi'], 'hello.txt', { type: 'text/plain' }));
        await flush();

        // Assert
        expect(mounted.store.get('$.app.error')).toBe('offline');
        expect(part(mounted.element, '.error')?.textContent).toBe('The file could not be sent');
    });

    it('should send a suggestion\'s prompt and hide the suggestions once text is typed', async () => {
        // Arrange
        const mounted = mountComponent('composer', { suggestions: { plan: { _label: 'Plan a trip', _prompt: 'Plan a weekend in Lisbon' } } });
        const sent = events(mounted.element, 'send');
        await flush();

        // Act
        part<HTMLButtonElement>(mounted.element, '.suggestion')?.click();
        mounted.store.set('$.app.value', 'x');
        await flush();

        // Assert
        expect(sent).toEqual([{ text: 'Plan a weekend in Lisbon', attachments: [] }]);
        expect(part(mounted.element, '.suggestions')).toBeNull();
    });

    it('should show a stop button while streaming that raises stop, and not send on Enter', async () => {
        // Arrange
        const mounted = mountComponent('composer', { streaming: true, value: 'next' });
        const stops = events(mounted.element, 'stop');
        const sent = events(mounted.element, 'send');
        await flush();
        part<HTMLTextAreaElement>(mounted.element, '.input')?.focus();

        // Act
        await userEvent.keyboard('{Enter}');
        part<HTMLButtonElement>(mounted.element, '.stop')?.click();
        await flush();

        // Assert
        expect(part(mounted.element, '.send')).toBeNull();
        expect(part(mounted.element, '.stop')?.getAttribute('aria-label')).toBe('Stop');
        expect(stops).toHaveLength(1);
        expect(sent).toEqual([]);
    });
});
