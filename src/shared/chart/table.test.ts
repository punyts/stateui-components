import { describe, expect, it } from 'vitest';
import { tableModel } from './table.js';
import type { ChartInput } from './scene.js';

const base: ChartInput = {
    type: 'bar',
    categories: ['Jan', 'Feb'],
    series: [
        { key: 'a', label: 'Revenue', values: [1000, 2000] },
        { key: 'b', label: 'Cost', values: [10, 20] }
    ],
    stacked: false,
    width: 0,
    height: 0,
    format: (value) => `${value}!`,
    percent: (share) => `${Math.round(share * 100)}%`,
    hidden: new Set(['b']),
    texts: { total: 'Total', category: 'Month', value: 'Value', share: 'Share' }
};

describe('tableModel', () => {
    it('should list a column per series and a row per record, hidden series included', () => {
        // Act
        const model = tableModel(base);

        // Assert
        expect(model.headers).toEqual(['Month', 'Revenue', 'Cost']);
        expect(model.rows).toEqual([['Jan', '1000!', '10!'], ['Feb', '2000!', '20!']]);
    });

    it('should list the value and the share of the total for a donut', () => {
        // Act
        const model = tableModel({ ...base, type: 'donut', series: [{ key: 'a', label: 'Revenue', values: [1, 3] }], hidden: new Set() });

        // Assert
        expect(model.headers).toEqual(['Month', 'Value', 'Share']);
        expect(model.rows).toEqual([['Jan', '1!', '25%'], ['Feb', '3!', '75%']]);
    });

    it('should read 0 for a value a record does not have, and for the share when the total is 0', () => {
        // Assert
        expect(tableModel({ ...base, series: [{ key: 'a', label: 'R', values: [5] }] }).rows[1]).toEqual(['Feb', '0!']);
        expect(tableModel({ ...base, type: 'donut', series: [{ key: 'a', label: 'R', values: [0, 0] }] }).rows[0]).toEqual(['Jan', '0!', '0%']);
    });
});
