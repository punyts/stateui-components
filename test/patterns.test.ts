import { describe, expect, it } from 'vitest';
import type { Catalog } from '@punyts/stateui-app/build';
import catalogJson from '../.test-build/real/components/catalog.json';

const catalog = catalogJson as unknown as Catalog;

describe('catalog patterns', () => {
    it('should hold a patterns array, empty until the library has patterns', () => {
        // Arrange and Act
        const patterns = catalog.patterns;

        // Assert
        expect(Array.isArray(patterns)).toBe(true);
        expect(patterns).toEqual([]);
    });
});
