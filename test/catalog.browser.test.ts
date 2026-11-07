import { report } from '@punyts/core';
import { libraryFromCatalog, mountApp, registerLocaleStep } from '@punyts/stateui-app';
import type { AppDocument, BuildError } from '@punyts/stateui-app';
import type { Catalog, ComposedCatalogEntry, RootCatalogEntry } from '@punyts/stateui-app/build';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import catalog from '../.test-build/real/components/catalog.json';
import { registerAll } from '../.test-build/real/components/index.js';
import { overlaysFromFiles } from './harness/createMountComponent.js';
import type { ComponentBuild } from './harness/createMountComponent.js';
import { mountComponent } from './harness/mountComponent.js';

const roots = (catalog.components as unknown as RootCatalogEntry[]).filter((entry) => entry.tier === 'root');
const composed = (catalog.components as unknown as ComposedCatalogEntry[]).filter((entry) => entry.tier === 'composed');
const library = libraryFromCatalog(catalog as unknown as Catalog);
const overlays = overlaysFromFiles(
    import.meta.glob<ComponentBuild['localeFiles'][string]>('../.test-build/real/components/*.locale.*.json', { eager: true, import: 'default' })
);

/** One mounted application of a composed example; `mountComponent` mounts root components only */
interface MountedExample {
    host: HTMLElement;
    errors: BuildError[];
    switchTo(code: string): BuildError[];
    dispose(): void;
}

const mountedExamples: MountedExample[] = [];

/**
 * Mounts a composed component's catalog example through `mountApp` with the locale step, as an application would.
 * The modules are registered by `mountComponent` when an earlier test in this file used it, otherwise here
 */
function mountExample(entry: ComposedCatalogEntry): MountedExample {
    if (!customElements.get(roots[0]?.tag ?? '')) registerAll();
    const host = globalThis.document.body.appendChild(globalThis.document.createElement('div'));
    const locale = registerLocaleStep(overlays);
    const app = mountApp(host, { locale: 'en', app: entry.example } as unknown as AppDocument, library);
    const mounted: MountedExample = {
        host,
        errors: app.errors,
        switchTo: (code) => locale.switchTo(code),
        dispose: () => {
            app.dispose();
            locale.unregister();
            host.remove();
        }
    };
    mountedExamples.push(mounted);
    return mounted;
}

/** True when an element with the tag is rendered under the root, looking through open shadow roots */
function rendered(root: ParentNode, tag: string): boolean {
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        if (candidate.localName === tag) return true;
        if (candidate.shadowRoot && rendered(candidate.shadowRoot, tag)) return true;
    }
    return false;
}

/**
 * Answers `ui-load-3d` as a host that serves the 3D chunk does, with a renderer that draws nothing: without it the
 * `scene3d` example shows `_fallback` and reports `SUI-RUN-3D` `no_chunk` (G3.3), which is right for a host without
 * the chunk but not what an example mounted in a full host does
 */
const answerLoad3d = (event: Event): void => {
    const scene = { update: () => undefined, drawn: () => Promise.resolve(), dispose: () => undefined };
    (event as CustomEvent<{ respond: (result: Promise<unknown>) => void }>).detail.respond(Promise.resolve({ version: '0.0.0', createScene3d: () => scene }));
};

describe('the catalog examples in Chromium', () => {
    beforeAll(() => document.addEventListener('ui-load-3d', answerLoad3d));
    afterAll(() => document.removeEventListener('ui-load-3d', answerLoad3d));

    afterEach(() => {
        mountComponent.unmountAll();
        vi.restoreAllMocks();
    });

    it.each(roots.map((entry) => [entry.name, entry] as const))('should mount the example of %s without a reported error', async (_name, entry) => {
        // Arrange
        const reported: unknown[] = [];
        vi.spyOn(report, 'error').mockImplementation((...args: unknown[]) => {
            reported.push(args);
        });
        const failures: string[] = [];
        const onError = (event: ErrorEvent): void => {
            failures.push(event.message);
        };
        window.addEventListener('error', onError);

        // Act
        const mounted = mountComponent(entry.name, entry.example as Record<string, unknown>);
        await new Promise((resolve) => setTimeout(resolve, 0));
        window.removeEventListener('error', onError);

        // Assert
        expect(mounted.element.localName).toBe(entry.tag);
        expect(reported).toEqual([]);
        expect(failures).toEqual([]);
    });

    it.each(roots.map((entry) => [entry.name, entry] as const))('should mount the example of %s in German without a reported error', async (_name, entry) => {
        // Arrange
        const reported: unknown[] = [];
        vi.spyOn(report, 'error').mockImplementation((...args: unknown[]) => {
            reported.push(args);
        });

        // Act
        const mounted = mountComponent(entry.name, entry.example as Record<string, unknown>, { locale: 'de' });
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Assert
        expect(mounted.element.localName).toBe(entry.tag);
        expect(reported).toEqual([]);
    });
});

describe('the accessible-name rules in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should name an icon-only button by its _title in English and in German and draw no label', () => {
        // Arrange
        const mounted = mountComponent('button', { icon: 'plus', iconPosition: 'only', _title: 'Add order' });

        // Assert
        expect(mounted.element.shadowRoot?.querySelector('button')?.getAttribute('aria-label')).toBe('Add order');
        expect(mounted.element.shadowRoot?.querySelector('.label')).toBeNull();
    });

    it('should name the icon-only button by the German default title when the node sets none', () => {
        // Arrange
        const mounted = mountComponent('button', { icon: 'plus', iconPosition: 'only' }, { locale: 'de' });

        // Assert
        expect(mounted.element.shadowRoot?.querySelector('button')?.getAttribute('aria-label')).toBe('Schaltfläche');
    });
});

describe('the composed catalog examples in Chromium', () => {
    afterEach(() => {
        for (const mounted of mountedExamples.splice(0)) mounted.dispose();
        vi.restoreAllMocks();
    });

    it.each(composed.map((entry) => [entry.name, entry] as const))('should mount the example of %s and switch it to German without a reported error', async (_name, entry) => {
        // Arrange
        const reported: unknown[] = [];
        vi.spyOn(report, 'error').mockImplementation((...args: unknown[]) => {
            reported.push(args);
        });
        const failures: string[] = [];
        const onError = (event: ErrorEvent): void => {
            failures.push(event.message);
        };
        window.addEventListener('error', onError);
        const outer = library[entry.tree.component];

        // Act
        const mounted = mountExample(entry);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const german = mounted.switchTo('de');
        await new Promise((resolve) => setTimeout(resolve, 0));
        window.removeEventListener('error', onError);

        // Assert
        expect(mounted.errors).toEqual([]);
        expect(german).toEqual([]);
        expect(outer?.tier).toBe('root');
        expect(rendered(mounted.host, outer?.tier === 'root' ? outer.tag : '')).toBe(true);
        expect(reported).toEqual([]);
        expect(failures).toEqual([]);
    });
});
