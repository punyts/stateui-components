import { resolve } from 'node:path';
import { formatError } from '@punyts/stateui-app/build';
import { buildComponents } from '../scripts/buildComponents.mjs';

const root = resolve(import.meta.dirname, '..');

/**
 * Builds the test fixture library and the package's own `components/` into folders the tests import from, so
 * `npm test` needs no earlier `npm run build`. The fixture output is `.test-build/fixture/`, the real one `.test-build/real/`
 */
export default async function setup(): Promise<void> {
    for (const [source, out] of [
        ['test/fixtures/components', '.test-build/fixture/components'],
        ['components', '.test-build/real/components']
    ] as const) {
        const result = await buildComponents(resolve(root, source), resolve(root, out));
        const errors = result.errors.filter((error) => error.severity !== 'warning');
        if (errors.length > 0) throw new Error(`Building ${source} failed:\n${errors.map(formatError).join('\n')}`);
    }
}
