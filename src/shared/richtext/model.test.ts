import { describe, expect, it } from 'vitest';
import { MAX_IMAGES, MAX_IMAGE_TEXT, MAX_INDENT, isBlockKey, newBlockKey, normalizeRuns, plainText, readRichText, textLength, valueOf } from './model.js';
import type { KeyedBlock } from './model.js';

describe('normalizeRuns', () => {
    it('should join neighbours with the same marks and link, and drop empty runs and unknown marks', () => {
        // Arrange
        const runs = [
            { text: 'a', marks: ['italic', 'bold'] },
            { text: 'b', marks: ['bold', 'italic', 'glow'] },
            { text: '' },
            { text: 'c' },
            { text: 'd', link: 'https://x.example' },
            { text: 'e', link: 'https://x.example' }
        ];

        // Act
        const normal = normalizeRuns(runs);

        // Assert
        expect(normal).toEqual([
            { text: 'ab', marks: ['italic', 'bold'] },
            { text: 'c' },
            { text: 'de', link: 'https://x.example' }
        ]);
    });

    it('should drop a link that is not https, relative or a fragment', () => {
        // Act
        const normal = normalizeRuns([{ text: 'x', link: 'javascript:alert(1)' }, { text: 'y', link: 'http://x.example' }]);

        // Assert
        expect(normal).toEqual([{ text: 'xy' }]);
    });
});

describe('readRichText', () => {
    it('should read blocks in order, then by key, with every field checked', () => {
        // Arrange
        const value = {
            blocks: {
                bZ: { order: 'V', type: 'paragraph', runs: [{ text: 'second' }] },
                bA: { order: 'V', type: 'paragraph', runs: [{ text: 'first' }] },
                bH: { order: 'a', type: 'heading', level: 9, runs: [{ text: 'h' }] },
                bL: { order: 'b', type: 'check', indent: 12, checked: 'yes', runs: [{ text: 'l' }] },
                bC: { order: 'c', type: 'code', language: 'ts', runs: [{ text: 'let ', marks: ['bold'] }, { text: 'a' }] }
            }
        };

        // Act
        const blocks = readRichText(value);

        // Assert
        expect(blocks.map((block) => block.key)).toEqual(['bA', 'bZ', 'bH', 'bL', 'bC']);
        expect(blocks[2]).toMatchObject({ type: 'heading', level: 3 });
        expect(blocks[3]).toMatchObject({ type: 'check', indent: MAX_INDENT, checked: false });
        expect(blocks[4]).toMatchObject({ type: 'code', language: 'ts', runs: [{ text: 'let a' }] });
    });

    it('should drop entries that are not blocks and keys that are integer-like', () => {
        // Arrange
        const value = { blocks: { 12: { order: 'a', type: 'paragraph', runs: [] }, bX: { type: 'video' }, bY: 'text', bQ: { order: 'b', type: 'divider', runs: [{ text: 'gone' }] } } };

        // Act
        const blocks = readRichText(value);

        // Assert
        expect(blocks).toEqual([{ key: 'bQ', order: 'b', type: 'divider', runs: [] }]);
    });

    it('should read anything that is not a value as no blocks', () => {
        // Assert
        expect(readRichText(undefined)).toEqual([]);
        expect(readRichText('text')).toEqual([]);
        expect(readRichText({ blocks: [] })).toEqual([]);
    });
});

describe('valueOf', () => {
    it('should give each block a new letter-first key and an order that keeps the order given', () => {
        // Act
        const value = valueOf([{ type: 'paragraph', runs: [{ text: 'one' }] }, { type: 'divider', runs: [] }, { type: 'paragraph', runs: [{ text: 'three' }] }]);

        // Assert
        const keys = Object.keys(value.blocks);
        expect(keys.every(isBlockKey)).toBe(true);
        expect(readRichText(value).map((block) => block.runs[0]?.text ?? '-')).toEqual(['one', '-', 'three']);
        expect(textLength(readRichText(value))).toBe(8);
    });

    it('should make block keys that are never integer-like', () => {
        // Act
        const keys = Array.from({ length: 200 }, newBlockKey);

        // Assert
        expect(keys.every((key) => isBlockKey(key) && !/^\d+$/.test(key))).toBe(true);
        expect(new Set(keys).size).toBe(200);
    });
});

