import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

type Commanded = Element & { commands: Record<string, (value?: unknown) => void> };

const command = (element: Element, name: string, value?: unknown): void => (element as Commanded).commands[name]?.(value);
const items = (element: Element): HTMLElement[] => Array.from((element.shadowRoot as ShadowRoot).querySelectorAll<HTMLElement>('.item'));
const toastOf = (item: HTMLElement): Element => (item.querySelector('sui-node') as Element).firstElementChild as Element;
const toastPart = (item: HTMLElement, selector: string): HTMLElement | null =>
    (toastOf(item).shadowRoot as ShadowRoot).querySelector<HTMLElement>(selector);
const texts = (element: Element): string[] => items(element).map((item) => toastPart(item, '.text')?.textContent?.trim() ?? '');
const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};
const runtimeItems = (store: { get<T>(path: string): T }): Record<string, unknown> =>
    store.get<Record<string, unknown>>('$.runtime.nodes.app.items');

function findDeep(root: ParentNode, tag: string): Element | undefined {
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        if (candidate.localName === tag) return candidate;
        const inner = candidate.shadowRoot ? findDeep(candidate.shadowRoot, tag) : undefined;
        if (inner) return inner;
    }
    return undefined;
}

const messages = {
    saved: { tone: 'success', _title: 'Saved', _text: 'Order saved' },
    second: { _text: 'Second' },
    third: { _text: 'Third' },
    fourth: { _text: 'Fourth' },
    failed: { tone: 'danger', _text: 'Failed' },
    undo: {
        _text: 'Deleted',
        action: {
            component: 'button',
            _title: 'Undo',
            on: { press: { command: 'set', target: '$.data.undone', value: true } }
        }
    }
};

