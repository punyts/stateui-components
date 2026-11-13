import { relative, sep } from 'node:path';
import { build } from 'vite';
import type { Plugin, UserConfig } from 'vite';

/*
 * How the browser test server serves modules. Vitest runs each browser test file in a fresh iframe, which imports all
 * its modules again. Served one file each, the built library (`.test-build/<kind>/components/index.js` and its
 * component and shared modules), its locale overlays and the linked `@punyts/*` packages were about 730 module
 * responses per test file. Chromium holds a pagefile-backed buffer for each response it has not read yet, and with up
 * to 12 test pages loading at once that commit charge grew by 10 to 28 GB within seconds until Windows refused to
 * commit more: a renderer died with an out-of-memory exception and the Vitest process with it (exit 127 in Git Bash),
 * at a different file each run. Served as below, a test file is about 70 module responses.
 */

/** The workspace packages the tests import, pre-bundled by Vite (linked packages are not by default) */
export const PREBUNDLED_PACKAGES = [
    '@punyts/core',
    '@punyts/state',
    '@punyts/state-sync',
    '@punyts/stateui',
    '@punyts/stateui-app',
    '@punyts/stateui-app/core'
];

/**
 * `optimizeDeps` for the browser configs: the packages above as a few pre-bundled modules, bundled again on each run
 * (`force`) so a rebuilt sibling package is never served from a stale bundle
 */
export const browserOptimizeDeps: UserConfig['optimizeDeps'] = { include: PREBUNDLED_PACKAGES, force: true };

const BUILT_INDEX = /\/\.test-build\/(?:real|fixture)\/components\/index\.js$/;

/** Whether an import stays outside the bundle: a package (served by Vite, so every test shares one copy) */
const isPackage = (id: string): boolean => !id.startsWith('.') && !id.startsWith('/') && !/^[a-zA-Z]:[\/]/.test(id) && !id.startsWith('\0');

/**
 * Serves a built library's `components/index.js` as one module: its component, controller and shared modules bundled
 * with Vite's own bundler, the packages they import left as imports. Built once per file and server, since Vite caches
 * what `load` returns
 */
export function bundleBuiltLibrary(): Plugin {
    return {
        name: 'stateui-components:bundle-built-library',
        enforce: 'pre',
        async load(id) {
            const file = id.split('?')[0] ?? id;
            if (!BUILT_INDEX.test(file.split(sep).join('/'))) return null;
            const output = await build({
                configFile: false,
                logLevel: 'silent',
                build: {
                    write: false,
                    minify: false,
                    sourcemap: false,
                    lib: { entry: file, formats: ['es'], fileName: 'index' },
                    rolldownOptions: { external: isPackage }
                }
            });
            const results = Array.isArray(output) ? output : [output];
            const chunks = results.flatMap((result) => ('output' in result ? result.output : [])).filter((item) => item.type === 'chunk');
            // The built modules import no other module lazily; a second chunk would be a module this plugin does not serve
            if (chunks.length !== 1 || chunks[0]?.type !== 'chunk') {
                throw new Error(`bundleBuiltLibrary: ${relative(process.cwd(), file)} gave ${chunks.length} chunks, expected 1`);
            }
            return chunks[0].code;
        }
    };
}
