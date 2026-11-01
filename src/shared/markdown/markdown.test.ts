import { describe, expect, it } from 'vitest';
import { cutPoint, parseMarkdown } from './markdown.js';
import { decodeTarget, safeHref } from './links.js';
import { parseInline } from './inlines.js';
import { splitRow } from './tables.js';
import type { MarkdownNode } from './nodes.js';
import { medianMs } from '../../../test/harness/medianMs.js';

/** The whole tree on one line: `h2(...)`, `p(...)`, `table(row(th<left>(...) ...))`, inline nodes as in `inlines.test.ts` */
function show(nodes: readonly MarkdownNode[]): string {
    return nodes
        .map((node) => {
            const inner = `(${show(node.children)})`;
            switch (node.type) {
                case 'text': return JSON.stringify(node.text);
                case 'emphasis': return `em${inner}`;
                case 'strong': return `strong${inner}`;
                case 'inlineCode': return `code${JSON.stringify(node.text)}`;
                case 'link': return `a<${node.href}>${inner}`;
                case 'paragraph': return `p${inner}`;
                case 'heading': return `h${node.level}${inner}`;
                case 'bulletList': return `ul${inner}`;
                case 'orderedList': return `ol${node.level}${inner}`;
                case 'listItem': return `li${inner}`;
                case 'blockquote': return `bq${inner}`;
                case 'code': return `pre${JSON.stringify(node.text)}`;
                case 'rule': return 'hr';
                case 'table': return `table${inner}`;
                case 'tableRow': return `tr${inner}`;
                case 'headerCell': return `th${node.align === '' ? '' : `<${node.align}>`}${inner}`;
                case 'tableCell': return `td${node.align === '' ? '' : `<${node.align}>`}${inner}`;
            }
        })
        .join(' ');
}
const shown = (source: string): string => show(parseMarkdown(source).children);

describe('safeHref', () => {
    const kept: [string, string][] = [
        ['a fragment', '#top'],
        ['a bare fragment mark', '#'],
        ['an absolute path', '/docs/page'],
        ['a relative path', 'docs/page.html'],
        ['a dot path', './page'],
        ['a parent path', '../page'],
        ['a query', '?tab=2'],
        ['https', 'https://x.example/a?b=1#c'],
        ['https in capitals', 'HTTPS://x.example'],
        ['a colon after the path starts', '/a:b'],
        ['a query with an ampersand', '/a?b=1&c=2']
    ];
    it.each(kept)('should keep %s', (_name, target) => {
        // Act
        const result = safeHref(target);

        // Assert
        expect(result).toBe(target);
    });

    const refused: [string, string][] = [
        ['javascript:', 'javascript:alert(1)'],
        ['javascript: in capitals', 'JaVaScRiPt:alert(1)'],
        ['vbscript:', 'vbscript:msgbox(1)'],
        ['data:', 'data:text/html,<script>alert(1)</script>'],
        ['data: with an image type', 'data:image/svg+xml;base64,AAAA'],
        ['http:', 'http://x.example'],
        ['mailto:', 'mailto:a@b.example'],
        ['tel:', 'tel:+123'],
        ['file:', 'file:///etc/passwd'],
        ['ftp:', 'ftp://x.example'],
        ['blob:', 'blob:https://x.example/id'],
        ['an unknown scheme', 'foo:bar'],
        ['https: with no slashes', 'https:x.example'],
        ['https: with nothing after the slashes', 'https://'],
        ['a protocol-relative target', '//evil.example'],
        ['a protocol-relative target with a backslash', '/\\evil.example'],
        ['a leading backslash', '\\\\evil.example'],
        ['an empty target', ''],
        ['a tab inside the scheme', 'java\tscript:alert(1)'],
        ['a newline inside the scheme', 'java\nscript:alert(1)'],
        ['a carriage return inside the scheme', 'java\rscript:alert(1)'],
        ['a leading space', ' javascript:alert(1)'],
        ['a NUL', 'java\u0000script:alert(1)'],
        ['a C1 control', 'java\u0085script:alert(1)'],
        ['a zero-width space', 'java​script:alert(1)'],
        ['a decimal entity for a letter', '&#106;avascript:alert(1)'],
        ['a hex entity for a letter', '&#x6A;avascript:alert(1)'],
        ['a hex entity in capitals', '&#X6a;avascript:alert(1)'],
        ['an entity for the colon', 'javascript&#58;alert(1)'],
        ['a named entity for the colon', 'javascript&colon;alert(1)'],
        ['an unknown named entity', 'javascript&unknown;alert(1)'],
        ['an entity for a tab', 'java&#x09;script:alert(1)'],
        ['a named entity for a tab', 'java&Tab;script:alert(1)'],
        ['a named entity for a newline', 'java&NewLine;script:alert(1)'],
        ['an entity without its semicolon followed by a scheme', '&#106avascript:alert(1)'],
        ['an escape that hides the scheme', 'java\\script:alert(1)'],
        ['a data: target with entities', 'd&#97;ta:text/html,x']
    ];
    it.each(refused)('should refuse %s', (_name, target) => {
        // Act
        const result = safeHref(target);

        // Assert
        expect(result).toBeUndefined();
    });

    it('should resolve entities and escapes in a target it keeps', () => {
        // Assert
        expect(safeHref('/p?a=1&amp;b=2')).toBe('/p?a=1&b=2');
        expect(safeHref('/p\\_q')).toBe('/p_q');
        expect(safeHref('/p%3Aq')).toBe('/p%3Aq');
    });

    it('should turn an invalid numeric entity into the replacement character', () => {
        // Assert
        expect(decodeTarget('&#0;&#xD800;&#x110000;')).toBe('���');
    });
});

