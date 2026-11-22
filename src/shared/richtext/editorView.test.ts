import { describe, expect, it } from 'vitest';
import type { KeyedBlock } from './model.js';
import { numbering } from './editorView.js';

const item = (key: string, type: KeyedBlock['type'], indent = 0): KeyedBlock => ({ key, order: key, type, runs: [], indent });

describe('numbering', () => {
    it('should count numbered items per indent, continue a level after deeper items and restart after another block', () => {
        // Arrange
        const blocks: KeyedBlock[] = [
            item('a', 'numbered'),
            item('b', 'numbered', 1),
            item('c', 'numbered', 1),
            item('d', 'numbered'),
            item('e', 'bullet'),
            item('f', 'numbered'),
            { key: 'g', order: 'g', type: 'paragraph', runs: [] },
            item('h', 'numbered')
        ];

        // Act
        const numbers = numbering(blocks);

        // Assert
        expect(Object.fromEntries(numbers)).toEqual({ a: 1, b: 1, c: 2, d: 2, f: 1, h: 1 });
    });
});
