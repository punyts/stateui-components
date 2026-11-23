import { describe, expect, it } from 'vitest';
import { keyName, readSceneKeys, takenKey } from './keys.js';

const press = (key: string, held: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({ key, altKey: false, ctrlKey: false, metaKey: false, ...held });

describe('scene keys', () => {
    it('should read the listed names once each and leave out the rest', () => {
        // Act
        const keys = readSceneKeys(['ArrowLeft', 'w', 'Tab', 'W', 'w', 3, 'Space']);

        // Assert
        expect(keys).toEqual(['ArrowLeft', 'w', 'Space']);
        expect(readSceneKeys('w')).toEqual([]);
    });

    it('should name the space bar Space and a letter in lower case', () => {
        // Act
        const names = [' ', 'W', 'w', '7', 'ArrowUp'].map(keyName);

        // Assert
        expect(names).toEqual(['Space', 'w', 'w', '7', 'ArrowUp']);
    });

    it('should take a listed key, but not with Alt, Control or Meta, and not Enter or Space on a proxy button', () => {
        // Arrange
        const keys = ['w', 'Space', 'Enter', 'ArrowUp'];

        // Act
        const taken = [takenKey(press('W'), keys, false), takenKey(press('ArrowUp'), keys, true), takenKey(press(' '), keys, false)];
        const left = [
            takenKey(press('s'), keys, false),
            takenKey(press('w', { ctrlKey: true }), keys, false),
            takenKey(press('w', { altKey: true }), keys, false),
            takenKey(press('w', { metaKey: true }), keys, false),
            takenKey(press(' '), keys, true),
            takenKey(press('Enter'), keys, true)
        ];

        // Assert
        expect(taken).toEqual(['w', 'ArrowUp', 'Space']);
        expect(left.every((name) => name === undefined)).toBe(true);
    });
});