describe('links in the tree', () => {
    const refusedLinks: [string, string][] = [
        ['javascript:', '[a](javascript:alert(1))'],
        ['javascript: in capitals', '[a](JAVASCRIPT:alert(1))'],
        ['data:', '[a](data:text/html;base64,AAAA)'],
        ['http:', '[a](http://x.example)'],
        ['mailto:', '[a](mailto:a@b.example)'],
        ['a protocol-relative target', '[a](//evil.example)'],
        ['an entity spelling', '[a](&#106;avascript:alert(1))'],
        ['a named entity spelling', '[a](javascript&colon;alert(1))'],
        ['a control character spelling', '[a](<java\tscript:alert(1)>)'],
        ['an autolink with javascript:', 'x <javascript:alert(1)>'],
        ['an autolink with a hex entity', 'x <&#x6A;avascript:alert(1)>']
    ];
    it.each(refusedLinks)('should leave the text of a link with %s as plain text', (_name, source) => {
        // Act
        const nodes = parseMarkdown(source).children;

        // Assert
        expect(show(nodes)).not.toContain('a<');
        const paragraph = nodes[0] as MarkdownNode;
        expect(paragraph.children.every((child) => child.type === 'text')).toBe(true);
    });

    it('should show the characters of a refused autolink and of a refused link text', () => {
        // Assert
        expect(shown('x <javascript:alert(1)>')).toBe('p("x javascript:alert(1)")');
        expect(shown('[click *me*](javascript:alert(1))')).toBe('p("click " em("me"))');
    });

    it('should keep targets for the three allowed kinds', () => {
        // Assert
        expect(shown('[a](#x) [b](/y) [c](https://z.example)')).toBe('p(a<#x>("a") " " a</y>("b") " " a<https://z.example>("c"))');
    });
});

describe('the inline profile', () => {
    it('should allow emphasis, code and links only', () => {
        // Act
        const result = parseMarkdown('# not a heading\n- not a list\n*a* `b` [c](/d)', { profile: 'inline' });

        // Assert
        expect(show(result.children)).toBe('"# not a heading\\n- not a list\\n" em("a") " " code"b" " " a</d>("c")');
    });

    it('should make an image its alt text and raw HTML its characters', () => {
        // Act
        const result = parseMarkdown('![alt](/i.png) <b>x</b>', { profile: 'inline' });

        // Assert
        expect(show(result.children)).toBe('"alt <b>x</b>"');
    });

    it('should not make tables', () => {
        // Act
        const result = parseMarkdown('| a |\n| - |', { profile: 'inline' });

        // Assert
        expect(result.children.every((node) => node.type === 'text')).toBe(true);
    });
});