describe('tables and mentions', () => {
    it('should read a table with as many columns as its header, padding and cutting rows, and keep alignment only when set', () => {
        // Arrange
        const value = {
            blocks: {
                t: { order: 'V', type: 'table', runs: [{ text: 'dropped' }], align: ['center', 'up'], rows: [{ cells: [{ runs: [{ text: 'a\nb' }] }, { runs: [] }] }, { cells: [{ runs: [{ text: 'c' }] }, {}, { runs: [{ text: 'cut' }] }] }, { cells: [] }] },
                u: { order: 'W', type: 'table', align: ['', ''], rows: [] }
            }
        };

        // Act
        const [t, u] = readRichText(value);

        // Assert
        expect(t?.runs).toEqual([]);
        expect(t?.rows?.map((row) => row.cells.map((cell) => plainText(cell.runs)))).toEqual([['a b', ''], ['c', ''], ['', '']]);
        expect(t?.align).toEqual(['center', '']);
        expect(u?.rows).toEqual([{ cells: [{ runs: [] }] }]);
        expect(u?.align).toBeUndefined();
        expect(textLength([t as KeyedBlock])).toBe(4);
    });

    it('should keep a mention as its own run without a link, and drop an empty or overlong id', () => {
        // Act
        const runs = normalizeRuns([
            { text: '@Ada', mention: 'u1', link: 'https://x.example' },
            { text: '@Bo', mention: 'u2' },
            { text: 'x', mention: '' },
            { text: 'y', mention: 'z'.repeat(129) }
        ]);

        // Assert
        expect(runs).toEqual([{ text: '@Ada', mention: 'u1' }, { text: '@Bo', mention: 'u2' }, { text: 'xy' }]);
    });
});

describe('images', () => {
    const photo = { id: 'f1', name: 'photo.png', size: 2048, type: 'image/png', extra: 'dropped' };

    it('should read an image with its file, one-line alt text and caption, and a known width, and no runs', () => {
        // Arrange
        const value = { blocks: { a: { order: 'V', type: 'image', file: photo, alt: 'a\nchart', caption: 'x'.repeat(MAX_IMAGE_TEXT + 5), width: 'small', runs: [{ text: 'no' }] } } };

        // Act
        const [image] = readRichText(value);

        // Assert
        expect(image).toEqual({ key: 'a', order: 'V', type: 'image', runs: [], file: { id: 'f1', name: 'photo.png', size: 2048, type: 'image/png' }, alt: 'a chart', caption: 'x'.repeat(MAX_IMAGE_TEXT), width: 'small' });
    });

    it('should drop an image whose file is missing or not a picture, and leave out an unknown width', () => {
        // Arrange
        const value = {
            blocks: {
                a: { order: 'V', type: 'image' },
                b: { order: 'W', type: 'image', file: { ...photo, type: 'text/html' } },
                c: { order: 'X', type: 'image', file: photo, width: 'huge' }
            }
        };

        // Act
        const blocks = readRichText(value);

        // Assert
        expect(blocks.map((one) => one.key)).toEqual(['c']);
        expect(blocks[0]?.width).toBeUndefined();
    });

    it('should keep at most the first images a field holds', () => {
        // Arrange
        const entries = Array.from({ length: MAX_IMAGES + 2 }, (_, index) => [`i${String.fromCharCode(97 + index)}`, { order: `V${String.fromCharCode(97 + index)}`, type: 'image', file: photo }]);

        // Act
        const blocks = readRichText({ blocks: Object.fromEntries(entries) });

        // Assert
        expect(blocks).toHaveLength(MAX_IMAGES);
        expect(blocks.at(-1)?.key).toBe(`i${String.fromCharCode(97 + MAX_IMAGES - 1)}`);
    });
});
