import { report } from '@punyts/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const frames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};
/** Frames for the resize observers, the height map, the scroll to the end and the pool refresh to settle */
const settle = async (): Promise<void> => {
    await frames(8);
    await new Promise((resolve) => setTimeout(resolve, 0));
};

interface Message {
    id: string;
    author: string;
    text: string;
    time: string;
    streaming?: boolean;
}
const message = (index: number, text = `Message number ${index}`): Message => ({ id: `m${index}`, author: index % 2 === 0 ? 'Ada Lovelace' : 'Minion', text, time: `10:${String(index % 60).padStart(2, '0')}` });
/** Messages of different lengths: some are one line, some are several paragraphs */
const messages = (count: number): Message[] =>
    Array.from({ length: count }, (_v, i) => message(i, i % 5 === 0 ? `Message ${i}\n\nA second paragraph for message ${i}.\n\nAnd a third one.` : `Message ${i}`));

const grid = (mounted: MountedComponent): HTMLElement => (mounted.element.shadowRoot as ShadowRoot).querySelector('ui-record-grid') as HTMLElement;
const scroller = (mounted: MountedComponent): HTMLElement => (grid(mounted).shadowRoot as ShadowRoot).querySelector<HTMLElement>('.grid') as HTMLElement;
/** How far the view is from the end of the content, in pixels */
const gap = (mounted: MountedComponent): number => scroller(mounted).scrollHeight - scroller(mounted).clientHeight - scroller(mounted).scrollTop;
const button = (mounted: MountedComponent): HTMLButtonElement | null => (mounted.element.shadowRoot as ShadowRoot).querySelector<HTMLButtonElement>('.new');
/** The text of a node and of every shadow root under it */
const deepText = (node: Node): string => (node instanceof Element && node.shadowRoot ? deepText(node.shadowRoot) : '') + Array.from(node.childNodes).map((child) => (child.nodeType === Node.TEXT_NODE ? child.textContent ?? '' : deepText(child))).join('');
const shownSlots = (mounted: MountedComponent): HTMLElement[] =>
    Array.from((grid(mounted).shadowRoot as ShadowRoot).querySelectorAll<HTMLElement>('.slot')).filter((slot) => !slot.hidden);

const mountList = async (records: Message[], state: Record<string, unknown> = {}, options: Parameters<typeof mountComponent>[2] = {}): Promise<MountedComponent> => {
    const mounted = mountComponent('messageList', { '<-records': '$.data.messages', ...state }, { data: { messages: records }, ...options });
    const host = mounted.element as HTMLElement;
    host.style.display = 'block';
    host.style.inlineSize = '420px';
    host.style.blockSize = '360px';
    await settle();
    return mounted;
};
const append = (mounted: MountedComponent, record: Message): void => {
    const current = mounted.store.get<unknown[]>('$.data.messages');
    mounted.store.set(`$.data.messages.${current.length}`, record);
};

