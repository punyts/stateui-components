import { describe, expect, it } from 'vitest';
import { fromMarkdown, inlineMarkdown, toMarkdown } from './markdown.js';
import { readRichText } from './model.js';

/** The blocks of a value without keys and orders, for comparing two values */
const shape = (value: unknown) => readRichText(value).map(({ key: _key, order: _order, ...block }) => block);

const SOURCE = [
    '# Opening hours',
    '',
    'Open **every day** except *holidays*; see [the calendar](https://x.example/cal) and `code`.',
    '',
    '- one',
    '- two',
    '    - nested',
    '- [x] done',
    '- [ ] open',
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
    '---'
].join('\n');

describe('fromMarkdown', () => {
    it('should read every construct into its block type, marks and links', () => {
        // Act
        const blocks = shape(fromMarkdown(SOURCE));

        // Assert
        expect(blocks).toEqual([
            { type: 'heading', level: 1, runs: [{ text: 'Opening hours' }] },
            {
                type: 'paragraph',
                runs: [
                    { text: 'Open ' },
                    { text: 'every day', marks: ['bold'] },
                    { text: ' except ' },
                    { text: 'holidays', marks: ['italic'] },
                    { text: '; see ' },
                    { text: 'the calendar', link: 'https://x.example/cal' },
                    { text: ' and ' },
                    { text: 'code', marks: ['code'] },
                    { text: '.' }
                ]
            },
            { type: 'bullet', indent: 0, runs: [{ text: 'one' }] },
            { type: 'bullet', indent: 0, runs: [{ text: 'two' }] },
            { type: 'bullet', indent: 1, runs: [{ text: 'nested' }] },
            { type: 'check', indent: 0, checked: true, runs: [{ text: 'done' }] },
            { type: 'check', indent: 0, checked: false, runs: [{ text: 'open' }] },
            { type: 'numbered', indent: 0, runs: [{ text: 'first' }] },
            { type: 'numbered', indent: 0, runs: [{ text: 'second' }] },
            { type: 'quote', runs: [{ text: 'quoted' }] },
            { type: 'code', runs: [{ text: 'let a = 1;' }] },
            { type: 'divider', runs: [] }
        ]);
    });

    it('should read heading levels past 3 as 3, strikethrough in one text, and a hard break as a line break', () => {
        // Act
        const blocks = shape(fromMarkdown('##### deep\n\nnot ~~this~~ one\\\nnext\nsame line'));

        // Assert
        expect(blocks).toEqual([
            { type: 'heading', level: 3, runs: [{ text: 'deep' }] },
            { type: 'paragraph', runs: [{ text: 'not ' }, { text: 'this', marks: ['strike'] }, { text: ' one\nnext same line' }] }
        ]);
    });

    it('should keep no unsafe link and no HTML', () => {
        // Act
        const blocks = shape(fromMarkdown('[bad](javascript:alert(1)) <b>raw</b>'));

        // Assert
        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.runs.every((run) => run.link === undefined)).toBe(true);
        expect(blocks[0]?.runs.map((run) => run.text).join('')).toContain('<b>raw</b>');
    });
});

describe('toMarkdown', () => {
    it('should write Markdown that fromMarkdown reads back to the same blocks', () => {
        // Arrange
        const value = fromMarkdown(SOURCE);

        // Act
        const written = toMarkdown(value);

        // Assert
        expect(shape(fromMarkdown(written))).toEqual(shape(value));
    });

    it('should round-trip text that looks like Markdown syntax as text', () => {
        // Arrange
        const value = {
            blocks: {
                bA: { order: 'a', type: 'paragraph', runs: [{ text: '# not a heading *or* [a link](x) 1. <b>&amp;' }] },
                bB: { order: 'b', type: 'paragraph', runs: [{ text: '2) also not a list | nor a table ~~' }] },
                bC: { order: 'c', type: 'bullet', indent: 0, runs: [{ text: '- dash first' }] }
            }
        };

        // Act
        const back = shape(fromMarkdown(toMarkdown(value)));

        // Assert
        expect(back).toEqual(shape(value));
    });

    it('should write overlapping marks, marked spaces and code with backticks so they read back', () => {
        // Arrange
        const value = {
            blocks: {
                bA: {
                    order: 'a',
                    type: 'paragraph',
                    runs: [
                        { text: 'plain ' },
                        { text: 'bold ', marks: ['bold'] },
                        { text: 'both', marks: ['italic', 'bold'] },
                        { text: ' italic', marks: ['italic'] },
                        { text: ' and ' },
                        { text: 'a`b', marks: ['code'] },
                        { text: ' end' }
                    ]
                }
            }
        };

        // Act
        const back = shape(fromMarkdown(toMarkdown(value)));

        // Assert
        expect(back).toEqual([
            {
                type: 'paragraph',
                runs: [
                    { text: 'plain ' },
                    { text: 'bold', marks: ['bold'] },
                    { text: ' ' },
                    { text: 'both', marks: ['italic', 'bold'] },
                    { text: ' ' },
                    { text: 'italic', marks: ['italic'] },
                    { text: ' and ' },
                    { text: 'a`b', marks: ['code'] },
                    { text: ' end' }
                ]
            }
        ]);
    });

    it('should write a code block with its language and a fence longer than any inside it', () => {
        // Arrange
        const value = { blocks: { bA: { order: 'a', type: 'code', language: 'md', runs: [{ text: '```\ninner\n```' }] } } };

        // Act
        const written = toMarkdown(value);

        // Assert
        expect(written).toBe('````md\n```\ninner\n```\n````');
        expect(shape(fromMarkdown(written))).toEqual([{ type: 'code', runs: [{ text: '```\ninner\n```' }] }]);
    });

    it('should write a link around the runs that share it', () => {
        // Act
        const written = inlineMarkdown([{ text: 'see ' }, { text: 'the ', link: '/help' }, { text: 'guide', marks: ['bold'], link: '/help' }]);

        // Assert
        expect(written).toBe('see [the **guide**](</help>)');
    });
});
