import { describe, expect, it } from 'vitest';
import { MAX_BLOCK_DEPTH, parseBlocks } from './blocks.js';
import type { BlockNode } from './blocks.js';
import { medianMs } from '../../../test/harness/medianMs.js';

/** One line per block tree: `p"text"`, `h2"text"`, `ul(li(p"a"))`, `ol3(...)`, `bq(...)`, `code"x"`, `hr`, `raw"<b>"` */
function show(nodes: readonly BlockNode[]): string {
    return nodes
        .map((node) => {
            const inner = node.children.length > 0 ? `(${show(node.children)})` : '';
            switch (node.type) {
                case 'paragraph': return `p${JSON.stringify(node.text)}`;
                case 'heading': return `h${node.level}${JSON.stringify(node.text)}`;
                case 'bulletList': return `ul${inner}`;
                case 'orderedList': return `ol${node.level}${inner}`;
                case 'listItem': return `li${inner}`;
                case 'blockquote': return `bq${inner}`;
                case 'code': return `code${JSON.stringify(node.text)}`;
                case 'rule': return 'hr';
                case 'text': return `raw${JSON.stringify(node.text)}`;
            }
        })
        .join(' ');
}
const shown = (source: string): string => show(parseBlocks(source));

describe('paragraphs', () => {
    const cases: [string, string, string][] = [
        ['one line', 'aaa', 'p"aaa"'],
        ['two paragraphs split by a blank line', 'aaa\n\nbbb', 'p"aaa" p"bbb"'],
        ['several blank lines are one break', 'aaa\n\n\n\nbbb', 'p"aaa" p"bbb"'],
        ['lines join with a newline and lose leading spaces', 'aaa\n   bbb\n      ccc', 'p"aaa\\nbbb\\nccc"'],
        ['the last line loses trailing spaces', 'aaa   ', 'p"aaa"'],
        ['leading blank lines are ignored', '\n\n  aaa', 'p"aaa"'],
        ['windows and old Mac line ends', 'aaa\r\nbbb\r\rccc', 'p"aaa\\nbbb" p"ccc"'],
        ['no blocks in an empty source', '', ''],
        ['no blocks in blank lines', '\n  \n\t\n', '']
    ];
    it.each(cases)('should parse %s', (_name, source, expected) => {
        // Act
        const result = shown(source);

        // Assert
        expect(result).toBe(expected);
    });
});

describe('ATX headings', () => {
    const cases: [string, string, string][] = [
        ['levels 1 to 6', '# a\n## b\n### c\n#### d\n##### e\n###### f', 'h1"a" h2"b" h3"c" h4"d" h5"e" h6"f"'],
        ['seven hashes are a paragraph', '####### a', 'p"####### a"'],
        ['a hash needs a space', '#a', 'p"#a"'],
        ['up to three spaces of indent', '   # a', 'h1"a"'],
        ['four spaces are code', '    # a', 'code"# a"'],
        ['a closing sequence is removed', '## a ##   ', 'h2"a"'],
        ['a closing sequence needs a space before it', '# a#', 'h1"a#"'],
        ['an empty heading', '#\n##  ##', 'h1"" h2""'],
        ['a heading ends a paragraph and needs no blank line', 'a\n# b\nc', 'p"a" h1"b" p"c"'],
        ['inline source stays raw', '# *a* `b`', 'h1"*a* `b`"']
    ];
    it.each(cases)('should parse %s', (_name, source, expected) => {
        // Act
        const result = shown(source);

        // Assert
        expect(result).toBe(expected);
    });
});

