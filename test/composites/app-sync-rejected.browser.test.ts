import { afterEach, describe, expect, it } from 'vitest';
import { libraryFromCatalog, mountApp } from '@punyts/stateui-app';
import type { AppDocument } from '@punyts/stateui-app';
import type { Catalog } from '@punyts/stateui-app/build';
import catalogJson from '../../.test-build/real/components/catalog.json';
import { registerAll } from '../../.test-build/real/components/index.js';

const library = libraryFromCatalog(catalogJson as unknown as Catalog);
let registered = false;
const mounted: { host: HTMLElement; dispose(): void }[] = [];

type Mounted = ReturnType<typeof mountApp>;

/** Every element with this tag under the root, through the shadow roots */
function deep(root: ParentNode, tag: string): HTMLElement[] {
    const found: HTMLElement[] = [];
    for (const child of Array.from(root.children)) {
        if (child.localName === tag) found.push(child as HTMLElement);
        if (child.shadowRoot) found.push(...deep(child.shadowRoot, tag));
        found.push(...deep(child, tag));
    }
    return found;
}

const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 4; turn++) await Promise.resolve();
};

/** The texts of the toasts on screen */
const toastTexts = (host: HTMLElement): string[] =>
    deep(host, 'ui-toast').map((toast) => toast.shadowRoot?.querySelector('.text')?.textContent?.trim() ?? '');

async function mount(app: Record<string, unknown>): Promise<{ host: HTMLElement; app: Mounted }> {
    if (!registered) {
        registerAll();
        registered = true;
    }
    const host = document.body.appendChild(document.createElement('div'));
    const doc = {
        locale: 'en',
        data: {},
        app,
        screens: { home: { root: { component: 'text', _text: 'Home' } } },
        start: 'home'
    } as unknown as AppDocument;
    const result = mountApp(host, doc, library);
    if (!result.store) throw new Error(`the app did not mount: ${result.errors.map((error) => error.message).join('; ')}`);
    mounted.push({ host, dispose: () => result.dispose() });
    await settle();
    return { host, app: result };
}

afterEach(() => {
    for (const entry of mounted.splice(0)) {
        entry.dispose();
        entry.host.remove();
    }
});

describe('app: the notice of a refused change', () => {
    it('should show the unsaved notice for code unsaved and the general one for any other code', async () => {
        // Arrange
        const { host, app } = await mount({ component: 'app' });

        // Act
        app.raise('sync.rejected', { path: '$.data.title', reason: 'server detail', code: 'unsaved' });
        app.raise('sync.rejected', { path: '$.data.title', reason: 'server detail', code: 'logic' });
        await settle();

        // Assert
        expect(toastTexts(host)).toEqual([
            'Not saved: the server is catching up with earlier changes. Try again in a moment.',
            'This change was not accepted.'
        ]);
        expect(toastTexts(host).join(' ')).not.toContain('server detail');
    });

    it('should show no built-in notice when the root has its own sync.rejected entry', async () => {
        // Arrange
        const { host, app } = await mount({
            component: 'app',
            on: { 'sync.rejected': { command: 'set', target: '$.data.refused', value: true } }
        });

        // Act
        app.raise('sync.rejected', { path: '$.data.title', reason: 'server detail', code: 'unsaved' });
        await settle();

        // Assert
        expect(app.store?.get('$.data.refused' as never)).toBe(true);
        expect(toastTexts(host)).toEqual([]);
    });
});
