import type { ComponentBuild } from './createMountComponent.js';
import files from '../../.test-build/real/locales.json';

/**
 * The locale overlays of the built library by file name (`accordion.locale.de.json`), for `overlaysFromFiles`.
 * `globalSetup` writes them into one `locales.json`, so a browser test file loads them as one module. An eager
 * `import.meta.glob` of the locale files was one module per file, over 200 per test file, and with Vitest's fresh
 * iframe per file the module responses waiting in Chromium ran the machine out of commit (see `browserServing.ts`)
 */
export const realLocaleFiles = files as unknown as ComponentBuild['localeFiles'];
