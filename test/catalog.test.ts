import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_LEAVES, KIND_GROUPS, OVERLAY_KINDS, SHIPPED_OVERLAYS, exposedPathResolves, libraryFromCatalog, resolveNode, validateDocument } from '@punyts/stateui-app/core';
import type { JsonValue, PropertyShape } from '@punyts/stateui-app/core';
import { formatError } from '@punyts/stateui-app/build';
import type { Catalog, ComposedCatalogEntry, RootCatalogEntry } from '@punyts/stateui-app/build';
import { buildComponents } from '../scripts/buildComponents.mjs';
import catalogJson from '../.test-build/real/components/catalog.json';
import { CORE_ICON_NAMES } from '../src/icons/coreNames.js';
import { buildIcons } from '../scripts/build-icons.ts';
import { createIconNames } from '../src/icons/names.js';
import type { IconNames } from '../src/icons/names.js';

const root = resolve(import.meta.dirname, '..');
const catalog = catalogJson as unknown as Catalog;
const roots = catalog.components.filter((entry): entry is RootCatalogEntry => entry.tier === 'root');

/** The 16 atoms of the first library, as the component spec names them */
const SPEC_ATOMS = [
    'text', 'icon', 'image', 'button', 'link', 'badge', 'divider', 'spinner', 'progress',
    'input', 'textarea', 'select', 'checkbox', 'switch', 'tooltip', 'skeleton'
] as const;

/** The 16 molecules of the first library, as the component spec names them */
const SPEC_MOLECULES = [
    'textField', 'textareaField', 'selectField', 'checkField', 'switchField', 'radioField', 'dateField', 'card',
    'alert', 'stat', 'emptyState', 'avatar', 'searchBox', 'menuItem', 'descriptionList', 'toast'
] as const;

/** The 13 composites of Epic 5 (the Epic 8 composites, such as recordGrid, accordion and wizard, are not in this set) */
const SPEC_COMPOSITES = [
    'panel', 'toolbar', 'page', 'nav', 'form', 'recordList', 'list', 'modal', 'drawer', 'tabs', 'table', 'menu', 'toastRegion'
] as const;

/** Root components that are parts of another component, not placed by a minion: the row `table` builds per record */
const PART_COMPONENTS = ['tableRow'] as const;

/** The six composed components of Epic 5 */
const SPEC_COMPOSED = ['confirmDialog', 'formDialog', 'masterDetail', 'settingsPage', 'crudTable', 'dashboardGrid'] as const;

const composedEntries = catalog.components.filter((entry): entry is ComposedCatalogEntry => entry.tier === 'composed');
const library = libraryFromCatalog(catalog);

/** Lists what the catalog has that the spec does not, and what it lacks */
const difference = (found: readonly string[], spec: readonly string[]): { missing: string[]; extra: string[] } => ({
    missing: spec.filter((name) => !found.includes(name)),
    extra: found.filter((name) => !spec.includes(name))
});

/** Components of Epic 8 that joined the library after the first set; the Epic 4 and 5 counts below stay as the spec fixed them */
const LATER_ATOMS: readonly string[] = ['segmented'];
const LATER_MOLECULES: readonly string[] = ['numberField', 'comboboxField', 'multiSelectField'];
const LATER_COMPOSITES: readonly string[] = ['popover'];

const FIELDS = ['textField', 'textareaField', 'selectField', 'checkField', 'switchField', 'radioField', 'dateField', 'numberField', 'comboboxField', 'multiSelectField'] as const;

let names: IconNames;
const isIconName = (name: string): boolean => names.isIconName(name);

beforeAll(async () => {
    names = createIconNames(await buildIcons());
}, 60_000);

const documentOf = (node: Record<string, unknown>): Record<string, unknown> => ({ locale: 'en', app: node });
const codes = (node: Record<string, unknown>): string[] =>
    validateDocument(documentOf(node), catalog, { isIconName }).errors.map((error) => error.code);

const typesOf = (property: PropertyShape): string[] => (Array.isArray(property.type) ? property.type : [property.type]);

