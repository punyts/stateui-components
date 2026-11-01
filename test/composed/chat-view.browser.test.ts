import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { libraryFromCatalog, mountApp, registerLocaleStep } from '@punyts/stateui-app';
import type { AppDocument } from '@punyts/stateui-app';
import type { Catalog } from '@punyts/stateui-app/build';
import catalogJson from '../../.test-build/real/components/catalog.json';
import { registerAll } from '../../.test-build/real/components/index.js';
import { overlaysFromFiles } from '../harness/createMountComponent.js';
import type { ComponentBuild } from '../harness/createMountComponent.js';

const catalog = catalogJson as unknown as Catalog;
const library = libraryFromCatalog(catalog);
const overlays = overlaysFromFiles(
    import.meta.glob<ComponentBuild['localeFiles'][string]>('../../.test-build/real/components/*.locale.*.json', { eager: true, import: 'default' })
);

let registered = false;
const mounted: { dispose(): void; host: HTMLElement; unregister(): void }[] = [];

interface Chat {
    host: HTMLElement;
    store: NonNullable<ReturnType<typeof mountApp>['store']>;
    emitted: { name: string; payload: unknown }[];
    switchTo(code: string): void;
}

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await frame();
    await new Promise((resolve) => setTimeout(resolve, 0));
};

/** Every element with this tag under the root, through the shadow roots, in document order */
function deep(root: ParentNode, tag: string): HTMLElement[] {
    const found: HTMLElement[] = [];
    for (const child of Array.from(root.children)) {
        if (child.localName === tag) found.push(child as HTMLElement);
        if (child.shadowRoot) found.push(...deep(child.shadowRoot, tag));
        found.push(...deep(child, tag));
    }
    return found;
}

const messagesOf = (count: number): { id: string; author: string; text: string; time: string }[] =>
    Array.from({ length: count }, (_v, i) => ({ id: `m${i}`, author: i % 2 === 0 ? 'Ada' : 'Minion', text: `Message ${i}`, time: '10:00' }));

async function mount(count = 3): Promise<Chat> {
    if (!registered) {
        registerAll();
        registered = true;
    }
    const host = globalThis.document.body.appendChild(globalThis.document.createElement('div'));
    host.style.cssText = 'inline-size: 480px; block-size: 420px; display: flex; flex-direction: column';
    const locale = registerLocaleStep(overlays);
    const emitted: { name: string; payload: unknown }[] = [];
    const document = {
        locale: 'en',
        data: { messages: messagesOf(count) },
        app: { component: 'chatView', children: { messages: { '<-records': '$.data.messages' } } }
    } as unknown as AppDocument;
    const result = mountApp(host, document, library, { onEmit: (name: string, payload: unknown) => emitted.push({ name, payload }) });
    if (!result.store) throw new Error(`chatView did not mount: ${result.errors.map((error) => `${error.code} ${error.message}`).join('; ')}`);
    mounted.push({ host, dispose: () => result.dispose(), unregister: () => locale.unregister() });
    await settle();
    return { host, store: result.store, emitted, switchTo: (code) => void locale.switchTo(code) };
}

const INPUT = '$.app.children.composer.children.input';
const valueOf = (chat: Chat): unknown => chat.store.get(`${INPUT}.value`);
const textarea = (chat: Chat): HTMLTextAreaElement => deep(chat.host, 'ui-textarea-field')[0]?.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement;
const sendButton = (chat: Chat): HTMLButtonElement => deep(chat.host, 'ui-button')[0]?.shadowRoot?.querySelector('button') as HTMLButtonElement;
const type = async (chat: Chat, text: string): Promise<void> => {
    await userEvent.click(textarea(chat));
    await userEvent.type(textarea(chat), text);
    await settle();
};

