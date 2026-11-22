import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const body = (element: Element): HTMLElement => element.shadowRoot?.querySelector('.rich-text') as HTMLElement;
const one = (element: Element, selector: string): HTMLElement => body(element).querySelector(selector) as HTMLElement;
const all = (element: Element, selector: string): HTMLElement[] => Array.from(body(element).querySelectorAll<HTMLElement>(selector));
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const events = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};

const VALUE = {
    blocks: {
        bHead: { order: 'a', type: 'heading', level: 1, runs: [{ text: 'Title' }] },
        bPara: {
            order: 'b',
            type: 'paragraph',
            runs: [
                { text: 'Some ' },
                { text: 'bold', marks: ['bold'] },
                { text: ', ' },
                { text: 'both', marks: ['italic', 'bold'] },
                { text: ', ' },
                { text: 'gone', marks: ['strike'] },
                { text: ', ' },
                { text: 'code', marks: ['code'] },
                { text: ' and ' },
                { text: 'a ', link: 'https://x.example/a' },
                { text: 'link', marks: ['bold'], link: 'https://x.example/a' },
                { text: '.\nNext line' }
            ]
        },
        bOne: { order: 'c', type: 'bullet', indent: 0, runs: [{ text: 'one' }] },
        bNested: { order: 'd', type: 'numbered', indent: 1, runs: [{ text: 'nested' }] },
        bTwo: { order: 'e', type: 'bullet', indent: 0, runs: [{ text: 'two' }] },
        bDone: { order: 'f', type: 'check', indent: 0, checked: true, runs: [{ text: 'done' }] },
        bQuote: { order: 'g', type: 'quote', runs: [{ text: 'quoted' }] },
        bCode: { order: 'h', type: 'code', language: 'ts', runs: [{ text: 'let a = 1;' }] },
        bRule: { order: 'i', type: 'divider', runs: [] }
    }
};

const mountValue = async (value: unknown, state: Record<string, unknown> = {}) => {
    const mounted = mountComponent('richText', { value, ...state });
    await flush();
    return mounted;
};

describe('richText in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should draw every block type and mark with its own element, in order', async () => {
        // Arrange
        const mounted = await mountValue(VALUE);

        // Assert
        expect(Array.from(body(mounted.element).children).map((child) => child.tagName.toLowerCase())).toEqual(['h2', 'p', 'ul', 'ul', 'blockquote', 'pre', 'hr']);
        expect(one(mounted.element, 'h2').textContent).toBe('Title');
        expect(one(mounted.element, 'p strong').textContent).toBe('bold');
        expect(one(mounted.element, 'p strong > em').textContent).toBe('both');
        expect(one(mounted.element, 'p s').textContent).toBe('gone');
        expect(one(mounted.element, 'p code.inline').textContent).toBe('code');
        expect(one(mounted.element, 'pre code').textContent).toBe('let a = 1;');
        expect(one(mounted.element, 'pre').dataset['language']).toBe('ts');
        expect(one(mounted.element, 'p').textContent).toContain('.\nNext line');
    });

    it('should nest list items by indent and draw a check item with a disabled, ticked box', async () => {
        // Arrange
        const mounted = await mountValue(VALUE);

        // Assert
        const items = all(mounted.element, 'ul:not(.checks) > li');
        expect(items.map((item) => item.dataset['key'])).toEqual(['bOne', 'bTwo']);
        expect(items[0]?.querySelector('ol > li')?.textContent).toBe('nested');
        const box = one(mounted.element, 'ul.checks > li > input') as HTMLInputElement;
        expect(box.checked && box.disabled).toBe(true);
        expect(one(mounted.element, 'ul.checks > li').hasAttribute('data-checked')).toBe(true);
    });

    it('should join runs that share a link into one link that raises press, and never navigate', async () => {
        // Arrange
        const mounted = await mountValue(VALUE);
        const pressed = events(mounted.element, 'press');

        // Act
        const links = all(mounted.element, '[role=link]');
        await userEvent.click(links[0] as HTMLElement);
        (links[0] as HTMLElement).focus();
        await userEvent.keyboard('{Enter}');

        // Assert
        expect(links).toHaveLength(1);
        expect(links[0]?.textContent).toBe('a link');
        expect(links[0]?.hasAttribute('href')).toBe(false);
        expect(pressed).toEqual([{ href: 'https://x.example/a' }, { href: 'https://x.example/a' }]);
    });

    it('should drop an unsafe link and show a script-like text as its characters', async () => {
        // Arrange
        const value = { blocks: { bA: { order: 'a', type: 'paragraph', runs: [{ text: '<img src=x onerror=alert(1)>', link: 'javascript:alert(1)' }] } } };

        // Act
        const mounted = await mountValue(value);

        // Assert
        expect(all(mounted.element, '[role=link]')).toHaveLength(0);
        expect(all(mounted.element, 'img')).toHaveLength(0);
        expect(one(mounted.element, 'p').textContent).toBe('<img src=x onerror=alert(1)>');
    });

    it('should redraw when a run inside the value changes', async () => {
        // Arrange
        const mounted = await mountValue(VALUE);

        // Act
        mounted.store.set('$.app.value.blocks.bHead.runs', [{ text: 'Renamed' }]);
        await flush();

        // Assert
        expect(one(mounted.element, 'h2').textContent).toBe('Renamed');
    });

    it('should show _empty and mark the host when there are no blocks', async () => {
        // Arrange
        const mounted = await mountValue({ blocks: {} }, { _empty: 'Nothing here' });

        // Assert
        expect(mounted.element.hasAttribute('data-empty')).toBe(true);
        expect(one(mounted.element, 'p.empty').textContent).toBe('Nothing here');
    });
});
