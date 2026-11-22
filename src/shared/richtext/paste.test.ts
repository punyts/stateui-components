import { describe, expect, it } from 'vitest';
import { plainText } from './model.js';
import { allowedShapes, htmlToShapes, looksLikeMarkdown, textToShapes } from './paste.js';
import type { Shape } from './paste.js';

const parse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');
/** Each shape as its type, level or indent, and text */
const outline = (shapes: readonly Shape[]): string[] => shapes.map((shape) => `${shape.type}${shape.level ?? ''}${shape.indent ? `+${shape.indent}` : ''}:${plainText(shape.runs)}`);

describe('looksLikeMarkdown', () => {
    it('should read block markers at a line start and inline marks or links as Markdown', () => {
        // Act
        const found = ['# Title', 'intro\n- item', '1. first', '> quoted', '```\ncode\n```', 'a **bold** word', 'see [docs](https://x.example)'].map(looksLikeMarkdown);
        const plain = ['just a line', 'a - b', 'costs 5 * 3', 'snake_case_name'].map(looksLikeMarkdown);

        // Assert
        expect(found.every(Boolean)).toBe(true);
        expect(plain.some(Boolean)).toBe(false);
    });
});

describe('textToShapes', () => {
    it('should make one paragraph per line of plain text, keeping empty lines', () => {
        // Act
        const shapes = textToShapes('one\r\n\r\ntwo');

        // Assert
        expect(outline(shapes)).toEqual(['paragraph:one', 'paragraph:', 'paragraph:two']);
    });

    it('should read Markdown through fromMarkdown', () => {
        // Act
        const shapes = textToShapes('## Plan\n\n- **first**\n- second');

        // Assert
        expect(outline(shapes)).toEqual(['heading2:Plan', 'bullet:first', 'bullet:second']);
        expect(shapes[1]?.runs).toEqual([{ text: 'first', marks: ['bold'] }]);
    });
});

describe('htmlToShapes', () => {
    it('should read headings, paragraphs, quotes, rules and code blocks', () => {
        // Arrange
        const html = '<h1>Title</h1><h5>Small</h5><p>One <b>bold</b> and <em>soft</em>.</p><blockquote><p>Said</p></blockquote><hr><pre><code>let a = 1;\n  a++;\n</code></pre>';

        // Act
        const shapes = htmlToShapes(parse(html));

        // Assert
        expect(outline(shapes)).toEqual(['heading1:Title', 'heading3:Small', 'paragraph:One bold and soft.', 'quote:Said', 'divider:', 'code:let a = 1;\n  a++;']);
        expect(shapes[2]?.runs).toEqual([{ text: 'One ' }, { text: 'bold', marks: ['bold'] }, { text: ' and ' }, { text: 'soft', marks: ['italic'] }, { text: '.' }]);
    });

    it('should read nested lists as indented items and task items as checks', () => {
        // Arrange
        const html = '<ul><li>a<ol><li>b</li><li>c</li></ol></li><li>d</li></ul><ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> open</li></ul>';

        // Act
        const shapes = htmlToShapes(parse(html));

        // Assert
        expect(outline(shapes)).toEqual(['bullet:a', 'numbered+1:b', 'numbered+1:c', 'bullet:d', 'check:done', 'check:open']);
        expect(shapes.slice(4).map((shape) => shape.checked)).toEqual([true, false]);
    });

    it('should keep a safe link and drop an unsafe one to its text', () => {
        // Act
        const shapes = htmlToShapes(parse('<p><a href="https://x.example/a">safe</a> <a href="javascript:alert(1)">bad</a></p>'));

        // Assert
        expect(shapes[0]?.runs).toEqual([{ text: 'safe', link: 'https://x.example/a' }, { text: ' bad' }]);
    });

    it('should leave out scripts, styles and images, and keep no other attribute', () => {
        // Act
        const shapes = htmlToShapes(parse('<style>p{}</style><p onclick="x()" class="c">text<script>alert(1)</script><img src="x.png" alt="pic"></p>'));

        // Assert
        expect(shapes).toEqual([{ type: 'paragraph', runs: [{ text: 'text' }] }]);
    });

    it('should collapse white space, keep line breaks and make divs into paragraphs', () => {
        // Act
        const shapes = htmlToShapes(parse('<div>  one\n   two <br> three </div><div>four</div>loose'));

        // Assert
        expect(outline(shapes)).toEqual(['paragraph:one two\nthree', 'paragraph:four', 'paragraph:loose']);
    });

    it('should read Google Docs marks from span styles and ignore its wrapping b', () => {
        // Arrange
        const html = '<b style="font-weight:normal;" id="docs-internal-guid-1"><p><span style="font-weight:700">Bold</span><span style="font-weight:400"> plain </span><span style="font-style:italic">slanted</span></p></b>';

        // Act
        const shapes = htmlToShapes(parse(html));

        // Assert
        expect(shapes[0]?.runs).toEqual([{ text: 'Bold', marks: ['bold'] }, { text: ' plain ' }, { text: 'slanted', marks: ['italic'] }]);
    });

    it('should join the cells of a table row into one paragraph', () => {
        // Act
        const shapes = htmlToShapes(parse('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>'));

        // Assert
        expect(outline(shapes)).toEqual(['paragraph:a b', 'paragraph:c']);
    });
});

describe('allowedShapes', () => {
    it('should turn types the field leaves out into paragraphs and drop dividers', () => {
        // Arrange
        const shapes: Shape[] = [
            { type: 'heading', level: 2, runs: [{ text: 'h' }] },
            { type: 'divider', runs: [] },
            { type: 'bullet', indent: 1, runs: [{ text: 'b' }] }
        ];

        // Act
        const allowed = allowedShapes(shapes, ['bullet']);

        // Assert
        expect(allowed).toEqual([{ type: 'paragraph', runs: [{ text: 'h' }] }, { type: 'bullet', indent: 1, runs: [{ text: 'b' }] }]);
    });
});
