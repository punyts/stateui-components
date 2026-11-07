import { describe, expect, it } from 'vitest';
import { libraryFromCatalog, themeTokenLookup, validateDocument } from '@punyts/stateui-app/core';
import type { Catalog } from '@punyts/stateui-app/build';
import catalogJson from '../.test-build/real/components/catalog.json';

// G2.4b of the graphics epic 2: the chart's `transition` is checked by the `fields` validator as a shape's is (G1.8)

const catalog = catalogJson as unknown as Catalog;
const hasToken = themeTokenLookup(libraryFromCatalog(catalog));

const chartDocument = (transition: unknown): Record<string, unknown> => ({
    locale: 'en',
    data: { sales: [{ month: 'Jan', revenue: 1 }] },
    app: { component: 'chart', x: 'month', series: { revenue: { field: 'revenue', _label: 'Revenue' } }, '<-records': '$.data.sales', transition }
});

const errorsOf = (transition: unknown): string[][] =>
    validateDocument(chartDocument(transition), catalog, { hasToken })
        .errors.filter((error) => error.severity !== 'warning')
        .map((error) => [error.code, error.statePath ?? '']);

describe('the chart transition', () => {
    it('should be declared on the chart with no default', () => {
        // Arrange
        const entry = catalog.components.find((candidate) => candidate.name === 'chart') as unknown as {
            own: string[];
            shape: { properties: Record<string, { type?: unknown; default?: unknown }> };
        };

        // Assert
        expect(entry.own).toContain('transition');
        expect(entry.shape.properties.transition?.type).toBe('object');
        expect(entry.shape.properties.transition?.default).toBeUndefined();
    });

    it.each([[{ duration: 300, easing: 'standard' }], [{ duration: 'slow' }], [{ easing: 'exit' }], [{}]])('should take %j', (transition) => {
        expect(errorsOf(transition)).toEqual([]);
    });

    it.each([[{ easing: 'bounce' }], [{ duration: 'medium' }], [{ duration: -5 }], [{ duration: 70000 }]])('should refuse %j as SUI-STATE-INVALID', (transition) => {
        expect(errorsOf(transition)).toEqual([['SUI-STATE-INVALID', '$.app.transition']]);
    });
});
