import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        globalSetup: ['./test/globalSetup.ts'],
        include: ['src/**/*.browser.test.ts', 'test/**/*.browser.test.ts'],
        // Timing tests run on their own, one file at a time: vitest.perf.config.ts (npm run test:perf)
        exclude: ['**/node_modules/**', '**/*.perf.browser.test.ts'],
        passWithNoTests: false,
        browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }]
        }
    }
});
