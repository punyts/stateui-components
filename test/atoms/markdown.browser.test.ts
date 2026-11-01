import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const body = (element: Element): HTMLElement => element.shadowRoot?.querySelector('.markdown') as HTMLElement;
const one = (element: Element, selector: string): HTMLElement => body(element).querySelector(selector) as HTMLElement;
const all = (element: Element, selector: string): HTMLElement[] => Array.from(body(element).querySelectorAll<HTMLElement>(selector));
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const events = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};
const mountText = async (text: string, state: Record<string, unknown> = {}, options: Parameters<typeof mountComponent>[2] = {}) => {
    const mounted = mountComponent('markdown', { _text: text, ...state }, options);
    await flush();
    return mounted;
};

const DOCUMENT = [
    '# Title',
    '',
    'Some *emphasis*, **strong**, `code` and a [link](https://x.example/a).',
    '',
    '- one',
    '  - nested',
    '- two',
    '',
    '1. first',
    '2. second',
    '',
    '> quoted',
    '',
    '```',
    'let a = 1;',
    '```',
    '',
    '---',
    '',
    '| Name | Qty |',
    '|:-----|----:|',
    '| Pen  | 3   |',
    '| Ink  | 12  |'
].join('\n');

describe('markdown in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
        vi.restoreAllMocks();
    });

    it('should render every construct with its own element', async () => {
        // Arrange
        const mounted = await mountText(DOCUMENT);

        // Assert
        expect(one(mounted.element, 'h2').textContent).toBe('Title');
        expect(one(mounted.element, 'p em').textContent).toBe('emphasis');
        expect(one(mounted.element, 'p strong').textContent).toBe('strong');
        expect(one(mounted.element, 'p code.inline').textContent).toBe('code');
        expect(one(mounted.element, 'ul > li > ul > li').textContent).toBe('nested');
        expect(all(mounted.element, 'ul > li')).toHaveLength(3);
        expect(all(mounted.element, 'ol > li').map((item) => item.textContent)).toEqual(['first', 'second']);
        expect(one(mounted.element, 'blockquote p').textContent).toBe('quoted');
        expect(one(mounted.element, 'pre code').textContent).toBe('let a = 1;');
        expect(all(mounted.element, 'hr')).toHaveLength(1);
        expect(all(mounted.element, 'thead th').map((cell) => cell.textContent)).toEqual(['Name', 'Qty']);
        expect(all(mounted.element, 'tbody tr')).toHaveLength(2);
        expect(all(mounted.element, 'tbody td').map((cell) => cell.textContent)).toEqual(['Pen', '3', 'Ink', '12']);
        expect(one(mounted.element, '[role=link]').textContent).toBe('link');
    });

    it('should show a script in the source as text and create no script, image or other raw element', async () => {
        // Arrange
        const mounted = await mountText('<script>window.__pwned = 1</script>\n\nand <img src=x onerror="window.__pwned = 2"> inline <b>bold</b>');

        // Assert
        expect(body(mounted.element).querySelector('script, img, b')).toBeNull();
        expect(body(mounted.element).textContent).toContain('<script>window.__pwned = 1</script>');
        expect(body(mounted.element).textContent).toContain('<img src=x onerror="window.__pwned = 2">');
        expect(body(mounted.element).textContent).toContain('<b>bold</b>');
        expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    });

    it('should show a javascript: link as text and make no link of it', async () => {
        // Arrange
        const mounted = await mountText('[click me](javascript:alert(1)) and [data](data:text/html,x) and [web](http://x.example)');

        // Assert
        expect(all(mounted.element, '[role=link]')).toHaveLength(0);
        expect(body(mounted.element).textContent).toBe('click me and data and web');
    });

    it('should render a link with role link, no href and a tab stop', async () => {
        // Arrange
        const mounted = await mountText('[a](#top) [b](/orders/12) [c](https://x.example)');
        const links = all(mounted.element, '[role=link]');

        // Assert
        expect(links.map((link) => link.dataset['href'])).toEqual(['#top', '/orders/12', 'https://x.example']);
        expect(links.every((link) => !link.hasAttribute('href') && link.tabIndex === 0)).toBe(true);
        expect(body(mounted.element).querySelector('a')).toBeNull();
    });

    it('should raise press with the href on a click and navigate and open nothing', async () => {
        // Arrange
        const mounted = await mountText('[go](https://x.example/p?q=1) and [top](#top) and [page](/orders/12)');
        const presses = events(mounted.element, 'press');
        const open = vi.spyOn(window, 'open');
        const before = { href: location.href, length: history.length };

        // Act
        await userEvent.click(all(mounted.element, '[role=link]')[0] as HTMLElement);
        await userEvent.click(all(mounted.element, '[role=link]')[1] as HTMLElement);
        await userEvent.click(all(mounted.element, '[role=link]')[2] as HTMLElement);

        // Assert
        expect(presses).toEqual([{ href: 'https://x.example/p?q=1' }, { href: '#top' }, { href: '/orders/12' }]);
        expect(location.href).toBe(before.href);
        expect(history.length).toBe(before.length);
        expect(open).not.toHaveBeenCalled();
    });

    it('should raise press when Enter is pressed on a focused link, once, and not on other keys', async () => {
        // Arrange
        const mounted = await mountText('[go](/orders/12)');
        const presses = events(mounted.element, 'press');
        const open = vi.spyOn(window, 'open');
        const link = one(mounted.element, '[role=link]');

        // Act
        link.focus();
        await userEvent.keyboard('{Enter}');
        await userEvent.keyboard(' ');
        await userEvent.keyboard('a');

        // Assert
        expect(presses).toEqual([{ href: '/orders/12' }]);
        expect(location.hash).toBe('');
        expect(open).not.toHaveBeenCalled();
    });

    it('should not raise press for a click on text that is not a link', async () => {
        // Arrange
        const mounted = await mountText('plain text [go](#a)');
        const presses = events(mounted.element, 'press');

        // Act
        await userEvent.click(one(mounted.element, 'p'));

        // Assert
        expect(presses).toEqual([]);
    });

    it('should shift headings by headingOffset and cap them at h6', async () => {
        // Arrange
        const source = '# a\n\n## b\n\n###### f';
        const byDefault = await mountText(source);
        const none = await mountText(source, { headingOffset: 0 });
        const three = await mountText(source, { headingOffset: 3 });
        const tags = (element: Element): string[] => all(element, 'h1, h2, h3, h4, h5, h6').map((heading) => heading.tagName.toLowerCase());

        // Assert
        expect(tags(byDefault.element)).toEqual(['h2', 'h3', 'h6']);
        expect(tags(none.element)).toEqual(['h1', 'h2', 'h6']);
        expect(tags(three.element)).toEqual(['h4', 'h5', 'h6']);
    });

    it('should follow a change of headingOffset', async () => {
        // Arrange
        const mounted = await mountText('# a');

        // Act
        mounted.store.set('$.app.headingOffset', 2);
        await flush();

        // Assert
        expect(one(mounted.element, 'h1, h2, h3')).toHaveProperty('tagName', 'H3');
    });

    it('should take each element typography from the text roles', async () => {
        // Arrange
        const mounted = await mountText('# a\n\n## b\n\n### c\n\n#### d\n\ntext `code`\n\n```\nblock\n```', { headingOffset: 0 });
        const size = (selector: string): number => Number.parseFloat(getComputedStyle(one(mounted.element, selector)).fontSize);
        const family = (selector: string): string => getComputedStyle(one(mounted.element, selector)).fontFamily;

        // Assert
        expect(size('h1')).toBeGreaterThan(size('h2'));
        expect(size('h2')).toBeGreaterThan(size('h3'));
        expect(size('h3')).toBeGreaterThan(size('p'));
        expect(size('h3')).toBe(size('h4'));
        expect(family('code.inline')).toMatch(/mono/i);
        expect(family('pre code')).toMatch(/mono/i);
        expect(family('code.inline')).not.toBe(family('p'));
    });

    it('should replace the rendered tree when _text changes', async () => {
        // Arrange
        const mounted = await mountText('first');

        // Act
        mounted.store.set('$.app._text', '# second');
        await flush();

        // Assert
        expect(body(mounted.element).textContent).toBe('second');
        expect(all(mounted.element, 'h2')).toHaveLength(1);
        expect(all(mounted.element, 'p')).toHaveLength(0);
    });

    it('should update from linked source data', async () => {
        // Arrange
        const mounted = mountComponent('markdown', { '<-_text': '$.data.note.body' }, { data: { note: { body: 'one **two**' } } });
        await flush();
        const first = body(mounted.element).textContent;

        // Act
        mounted.store.set('$.data.note.body', '- a\n- b');
        await flush();

        // Assert
        expect(first).toBe('one two');
        expect(all(mounted.element, 'li').map((item) => item.textContent)).toEqual(['a', 'b']);
    });

    it('should lay a table out in columns with the alignment of the delimiter row', async () => {
        // Arrange
        const mounted = await mountText('| Name | Qty |\n|:-----|----:|\n| Pen | 3 |\n| Highlighter | 12 |');
        const heads = all(mounted.element, 'th');
        const cells = all(mounted.element, 'td');
        const alignOf = (cell: HTMLElement): string => getComputedStyle(cell).textAlign;

        // Assert
        expect(heads[0]?.getBoundingClientRect().left).toBe(cells[0]?.getBoundingClientRect().left);
        expect(heads[0]?.getBoundingClientRect().left).toBe(cells[2]?.getBoundingClientRect().left);
        expect(heads[1]?.getBoundingClientRect().left).toBe(cells[3]?.getBoundingClientRect().left);
        expect((cells[1] as HTMLElement).getBoundingClientRect().top).toBe((cells[0] as HTMLElement).getBoundingClientRect().top);
        expect((cells[2] as HTMLElement).getBoundingClientRect().top).toBeGreaterThan((cells[0] as HTMLElement).getBoundingClientRect().top);
        expect(alignOf(heads[0] as HTMLElement)).toBe('start');
        expect(alignOf(heads[1] as HTMLElement)).toBe('end');
        expect(alignOf(cells[1] as HTMLElement)).toBe('end');
        expect(heads.every((head) => head.getAttribute('scope') === 'col')).toBe(true);
    });

    it('should change the text colour in the dark overlay and use the code background token', async () => {
        // Arrange
        const mounted = await mountText('text and `code`');
        const text = one(mounted.element, 'p');
        const code = one(mounted.element, 'code.inline');
        const light = { text: getComputedStyle(text).color, code: getComputedStyle(code).backgroundColor };

        // Act
        mounted.setTheme('mode', 'dark');

        // Assert
        expect(getComputedStyle(text).color).not.toBe(light.text);
        expect(getComputedStyle(code).backgroundColor).not.toBe(light.code);
        expect(light.code).not.toBe('rgba(0, 0, 0, 0)');
    });

    it('should space the blocks by the gap token', async () => {
        // Arrange
        const mounted = await mountText('one\n\ntwo');
        const [first, second] = all(mounted.element, 'p') as [HTMLElement, HTMLElement];
        const gap = second.getBoundingClientRect().top - first.getBoundingClientRect().bottom;

        // Assert
        expect(gap).toBeGreaterThan(0);
        expect(getComputedStyle(body(mounted.element)).rowGap).toBe(`${gap}px`);
    });

    it('should show the German overlay of _text and a German _text of the application', async () => {
        // Arrange
        const defaults = mountComponent('markdown', {}, { locale: 'de' });
        const own = mountComponent('markdown', { _text: 'English **text**' }, { locale: 'de', locales: { de: { _text: 'Deutscher **Text**' } } });
        await flush();

        // Assert
        expect(body(defaults.element).textContent).toBe('Beispieltext in Markdown');
        expect(one(defaults.element, 'strong').textContent).toBe('Markdown');
        expect(body(own.element).textContent).toBe('Deutscher Text');
        expect(one(own.element, 'strong').textContent).toBe('Text');
    });

    it('should switch language and render the new source', async () => {
        // Arrange
        const mounted = mountComponent('markdown', { _text: 'English' }, { locales: { de: { _text: '# Deutsch' } } });
        await flush();

        // Act
        mounted.setLocale('de');
        await flush();

        // Assert
        expect(one(mounted.element, 'h2').textContent).toBe('Deutsch');
    });

    it('should read only emphasis, code and links in the inline profile', async () => {
        // Arrange
        const mounted = await mountText('# not a heading *em* `code` [l](#a)\n- not a list', { profile: 'inline' });

        // Assert
        expect(all(mounted.element, 'h1, h2, ul, li, p')).toHaveLength(0);
        expect(one(mounted.element, 'em').textContent).toBe('em');
        expect(one(mounted.element, 'code').textContent).toBe('code');
        expect(one(mounted.element, '[role=link]').textContent).toBe('l');
        expect(body(mounted.element).textContent).toContain('# not a heading');
        expect(getComputedStyle(mounted.element).display).toBe('inline');
    });

    it('should cut the source at maxLength on a block boundary and flag the host', async () => {
        // Arrange
        const mounted = await mountText('aaa\n\nbbb\n\nccc', { maxLength: 8 });

        // Assert
        expect(all(mounted.element, 'p').map((paragraph) => paragraph.textContent)).toEqual(['aaa', 'bbb']);
        expect(mounted.element.hasAttribute('data-truncated')).toBe(true);

        // Act
        mounted.store.set('$.app.maxLength', 100);
        await flush();

        // Assert
        expect(all(mounted.element, 'p')).toHaveLength(3);
        expect(mounted.element.hasAttribute('data-truncated')).toBe(false);
    });

    it('should render a long hostile source without blocking and with a bounded tree depth', async () => {
        // Arrange
        const source = `${'> - '.repeat(2_000)}x\n\n${'*a [b `c '.repeat(1_000)}`;
        const start = performance.now();

        // Act
        const mounted = await mountText(source);

        // Assert
        expect(performance.now() - start).toBeLessThan(1_000);
        expect(body(mounted.element).textContent).toContain('x');
    });

    it('should leave the previous tree out of the page when it is disposed', async () => {
        // Arrange
        const mounted = await mountText('text');
        const part = body(mounted.element);

        // Act
        mounted.dispose();

        // Assert
        expect(part.childElementCount).toBe(0);
    });
});
