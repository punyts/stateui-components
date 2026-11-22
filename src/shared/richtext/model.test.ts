import { describe, expect, it } from 'vitest';
import { MAX_INDENT, isBlockKey, newBlockKey, normalizeRuns, readRichText, textLength, valueOf } from './model.js';

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