/** Every property of a shape and of the map items inside it, with its path (`options.icon`) */
function walk(properties: Record<string, PropertyShape>, prefix = ''): [string, PropertyShape][] {
    const found: [string, PropertyShape][] = [];
    for (const [name, property] of Object.entries(properties)) {
        found.push([`${prefix}${name}`, property]);
        if (property.items !== undefined && property.items !== 'string') found.push(...walk(property.items, `${prefix}${name}.`));
    }
    return found;
}

/** Every icon name in a node value, wherever it sits in the example */
function iconNamesOf(entry: RootCatalogEntry): string[] {
    const names: string[] = [];
    for (const [path, property] of walk(entry.shape.properties)) {
        if (!typesOf(property).includes('icon') || path.includes('.')) continue;
        const value = entry.example[path];
        if (typeof value === 'string') names.push(value);
    }
    return names;
}

const sizeOfName = (name: string): string | undefined => catalog.components.find((entry) => entry.name === name)?.size;

describe('the component catalog holds the first library', () => {
    it('should hold exactly the atoms the component spec names (16 and the later ones), each of size atom', () => {
        // Arrange
        const found = catalog.components.filter((entry) => entry.size === 'atom').map((entry) => entry.name);

        // Assert
        expect({ missing: [...SPEC_ATOMS, ...LATER_ATOMS].filter((name) => !found.includes(name)), extra: found.filter((name) => ![...SPEC_ATOMS, ...LATER_ATOMS].includes(name)) }).toEqual({
            missing: [],
            extra: []
        });
        expect(found).toHaveLength(16 + LATER_ATOMS.length);
    });

    it('should hold exactly the molecules the component spec names (16 and the later ones), each of size molecule', () => {
        // Arrange
        const found = catalog.components.filter((entry) => entry.size === 'molecule').map((entry) => entry.name);

        // Assert
        expect({ missing: [...SPEC_MOLECULES, ...LATER_MOLECULES].filter((name) => !found.includes(name)), extra: found.filter((name) => ![...SPEC_MOLECULES, ...LATER_MOLECULES].includes(name)) }).toEqual({
            missing: [],
            extra: []
        });
        expect(found).toHaveLength(16 + LATER_MOLECULES.length);
    });

    it('should give every spec component its size and no other component the size atom or molecule', () => {
        // Arrange
        const specNames: readonly string[] = [...SPEC_ATOMS, ...SPEC_MOLECULES, ...LATER_ATOMS, ...LATER_MOLECULES];
        const others = catalog.components.filter((entry) => !specNames.includes(entry.name));

        // Assert
        expect([...SPEC_ATOMS, ...LATER_ATOMS].map(sizeOfName).every((size) => size === 'atom')).toBe(true);
        expect([...SPEC_MOLECULES, ...LATER_MOLECULES].map(sizeOfName).every((size) => size === 'molecule')).toBe(true);
        expect(others.filter((entry) => entry.size === 'atom' || entry.size === 'molecule')).toEqual([]);
    });

    it('should give every component a tag, a summary, a shape, tokens or none, locales and an example', () => {
        // Assert
        for (const entry of roots) {
            expect(entry.tag, entry.name).toBe(`ui-${entry.name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
            expect(entry.summary.length, entry.name).toBeGreaterThan(0);
            expect(entry.shape.properties, entry.name).toBeTypeOf('object');
            expect(entry.shared, entry.name).toContain('hidden');
            expect(entry.example.component, entry.name).toBe(entry.name);
        }
    });
});

describe('the component catalog holds the whole Epic 5 set', () => {
    it('should hold exactly the 13 composites of Epic 5 and the later ones as root composites, besides the parts of other components', () => {
        // Arrange
        const found = roots.filter((entry) => entry.size === 'composite').map((entry) => entry.name);
        const placeable = found.filter((name) => !(PART_COMPONENTS as readonly string[]).includes(name));

        // Assert
        expect(difference(placeable, [...SPEC_COMPOSITES, ...LATER_COMPOSITES])).toEqual({ missing: [], extra: [] });
        expect(placeable).toHaveLength(13 + LATER_COMPOSITES.length);
        expect(found.filter((name) => (PART_COMPONENTS as readonly string[]).includes(name))).toEqual([...PART_COMPONENTS]);
    });

    it('should hold 45 root components of the first library besides the parts, and the later ones', () => {
        // Arrange
        const placeable = roots.filter((entry) => !(PART_COMPONENTS as readonly string[]).includes(entry.name));

        // Assert
        expect(difference(placeable.map((entry) => entry.name), [...SPEC_ATOMS, ...SPEC_MOLECULES, ...SPEC_COMPOSITES, ...LATER_ATOMS, ...LATER_MOLECULES, ...LATER_COMPOSITES])).toEqual({ missing: [], extra: [] });
        expect(placeable).toHaveLength(45 + LATER_ATOMS.length + LATER_MOLECULES.length + LATER_COMPOSITES.length);
    });

    it('should hold exactly the six composed components of Epic 5', () => {
        // Arrange
        const found = composedEntries.map((entry) => entry.name);

        // Assert
        expect(difference(found, SPEC_COMPOSED)).toEqual({ missing: [], extra: [] });
        expect(found).toHaveLength(6);
    });

    it('should give every root and composed component a German overlay', () => {
        // Arrange
        const without = catalog.components.filter((entry) => !entry.locales.includes('de')).map((entry) => entry.name);

        // Assert
        expect(without).toEqual([]);
    });
});

describe('every composed component', () => {
    it.each(composedEntries.map((entry) => [entry.name, entry] as const))('should have an example that passes validateDocument: %s', (_name, entry) => {
        // Act
        const result = validateDocument(documentOf(entry.example), catalog, { isIconName });

        // Assert
        expect(entry.example.component).toBe(entry.name);
        expect(result.errors.map(formatError)).toEqual([]);
        expect(result.valid).toBe(true);
    });

    it.each(composedEntries.map((entry) => [entry.name, entry] as const))('should list exposed paths that each resolve in its resolved default tree: %s', (_name, entry) => {
        // Arrange
        const resolved = resolveNode(entry.tree, library, {}, { path: '$' });

        // Act
        const unresolved = (entry.exposes ?? []).map((exposed) => exposed.path).filter((path) => !exposedPathResolves(resolved.node, path, library));

        // Assert
        expect(resolved.errors.map(formatError)).toEqual([]);
        expect(entry.exposes?.length ?? 0).toBeGreaterThan(0);
        expect(unresolved).toEqual([]);
    });
});

describe('every catalog example', () => {
    it.each(roots.map((entry) => [entry.name, entry] as const))('should pass validateDocument in a minimal document: %s', (_name, entry) => {
        // Act
        const result = validateDocument(documentOf(entry.example), catalog, { isIconName });

        // Assert
        expect(result.errors.map(formatError)).toEqual([]);
        expect(result.valid).toBe(true);
    });

    it('should name only icons that pass isIconName', () => {
        // Arrange
        const used = roots.flatMap(iconNamesOf);

        // Assert
        expect(used.filter((name) => !isIconName(name))).toEqual([]);
    });
});

describe('content in en and de', () => {
    const overlays = new Map<string, Record<string, JsonValue>>();

    it('should give every component with a content property a German overlay and a German value for each default text', async () => {
        // Arrange
        const folder = join(root, '.test-build/real/components');
        for (const entry of roots) {
            if (entry.content.length === 0) continue;
            const file = join(folder, `${entry.name}.locale.de.json`);
            overlays.set(entry.name, JSON.parse(await readFile(file, 'utf8')) as Record<string, JsonValue>);
        }
        const missing: string[] = [];

        // Act
        for (const entry of roots) {
            if (entry.content.length === 0) continue;
            const overlay = overlays.get(entry.name) ?? {};
            for (const name of entry.content) {
                if (name.includes('.')) continue;
                const property = entry.shape.properties[name] as PropertyShape;
                const text = property.default;
                if (typeof text === 'string' && text !== '' && !(typeof overlay[name] === 'string' && overlay[name] !== '')) {
                    missing.push(`${entry.name}.${name}`);
                }
                if (text !== null && typeof text === 'object' && !Array.isArray(text)) {
                    const german = overlay[name];
                    for (const key of Object.keys(text)) {
                        const value = german !== null && typeof german === 'object' && !Array.isArray(german) ? german[key] : undefined;
                        if (typeof value !== 'string' || value === '') missing.push(`${entry.name}.${name}.${key}`);
                    }
                }
            }
        }

        // Assert
        expect(missing).toEqual([]);
        expect(catalog.locales).toEqual(['de']);
    });

    it('should give every content property an English text: a default, or a condition or requirement that asks the node for one', () => {
        // Arrange
        const without: string[] = [];

        // Act
        for (const entry of roots) {
            for (const name of entry.content) {
                if (name.includes('.')) continue;
                const property = entry.shape.properties[name] as PropertyShape;
                if (property.default === undefined && !property.required && property.requiredWhen === undefined) without.push(`${entry.name}.${name}`);
            }
        }

        // Assert
        expect(without).toEqual([]);
    });
});

describe('the library build and its styles', () => {
    const folders: string[] = [];
    afterAll(async () => {
        for (const folder of folders) await rm(folder, { recursive: true, force: true });
    });

    it('should pass the build lint for the whole library with no error or warning', async () => {
        // Arrange
        const folder = await mkdtemp(join(tmpdir(), 'stateui-components-catalog-'));
        folders.push(folder);

        // Act
        const result = await buildComponents(resolve(root, 'components'), join(folder, 'components'));

        // Assert
        expect(result.errors.map(formatError)).toEqual([]);
        expect(result.built).toHaveLength(roots.length);
    });

    it('should reference no tone colour token in any component or shared stylesheet', async () => {
        // Arrange
        const tone = /--ui-color-(?:neutral|accent|danger|warning|success|info)-(?:base|soft|on)/;
        const sheets: string[] = [];
        for (const base of [resolve(root, 'components'), resolve(root, 'src/shared/css')]) {
            for (const entry of await readdir(base, { recursive: true, withFileTypes: true })) {
                if (entry.isFile() && entry.name.endsWith('.css')) sheets.push(join(entry.parentPath, entry.name));
            }
        }

        // Act
        const offenders: string[] = [];
        for (const sheet of sheets) {
            const lines = (await readFile(sheet, 'utf8')).split('\n');
            lines.forEach((line, index) => {
                if (tone.test(line)) offenders.push(`${sheet}:${index + 1} ${line.trim()}`);
            });
        }

        // Assert
        expect(sheets.length).toBeGreaterThan(30);
        expect(offenders).toEqual([]);
    });
});

describe('component tokens and icon defaults', () => {
    it('should default every component token to references or a calc() of references, never a literal', () => {
        // Arrange
        const offenders: string[] = [];

        // Act
        for (const entry of roots) {
            for (const token of entry.tokens ?? []) {
                const value = token.default;
                const references = value.match(/\{[a-z0-9.]+\}/g) ?? [];
                const rest = value.replace(/\{[a-z0-9.]+\}/g, '');
                const reference = /^\{[a-z0-9.]+\}$/.test(value);
                const calc = /^calc\(.*\)$/.test(value) && references.length > 0 && /^[\s()+\-*/\d.]*$/.test(rest.replace(/^calc/, ''));
                if (!reference && !calc) offenders.push(`${entry.name} ${token.path} = ${value}`);
            }
        }

        // Assert
        expect(offenders).toEqual([]);
        expect(roots.some((entry) => (entry.tokens ?? []).length > 0)).toBe(true);
    });

    it('should name every token group as one lower-case word', () => {
        // Arrange
        const groups = new Set(roots.flatMap((entry) => (entry.tokens ?? []).map((token) => token.group)));

        // Assert
        expect([...groups].filter((group) => !/^[a-z]+$/.test(group))).toEqual([]);
        expect(groups.size).toBeGreaterThan(5);
    });

    it('should default every icon property to a core icon or to empty', () => {
        // Arrange
        const core = new Set(CORE_ICON_NAMES);
        const offenders: string[] = [];

        // Act
        for (const entry of roots) {
            for (const [path, property] of walk(entry.shape.properties)) {
                if (!typesOf(property).includes('icon')) continue;
                const value = property.default;
                if (value !== undefined && value !== '' && !(typeof value === 'string' && core.has(value))) offenders.push(`${entry.name}.${path} = ${String(value)}`);
            }
        }

        // Assert
        expect(offenders).toEqual([]);
    });
});

describe('the accessible-name and runtime rules', () => {
    it('should report SUI-STATE-CONDITION for an icon that is not decorative and has no _label', () => {
        // Assert
        expect(codes({ component: 'icon', name: 'plus', decorative: false })).toEqual(['SUI-STATE-CONDITION']);
        expect(codes({ component: 'icon', name: 'plus', decorative: false, _label: 'Add' })).toEqual([]);
        expect(codes({ component: 'icon', name: 'plus' })).toEqual([]);
    });

    it('should report SUI-STATE-CONDITION for an image with no _alt unless it is decorative', () => {
        // Assert
        expect(codes({ component: 'image' })).toEqual(['SUI-STATE-CONDITION']);
        expect(codes({ component: 'image', _alt: 'A logo' })).toEqual([]);
        expect(codes({ component: 'image', decorative: true })).toEqual([]);
    });

    it('should name an icon-only button by its _title, which the shape declares as content with an English default', () => {
        // Arrange
        const button = roots.find((entry) => entry.name === 'button') as RootCatalogEntry;

        // Assert
        expect(button.content).toEqual(['_title']);
        expect(button.shape.properties._title?.default).toBe('Button');
        expect(button.shape.properties.iconPosition?.values).toContain('only');
        expect(codes({ component: 'button', icon: 'plus', iconPosition: 'only', _title: 'Add' })).toEqual([]);
    });

    it('should report SUI-STATE-RUNTIME for a node that sets error, touched or dirty on any field', () => {
        // Act and Assert
        for (const name of FIELDS) {
            for (const property of ['error', 'touched', 'dirty']) {
                const value = property === 'error' ? 'Wrong' : true;
                expect(codes({ component: name, [property]: value }), `${name}.${property}`).toContain('SUI-STATE-RUNTIME');
            }
        }
    });

    it('should report SUI-STATE-RUNTIME for every runtime property of every component', () => {
        // Arrange: a runtime property that still holds its default is not reported, because a resolved node carries every default, so the value differs
        const offenders: string[] = [];

        // Act
        for (const entry of roots) {
            for (const [name, property] of Object.entries(entry.shape.properties)) {
                if (!property.runtime) continue;
                if (!codes({ component: entry.name, [name]: { notTheDefault: true } }).includes('SUI-STATE-RUNTIME')) offenders.push(`${entry.name}.${name}`);
            }
        }

        // Assert
        expect(offenders).toEqual([]);
    });
});

describe('the theme section of the catalog', () => {
    const semantic = DEFAULT_LEAVES.filter((leaf) => leaf.layer === 'semantic');

    it('should list every semantic token of the default tree and no primitive', () => {
        // Arrange
        const listed = catalog.theme.tokens.map((token) => token.path);

        // Assert
        expect(listed).toEqual(semantic.map((leaf) => leaf.path));
        expect(catalog.theme.tokens.filter((token) => ['palette', 'scale', 'font'].includes(token.group))).toEqual([]);
    });

    it('should give every token a type, a default and a one-line description', () => {
        for (const token of catalog.theme.tokens) {
            expect(token.type, token.path).toBeTruthy();
            expect(token.default, token.path).not.toBe('');
            expect(token.description, token.path).toMatch(/^[^\r\n]+$/);
        }
    });

    it('should list the shipped overlays by kind with the groups the kind may touch', () => {
        expect(Object.keys(catalog.theme.overlays)).toEqual([...OVERLAY_KINDS]);
        for (const kind of OVERLAY_KINDS) {
            expect(catalog.theme.overlays[kind].map((overlay) => overlay.name)).toEqual(Object.keys(SHIPPED_OVERLAYS[kind] ?? {}));
            for (const overlay of catalog.theme.overlays[kind]) expect(overlay.groups).toEqual([...KIND_GROUPS[kind]]);
        }
    });

    it('should keep component tokens on the component entries, not in the theme section', () => {
        const groups = new Set(catalog.theme.tokens.map((token) => token.group));
        const componentGroups = roots.flatMap((entry) => (entry.tokens ?? []).map((token) => token.group));

        expect(componentGroups.length).toBeGreaterThan(0);
        for (const group of componentGroups) expect(groups.has(group), group).toBe(false);
    });
});
