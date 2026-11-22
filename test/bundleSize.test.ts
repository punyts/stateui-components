// @vitest-environment node
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

/**
 * The gzipped size of the library's own code, every component with its shape, view, styles, controller and functions,
 * as measured when `richText` with its block model and Markdown computes joined it (first measured with `treeDiagram`,
 * stateui-hard-ip.md, Size). Component functions add to
 * this bundle, so it has a gate like stateui-3d's chunk: the test fails when it is more than 5% above the measure. A
 * component that needs more raises the measure in the same commit, with the reason
 */
const MEASURED_GZIP_BYTES = 235_300;
const GZIP_LIMIT = Math.floor(MEASURED_GZIP_BYTES * 1.05);

describe('the components bundle', () => {
    it('should stay under its gzip gate', async () => {
        // Arrange: the built `register` entry, minified, with the punyts libraries it builds on left out
        const result = await build({ entryPoints: ['dist/register.js'], bundle: true, minify: true, format: 'esm', write: false, external: ['@punyts/*'], logLevel: 'silent' });

        // Act
        const gzipped = gzipSync(result.outputFiles[0]!.contents, { level: 9 }).length;

        // Assert
        expect(gzipped, `the components bundle is ${gzipped} bytes gzipped, the gate is ${GZIP_LIMIT}`).toBeLessThanOrEqual(GZIP_LIMIT);
    }, 60_000);
});
