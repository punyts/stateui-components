import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseShape, validateNode } from '@punyts/stateui-app/core';
import type { Node } from '@punyts/stateui-app/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildIcons, writeIcons } from '../../scripts/build-icons.ts';
import { buildCoreIcons, coreIconsModule } from '../../scripts/core-icons.ts';
import { ICON_ALIASES } from '../../src/icons/aliases.ts';
import { CORE_ICON_NAMES } from '../../src/icons/coreNames.ts';
import { createIconNames, loadIconsFile } from '../../src/icons/names.ts';
import type { IconNames } from '../../src/icons/names.ts';
import type { IconsFile } from '../../src/icons/types.ts';
import { validateIconNode } from '../../src/icons/validate.ts';

const root = resolve(import.meta.dirname, '..', '..');
const iconFile = resolve(root, 'components/atoms/icon/icon.state.json');
const parsed = parseShape(await readFile(iconFile, 'utf8'), iconFile);
if (!parsed.shape) throw new Error(`icon shape did not parse: ${JSON.stringify(parsed.errors)}`);
const shape = parsed.shape;

let file: IconsFile;
let names: IconNames;
const folders: string[] = [];

beforeAll(async () => {
    file = await buildIcons();
    names = createIconNames(file);
}, 60_000);

afterEach(async () => {
    for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

const codes = (node: Record<string, unknown>): string[] =>
    validateNode(shape, { component: 'icon', ...node } as Node, '$.app', { isIconName: names.isIconName }).map((error) => error.code);

describe('icon names', () => {
    it('should accept Tabler names and aliases and refuse others', () => {
        // Assert
        expect(names.isIconName('search')).toBe(true);
        expect(names.isIconName('close')).toBe(true);
        expect(names.isIconName('brand-github')).toBe(false);
        expect(names.isIconName('toString')).toBe(false);
        expect(names.isIconName('')).toBe(false);
    });

    it('should resolve an alias to its target and know which icons have a filled variant', () => {
        // Assert
        expect(names.resolve('warning')).toBe('alert-triangle');
        expect(names.resolve('x')).toBe('x');
        expect(names.resolve('nope')).toBeUndefined();
        expect(names.hasFilled('success')).toBe(true);
        expect(names.hasFilled('a-b-2')).toBe(false);
    });

    it('should read the names and aliases from an icons.json on disk', async () => {
        // Arrange
        const folder = await mkdtemp(join(tmpdir(), 'stateui-icons-'));
        folders.push(folder);
        const out = join(folder, 'icons.json');

        // Act
        await writeIcons(out);
        const loaded = createIconNames(loadIconsFile(out));

        // Assert
        expect(loaded.isIconName('delete')).toBe(true);
        expect(loaded.isIconName('trash')).toBe(true);
        expect(loaded.isIconName('not-an-icon')).toBe(false);
    }, 60_000);

    it('should make validateNode report an unknown name as SUI-STATE-INVALID', () => {
        // Assert
        expect(codes({ name: 'x' })).toEqual([]);
        expect(codes({ name: 'warning' })).toEqual([]);
        expect(codes({ name: 'no-such-icon' })).toEqual(['SUI-STATE-INVALID']);
    });

    it('should report a non-decorative icon without _label as SUI-STATE-CONDITION', () => {
        // Assert
        expect(codes({ name: 'x', decorative: false })).toEqual(['SUI-STATE-CONDITION']);
        expect(codes({ name: 'x', decorative: false, _label: 'Close' })).toEqual([]);
    });
});

describe('validateIconNode', () => {
    it('should warn with SUI-STATE-FILLED for filled on a name with no filled variant', () => {
        // Act
        const result = validateIconNode({ component: 'icon', name: 'a-b-2', filled: true }, '$.app.i', names);

        // Assert
        expect(result.map((error) => [error.code, error.severity, error.statePath])).toEqual([['SUI-STATE-FILLED', 'warning', '$.app.i']]);
    });

    it('should warn through an alias whose target has no filled variant', () => {
        // Arrange
        const table: IconsFile = { ...file, aliases: { ...file.aliases, plain: 'a-b-2' } };

        // Act
        const result = validateIconNode({ component: 'icon', name: 'plain', filled: true }, '$.app', createIconNames(table));

        // Assert
        expect(result).toHaveLength(1);
    });

    it('should give nothing for a filled variant, an unset filled, an unknown name or another component', () => {
        // Assert
        expect(validateIconNode({ component: 'icon', name: 'circle-check', filled: true }, '$.app', names)).toEqual([]);
        expect(validateIconNode({ component: 'icon', name: 'a-b-2' }, '$.app', names)).toEqual([]);
        expect(validateIconNode({ component: 'icon', name: 'nope', filled: true }, '$.app', names)).toEqual([]);
        expect(validateIconNode({ component: 'button', name: 'a-b-2', filled: true }, '$.app', names)).toEqual([]);
        expect(validateIconNode({ component: 'icon', '<-filled': '$.data.f', name: 'a-b-2' }, '$.app', names)).toEqual([]);
    });
});

describe('core icon set', () => {
    it('should name only Tabler icons and include the alias targets for the status icons', () => {
        // Assert
        for (const name of CORE_ICON_NAMES) expect(file.icons[name], name).toBeDefined();
        for (const target of ['alert-triangle', 'alert-circle', 'circle-check', 'info-circle']) expect(CORE_ICON_NAMES).toContain(target);
        expect(Object.values(ICON_ALIASES).filter((target) => CORE_ICON_NAMES.includes(target)).length).toBeGreaterThan(0);
    });

    it('should hold the same path data as icons.json for every core icon', async () => {
        // Act
        const core = await buildCoreIcons();

        // Assert
        expect(Object.keys(core).sort()).toEqual([...CORE_ICON_NAMES].sort());
        for (const [name, icon] of Object.entries(core)) {
            expect(icon.outline, name).toEqual(file.icons[name]?.outline);
            expect(icon.filled, name).toEqual(file.icons[name]?.filled);
        }
    });

    it('should be written into every build output next to the components', async () => {
        // Act
        const built = await readdir(resolve(root, '.test-build/real/icons'));
        const text = await readFile(resolve(root, '.test-build/real/icons/core.js'), 'utf8');

        // Assert
        expect(built).toEqual(expect.arrayContaining(['core.js', 'core.d.ts']));
        expect(text).toBe(coreIconsModule(await buildCoreIcons()));
    });
});
