import { describe, expect, it } from 'vitest';
import { filterComboOptions, labelContains, readComboOptions, sameText } from './combo.js';

describe('readComboOptions', () => {
    it('should read a keyed map with the key as value and _label as label, the key when there is none', () => {
        // Act
        const options = readComboOptions({ open: { _label: 'Open' }, done: {} }, 'value', 'label');

        // Assert
        expect(options).toEqual([
            { key: 'open', value: 'open', label: 'Open' },
            { key: 'done', value: 'done', label: 'done' }
        ]);
    });

    it('should read a data array by optionValue and optionLabel and keep the value type', () => {
        // Act
        const options = readComboOptions([{ id: 1, name: 'One' }, { id: 2 }, { name: 'No id' }, null, 'Plain'], 'id', 'name');

        // Assert
        expect(options).toEqual([
            { key: '1', value: 1, label: 'One' },
            { key: '2', value: 2, label: '2' },
            { key: 'Plain', value: 'Plain', label: 'Plain' }
        ]);
    });

    it('should give nothing for anything else', () => {
        // Assert
        expect(readComboOptions(undefined, 'value', 'label')).toEqual([]);
        expect(readComboOptions('x', 'value', 'label')).toEqual([]);
    });
});

describe('labelContains and sameText', () => {
    it.each([
        ['Café', 'e', 'en', true],
        ['Cafe', 'é', 'en', true],
        ['ÉCLAIR', 'eclair', 'en', true],
        ['Zürich', 'URI', 'de', true],
        ['Berlin', 'lin', 'de', true],
        ['Berlin', 'x', 'de', false],
        ['Berlin', '', 'de', true],
        ['Be', 'Ber', 'de', false]
    ] as const)('should find %s for %s in %s: %s', (label, query, locale, expected) => {
        // Assert
        expect(labelContains(label, query, locale)).toBe(expected);
    });

    it('should compare whole texts apart from case and accents, and fall back for an unknown language code', () => {
        // Assert
        expect(sameText('Éclair', 'eclair', 'fr')).toBe(true);
        expect(sameText('Eclair', 'Eclairs', 'en')).toBe(false);
        expect(sameText('a', 'A', 'not a locale!')).toBe(true);
    });
});

describe('filterComboOptions', () => {
    const options = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'].map((label) => ({ key: label, value: label, label }));

    it('should keep option order and cap the list, saying that more matched', () => {
        // Act
        const result = filterComboOptions(options, 'a', 'en', 3);

        // Assert
        expect(result.shown.map((option) => option.label)).toEqual(['Alpha', 'Beta', 'Gamma']);
        expect(result.more).toBe(true);
    });

    it('should not say more when everything that matched is shown', () => {
        // Act
        const result = filterComboOptions(options, 'eps', 'en', 3);

        // Assert
        expect(result).toEqual({ shown: [options[4]], more: false });
    });
});
