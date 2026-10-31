import type { Catalog } from '@punyts/stateui-app/build';
import catalog from '../../.test-build/fixture/components/catalog.json';
import { registerAll } from '../../.test-build/fixture/components/index.js';
import { createMountComponent } from './createMountComponent.js';
import type { ComponentBuild } from './createMountComponent.js';

const localeFiles = import.meta.glob<ComponentBuild['localeFiles'][string]>(
    '../../.test-build/fixture/components/*.locale.*.json',
    { eager: true, import: 'default' }
);

/** `mountComponent` over the test fixture library (`test/fixtures/components/`), for the harness's own tests */
export const mountFixture = createMountComponent({ catalog: catalog as unknown as Catalog, registerAll, localeFiles });
