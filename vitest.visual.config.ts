import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { browserOptimizeDeps, bundleBuiltLibrary } from './test/browserServing';

/**
 * How the components look (`npm run test:visual`): screenshots of sheets of components compared with references under
 * `test/visual/__screenshots__`. They are kept apart from the browser tests because fonts differ by platform; write
 * the references again with `npm run test:visual -- -u` after a change to the look that is meant
 */
export default defineConfig({
    plugins: [bundleBuiltLibrary()],
    optimizeDeps: browserOptimizeDeps,
    test: {
        globals: true,
        globalSetup: ['./test/globalSetup.ts'],
        include: ['test/**/*.visual.browser.test.ts'],
        passWithNoTests: false,
        browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            viewport: { width: 1000, height: 1400 },
            instances: [{ browser: 'chromium' }]
        }
    }
});