describe('setext headings', () => {
    const cases: [string, string, string][] = [
        ['level 1 with =', 'Foo\n===', 'h1"Foo"'],
        ['level 2 with -', 'Foo\n---', 'h2"Foo"'],
        ['one character underlines', 'Foo\n=\n\nBar\n-', 'h1"Foo" h2"Bar"'],
        ['a multi-line heading', 'Foo\nbar\n---', 'h2"Foo\\nbar"'],
        ['trailing spaces after the underline', 'Foo\n---   ', 'h2"Foo"'],
        ['an underline with a gap is not one for =', 'Foo\n= =', 'p"Foo\\n= ="'],
        ['a rule after a blank line is a rule', 'Foo\n\n---', 'p"Foo" hr'],
        ['an underline with no paragraph is a rule or text', '===', 'p"==="'],
        ['a lazy line cannot be an underline', '> Foo\n---', 'bq(p"Foo") hr']
    ];
    it.each(cases)('should parse %s', (_name, source, expected) => {
        // Act
        const result = shown(source);

        // Assert
        expect(result).toBe(expected);
    });
});

describe('horizontal rules', () => {
    const cases: [string, string, string][] = [
        ['three of each character', '***\n---\n___', 'hr hr hr'],
        ['spaces between', ' - - -\n_  _  _  _', 'hr hr'],
        ['two are not enough', '--\n**', 'p"--\\n**"'],
        ['other characters spoil it', '---a', 'p"---a"'],
        ['mixed characters are not a rule', '-*-', 'p"-*-"'],
        ['a rule between paragraphs', 'a\n\n***\n\nb', 'p"a" hr p"b"'],
        ['a rule wins over a list item', '* * *', 'hr'],
        ['a rule ends a list', '- a\n***', 'ul(li(p"a")) hr'],
        ['four spaces are code', '    ---', 'code"---"']
    ];
    it.each(cases)('should parse %s', (_name, source, expected) => {
        // Act
        const result = shown(source);

        // Assert
        expect(result).toBe(expected);
    });
});

describe('indented code blocks', () => {
    const cases: [string, string, string][] = [
        ['a chunk', '    a\n    b', 'code"a\\nb"'],
        ['extra indent is kept', '        a', 'code"    a"'],
        ['a blank line inside is kept', '    a\n\n    b', 'code"a\\n\\nb"'],
        ['trailing blank lines are dropped', '    a\n\n\n', 'code"a"'],
        ['it cannot interrupt a paragraph', 'a\n    b', 'p"a\\nb"'],
        ['a paragraph after code', '    a\nb', 'code"a" p"b"'],
        ['it follows a heading', '# h\n    a', 'h1"h" code"a"'],
        ['markup inside is literal', '    # a\n    - b\n    > c', 'code"# a\\n- b\\n> c"'],
        ['a tab is four columns', '\ta', 'code"a"']
    ];
    it.each(cases)('should parse %s', (_name, source, expected) => {
        // Act
        const result = shown(source);

        // Assert
        expect(result).toBe(expected);
    });
});

describe('fenced code blocks', () => {
    const cases: [string, string, string][] = [
        ['backticks', '```\na\nb\n```', 'code"a\\nb"'],
        ['tildes', '~~~\na\n~~~', 'code"a"'],
        ['an info string is ignored', '```js\nx\n```', 'code"x"'],
        ['an empty fence', '```\n```', 'code""'],
        ['markup inside is literal', '```\n# a\n- b\n> c\n```', 'code"# a\\n- b\\n> c"'],
        ['blank lines inside are kept', '```\na\n\nb\n```', 'code"a\\n\\nb"'],
        ['a shorter closing fence does not close', '````\na\n```\nb\n````', 'code"a\\n```\\nb"'],
        ['a longer closing fence closes', '```\na\n`````', 'code"a"'],
        ['the other character does not close', '```\na\n~~~\n```', 'code"a\\n~~~"'],
        ['the opener indent is removed from the content', '  ```\n  a\n   b\n c\n  ```', 'code"a\\n b\\nc"'],
        ['a backtick in a backtick fence info is not a fence', '``` a`b\nc', 'p"``` a`b\\nc"'],
        ['a fence interrupts a paragraph', 'a\n```\nb\n```\nc', 'p"a" code"b" p"c"'],
        ['an unclosed fence runs to the end', '```\na\n\nb', 'code"a\\n\\nb"'],
        ['an unclosed fence ends with its quote', '> ```\n> a\nb', 'bq(code"a") p"b"'],
        ['a closing fence with trailing text is content', '```\na\n``` b\n```', 'code"a\\n``` b"'],
        ['two backticks are inline code', '``a``', 'p"``a``"']
    ];
    it.each(cases)('should parse %s', (_name, source, expected) => {
        // Act
        const result = shown(source);

        // Assert
        expect(result).toBe(expected);
    });
});

