import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { themeTokenLookup, libraryFromCatalog, validateDocument } from '@punyts/stateui-app/core';
import { formatError } from '@punyts/stateui-app/build';
import type { Catalog } from '@punyts/stateui-app/build';
import catalogJson from '../.test-build/real/components/catalog.json';

const catalog = catalogJson as unknown as Catalog;
const hasToken = themeTokenLookup(libraryFromCatalog(catalog));

/** The JSON example of the README's graphics overview (G1.11), so the documented drawing stays valid */
function graphicsExample(): Record<string, unknown> {
    const readme = readFileSync(resolve(import.meta.dirname, '..', 'README.md'), 'utf8');
    const section = readme.slice(readme.indexOf('## Graphics:'));
    const match = /```json\n([\s\S]*?)```/.exec(section);
    if (match === null) throw new Error('The README graphics section has no JSON example');
    return JSON.parse(match[1]) as Record<string, unknown>;
}

describe('the README graphics example', () => {
    it('should be a drawing that validates with its seats dataset', () => {
        // Arrange
        const document = {
            locale: 'en',
            data: { ui: { seat: '' }, seats: { a1: { id: 'a1', name: 'A1', x: 40, y: 60, fill: '{color.accent.base}' } } },
            app: graphicsExample()
        };

        // Act
        const result = validateDocument(document, catalog, { hasToken });

        // Assert (warnings, such as a missing _label, are in errors too)
        expect((document.app as { component: string }).component).toBe('drawing');
        expect(result.errors.map(formatError)).toEqual([]);
    });
});
