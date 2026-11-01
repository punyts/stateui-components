import { describe, expect, it } from 'vitest';
import { MAX_INLINE_DEPTH, parseInline } from './inlines.js';
import type { MarkdownNode } from './nodes.js';
import { medianMs } from '../../../test/harness/medianMs.js';

/** `"text"`, `em(...)`, `strong(...)`, `code"x"`, `a<href>(...)` */
export function showInline(nodes: readonly MarkdownNode[]): string {
    return nodes
        .map((node) => {
            const inner = `(${showInline(node.children)})`;
            switch (node.type) {
                case 'text': return JSON.stringify(node.text);
                case 'emphasis': return `em${inner}`;
                case 'strong': return `strong${inner}`;
                case 'inlineCode': return `code${JSON.stringify(node.text)}`;
                case 'link': return `a<${node.href}>${inner}`;
                default: return `?${node.type}`;
            }
        })
        .join(' ');
}
const shown = (text: string): string => showInline(parseInline(text));

describe('parseInline plain text', () => {
    const cases: [string, string, string][] = [
        ['plain text', 'hello world', '"hello world"'],
        ['an empty string', '', ''],
        ['a newline kept in the text', 'a\nb', '"a\\nb"'],
        ['an escaped punctuation character', 'a \\* b \\_ c \\[ d \\\\ e', '"a * b _ c [ d \\\\ e"'],
        ['a backslash before a letter', 'a\\b', '"a\\\\b"'],
        ['an entity is not decoded', '&amp; &lt;', '"&amp; &lt;"']
    ];
    it.each(cases)('should parse %s', (_name, source, expected) => {
        // Act
        const result = shown(source);

        // Assert
        expect(result).toBe(expected);
    });
});

describe('parseInline emphasis and strong', () => {
    const cases: [string, string, string][] = [
        ['emphasis with *', '*a*', 'em("a")'],
        ['emphasis with _', '_a_', 'em("a")'],
        ['strong with **', '**a**', 'strong("a")'],
        ['strong with __', '__a__', 'strong("a")'],
        ['strong inside emphasis', '*a **b** c*', 'em("a " strong("b") " c")'],
        ['emphasis inside strong', '**a *b* c**', 'strong("a " em("b") " c")'],
        ['both on one word', '***a***', 'em(strong("a"))'],
        ['text around', 'x *a* y', '"x " em("a") " y"'],
        ['a space after the opener is not emphasis', '* a *', '"* a *"'],
        ['a space before the closer is not emphasis', '*a *', '"*a *"'],
        ['_ inside a word is text', 'snake_case_name', '"snake_case_name"'],
        ['* inside a word is emphasis', 'a*b*c', '"a" em("b") "c"'],
        ['an escaped marker is text', '\\*a\\*', '"*a*"'],
        ['an unclosed marker is text', '*a', '"*a"'],
        ['an unclosed strong is text', '**a', '"**a"'],
        ['two unequal runs', '**a*', '"*" em("a")'],
        ['the three rule', '*foo**bar*', 'em("foo**bar")'],
        ['a run of four is not emphasis', '****a****', 'strong(strong("a"))'],
        ['emphasis around a link', '*[a](#x)*', 'em(a<#x>("a"))'],
        ['emphasis around code', '*`a`*', 'em(code"a")'],
        ['punctuation flanking', '*(a)*', 'em("(a)")'],
        ['underscore next to punctuation', '_a_.', 'em("a") "."'],
        ['emphasis across a line break', '*a\nb*', 'em("a\\nb")'],
        ['a marker alone', '*', '"*"']
    ];
    it.each(cases)('should parse %s', (_name, source, expected) => {
        // Act
        const result = shown(source);

        // Assert
        expect(result).toBe(expected);
    });
});

describe('parseInline code', () => {
    const cases: [string, string, string][] = [
        ['a code span', '`a`', 'code"a"'],
        ['markup inside is literal', '`*a* [b](c)`', 'code"*a* [b](c)"'],
        ['a double-backtick span holds a backtick', '``a`b``', 'code"a`b"'],
        ['one space is stripped on both sides', '` a `', 'code"a"'],
        ['only one space is stripped', '`  a  `', 'code" a "'],
        ['a space-only span is kept', '`  `', 'code"  "'],
        ['a newline is a space', '`a\nb`', 'code"a b"'],
        ['an unclosed run is text', '`a', '"`a"'],
        ['runs of different lengths do not match', '`a``', '"`a``"'],
        ['a backslash is literal inside', '`a\\`', 'code"a\\\\"'],
        ['a code span beats emphasis', '*a `*` b*', 'em("a " code"*" " b")'],
        ['text after a span', '`a` b', 'code"a" " b"']
    ];
    it.each(cases)('should parse %s', (_name, source, expected) => {
        // Act
        const result = shown(source);

        // Assert
        expect(result).toBe(expected);
    });
});

