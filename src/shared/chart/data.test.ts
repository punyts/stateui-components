import { describe, expect, it } from 'vitest';
import { formatOnce, readCategories, readKeys, readRows, readSeries, readValues } from './data.js';

describe('readRows', () => {
    it('should read an array as it is and a keyed map in key order', () => {
        // Assert
        expect(readRows([{ a: 1 }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }]);
        expect(readRows({ k1: { a: 1 }, k2: { a: 2 } })).toEqual([{ a: 1 }, { a: 2 }]);
    });

    it('should leave out what is not an object and give nothing for other input', () => {
        // Assert
        expect(readRows([{ a: 1 }, 3, null, 'x', [1]])).toEqual([{ a: 1 }]);
        expect(readRows(undefined)).toEqual([]);
        expect(readRows(5)).toEqual([]);
    });
});

describe('readKeys', () => {
    it('should key an array by its index as a string and a keyed map by its key, in the order of readRows', () => {
        // Assert
        expect(readKeys([{ a: 1 }, { a: 2 }])).toEqual(['0', '1']);
        expect(readKeys({ k2: { a: 2 }, k1: { a: 1 } })).toEqual(['k2', 'k1']);
        expect(readKeys({ k2: { a: 2 }, k1: { a: 1 } }).length).toBe(readRows({ k2: { a: 2 }, k1: { a: 1 } }).length);
    });

    it('should leave out the keys of entries readRows leaves out, without shifting the array indexes after them', () => {
        // Assert
        expect(readKeys([{ a: 1 }, 3, null, { a: 2 }])).toEqual(['0', '3']);
        expect(readKeys({ x: 'text', y: { a: 1 } })).toEqual(['y']);
        expect(readKeys(undefined)).toEqual([]);
        expect(readKeys(5)).toEqual([]);
    });
});

describe('readSeries', () => {
    it('should list the series in key order with their field and label', () => {
        // Act
        const series = readSeries({ revenue: { field: 'rev', _label: 'Revenue' }, cost: { field: 'cost', _label: 'Cost' } });

        // Assert
        expect(series).toEqual([
            { key: 'revenue', field: 'rev', label: 'Revenue' },
            { key: 'cost', field: 'cost', label: 'Cost' }
        ]);
    });

    it('should read the field named like the key and label with the key when they are missing', () => {
        // Assert
        expect(readSeries({ sales: {} })).toEqual([{ key: 'sales', field: 'sales', label: 'sales' }]);
        expect(readSeries('nope')).toEqual([]);
    });
});

describe('readCategories and readValues', () => {
    it('should use the x field as text and the position from 1 when it is empty', () => {
        // Assert
        expect(readCategories([{ m: 'Jan' }, { m: 2 }, {}, { m: '' }], 'm')).toEqual(['Jan', '2', '3', '4']);
    });

    it('should read numbers, with text numbers converted and anything else 0', () => {
        // Assert
        expect(readValues([{ v: 3 }, { v: '4.5' }, { v: 'x' }, {}], 'v')).toEqual([3, 4.5, 0, 0]);
    });
});

describe('formatOnce', () => {
    it('should format each value once and give the same text again', () => {
        // Arrange
        const calls: number[] = [];
        const format = formatOnce((value) => {
            calls.push(value);
            return `#${value}`;
        });

        // Act
        const texts = [format(1), format(2), format(1), format(2)];

        // Assert
        expect(texts).toEqual(['#1', '#2', '#1', '#2']);
        expect(calls).toEqual([1, 2]);
    });
});