describe('messageList in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
        vi.restoreAllMocks();
    });

    it('should show the newest message at the bottom with one column and the default row', async () => {
        // Arrange and Act
        const mounted = await mountList(messages(200));

        // Assert
        expect(gap(mounted)).toBeLessThanOrEqual(2);
        expect(mounted.store.get<number>('$.app.body.colCount')).toBe(1);
        expect(mounted.store.get<boolean>('$.app.pinned')).toBe(true);
        const last = shownSlots(mounted).find((slot) => deepText(slot).includes('Message 199'));
        expect(last).toBeDefined();
        expect(button(mounted)).toBeNull();
    });

    it('should draw each message with an avatar, a Markdown body and the time', async () => {
        // Arrange and Act
        const mounted = await mountList([message(0, 'A **bold** word'), message(1, 'Second')]);

        // Assert
        const slots = shownSlots(mounted);
        expect(slots).toHaveLength(2);
        const first = slots[0] as HTMLElement;
        const deep = (root: ParentNode, selector: string): Element | null => {
            const direct = root.querySelector(selector);
            if (direct) return direct;
            for (const child of Array.from(root.querySelectorAll('*'))) {
                const found = child.shadowRoot ? deep(child.shadowRoot, selector) : null;
                if (found) return found;
            }
            return null;
        };
        const text = (node: Node): string => (node instanceof Element && node.shadowRoot ? text(node.shadowRoot) : '') + Array.from(node.childNodes).map((child) => (child.nodeType === Node.TEXT_NODE ? child.textContent ?? '' : text(child))).join('');
        expect(deep(first, 'ui-avatar')).not.toBeNull();
        const markdown = deep(first, 'ui-markdown') as Element;
        expect(markdown.shadowRoot?.querySelector('strong')?.textContent).toBe('bold');
        expect(text(first)).toContain('10:00');
        expect(text(deep(first, 'ui-avatar') as Element)).toContain('AL');
    });

    it('should stay pinned to the bottom when a message is appended', async () => {
        // Arrange
        const mounted = await mountList(messages(60));

        // Act and Assert
        for (let i = 60; i < 66; i++) {
            append(mounted, message(i, `A new message ${i}\n\nwith two paragraphs`));
            await settle();
            expect(gap(mounted), `appended ${i}`).toBeLessThanOrEqual(2);
        }
        expect(mounted.store.get<boolean>('$.app.pinned')).toBe(true);
        expect(button(mounted)).toBeNull();
    });

    it('should stay pinned to the bottom while the last message grows, as a streamed reply does', async () => {
        // Arrange
        const mounted = await mountList(messages(30));
        append(mounted, { ...message(30, ''), streaming: true });
        await settle();
        const index = 30;
        let text = '';

        // Act and Assert
        for (let chunk = 0; chunk < 12; chunk++) {
            text += `Chunk ${chunk} of the reply.\n\n`;
            mounted.store.set(`$.data.messages.${index}.text`, text);
            await frames(3);
            expect(gap(mounted), `chunk ${chunk}`).toBeLessThanOrEqual(2);
        }
        mounted.store.set(`$.data.messages.${index}.streaming`, false);
        await settle();
        expect(gap(mounted)).toBeLessThanOrEqual(2);
        expect(button(mounted)).toBeNull();
    });

    it('should not move after the user scrolls up, show the button when a message arrives and take the view to the end when it is pressed', async () => {
        // Arrange
        const mounted = await mountList(messages(120));
        scroller(mounted).scrollTop -= 500;
        await settle();
        const top = scroller(mounted).scrollTop;
        expect(mounted.store.get<boolean>('$.app.pinned')).toBe(false);
        expect(button(mounted)).toBeNull();

        // Act
        append(mounted, message(120, 'Something new'));
        await settle();

        // Assert
        expect(Math.abs(scroller(mounted).scrollTop - top)).toBeLessThan(1.5);
        expect(button(mounted)?.textContent.trim()).toBe('New messages');
        button(mounted)?.click();
        await settle();
        expect(gap(mounted)).toBeLessThanOrEqual(2);
        expect(button(mounted)).toBeNull();
        expect(mounted.store.get<boolean>('$.app.pinned')).toBe(true);
        append(mounted, message(121, 'And another'));
        await settle();
        expect(gap(mounted)).toBeLessThanOrEqual(2);
    });

    it('should show the button when the last message grows while the user is away, and hide it when the user scrolls back to the end', async () => {
        // Arrange
        const mounted = await mountList(messages(120));
        scroller(mounted).scrollTop -= 500;
        await settle();

        // Act
        mounted.store.set('$.data.messages.119.text', 'The last message is longer now\n\nwith more paragraphs\n\nand more');
        await settle();

        // Assert
        expect(button(mounted)).not.toBeNull();
        scroller(mounted).scrollTop = scroller(mounted).scrollHeight;
        await settle();
        expect(button(mounted)).toBeNull();
        expect(mounted.store.get<boolean>('$.app.pinned')).toBe(true);
    });

    it('should not show the button for an edit of a message above the newest one', async () => {
        // Arrange
        const mounted = await mountList(messages(120));
        scroller(mounted).scrollTop -= 500;
        await settle();

        // Act
        mounted.store.set('$.data.messages.3.text', 'Edited');
        await settle();

        // Assert
        expect(button(mounted)).toBeNull();
    });

    it('should run scrollToEnd as a command', async () => {
        // Arrange
        const mounted = await mountList(messages(120));
        scroller(mounted).scrollTop = 0;
        await settle();
        append(mounted, message(120));
        await settle();
        expect(button(mounted)).not.toBeNull();

        // Act
        (mounted.element as Element & { commands: { scrollToEnd(): void } }).commands.scrollToEnd();
        await settle();

        // Assert
        expect(gap(mounted)).toBeLessThanOrEqual(2);
        expect(button(mounted)).toBeNull();
    });

    it('should keep the pool of slots bounded with 5,000 messages and show the newest at the bottom', async () => {
        // Arrange and Act
        const mounted = await mountList(messages(5000));

        // Assert
        expect(gap(mounted)).toBeLessThanOrEqual(2);
        expect(mounted.store.get<number>('$.app.body.count')).toBe(5000);
        const slots = (grid(mounted).shadowRoot as ShadowRoot).querySelectorAll('.slot').length;
        expect(slots).toBeGreaterThan(0);
        expect(slots).toBeLessThanOrEqual(200);
        scroller(mounted).scrollTop = 0;
        await settle();
        expect((grid(mounted).shadowRoot as ShadowRoot).querySelectorAll('.slot').length).toBeLessThanOrEqual(200);
        expect(shownSlots(mounted).some((slot) => deepText(slot).includes('Message 0'))).toBe(true);
    });

    it('should show the button text in German', async () => {
        // Arrange
        const mounted = await mountList(messages(120), {}, { locale: 'de' });
        scroller(mounted).scrollTop -= 500;
        await settle();

        // Act
        append(mounted, message(120));
        await settle();

        // Assert
        expect(button(mounted)?.textContent.trim()).toBe('Neue Nachrichten');
    });

    it('should report no error when the default row is shown in German', async () => {
        // Arrange
        const reported: unknown[] = [];
        vi.spyOn(report, 'error').mockImplementation((...args: unknown[]) => {
            reported.push(args);
        });

        // Act
        const mounted = await mountList(messages(20), {}, { locale: 'de' });
        mounted.setLocale('en');
        await settle();

        // Assert
        expect(reported).toEqual([]);
    });

    it('should use the row template the application gives it', async () => {
        // Arrange and Act
        const mounted = await mountList(messages(5), { row: { component: 'text', '<-_text': '$row.text' } });

        // Assert
        const first = shownSlots(mounted)[0] as HTMLElement;
        expect(first.querySelector('ui-text')).not.toBeNull();
        expect(first.querySelector('ui-avatar')).toBeNull();
    });
});
