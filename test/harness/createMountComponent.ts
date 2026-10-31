import type { Store } from '@punyts/state';
import { libraryFromCatalog, mountApp, registerLocaleStep } from '@punyts/stateui-app';
import type { AppDocument, AppState, ComponentLibrary, ComponentOverlays } from '@punyts/stateui-app';
import type { Catalog } from '@punyts/stateui-app/build';
import type { BuildError } from '@punyts/stateui-app';

/** One line per error: the build's own formatter reads files, so the browser harness cannot import it */
const formatError = (error: BuildError): string => `${error.code} ${error.message}${error.statePath ? ` (${error.statePath})` : ''}`;

/** The theme kinds `setTheme` switches; each has overlays named by the library and the document */
export type ThemeKind = 'mode' | 'brand' | 'motion';

/** What a test may choose when it mounts a component: the overlay of each kind and the language */
export interface MountOptions {
    /** The active `mode` overlay (`light` by default; `dark`, `contrast` or `system`) */
    mode?: string;
    /** The active `brand` overlay (`default`) */
    brand?: string;
    /** The active `motion` overlay (`full` by default; `reduced` or `system`) */
    motion?: string;
    /** The language to switch to after mount; a component's own text is `en` */
    locale?: string;
    /** The document's `data`, so a `<-` link to `$.data.<name>` has a target when the node mounts (none by default) */
    data?: Readonly<Record<string, unknown>>;
    /** The document's `locales`: the overlay per language the application itself brings (relative to the node), on top of the component overlays */
    locales?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/** What `mountComponent` gives back */
export interface MountedComponent {
    /** The component's own element (`<ui-name>`), found through the shadow roots */
    element: Element;
    /** The element that holds the application root; the mounted store's host */
    host: HTMLElement;
    /** The store `mountApp` built; `$.app` is the node, `$.data` the document's data */
    store: Store<AppState>;
    /** Activates the overlay `name` of `kind` (`setTheme('mode', 'dark')`) by writing `$.theme.active.<kind>` */
    setTheme(kind: ThemeKind, name: string): void;
    /** Switches the application to the language `code`; throws when the library has no overlay for it */
    setLocale(code: string): void;
    /** Unmounts the application and removes the host; safe to call twice */
    dispose(): void;
}

/** The node written under `$.app`; `mountComponent` adds the component name */
export type NodeState = Readonly<Record<string, unknown>>;

export type MountComponent = ((name: string, nodeState?: NodeState, options?: MountOptions) => MountedComponent) & {
    /** Disposes every component mounted through this function that is still mounted */
    unmountAll(): void;
};

type Overlay = ComponentOverlays[string][string];

/** A built library as the harness needs it: its catalog, its component modules and the overlay files it emitted */
export interface ComponentBuild {
    catalog: Catalog;
    /** `registerAll` of the build's `index.js` */
    registerAll(): unknown;
    /** The parsed `<name>.locale.<code>.json` files by file path */
    localeFiles: Readonly<Record<string, Overlay>>;
}

const LOCALE_FILE = /^(?:.*\/)?([a-z0-9-]+)\.locale\.([a-zA-Z-]+)\.json$/;

/** Groups the locale files by component name (camel-cased, as the catalog names it), then by language code */
export function overlaysFromFiles(files: ComponentBuild['localeFiles']): ComponentOverlays {
    const overlays: Record<string, Record<string, Overlay>> = {};
    for (const [file, overlay] of Object.entries(files)) {
        const match = LOCALE_FILE.exec(file);
        if (!match) throw new Error(`Not a locale file name: ${file}`);
        const folder = match[1] as string;
        const code = match[2] as string;
        const name = folder.replace(/-([a-z0-9])/g, (_all, letter: string) => letter.toUpperCase());
        (overlays[name] ??= {})[code] = overlay;
    }
    return overlays;
}

function findByTag(root: ParentNode, tag: string): Element | undefined {
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        if (candidate.localName === tag) return candidate;
        const inner = candidate.shadowRoot ? findByTag(candidate.shadowRoot, tag) : undefined;
        if (inner) return inner;
    }
    return undefined;
}

/**
 * Binds `mountComponent` to one built library. It registers the library's modules once, and each call mounts one
 * component through `mountApp` with the locale step the real runtime uses
 */
export function createMountComponent(build: ComponentBuild): MountComponent {
    const library: ComponentLibrary = libraryFromCatalog(build.catalog);
    const overlays = overlaysFromFiles(build.localeFiles);
    const mounted = new Set<MountedComponent>();
    let registered = false;

    const mountComponent = (name: string, nodeState: NodeState = {}, options: MountOptions = {}): MountedComponent => {
        const entry = Object.hasOwn(library, name) ? library[name] : undefined;
        if (entry?.tier !== 'root') throw new Error(`mountComponent: "${name}" is not a root component of the library`);
        if (!registered) {
            build.registerAll();
            registered = true;
        }
        const active: Record<string, string> = {};
        for (const kind of ['mode', 'brand', 'motion'] as const) {
            const chosen = options[kind];
            if (chosen !== undefined) active[kind] = chosen;
        }
        const document = {
            locale: 'en',
            theme: { active },
            ...(options.data === undefined ? {} : { data: options.data }),
            ...(options.locales === undefined ? {} : { locales: options.locales }),
            app: { component: name, ...nodeState }
        } as unknown as AppDocument;
        const host = globalThis.document.body.appendChild(globalThis.document.createElement('div'));
        const locale = registerLocaleStep(overlays);
        const app = mountApp(host, document, library);
        if (!app.store) {
            locale.unregister();
            host.remove();
            throw new Error(`mountComponent: "${name}" did not mount:\n${app.errors.map(formatError).join('\n')}`);
        }
        const store = app.store;
        const element = findByTag(host, entry.tag);
        if (!element) {
            app.dispose();
            locale.unregister();
            host.remove();
            throw new Error(`mountComponent: no <${entry.tag}> was rendered`);
        }

        let disposed = false;
        const result: MountedComponent = {
            element,
            host,
            store,
            setTheme(kind, themeName) {
                store.set(`$.theme.active.${kind}`, themeName);
            },
            setLocale(code) {
                const errors = locale.switchTo(code);
                if (errors.length > 0) throw new Error(`mountComponent: ${errors.map(formatError).join('\n')}`);
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
        if (options.locale !== undefined) result.setLocale(options.locale);
        return result;
    };
    mountComponent.unmountAll = (): void => {
        for (const component of [...mounted]) component.dispose();
    };
    return mountComponent;
}
