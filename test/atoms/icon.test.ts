import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICON_ALIASES } from '../../src/icons/aliases.ts';
import { CORE_ICON_NAMES } from '../../src/icons/coreNames.ts';

const root = resolve(import.meta.dirname, '..', '..');

async function files(folder: string, found: string[] = []): Promise<string[]> {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) await files(path, found);
        else found.push(path);
    }
    return found;
}

/** Icon names a shape defaults to, and names a view writes as a literal on `ui-icon` or in an icon expression */
async function usedIconNames(): Promise<Map<string, string>> {
    const used = new Map<string, string>();
    for (const path of await files(resolve(root, 'components'))) {
        const text = await readFile(path, 'utf8');
        if (path.endsWith('.state.json')) {
            const shape = JSON.parse(text) as { properties?: Record<string, { type?: string | string[]; default?: unknown }> };
            for (const [property, definition] of Object.entries(shape.properties ?? {})) {
                const types = Array.isArray(definition.type) ? definition.type : [definition.type];
                if (types.includes('icon') && typeof definition.default === 'string' && definition.default !== '') {
                    used.set(definition.default, `${path} ${property}`);
                }
            }
        }
        if (path.endsWith('.view.html')) {
            for (const tag of text.match(/<ui-icon\b[^>]*>/g) ?? []) {
                const literal = /\bname="([^"{]+)"/.exec(tag);
                if (literal?.[1]) used.set(literal[1], path);
                for (const expression of tag.match(/\bname="\{\{[^"]*\}\}"/g) ?? []) {
                    for (const quoted of expression.match(/'([a-z0-9-]+)'/g) ?? []) used.set(quoted.slice(1, -1), path);
                }
            }
        }
    }
    return used;
}

describe('icons the library uses', () => {
    it('should all be in the core set', async () => {
        // Act
        const used = await usedIconNames();
        const missing = [...used].filter(([name]) => !CORE_ICON_NAMES.includes(ICON_ALIASES[name] ?? name));

        // Assert
        expect(missing).toEqual([]);
    });

    it('should find a name that is not in the core set', async () => {
        // Assert
        expect(CORE_ICON_NAMES).not.toContain('star');
        expect(CORE_ICON_NAMES).toContain('chevron-down');
    });
});

describe('built icon output', () => {
    it('should reference no network address, sprite, font or stylesheet import', async () => {
        // Arrange
        const built = [
            ...(await files(resolve(root, '.test-build/real/components'))).filter((path) => /icon\./.test(path)),
            resolve(root, '.test-build/real/icons/core.js')
        ];

        // Act
        const text = (await Promise.all(built.map((path) => readFile(path, 'utf8')))).join('\n');
        const addresses = (text.match(/https?:\/\/[^\s'"`)]+/g) ?? []).filter((address) => address !== 'http://www.w3.org/2000/svg');

        // Assert
        expect(built.length).toBeGreaterThan(3);
        expect(addresses).toEqual([]);
        expect(text).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|@font-face|@import|url\(|<use\b|xlink:href|innerHTML|insertAdjacentHTML|DOMParser/);
    });
});
