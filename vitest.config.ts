import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'happy-dom',
        globals: true,
        globalSetup: ['./test/globalSetup.ts'],
        include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
        exclude: [...configDefaults.exclude, 'src/**/*.browser.test.ts', 'test/**/*.browser.test.ts']
    }
});
