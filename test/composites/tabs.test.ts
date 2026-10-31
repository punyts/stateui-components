import { describe, expect, it } from 'vitest';
import { validateDocument } from '@punyts/stateui-app/core';
import type { Catalog } from '@punyts/stateui-app/build';
import catalogJson from '../../.test-build/real/components/catalog.json';

const catalog = catalogJson as unknown as Catalog;

const check = (children: Record<string, unknown>): string[] =>
    validateDocument({ locale: 'en', app: { component: 'tabs', children } }, catalog).errors.map((error) => error.code);

describe('tabs placement shape', () => {
    it('should declare _tab, icon and badge and no layout', () => {
        // Arrange
        const entry = catalog.components.find((candidate) => candidate.name === 'tabs');

        // Assert
        expect(entry?.tier).toBe('root');
        const shape = entry as { layout?: boolean; placement?: Record<string, unknown> };
        expect(Object.keys(shape.placement ?? {})).toEqual(['_tab', 'icon', 'badge']);
        expect(shape.layout).not.toBe(true);
    });

    it('should accept _tab, icon and badge on a child', () => {
        // Act
        const codes = check({ a: { component: 'text', _text: 'A', placement: { _tab: 'A', icon: 'star', badge: 2 } } });

        // Assert
        expect(codes).toEqual([]);
    });

    it('should report a placement.region under tabs as SUI-LAYOUT', () => {
        // Act
        const codes = check({ a: { component: 'text', _text: 'A', placement: { region: 'nw' } } });

        // Assert
        expect(codes.some((code) => code.startsWith('SUI-LAYOUT'))).toBe(true);
    });

    it('should report a layout on tabs as SUI-LAYOUT', () => {
        // Act
        const codes = validateDocument(
            { locale: 'en', app: { component: 'tabs', layout: { type: 'row' }, children: {} } },
            catalog
        ).errors.map((error) => error.code);

        // Assert
        expect(codes).toContain('SUI-LAYOUT-UNSUPPORTED');
    });
});