describe('tables', () => {
    const cases: [string, string, string][] = [
        ['a table with outer pipes', '| a | b |\n| - | - |\n| 1 | 2 |', 'table(tr(th("a") th("b")) tr(td("1") td("2")))'],
        ['a table without outer pipes', 'a | b\n--- | ---\n1 | 2', 'table(tr(th("a") th("b")) tr(td("1") td("2")))'],
        ['alignment from the delimiter row', '| l | c | r | n |\n|:--|:-:|--:|---|\n| 1 | 2 | 3 | 4 |', 'table(tr(th<left>("l") th<center>("c") th<right>("r") th("n")) tr(td<left>("1") td<center>("2") td<right>("3") td("4")))'],
        ['inline markup in cells', '| *a* | `b` |\n|-|-|\n| [c](/d) | **e** |', 'table(tr(th(em("a")) th(code"b")) tr(td(a</d>("c")) td(strong("e"))))'],
        ['an escaped pipe in a cell', '| a\\|b | c |\n|-|-|', 'table(tr(th("a|b") th("c")))'],
        ['a short row is not padded', '| a | b |\n|-|-|\n| 1 |', 'table(tr(th("a") th("b")) tr(td("1")))'],
        ['a long row is cut', '| a |\n|-|\n| 1 | 2 | 3 |', 'table(tr(th("a")) tr(td("1")))'],
        ['a header only', '| a | b |\n|-|-|', 'table(tr(th("a") th("b")))'],
        ['a one-column table', '| a |\n| --- |\n| 1 |', 'table(tr(th("a")) tr(td("1")))'],
        ['a cell count that differs is a paragraph', '| a | b |\n|-|\n| 1 |', 'p("| a | b |\\n|-|\\n| 1 |")'],
        ['a delimiter row with other characters is a paragraph', '| a |\n| x |', 'p("| a |\\n| x |")'],
        ['a delimiter row with no dashes is a paragraph', '| a |\n| : |', 'p("| a |\\n| : |")'],
        ['text before the header keeps it a paragraph', 'text\n| a |\n|-|', 'p("text\\n| a |\\n|-|")'],
        ['a blank line ends the table', '| a |\n|-|\n| 1 |\n\ntext', 'table(tr(th("a")) tr(td("1"))) p("text")'],
        ['a table in a quote', '> | a |\n> |-|\n> | 1 |', 'bq(table(tr(th("a")) tr(td("1"))))'],
        ['a table in a list item', '- | a |\n  |-|\n  | 1 |', 'ul(li(table(tr(th("a")) tr(td("1")))))']
    ];
    it.each(cases)('should parse %s', (_name, source, expected) => {
        // Act
        const result = shown(source);

        // Assert
        expect(result).toBe(expected);
    });

    it('should split a row on pipes a backslash does not escape', () => {
        // Assert
        expect(splitRow('| a | b\\|c |  |')).toEqual(['a', 'b|c', '']);
        expect(splitRow('a|b')).toEqual(['a', 'b']);
        expect(splitRow('')).toEqual([]);
        expect(splitRow('|')).toEqual([]);
    });

    it('should hold the alignment in the align field of the cells', () => {
        // Act
        const table = parseMarkdown('| a |\n|--:|\n| 1 |').children[0] as MarkdownNode;

        // Assert
        expect(table.type).toBe('table');
        expect((table.children[1] as MarkdownNode).children[0]).toMatchObject({ type: 'tableCell', align: 'right' });
    });
});

describe('parseMarkdown blocks and inlines together', () => {
    it('should join the block parser and the inline parser', () => {
        // Act
        const result = shown('# Title *x*\n\nSome `code` and [a link](/p).\n\n- one\n- **two**\n\n> quote\n\n```\nraw *text*\n```\n\n---');

        // Assert
        expect(result).toBe('h1("Title " em("x")) p("Some " code"code" " and " a</p>("a link") ".") ul(li(p("one")) li(p(strong("two")))) bq(p("quote")) pre"raw *text*" hr');
    });

    it('should show a raw HTML block and inline HTML as text', () => {
        // Assert
        expect(shown('<script>alert(1)</script>')).toBe('"<script>alert(1)</script>"');
        expect(shown('a <b>x</b>')).toBe('p("a <b>x</b>")');
    });

    it('should give every node every field', () => {
        // Act
        const [node] = parseMarkdown('[a](/p)').children;

        // Assert
        expect(node).toEqual({
            type: 'paragraph',
            children: [{ type: 'link', children: [{ type: 'text', children: [], text: 'a', href: '', level: 0, align: '' }], text: '', href: '/p', level: 0, align: '' }],
            text: '',
            href: '',
            level: 0,
            align: ''
        });
    });
});

