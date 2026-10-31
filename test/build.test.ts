import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildComponents } from '../scripts/buildComponents.mjs';
import { COMPONENT_GROUPS } from '../src/index.js';

const fixtures = resolve(import.meta.dirname, 'fixtures/components');
const folders: string[] = [];

async function outFolder(): Promise<string> {
    const folder = await mkdtemp(join(tmpdir(), 'stateui-components-'));
    folders.push(folder);
    return join(folder, 'components');
}

describe('buildComponents', () => {
    afterEach(async () => {
        for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
    });

    it('should build the fixture component into modules, the German overlay and catalog.json', async () => {
        // Arrange
        const out = await outFolder();

        // Act
        const result = await buildComponents(fixtures, out);

        // Assert
        expect(result.errors).toEqual([]);
        const files = await readdir(out);
        expect(files).toEqual(expect.arrayContaining(['catalog.json', 'index.js', 'probe.js', 'probe.locale.de.json']));
        const catalog = JSON.parse(await readFile(join(out, 'catalog.json'), 'utf8')) as {
            components: { name: string; tag: string; size: string }[];
            locales: string[];
        };
        expect(catalog.components.map(({ name, tag, size }) => ({ name, tag, size }))).toEqual([
            { name: 'orderEditor', tag: 'ui-order-editor', size: 'composite' },
            { name: 'probe', tag: 'ui-probe', size: 'atom' }
        ]);
        expect(catalog.locales).toEqual(['de']);
    });

    it('should write the register helper next to the components folder', async () => {
        // Arrange
        const out = await outFolder();

        // Act
        await buildComponents(fixtures, out);

        // Assert
        const register = await readFile(join(out, '..', 'register.js'), 'utf8');
        expect(register).toContain("from './components/index.js'");
        expect(register).toContain('export function register(window)');
        expect(await readFile(join(out, '..', 'register.d.ts'), 'utf8')).toContain('export declare function register');
    });

    it('should build the package components folder, which has no components yet, without errors', async () => {
        // Arrange
        const out = await outFolder();

        // Act
        const result = await buildComponents(resolve(import.meta.dirname, '../components'), out);

        // Assert
        expect(result.errors).toEqual([]);
        expect(result.catalog.components.every((component) => component.name !== '')).toBe(true);
    });

    it('should name the four grouping folders', () => {
        // Assert
        expect(COMPONENT_GROUPS).toEqual(['atoms', 'molecules', 'composites', 'composed']);
    });
});
