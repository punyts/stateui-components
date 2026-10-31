import { describe, expect, it } from 'vitest';
import { validateDocument } from '@punyts/stateui-app/core';
import type { Catalog } from '@punyts/stateui-app/build';
import catalogJson from '../../.test-build/real/components/catalog.json';

const catalog = catalogJson as unknown as Catalog;

const check = (children: Record<string, unknown>): { code: string; statePath?: string }[] =>
    validateDocument({ locale: 'en', app: { component: 'accordion', children } }, catalog).errors.map((error) => ({
        code: error.code,
        statePath: error.statePath
    }));

describe('accordion child shape', () => {
    it('should accept disclosure children', () => {
        // Act
        const errors = check({ a: { component: 'disclosure', _title: 'A' }, b: { component: 'disclosure', _title: 'B', open: true } });

        // Assert
        expect(errors).toEqual([]);
    });

    it('should report SUI-NODE-CHILD with the state path for a child that is not a disclosure', () => {
        // Act
        const errors = check({ a: { component: 'disclosure' }, b: { component: 'text', _text: 'Loose' } });

        // Assert
        expect(errors).toEqual([{ code: 'SUI-NODE-CHILD', statePath: '$.app.children.b' }]);
    });

    it('should list disclosure as the accepted child in the catalog entry', () => {
        // Arrange
        const entry = catalog.components.find((candidate) => candidate.name === 'accordion') as { shape?: { childComponents?: string[] }; childComponents?: string[] };

        // Assert
        expect(entry.childComponents).toEqual(['disclosure']);
        expect(entry.shape?.childComponents).toEqual(['disclosure']);
    });
});