describe('the length cut', () => {
    const source = 'aaa\n\nbbb\n\nccc\n\nddd';

    it('should keep a source that fits and not flag it', () => {
        // Act
        const result = parseMarkdown(source, { maxLength: source.length });

        // Assert
        expect(result.truncated).toBe(false);
        expect(result.children).toHaveLength(4);
    });

    it('should cut at the last blank line that fits and flag it', () => {
        // Act
        const result = parseMarkdown(source, { maxLength: 11 });

        // Assert
        expect(result.truncated).toBe(true);
        expect(show(result.children)).toBe('p("aaa") p("bbb")');
    });

    it('should keep a block that fits whole and drop the next one that does not', () => {
        // Assert
        expect(show(parseMarkdown(source, { maxLength: 13 }).children)).toBe('p("aaa") p("bbb") p("ccc")');
        expect(show(parseMarkdown(source, { maxLength: 12 }).children)).toBe('p("aaa") p("bbb")');
        expect(show(parseMarkdown(source, { maxLength: 8 }).children)).toBe('p("aaa") p("bbb")');
    });

    it('should not cut at a blank line inside a code fence', () => {
        // Arrange
        const fenced = 'intro\n\n```\none\n\ntwo\n```\n\nafter';

        // Act
        const result = parseMarkdown(fenced, { maxLength: 18 });

        // Assert
        expect(show(result.children)).toBe('p("intro")');
        expect(cutPoint(fenced, 18)).toBe(5);
    });

    it('should cut a single long paragraph at the last whole line, else at the limit', () => {
        // Assert
        expect(cutPoint('one\ntwo\nthree', 9)).toBe(7);
        expect(cutPoint('abcdefghij', 4)).toBe(4);
        expect(show(parseMarkdown('abcdefghij', { maxLength: 4 }).children)).toBe('p("abcd")');
    });

    it('should not split a surrogate pair at the limit', () => {
        // Act
        const point = cutPoint('ab😀cd', 3);

        // Assert
        expect(point).toBe(2);
    });

    it('should cut an inline source and flag it', () => {
        // Act
        const result = parseMarkdown('*abcdef*', { profile: 'inline', maxLength: 4 });

        // Assert
        expect(result.truncated).toBe(true);
    });

    it('should default to 20,000 characters', () => {
        // Arrange
        const paragraphs = 'word\n\n'.repeat(4_000);

        // Act
        const result = parseMarkdown(paragraphs);

        // Assert
        expect(result.truncated).toBe(true);
        expect(result.children.length).toBeLessThanOrEqual(4_000);
        expect(result.children.length).toBeGreaterThan(3_000);
    });

    it('should return nothing but the flag for a limit of zero', () => {
        // Act
        const result = parseMarkdown('abc', { maxLength: 0 });

        // Assert
        expect(result).toEqual({ children: [], truncated: true });
    });
});

describe('pathological documents', () => {
    const SIZE = 20_000;
    const documents: [string, string][] = [
        ['a table with thousands of cells', `${'|a'.repeat(SIZE / 4)}|\n${'|-'.repeat(SIZE / 4)}|`],
        ['a table with thousands of rows', `|a|\n|-|\n${'|b|\n'.repeat(SIZE / 4)}`],
        ['a table with unclosed markers in each cell', `|${'*a|[b|`c|'.repeat(SIZE / 28)}\n|${'-|'.repeat(SIZE / 28 * 3)}\n${'|*a|[b|`c|\n'.repeat(SIZE / 28)}`],
        ['thousands of tiny paragraphs', 'a\n\n'.repeat(SIZE / 3)],
        ['thousands of headings with unclosed markers', '# *a [b `c\n'.repeat(SIZE / 12)],
        ['thousands of list items with markers', '- *a\n'.repeat(SIZE / 5)],
        ['deep quotes with inline markers', `${'> '.repeat(100)}${'*a [b `c '.repeat(SIZE / 9)}`],
        ['one huge paragraph of unclosed markers', '*a [b `c _d <e '.repeat(SIZE / 14)]
    ];

    it.each(documents)('should parse %s in under 50 ms', (_name, source) => {
        // Arrange
        expect(source.length).toBeLessThanOrEqual(SIZE + 2000);

        // Act
        const result = parseMarkdown(source, { maxLength: SIZE + 2000 });
        const median = medianMs(() => parseMarkdown(source, { maxLength: SIZE + 2000 }));

        // Assert
        expect(result.children.length).toBeGreaterThan(0);
        expect(median).toBeLessThan(50);
    });

    it('should keep the tree depth bounded so that a walk cannot overflow the stack', () => {
        // Arrange
        const source = `${'> - '.repeat(5_000)}x`;
        const depthOf = (nodes: readonly MarkdownNode[]): number => nodes.reduce((deepest, node) => Math.max(deepest, 1 + depthOf(node.children)), 0);

        // Act
        const depth = depthOf(parseMarkdown(source).children);

        // Assert
        expect(depth).toBeLessThan(80);
    });
});

describe('parseInline and parseMarkdown agree', () => {
    it('should give the inline profile the same nodes parseInline gives', () => {
        // Arrange
        const text = '*a* **b** `c` [d](/e) <https://f.example>';

        // Assert
        expect(parseMarkdown(text, { profile: 'inline' }).children).toEqual(parseInline(text));
    });
});