describe('parseInline links', () => {
    const cases: [string, string, string][] = [
        ['a link', '[a](https://x.example/p)', 'a<https://x.example/p>("a")'],
        ['a fragment', '[a](#top)', 'a<#top>("a")'],
        ['a relative path', '[a](/docs/page)', 'a</docs/page>("a")'],
        ['a relative file', '[a](page.html)', 'a<page.html>("a")'],
        ['a title is dropped', '[a](/p "Title")', 'a</p>("a")'],
        ['a title in single quotes and parentheses', "[a](/p 'T') [b](/q (T))", 'a</p>("a") " " a</q>("b")'],
        ['a target in angle brackets', '[a](</my%20page>)', 'a</my%20page>("a")'],
        ['a target with a space is refused', '[a](</my page>)', '"a"'],
        ['balanced parentheses in the target', '[a](/p(1))', 'a</p(1)>("a")'],
        ['an escaped parenthesis in the target', '[a](/p\\))', 'a</p)>("a")'],
        ['emphasis in the text', '[*a* b](/p)', 'a</p>(em("a") " b")'],
        ['code in the text', '[`a`](/p)', 'a</p>(code"a")'],
        ['text before and after', 'x [a](/p) y', '"x " a</p>("a") " y"'],
        ['brackets without a target are text', '[a]', '"[a]"'],
        ['a reference is text', '[a][b]', '"[a][b]"'],
        ['a missing closing parenthesis is text', '[a](/p', '"[a](/p"'],
        ['an unmatched ] is text', 'a]', '"a]"'],
        ['an unmatched [ is text', '[a', '"[a"'],
        ['a link inside a link is not made', '[a [b](/q)](/p)', '"[a " a</q>("b") "](/p)"'],
        ['an escaped bracket is text', '\\[a](/p)', '"[a](/p)"'],
        ['an entity in the target is resolved', '[a](/p?x=1&amp;y=2)', 'a</p?x=1&y=2>("a")'],
        ['two links', '[a](/1)[b](/2)', 'a</1>("a") a</2>("b")'],
        ['a space before the parenthesis is text', '[a] (/p)', '"[a] (/p)"'],
        ['a target past the window is text', `[a](/${'x'.repeat(2000)})`, `"[a](/${'x'.repeat(2000)})"`]
    ];
    it.each(cases)('should parse %s', (_name, source, expected) => {
        // Act
        const result = shown(source);

        // Assert
        expect(result).toBe(expected);
    });
});

describe('parseInline autolinks', () => {
    const cases: [string, string, string][] = [
        ['an https autolink', '<https://x.example/a?b=1>', 'a<https://x.example/a?b=1>("https://x.example/a?b=1")'],
        ['an http autolink is text', '<http://x.example>', '"http://x.example"'],
        ['a javascript autolink is text', '<javascript:alert(1)>', '"javascript:alert(1)"'],
        ['a mailto autolink is text', '<mailto:a@b.example>', '"mailto:a@b.example"'],
        ['an email address in brackets is text', '<a@b.example>', '"<a@b.example>"'],
        ['a space ends the candidate', '<https://x y>', '"<https://x y>"'],
        ['text around an autolink', 'see <https://x.example> now', '"see " a<https://x.example>("https://x.example") " now"']
    ];
    it.each(cases)('should parse %s', (_name, source, expected) => {
        // Act
        const result = shown(source);

        // Assert
        expect(result).toBe(expected);
    });
});

describe('parseInline images', () => {
    const cases: [string, string, string][] = [
        ['an image is its alt text', '![a cat](https://x.example/c.png)', '"a cat"'],
        ['an image with a data target', '![a](data:image/png;base64,AAAA)', '"a"'],
        ['an image with a title', '![a](/c.png "T")', '"a"'],
        ['emphasis in the alt text is plain', '![a *b* c](/c.png)', '"a b c"'],
        ['an image inside a link', '[![a](/i.png)](/p)', 'a</p>("a")'],
        ['text around an image', 'x ![a](/i.png) y', '"x a y"'],
        ['an image without a target is text', '![a]', '"![a]"'],
        ['an empty alt text', '![](/i.png)', ''],
        ['a link inside an image alt is plain text', '![a [b](/q)](/i.png)', '"a b"']
    ];
    it.each(cases)('should parse %s', (_name, source, expected) => {
        // Act
        const result = shown(source);

        // Assert
        expect(result).toBe(expected);
    });
});