describe('chatView in Chromium', () => {
    afterEach(() => {
        for (const entry of mounted.splice(0)) {
            entry.dispose();
            entry.unregister();
            entry.host.remove();
        }
    });

    it('should draw the messages of the linked array above the composer', async () => {
        // Arrange and Act
        const chat = await mount(3);

        // Assert
        const list = deep(chat.host, 'ui-message-list')[0] as HTMLElement;
        const composer = deep(chat.host, 'ui-textarea-field')[0] as HTMLElement;
        expect(list).toBeDefined();
        expect(list.getBoundingClientRect().bottom).toBeLessThanOrEqual(composer.getBoundingClientRect().top + 1);
        expect(list.getBoundingClientRect().height).toBeGreaterThan(100);
        expect(deep(chat.host, 'ui-record-grid')[0]?.shadowRoot?.querySelectorAll('.slot:not([hidden])')).toHaveLength(3);
    });

    it('should emit chat.send with the text and clear the composer when the Send button is pressed', async () => {
        // Arrange
        const chat = await mount();
        await type(chat, 'Hello there');

        // Act
        sendButton(chat).click();
        await settle();

        // Assert
        expect(chat.emitted).toEqual([{ name: 'chat.send', payload: 'Hello there' }]);
        expect(valueOf(chat)).toBe('');
        expect(textarea(chat).value).toBe('');
    });

    it('should emit chat.send with the text and clear the composer when Enter is pressed', async () => {
        // Arrange
        const chat = await mount();
        await type(chat, 'Hello there');

        // Act
        await userEvent.keyboard('{Enter}');
        await settle();

        // Assert
        expect(chat.emitted).toEqual([{ name: 'chat.send', payload: 'Hello there' }]);
        expect(valueOf(chat)).toBe('');
        expect(textarea(chat).value).toBe('');
    });

    it('should add a line and send nothing when Shift+Enter is pressed, and send both lines on Enter', async () => {
        // Arrange
        const chat = await mount();
        await type(chat, 'first');

        // Act
        await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
        await userEvent.keyboard('second');
        await settle();

        // Assert
        expect(chat.emitted).toEqual([]);
        expect(valueOf(chat)).toBe('first\nsecond');
        await userEvent.keyboard('{Enter}');
        await settle();
        expect(chat.emitted).toEqual([{ name: 'chat.send', payload: 'first\nsecond' }]);
    });

    it('should send nothing for an empty composer or one with only spaces and lines, by button and by Enter', async () => {
        // Arrange
        const chat = await mount();

        // Act
        sendButton(chat).click();
        await settle();
        await userEvent.click(textarea(chat));
        await userEvent.keyboard('{Enter}');
        await userEvent.type(textarea(chat), '   ');
        await userEvent.keyboard('{Enter}');
        sendButton(chat).click();
        await settle();

        // Assert
        expect(chat.emitted).toEqual([]);
    });

    it('should grow the composer with its text, up to the lines typed', async () => {
        // Arrange
        const chat = await mount();
        const before = textarea(chat).getBoundingClientRect().height;

        // Act
        await type(chat, 'one');
        for (const line of ['two', 'three', 'four']) {
            await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
            await userEvent.keyboard(line);
        }
        await settle();

        // Assert
        expect(textarea(chat).getBoundingClientRect().height).toBeGreaterThan(before + 20);
    });

    it('should keep the newest message in view when a message is appended to the linked array', async () => {
        // Arrange
        const chat = await mount(80);
        const scroller = deep(chat.host, 'ui-record-grid')[0]?.shadowRoot?.querySelector('.grid') as HTMLElement;
        expect(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop).toBeLessThanOrEqual(2);

        // Act
        chat.store.set('$.data.messages.80', { id: 'm80', author: 'Minion', text: 'A new reply\n\nwith two paragraphs', time: '10:01' });
        await settle();

        // Assert
        expect(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop).toBeLessThanOrEqual(2);
    });

    it('should show the German texts after the locale is switched', async () => {
        // Arrange
        const chat = await mount();

        // Act
        chat.switchTo('de');
        await settle();

        // Assert
        expect(textarea(chat).placeholder).toBe('Nachricht eingeben');
        expect(deep(chat.host, 'ui-button')[0]?.shadowRoot?.querySelector('.label')?.textContent?.trim()).toBe('Senden');
        expect(deep(chat.host, 'ui-textarea-field')[0]?.shadowRoot?.querySelector('label')?.textContent?.trim()).toBe('Nachricht');
    });

    it('should send the text under the event name an application gives the emit command', async () => {
        // Arrange
        if (!registered) {
            registerAll();
            registered = true;
        }
        const host = globalThis.document.body.appendChild(globalThis.document.createElement('div'));
        host.style.cssText = 'inline-size: 480px; block-size: 420px';
        const emitted: { name: string; payload: unknown }[] = [];
        const document = {
            locale: 'en',
            data: { messages: [] },
            app: {
                component: 'chatView',
                children: {
                    messages: { '<-records': '$.data.messages' },
                    composer: { children: { input: { _placeholder: 'Ask the minion', on: { send: [{ command: 'emit', target: 'ask.minion' }, { command: 'clear' }] } } } }
                }
            }
        } as unknown as AppDocument;
        const result = mountApp(host, document, library, { onEmit: (name: string, payload: unknown) => emitted.push({ name, payload }) });
        if (!result.store) throw new Error(`chatView did not mount: ${result.errors.map((error) => `${error.code} ${error.message}`).join('; ')}`);
        mounted.push({ host, dispose: () => result.dispose(), unregister: () => undefined });
        await settle();
        const area = deep(host, 'ui-textarea-field')[0]?.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement;

        // Act
        await userEvent.click(area);
        await userEvent.type(area, 'Hi');
        await userEvent.keyboard('{Enter}');
        await settle();

        // Assert
        expect(area.placeholder).toBe('Ask the minion');
        expect(emitted).toEqual([{ name: 'ask.minion', payload: 'Hi' }]);
        expect(area.value).toBe('');
    });
});
