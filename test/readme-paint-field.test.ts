import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { themeTokenLookup, libraryFromCatalog, validateDocument } from '@punyts/stateui-app/core';
import { formatError } from '@punyts/stateui-app/build';
import type { Catalog } from '@punyts/stateui-app/build';
import catalogJson from '../.test-build/real/components/catalog.json';

const catalog = catalogJson as unknown as Catalog;
const hasToken = themeTokenLookup(libraryFromCatalog(catalog));

/** The JSON example of the README's `paintField` section (G2.11), so the documented form stays valid */
function paintFieldExample(): Record<string, unknown> {
    const readme = readFileSync(resolve(import.meta.dirname, '..', 'README.md'), 'utf8');
    const section = readme.slice(readme.indexOf('## Fields: `paintField`'));
    const match = /```json\n([\s\S]*?)```/.exec(section);
    if (match === null) throw new Error('The README paintField section has no JSON example');
    return JSON.parse(match[1]) as Record<string, unknown>;
}

describe('the README paintField example', () => {
    it('should be a form with a paintField and a typed alternative that validates', () => {
        // Arrange
        const document = {
            locale: 'en',
            data: { order: { signature: {}, typedSignature: '' } },
            app: paintFieldExample()
        };
        const children = (document.app as { children: Record<string, { component: string }> }).children;

        // Act
        const result = validateDocument(document, catalog, { hasToken });

        // Assert (warnings are in errors too)
        expect((document.app as { component: string }).component).toBe('form');
        expect(Object.values(children).map((child) => child.component)).toEqual(['paintField', 'textField']);
        expect(result.errors.map(formatError)).toEqual([]);
    });
});