describe('toastRegion in Chromium', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });
    afterEach(() => {
        mountComponent.unmountAll();
        vi.useRealTimers();
    });

    it('should show a toast from a message and label the region as a polite landmark', async () => {
        // Arrange
        const mounted = mountComponent('toastRegion', { messages, _label: 'Alerts' });
        await flush();

        // Act
        command(mounted.element, 'show', 'saved');

        // Assert
        const region = (mounted.element.shadowRoot as ShadowRoot).querySelector('.region') as HTMLElement;
        expect(region.getAttribute('role')).toBe('region');
        expect(region.getAttribute('aria-live')).toBe('polite');
        expect(region.getAttribute('aria-label')).toBe('Alerts');
        expect(items(mounted.element)).toHaveLength(1);
        expect(toastPart(items(mounted.element)[0] as HTMLElement, '.title')?.textContent?.trim()).toBe('Saved');
        expect(toastOf(items(mounted.element)[0] as HTMLElement).getAttribute('tone')).toBe('success');
    });

    it('should queue toasts beyond max and show the next one when a toast expires', async () => {
        // Arrange
        const mounted = mountComponent('toastRegion', { messages, max: 2 });
        await flush();

        // Act
        for (const key of ['saved', 'second', 'third', 'fourth']) command(mounted.element, 'show', key);
        const before = texts(mounted.element);
        vi.advanceTimersByTime(5000);
        const afterFirst = texts(mounted.element);
        vi.advanceTimersByTime(5000);

        // Assert
        expect(before).toEqual(['Order saved', 'Second']);
        expect(afterFirst).toEqual(['Third', 'Fourth']);
        expect(items(mounted.element)).toHaveLength(0);
    });

    it('should keep a danger toast until it is closed', async () => {
        // Arrange
        const mounted = mountComponent('toastRegion', { messages });
        await flush();
        command(mounted.element, 'show', 'failed');
        command(mounted.element, 'show', 'second');

        // Act
        vi.advanceTimersByTime(60_000);
        const remaining = texts(mounted.element);
        const closed = vi.fn();
        mounted.element.addEventListener('close', (event) => closed((event as CustomEvent).detail));
        (toastPart(items(mounted.element)[0] as HTMLElement, '.close') as HTMLElement).click();

        // Assert
        expect(remaining).toEqual(['Failed']);
        expect(closed).toHaveBeenCalledWith({ key: 'failed' });
        expect(items(mounted.element)).toHaveLength(0);
    });

    it('should let a set duration apply to danger and treat 0 as sticky', async () => {
        // Arrange
        const timed = mountComponent('toastRegion', { messages, duration: 1000 });
        const sticky = mountComponent('toastRegion', { messages, duration: 0 });
        await flush();

        // Act
        command(timed.element, 'show', 'failed');
        command(sticky.element, 'show', 'second');
        vi.advanceTimersByTime(1000);

        // Assert
        expect(items(timed.element)).toHaveLength(0);
        expect(items(sticky.element)).toHaveLength(1);
    });

    it('should pause the timer while the pointer is over a toast and restart it on leave', async () => {
        // Arrange
        const mounted = mountComponent('toastRegion', { messages });
        await flush();
        command(mounted.element, 'show', 'second');
        const item = items(mounted.element)[0] as HTMLElement;

        // Act
        vi.advanceTimersByTime(3000);
        item.dispatchEvent(new PointerEvent('pointerenter'));
        vi.advanceTimersByTime(60_000);
        const held = items(mounted.element).length;
        item.dispatchEvent(new PointerEvent('pointerleave'));
        vi.advanceTimersByTime(4999);
        const waiting = items(mounted.element).length;
        vi.advanceTimersByTime(1);

        // Assert
        expect(held).toBe(1);
        expect(waiting).toBe(1);
        expect(items(mounted.element)).toHaveLength(0);
    });

    it('should pause the timer while focus is inside a toast and restart it when focus leaves', async () => {
        // Arrange
        const mounted = mountComponent('toastRegion', { messages });
        await flush();
        command(mounted.element, 'show', 'second');
        const item = items(mounted.element)[0] as HTMLElement;
        const close = toastPart(item, '.close') as HTMLElement;

        // Act
        close.focus();
        vi.advanceTimersByTime(60_000);
        const held = items(mounted.element).length;
        close.blur();
        vi.advanceTimersByTime(5000);

        // Assert
        expect(held).toBe(1);
        expect(items(mounted.element)).toHaveLength(0);
    });

    it('should remove every toast and the queue on dismissAll', async () => {
        // Arrange
        const mounted = mountComponent('toastRegion', { messages, max: 1 });
        await flush();
        for (const key of ['saved', 'second', 'third']) command(mounted.element, 'show', key);

        // Act
        command(mounted.element, 'dismissAll');
        vi.advanceTimersByTime(60_000);

        // Assert
        expect(items(mounted.element)).toHaveLength(0);
        expect(Object.keys(runtimeItems(mounted.store))).toEqual([]);
    });

    it('should run the on.press of an Undo action with an absolute data target', async () => {
        // Arrange
        const mounted = mountComponent('toastRegion', { messages }, { data: { undone: false } });
        await flush();
        command(mounted.element, 'show', 'undo');
        const action = toastPart(items(mounted.element)[0] as HTMLElement, '.action sui-node') as HTMLElement;
        const button = (action.firstElementChild as Element).shadowRoot?.querySelector('button') as HTMLButtonElement;

        // Act
        button.click();

        // Assert
        expect(mounted.store.get<boolean>('$.data.undone')).toBe(true);
    });

    it('should show the German message text and close label after a language switch', async () => {
        // Arrange
        const mounted = mountComponent(
            'toastRegion',
            { messages },
            { locales: { de: { messages: { second: { _text: 'Zweite Nachricht' } } } } }
        );
        await flush();
        mounted.setLocale('de');

        // Act
        command(mounted.element, 'show', 'second');
        await flush();

        // Assert
        expect(texts(mounted.element)).toEqual(['Zweite Nachricht']);
        expect(toastPart(items(mounted.element)[0] as HTMLElement, '.close')?.getAttribute('aria-label')).toBe('Schließen');
        expect((mounted.element.shadowRoot as ShadowRoot).querySelector('.region')?.getAttribute('aria-label')).toBe(
            'Benachrichtigungen'
        );
    });

    it('should write toasts only under the runtime branch, never into $.app', async () => {
        // Arrange
        const mounted = mountComponent('toastRegion', { messages });
        await flush();
        const before = JSON.stringify(mounted.store.get<unknown>('$.app.messages'));

        // Act
        command(mounted.element, 'show', 'saved');

        // Assert
        expect(Object.keys(runtimeItems(mounted.store))).toHaveLength(1);
        expect(JSON.stringify(mounted.store.get<unknown>('$.app.messages'))).toBe(before);
        expect(Object.keys(mounted.store.get<Record<string, unknown>>('$.app'))).not.toContain('t1');
    });

    it('should throw for an unknown message key', async () => {
        // Arrange
        const mounted = mountComponent('toastRegion', { messages });
        await flush();

        // Act
        const run = (): void => command(mounted.element, 'show', 'missing');

        // Assert
        expect(run).toThrow(/missing/);
        expect(items(mounted.element)).toHaveLength(0);
    });

    it('should be in every app as the default toasts slot', async () => {
        // Arrange
        const mounted = mountComponent('app');
        await flush();

        // Act
        const region = findDeep(mounted.host, 'ui-toast-region');

        // Assert
        expect(region).toBeDefined();
        expect(mounted.store.get<Record<string, unknown>>('$.app.toasts')['component']).toBe('toastRegion');
    });
});
