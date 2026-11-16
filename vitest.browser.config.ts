import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { browserOptimizeDeps, bundleBuiltLibrary } from './test/browserServing';

export default defineConfig({
    // Few module responses per test file, or the parallel test pages run Windows out of commit (test/browserServing.ts)
    plugins: [bundleBuiltLibrary()],
    optimizeDeps: browserOptimizeDeps,
    test: {
        globals: true,
        globalSetup: ['./test/globalSetup.ts'],
        include: ['src/**/*.browser.test.ts', 'test/**/*.browser.test.ts'],
        // Timing tests run on their own, one file at a time: vitest.perf.config.ts (npm run test:perf); screenshots too:
        // vitest.visual.config.ts (npm run test:visual)
        exclude: ['**/node_modules/**', '**/*.perf.browser.test.ts', '**/*.visual.browser.test.ts'],
        passWithNoTests: false,
        // At most 6 test pages at once (12 by default on this machine): 56 s instead of 48 s, and a commit peak of about
        // 7 GB instead of 10.5 GB above what the machine already uses (test/browserServing.ts)
        maxWorkers: 6,
        browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }]
        }
    }
});