describe('parseInline raw HTML', () => {
    const cases: [string, string, string][] = [
        ['a tag is its characters', '<b>bold</b>', '"<b>bold</b>"'],
        ['a script is its characters', 'a <script>alert(1)</script> b', '"a <script>alert(1)</script> b"'],
        ['an image tag', '<img src=x onerror=alert(1)>', '"<img src=x onerror=alert(1)>"'],
        ['a comment', '<!-- a -->', '"<!-- a -->"'],
        ['markup between tags still applies', '<b>*a*</b>', '"<b>" em("a") "</b>"'],
        ['a lone less-than sign', '1 < 2 > 0', '"1 < 2 > 0"']
    ];
    it.each(cases)('should parse %s', (_name, source, expected) => {
        // Act
        const result = shown(source);

        // Assert
        expect(result).toBe(expected);
    });
});

describe('parseInline depth', () => {
    it('should show emphasis markers past the depth limit as text', () => {
        // Arrange
        const count = MAX_INLINE_DEPTH + 10;
        const source = `${'*a '.repeat(count)}x${' a*'.repeat(count)}`;

        // Act
        const result = parseInline(source);
        let depth = 0;
        for (let node: MarkdownNode | undefined = result[0]; node !== undefined; node = node.children.find((child) => child.type !== 'text')) depth++;

        // Assert
        expect(depth).toBeLessThanOrEqual(MAX_INLINE_DEPTH + 1);
        expect(depth).toBeGreaterThan(1);
    });
});

describe('parseInline pathological input', () => {
    const SIZE = 20_000;
    const inputs: [string, string][] = [
        ['thousands of unclosed *', '*a '.repeat(SIZE / 3)],
        ['thousands of unclosed _', '_a '.repeat(SIZE / 3)],
        ['thousands of closers with no opener', 'a* '.repeat(SIZE / 3)],
        ['a run of *', '*'.repeat(SIZE)],
        ['alternating * and _', '*a_'.repeat(SIZE / 3)],
        ['openers of both kinds then closers', `${'*_a '.repeat(SIZE / 8)}${'a_* '.repeat(SIZE / 8)}`],
        ['unclosed [', '[a '.repeat(SIZE / 3)],
        ['a run of [', '['.repeat(SIZE)],
        ['a run of ]', ']'.repeat(SIZE)],
        ['[ and ] without a target', '[a] '.repeat(SIZE / 4)],
        ['](( without an end', '[a]('.repeat(SIZE / 4)],
        ['](x with long runs', '[a](x'.repeat(SIZE / 5)],
        ['](" with an open title', '[a](b "'.repeat(SIZE / 8)],
        ['](< with an open angle', '[a](<'.repeat(SIZE / 5)],
        ['![ without an end', '![a '.repeat(SIZE / 4)],
        ['unclosed backticks of one length', '`a '.repeat(SIZE / 3)],
        ['backticks of growing lengths', Array.from({ length: 190 }, (_, at) => '`'.repeat(at + 1)).join(' ').slice(0, SIZE)],
        ['a run of backticks', '`'.repeat(SIZE)],
        ['backtick pairs of the same length', '`a` '.repeat(SIZE / 4)],
        ['unclosed <', '<a '.repeat(SIZE / 3)],
        ['unfinished autolinks', '<https:x'.repeat(SIZE / 8)],
        ['a long autolink candidate', `<https:${'a'.repeat(SIZE - 8)}`],
        ['a run of backslashes', '\\'.repeat(SIZE)],
        ['a run of &', '&'.repeat(SIZE)],
        ['links that each nest in brackets', `${'[[a](/p) '.repeat(SIZE / 9)}`],
        ['mixed markers', '*_`[<!'.repeat(SIZE / 6)],
        ['emphasis inside links inside emphasis', '*[*a*](/p)* '.repeat(SIZE / 12)]
    ];

    it.each(inputs)('should parse %s in under 50 ms', (_name, source) => {
        // Arrange
        expect(source.length).toBeLessThanOrEqual(SIZE + 2);

        // Act
        const result = parseInline(source);
        const median = medianMs(() => parseInline(source));

        // Assert
        expect(result.length).toBeGreaterThan(0);
        expect(median).toBeLessThan(50);
    });

    it('should take time in proportion to the input, not its square', () => {
        // Arrange
        const small = '*a [b](x `c '.repeat(1_000);
        const large = '*a [b](x `c '.repeat(4_000);

        // Act
        const smallMs = medianMs(() => parseInline(small));
        const largeMs = medianMs(() => parseInline(large));

        // Assert: four times the input must stay far below the sixteen times of a quadratic parser
        expect(largeMs).toBeLessThan(Math.max(smallMs * 10, 5));
    });
});