describe('block quotes', () => {
    const cases: [string, string, string][] = [
        ['one line', '> a', 'bq(p"a")'],
        ['without the space', '>a', 'bq(p"a")'],
        ['several lines', '> a\n> b', 'bq(p"a\\nb")'],
        ['a lazy continuation line', '> a\nb', 'bq(p"a\\nb")'],
        ['a blank line ends it', '> a\n\n> b', 'bq(p"a") bq(p"b")'],
        ['a blank quote line splits paragraphs', '> a\n>\n> b', 'bq(p"a" p"b")'],
        ['nested', '> > a', 'bq(bq(p"a"))'],
        ['nested with a lazy line', '> > a\nb', 'bq(bq(p"a\\nb"))'],
        ['a heading inside', '> # h\n> a', 'bq(h1"h" p"a")'],
        ['a list inside', '> - a\n> - b', 'bq(ul(li(p"a") li(p"b")))'],
        ['code inside', '>     a', 'bq(code"a")'],
        ['a heading ends a lazy quote', '> a\n# h', 'bq(p"a") h1"h"'],
        ['a fence ends a lazy quote', '> a\n```\nb\n```', 'bq(p"a") code"b"'],
        ['four spaces make a lazy line, not a quote', 'a\n    > b', 'p"a\\n> b"'],
        ['a quote interrupts a paragraph', 'a\n> b', 'p"a" bq(p"b")']
    ];
    it.each(cases)('should parse %s', (_name, source, expected) => {
        // Act
        const result = shown(source);

        // Assert
        expect(result).toBe(expected);
    });
});

