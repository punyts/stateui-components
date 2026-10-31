import type { Catalog } from '@punyts/stateui-app/build';
import catalog from '../../.test-build/real/components/catalog.json';
import { registerAll } from '../../.test-build/real/components/index.js';
import { createMountComponent } from './createMountComponent.js';
import type { ComponentBuild } from './createMountComponent.js';

const localeFiles = import.meta.glob<ComponentBuild['localeFiles'][string]>(
    '../../.test-build/real/components/*.locale.*.json',
    { eager: true, import: 'default' }
);

/**
 * Mounts one component of this library for a component test: `mountComponent('text', { _text: 'Hi' }, { mode: 'dark' })`.
 * It returns the element, the store and `setTheme` / `setLocale`. Call `mountComponent.unmountAll()` in `afterEach`
 */
export const mountComponent = createMountComponent({
    catalog: catalog as unknown as Catalog,
    registerAll,
    localeFiles
});
