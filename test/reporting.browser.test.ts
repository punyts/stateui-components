import { addListener, removeListener, setCategories } from '@punyts/core';
import { FileTransferError, libraryFromCatalog } from '@punyts/stateui-app';
import type { AppDocument, AppHost, OpenedApp, ReadFile } from '@punyts/stateui-app';
import type { Catalog } from '@punyts/stateui-app/build';
import { userEvent } from 'vitest/browser';
import { afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import catalog from '../.test-build/real/components/catalog.json';
import { mountComponent } from './harness/mountComponent.js';
import { isScene3dChunk } from '../src/shared/scene3d/load.js';

interface Seen {
    category: string;
    message: string;
    details: unknown;
}

const library = libraryFromCatalog(catalog as unknown as Catalog);
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const command = (element: Element, name: string): void => {
    (element as Element & { commands: Record<string, () => void> }).commands[name]?.();
};
/** Every element with this tag under the node, through the shadow roots, in document order */
const deep = (root: ParentNode, tag: string): Element[] => {
    const found: Element[] = [];
    for (const child of Array.from(root.children)) {
        if (child.localName === tag) found.push(child);
        if (child.shadowRoot) found.push(...deep(child.shadowRoot, tag));
        found.push(...deep(child, tag));
    }
    return found;
};

/** An app host that gives `shop` and refuses anything else */
const shopHost = (): AppHost => ({
    open(ask) {
        if (ask.app !== 'shop') return Promise.reject(new Error('No such app'));
        const document = { data: {}, start: 'home', app: { component: 'app' }, screens: { home: { root: { component: 'text', _text: 'Shop' } } } } as unknown as AppDocument;
        return Promise.resolve({ document, library } as OpenedApp);
    }
});

describe('stateui-components reporting in Chromium', () => {
    let seen: Seen[] = [];
    const listener = (_timestamp: number, category: string, message: string, details: unknown): void => {
        seen.push({ category, message, details });
    };
    const of = (category: string): Seen[] => seen.filter((entry) => entry.category === category);

    beforeEach(() => {
        seen = [];
        setCategories(['info', 'error', 'stack', 'stateui-components.*']);
        addListener(listener, 'stateui-components.*');
    });
    afterEach(() => {
        removeListener(listener, 'stateui-components.*');
        setCategories(['info', 'error', 'stack']);
        mountComponent.unmountAll();
    });

    it('should report a form validation and submit with field names and counts, and no value', async () => {
        // Arrange
        const mounted = mountComponent('form', { children: { name: { component: 'textField', required: true }, note: { component: 'textField' } } });
        const inputs = deep(mounted.element.shadowRoot as ShadowRoot, 'ui-text-field').map((field) => field.shadowRoot?.querySelector('input') as HTMLInputElement);

        // Act
        command(mounted.element, 'submit');
        await userEvent.type(inputs[0] as HTMLInputElement, 'Ada Lovelace');
        command(mounted.element, 'submit');

        // Assert
        const reports = of('stateui-components.form');
        expect(reports.map((entry) => entry.message)).toEqual([
            'Validated $.app: 2 fields, 1 with an issue',
            'Refused the submit of $.app: 1 field(s) with an issue',
            'Validated $.app: 2 fields, 0 with an issue',
            'Submitted $.app: 2 field(s)'
        ]);
        expect(reports[0]?.details).toEqual(['$.app', 2, 1, ['name']]);
        expect(JSON.stringify(seen)).not.toContain('Ada');
    });

    it('should report a modal opened with focus trapped, dismissed by Escape, and closed with focus returned', async () => {
        // Arrange
        const opener = document.createElement('button');
        document.body.append(opener);
        opener.focus();
        const mounted = mountComponent('modal', { _title: 'Edit', body: { component: 'text', _text: 'Body' } });

        // Act
        command(mounted.element, 'open');
        await frame();
        await userEvent.keyboard('{Escape}');
        await frame();

        // Assert
        expect(of('stateui-components.overlay').map((entry) => entry.message)).toEqual([
            'Opened the dialog of $.app: focus trapped, from button',
            'Dismissed the dialog of $.app by escape',
            'Closed the dialog of $.app: focus returned to button'
        ]);
        opener.remove();
    });

    it('should report an embedded app asked for, mounted with its time, and one the host refused', async () => {
        // Arrange
        const apps = shopHost();

        // Act
        mountComponent('embeddedApp', { app: 'shop', live: true, fill: true }, { apps });
        mountComponent('embeddedApp', { app: 'nowhere' }, { apps });
        await flush();
        await flush();

        // Assert
        const messages = of('stateui-components.embed').map((entry) => entry.message);
        expect(messages).toContain('Asked for app shop in $.app: live, fill');
        expect(messages).toContain('Asked for app nowhere in $.app: preview, fixed size');
        expect(messages).toContain('The host refused app nowhere for $.app');
        const mountedReport = of('stateui-components.embed').find((entry) => entry.message.startsWith('Mounted app shop'));
        expect(mountedReport?.details).toEqual(['shop', '$.app', 'live', expect.any(Number)]);
        expect(JSON.stringify(seen)).not.toContain('No such app');
    });
});

/** The built chunk of `../stateui-3d` (test/globalSetup.ts); empty when the workspace has none */
const script = inject('chunk3dScript');

describe.skipIf(script === '')('stateui-components scene3d reporting with the real 3D renderer chunk in Chromium', () => {
    let seen: Seen[] = [];
    let remove: (() => void) | undefined;
    const listener = (_timestamp: number, _category: string, message: string, details: unknown): void => {
        seen.push({ category: _category, message, details });
    };

    beforeAll(() => {
        if (!isScene3dChunk((globalThis as Record<string, unknown>).__stateui3d)) {
            const element = document.createElement('script');
            element.textContent = script;
            document.head.append(element);
        }
    });
    beforeEach(() => {
        seen = [];
        setCategories(['info', 'error', 'stack', 'stateui-components.*']);
        addListener(listener, 'stateui-components.scene3d');
        const chunk = (globalThis as Record<string, unknown>).__stateui3d;
        const answer = (event: Event): void => {
            (event as CustomEvent<{ respond: (result: Promise<unknown>) => void }>).detail.respond(Promise.resolve(chunk));
        };
        document.addEventListener('ui-load-3d', answer);
        remove = () => document.removeEventListener('ui-load-3d', answer);
    });
    afterEach(() => {
        remove?.();
        removeListener(listener, 'stateui-components.scene3d');
        setCategories(['info', 'error', 'stack']);
        mountComponent.unmountAll();
    });

    it('should report the chunk loaded with its time, the scene made, an issue by code and path, and the dispose', async () => {
        // Arrange
        const id = '6f1c2a4e-8d3b-4c7a-9e21-3b5d7f9a1c02';
        const readFile: ReadFile = () => Promise.reject(new FileTransferError('not_found', 'no such file'));
        const children = { eye: { component: 'camera', position: [0, 0, 3], target: [0, 0, 0] }, chair: { component: 'model', src: { id, name: 'secret-chair.glb', size: 10, type: 'model/gltf-binary' } } };

        // Act
        mountComponent('scene3d', { environment: 'none', children }, { hooks: { readFile } });
        for (let i = 0; i < 50 && !seen.some((entry) => entry.message.includes('cannot draw')); i++) await new Promise((resolve) => setTimeout(resolve, 20));
        mountComponent.unmountAll();

        // Assert
        const messages = seen.map((entry) => entry.message);
        expect(messages[0]).toMatch(/^Loaded the 3D runtime chunk for \$\.app in [\d.]+ ms$/);
        expect(messages).toContain('Made the scene $.app');
        expect(messages).toContain('The scene $.app cannot draw $.app.children.chair: SUI-RUN-FILE, file not_found');
        expect(messages.at(-1)).toBe('Disposed the scene $.app');
        expect(JSON.stringify(seen)).not.toMatch(/secret-chair|6f1c2a4e/);
    });
});