describe('lists', () => {
    const cases: [string, string, string][] = [
        ['a bullet list with each marker', '- a\n- b\n\n+ c\n\n* d', 'ul(li(p"a") li(p"b")) ul(li(p"c")) ul(li(p"d"))'],
        ['an ordered list with ) and .', '1. a\n2. b\n\n1) c', 'ol1(li(p"a") li(p"b")) ol1(li(p"c"))'],
        ['an ordered list keeps its first number', '3. a\n4. b', 'ol3(li(p"a") li(p"b"))'],
        ['a marker needs a space', '-a\n1.b', 'p"-a\\n1.b"'],
        ['ten digits are not a marker', '1234567890. a', 'p"1234567890. a"'],
        ['an item with several paragraphs', '- a\n\n  b', 'ul(li(p"a" p"b"))'],
        ['a blank line between items', '- a\n\n- b', 'ul(li(p"a") li(p"b"))'],
        ['a lazy continuation line', '- a\nb', 'ul(li(p"a\\nb"))'],
        ['an indented continuation line', '- a\n  b', 'ul(li(p"a\\nb"))'],
        ['a different marker starts a new list', '- a\n* b', 'ul(li(p"a")) ul(li(p"b"))'],
        ['a paragraph ends the list after a blank line', '- a\n\nb', 'ul(li(p"a")) p"b"'],
        ['an empty item', '-\n- a', 'ul(li li(p"a"))'],
        ['an empty item does not continue over a blank line', '-\n\n  a', 'ul(li) p"a"'],
        ['a list interrupts a paragraph', 'a\n- b', 'p"a" ul(li(p"b"))'],
        ['an empty item cannot interrupt a paragraph', 'a\n-', 'h2"a"'],
        ['an ordered list interrupts a paragraph only from 1', 'a\n2. b\n\nc\n1. d', 'p"a\\n2. b" p"c" ol1(li(p"d"))'],
        ['a heading inside an item', '- # h\n  a', 'ul(li(h1"h" p"a"))'],
        ['a quote inside an item', '- > a', 'ul(li(bq(p"a")))'],
        ['a fence inside an item', '- ```\n  a\n  ```', 'ul(li(code"a"))'],
        ['code inside an item', '-     a', 'ul(li(code"a"))'],
        ['indented code after an item and a blank line', '- a\n\n      b', 'ul(li(p"a" code"b"))'],
        ['the content indent follows the marker width', '10. a\n    b\n11. c', 'ol10(li(p"a\\nb") li(p"c"))'],
        ['a list inside a quote', '> 1. a\n> 2. b', 'bq(ol1(li(p"a") li(p"b")))'],
        ['a tab after the marker', '-\ta\n-\tb', 'ul(li(p"a") li(p"b"))']
    ];
    it.each(cases)('should parse %s', (_name, source, expected) => {
        // Act
        const result = shown(source);

        // Assert
        expect(result).toBe(expected);
    });

    it('should nest lists three deep', () => {
        // Arrange
        const source = '- a\n  - b\n    - c\n  - d\n- e';

        // Act
        const result = shown(source);

        // Assert
        expect(result).toBe('ul(li(p"a" ul(li(p"b" ul(li(p"c"))) li(p"d"))) li(p"e"))');
    });

    it('should nest ordered lists inside bullet lists and back', () => {
        // Arrange
        const source = '1. a\n   - b\n     1. c';

        // Act
        const result = shown(source);

        // Assert
        expect(result).toBe('ol1(li(p"a" ul(li(p"b" ol1(li(p"c"))))))');
    });

    it('should start a nested list on the same line as the marker', () => {
        // Act
        const result = shown('- - a\n  - b');

        // Assert
        expect(result).toBe('ul(li(ul(li(p"a") li(p"b"))))');
    });

    it('should close a nested list when the indent drops', () => {
        // Act
        const result = shown('- a\n  - b\n- c\n\n  d');

        // Assert
        expect(result).toBe('ul(li(p"a" ul(li(p"b"))) li(p"c" p"d"))');
    });
});

describe('raw HTML blocks', () => {
    const cases: [string, string, string][] = [
        ['a script line is its characters', '<script>alert(1)</script>', 'raw"<script>alert(1)</script>"'],
        ['an element block runs to the blank line', '<div>\n*a*\n</div>\n\nb', 'raw"<div>\\n*a*\\n</div>" p"b"'],
        ['a comment', '<!-- a -->', 'raw"<!-- a -->"'],
        ['a closing tag', '</div>', 'raw"</div>"'],
        ['a processing instruction', '<?php x ?>', 'raw"<?php x ?>"'],
        ['a less-than sign and a space is a paragraph', '< a', 'p"< a"'],
        ['inside a quote', '> <b>x</b>', 'bq(raw"<b>x</b>")'],
        ['inside an item', '- <i>x</i>', 'ul(li(raw"<i>x</i>"))'],
        ['it does not interrupt a paragraph', 'a\n<b>', 'p"a\\n<b>"'],
        ['four spaces are code', '    <b>', 'code"<b>"']
    ];
    it.each(cases)('should parse %s', (_name, source, expected) => {
        // Act
        const result = shown(source);

        // Assert
        expect(result).toBe(expected);
    });

    it('should hold the characters of a script block in a node with no children', () => {
        // Act
        const [node] = parseBlocks('<script>alert(1)</script>');

        // Assert
        expect(node).toEqual({ type: 'text', children: [], text: '<script>alert(1)</script>', level: 0 });
    });
});

