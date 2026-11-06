import { describe, expect, it } from 'vitest';
import type { Catalog, PatternCatalogEntry } from '@punyts/stateui-app/build';
import catalogJson from '../.test-build/real/components/catalog.json';

const catalog = catalogJson as unknown as Catalog;

function pattern(name: string): PatternCatalogEntry {
    const found = catalog.patterns.find((entry) => entry.name === name);
    if (found === undefined) throw new Error(`pattern ${name} is not in the catalog`);
    return found;
}

/** Each commerce screen with its slots and the type of each param (S2.3) */
const COMMERCE = [
    ['product-grid', ['actions', 'card'], { title: 'string', products: 'path' }],
    ['product-detail', ['actions', 'detail'], { title: 'string', product: 'path' }],
    ['bag-and-checkout', ['line', 'payment', 'summary'], { title: 'string', bag: 'path', products: 'path' }],
    ['sign-in-form', ['fields', 'help'], { title: 'string', email: 'path' }]
] as const;

describe('catalog patterns', () => {
    it('should list the patterns sorted by kind then name', () => {
        // Arrange and Act
        const keys = catalog.patterns.map((entry) => `${entry.kind}/${entry.name}`);

        // Assert
        expect(keys).toEqual([...keys].sort());
    });

    it.each(COMMERCE)('should hold the screen pattern %s with its slots and params', (name, slots, params) => {
        // Arrange and Act
        const entry = pattern(name);

        // Assert
        expect(entry.kind).toBe('screen');
        expect(Object.keys(entry.slots).sort()).toEqual([...slots]);
        expect(Object.fromEntries(Object.entries(entry.params).map(([key, param]) => [key, param.type]))).toEqual(params);
        expect(entry.components).not.toContain('outlet');
        expect(entry.purposes.length).toBeGreaterThanOrEqual(3);
    });

    it('should build bag-and-checkout from a stepper and a recordList', () => {
        // Arrange and Act
        const entry = pattern('bag-and-checkout');

        // Assert
        expect(entry.components).toEqual(expect.arrayContaining(['stepper', 'recordList']));
    });
});
