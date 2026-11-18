import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { formatError } from '@punyts/stateui-app/build';
import { buildComponents } from './buildComponents.mjs';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const LOCALE_FILE = /\.locale\.[a-zA-Z-]+\.json$/;

/**
 * Writes every `<name>.locale.<code>.json` of a built library into one `locales.json` beside its `components/` folder,
 * keyed by file name, so a browser test loads the overlays as one module rather than one per file (see
 * `test/harness/realLocales.ts`)
 */
async function writeLocaleBundle(componentsDir: string): Promise<void> {
    const files: Record<string, unknown> = {};
    for (const name of (await readdir(componentsDir)).filter((file) => LOCALE_FILE.test(file)).sort()) {
        files[name] = JSON.parse(await readFile(join(componentsDir, name), 'utf8'));
    }
    await writeFile(join(dirname(componentsDir), 'locales.json'), JSON.stringify(files));
}

/**
 * Builds the test fixture library and the package's own `components/` into the folders the tests import from:
 * `.test-build/fixture/` and `.test-build/real/`, each with a `locales.json` of all its locale overlays. The test
 * configs run it as their global setup, and `npm run typecheck` runs it first, since the tests import its output
 */
export async function buildTestLibraries(): Promise<void> {
    for (const [source, out] of [
        ['test/fixtures/components', '.test-build/fixture/components'],
        ['components', '.test-build/real/components']
    ] as const) {
        const result = await buildComponents(resolve(PACKAGE_ROOT, source), resolve(PACKAGE_ROOT, out));
        const errors = result.errors.filter((error) => error.severity !== 'warning');
        if (errors.length > 0) throw new Error(`Building ${source} failed:\n${errors.map(formatError).join('\n')}`);
        await writeLocaleBundle(resolve(PACKAGE_ROOT, out));
    }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
    buildTestLibraries().catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    });
}
