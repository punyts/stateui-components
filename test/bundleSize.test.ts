// @vitest-environment node
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

/**
 * The gzipped size of the library's own code, every component with its shape, view, styles, controller and functions.
 * First measured when `treeDiagram` and its `layoutTree` joined it (stateui-hard-ip.md, Size); raised to 235,300 bytes
 * when `richText` with its block model and Markdown computes joined it, to 250,454 when `richTextField` did, whose
 * editing model, view and undo history add about 13 KB (stateui-text-editor.md, T2), and to 263,957 when the editor's paste,
 * link panel, tables and mentions (T3, T4), the table's pinned and resizable columns and `actionBar` (stateui-component-gaps.md, C1) did. Component functions add to this
 * bundle, so it has a gate like stateui-3d's chunk: the test fails when it is more than 5% above the measure. A component
 * that needs more raises the measure in the same commit, with the reason
 */
const MEASURED_GZIP_BYTES = 263_957;
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
