import { libraryFromCatalog, mountApp, registerLocaleStep } from '@punyts/stateui-app';
import type { AppDocument, AppState, ComponentLibrary } from '@punyts/stateui-app';
import type { Catalog } from '@punyts/stateui-app/build';
import type { Store } from '@punyts/state';
import realCatalog from '../../.test-build/real/components/catalog.json';
import fixtureCatalog from '../../.test-build/fixture/components/catalog.json';
import { registerAll } from '../../.test-build/real/components/index.js';
import { overlaysFromFiles } from './createMountComponent.js';
import type { ComponentBuild } from './createMountComponent.js';

/** The composed components of the fixture library that the order editor tests add to the real library */
const FIXTURE_COMPOSED = ['orderEditor'];

const real = realCatalog as unknown as Catalog;
const fixture = fixtureCatalog as unknown as Catalog;

/**
 * The real library's catalog with the fixture's `orderEditor` added. The fixture is built by the same `buildLibrary`
 * (`globalSetup`) into `.test-build/fixture/`, so its entry is exactly what a catalog build gives; it is not shipped
 */
export const orderEditorCatalog: Catalog = {
    ...real,
    components: [...real.components, ...fixture.components.filter((entry) => FIXTURE_COMPOSED.includes(entry.name))].sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    ),
    locales: [...new Set([...real.locales, ...fixture.locales])].sort()
};

/** The merged catalog as `mountApp` takes it */
export const orderEditorLibrary: ComponentLibrary = libraryFromCatalog(orderEditorCatalog);

const realLocales = import.meta.glob<ComponentBuild['localeFiles'][string]>('../../.test-build/real/components/*.locale.*.json', {
    eager: true,
    import: 'default'
});
const fixtureLocales = import.meta.glob<ComponentBuild['localeFiles'][string]>('../../.test-build/fixture/components/orderEditor.locale.*.json', {
    eager: true,
    import: 'default'
});
const overlays = overlaysFromFiles({ ...realLocales, ...fixtureLocales });

/** A status option as `selectField` reads it with the default `optionValue` and `optionLabel` */
export interface Status {
    value: string;
    label: string;
}

/** One line of an order */
export interface OrderLine {
    id: string;
    description: string;
}

/** The `$.data` the order editor links to: `order` (customer, status, lines) and `statuses` */
export interface OrderData {
    order: { customer: string; status: string; lines: OrderLine[] };
    statuses: Status[];
}

/** A fresh copy of the sample data: an order with no customer, two lines and three statuses */
export function orderData(): OrderData {
    return {
        order: {
            customer: '',
            status: 'open',
            lines: [
                { id: 'l1', description: 'Oak table' },
                { id: 'l2', description: 'Four chairs' }
            ]
        },
        statuses: [
            { value: 'open', label: 'Open' },
            { value: 'shipped', label: 'Shipped' },
            { value: 'closed', label: 'Closed' }
        ]
    };
}

/** What `mountOrderDocument` gives back */
export interface MountedOrderDocument {
    /** The element `mountApp` rendered into */
    host: HTMLElement;
    store: Store<AppState>;
    /** The document as it was mounted, for `validateDocument` */
    document: AppDocument;
    /** Every `hooks.onEmit` call, in order */
    emitted: { name: string; payload: unknown }[];
    /** Switches the language through the locale step the real runtime uses; throws with its errors */
    switchTo(code: string): void;
    dispose(): void;
}

const mounted = new Set<MountedOrderDocument>();
let registered = false;

/**
 * Mounts a whole document (`{ locale, data, app, ... }`) against the real library plus the fixture's `orderEditor`,
 * with the locale step registered and `hooks.onEmit` recorded. Throws with the errors when it does not mount.
 * Call `unmountOrderDocuments()` in `afterEach`
 */
export function mountOrderDocument(document: Readonly<Record<string, unknown>>): MountedOrderDocument {
    if (!registered) {
        registerAll();
        registered = true;
    }
    const host = globalThis.document.body.appendChild(globalThis.document.createElement('div'));
    const locale = registerLocaleStep(overlays);
    const emitted: MountedOrderDocument['emitted'] = [];
    const app = mountApp(host, document as unknown as AppDocument, orderEditorLibrary, {
        onEmit: (name: string, payload: unknown) => void emitted.push({ name, payload })
    });
    if (!app.store) {
        locale.unregister();
        host.remove();
        throw new Error(`the document did not mount:\n${app.errors.map((error) => `${error.code} ${error.message} (${error.statePath ?? '$'})`).join('\n')}`);
    }
    let disposed = false;
    const result: MountedOrderDocument = {
        host,
        store: app.store,
        document: document as unknown as AppDocument,
        emitted,
        switchTo(code) {
            const errors = locale.switchTo(code);
            if (errors.length > 0) throw new Error(errors.map((error) => `${error.code} ${error.message}`).join('\n'));
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            app.dispose();
            locale.unregister();
            host.remove();
            mounted.delete(result);
        }
    };
    mounted.add(result);
    return result;
}

/** Disposes every document `mountOrderDocument` mounted that is still mounted */
export function unmountOrderDocuments(): void {
    for (const entry of [...mounted]) entry.dispose();
}

/** Every element with this tag under the root, through the shadow roots, in document order */
export function deepAll(root: ParentNode, tag: string): HTMLElement[] {
    const found: HTMLElement[] = [];
    for (const child of Array.from(root.children)) {
        if (child.localName === tag) found.push(child as HTMLElement);
        if (child.shadowRoot) found.push(...deepAll(child.shadowRoot, tag));
        found.push(...deepAll(child, tag));
    }
    return found;
}
