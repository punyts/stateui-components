import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * Timing tests (`*.perf.browser.test.ts`) in Chromium, one file at a time, so a time ceiling measures the code and not
 * the other files sharing the machine. The default browser config leaves these files out.
 */
export default defineConfig({
    test: {
        globals: true,
        globalSetup: ['./test/globalSetup.ts'],
        include: ['src/**/*.perf.browser.test.ts', 'test/**/*.perf.browser.test.ts'],
        fileParallelism: false,
        passWithNoTests: false,
        browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }]
        }
    }
});
