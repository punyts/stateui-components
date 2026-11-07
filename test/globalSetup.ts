import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { TestProject } from 'vitest/node';
import { formatError } from '@punyts/stateui-app/build';
import { buildComponents } from '../scripts/buildComponents.mjs';

const root = resolve(import.meta.dirname, '..');

declare module 'vitest' {
    export interface ProvidedContext {
        /**
         * The text of the 3D renderer chunk built by the sibling `@punyts/stateui-3d` (`../stateui-3d/dist/runtime-chunk/`),
         * or an empty string when it is not built; the scene test with the real chunk skips then
         */
        chunk3dScript: string;
    }
}

/** The built 3D renderer chunk of the workspace's `stateui-3d`, read through its manifest; empty when there is none */
async function readChunk3d(): Promise<string> {
    const dir = resolve(root, '..', 'stateui-3d', 'dist', 'runtime-chunk');
    const manifestPath = join(dir, 'manifest.json');
    if (!existsSync(manifestPath)) return '';
    try {
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { script?: unknown };
        return typeof manifest.script === 'string' ? await readFile(join(dir, manifest.script), 'utf8') : '';
    } catch {
        return '';
    }
}

/**
 * Builds the test fixture library and the package's own `components/` into folders the tests import from, so
 * `npm test` needs no earlier `npm run build`. The fixture output is `.test-build/fixture/`, the real one `.test-build/real/`.
 * It also gives the browser tests the built 3D renderer chunk, when the workspace has one (`inject('chunk3dScript')`)
 */
export default async function setup(project: TestProject): Promise<void> {
    for (const [source, out] of [
        ['test/fixtures/components', '.test-build/fixture/components'],
        ['components', '.test-build/real/components']
    ] as const) {
        const result = await buildComponents(resolve(root, source), resolve(root, out));
        const errors = result.errors.filter((error) => error.severity !== 'warning');
        if (errors.length > 0) throw new Error(`Building ${source} failed:\n${errors.map(formatError).join('\n')}`);
    }
    project.provide('chunk3dScript', await readChunk3d());
}