describe('the node shape', () => {
    it('should give every block type, children, text and level', () => {
        // Act
        const result = parseBlocks('## h\n\n3. a');

        // Assert
        expect(result).toEqual([
            { type: 'heading', children: [], text: 'h', level: 2 },
            {
                type: 'orderedList',
                children: [{ type: 'listItem', children: [{ type: 'paragraph', children: [], text: 'a', level: 0 }], text: '', level: 0 }],
                text: '',
                level: 3
            }
        ]);
    });
});

describe('pathological input', () => {
    const SIZE = 20_000;
    const depthOf = (nodes: readonly BlockNode[]): number => {
        let deepest = 0;
        const stack: [BlockNode, number][] = nodes.map((node) => [node, 1]);
        while (stack.length > 0) {
            const [node, depth] = stack.pop() as [BlockNode, number];
            deepest = Math.max(deepest, depth);
            for (const child of node.children) stack.push([child, depth + 1]);
        }
        return deepest;
    };
    const inputs: [string, string][] = [
        ['a run of >', '>'.repeat(SIZE)],
        ['nested quotes with spaces', '> '.repeat(SIZE / 2)],
        ['a run of -', '-'.repeat(SIZE)],
        ['nested bullets on one line', '- '.repeat(SIZE / 2)],
        ['nested bullets ending in text', `${'- '.repeat(SIZE / 2 - 1)}x`],
        ['nested ordered markers', '1. '.repeat(SIZE / 3)],
        ['mixed quote and list markers', '> - '.repeat(SIZE / 4)],
        ['a rule made of spaced dashes', '- '.repeat(SIZE / 2 - 1) + '-'],
        ['unclosed fences', '```\n'.repeat(SIZE / 4)],
        ['alternating fence characters', '```\n~~~\n'.repeat(SIZE / 8)],
        ['a growing indent', Array.from({ length: 140 }, (_, at) => `${' '.repeat(at)}- a`).join('\n')],
        ['quotes one more deep on each line', Array.from({ length: 140 }, (_, at) => `${'>'.repeat(at + 1)} a`).join('\n')],
        ['many short quote lines', '>\n'.repeat(SIZE / 2)],
        ['many short list lines', '-\n'.repeat(SIZE / 2)],
        ['many blank lines with spaces', '  \n'.repeat(SIZE / 3)],
        ['one very long line of spaces', `${' '.repeat(SIZE)}x`],
        ['a long run of setext underline candidates', `a\n${'='.repeat(SIZE - 2)}`],
        ['many tabs', '\t'.repeat(SIZE)],
        ['many heading markers', '#'.repeat(SIZE)],
        ['many raw html lines', '<a>\n'.repeat(SIZE / 4)]
    ];

    it.each(inputs)('should parse %s in under 50 ms and keep the tree shallow', (_name, source) => {
        // Arrange
        expect(source.length).toBeLessThanOrEqual(SIZE + 1);

        // Act
        const result = parseBlocks(source);
        const median = medianMs(() => parseBlocks(source));

        // Assert
        expect(median).toBeLessThan(50);
        expect(depthOf(result)).toBeLessThanOrEqual(MAX_BLOCK_DEPTH + 1);
    });

    it('should take time in proportion to the input, not its square', () => {
        // Arrange
        const build = (count: number): string => `${'> - '.repeat(count)}x\n`.repeat(2);
        const small = build(2_000);
        const large = build(8_000);

        // Act
        const smallMs = medianMs(() => parseBlocks(small));
        const largeMs = medianMs(() => parseBlocks(large));

        // Assert: four times the input must stay far below the sixteen times of a quadratic parser
        expect(largeMs).toBeLessThan(Math.max(smallMs * 10, 5));
    });

    it('should cap the container depth and show the markers past the cap as text', () => {
        // Act
        const result = parseBlocks('>'.repeat(100));

        // Assert
        expect(depthOf(result)).toBe(MAX_BLOCK_DEPTH + 1);
        expect(shown('>'.repeat(100))).toContain('>'.repeat(100 - MAX_BLOCK_DEPTH));
    });
});
