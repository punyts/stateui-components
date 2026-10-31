import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ICON_ALIASES } from '../src/icons/aliases.ts';
import type { IconEntry, IconsFile } from '../src/icons/types.ts';
import { svgToPaths } from './icon-convert.ts';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BRAND_PREFIX = 'brand-';

interface TablerMetadata {
    readonly name?: unknown;
    readonly category?: unknown;
    readonly tags?: unknown;
}

/** Finds the installed `@tabler/icons` folder by walking up from `from` (its `exports` map hides `package.json`) */
export function findTablerRoot(from: string = PACKAGE_ROOT): string {
    let folder = resolve(from);
    for (;;) {
        const candidate = join(folder, 'node_modules', '@tabler', 'icons');
        if (existsSync(join(candidate, 'icons.json'))) return candidate;
        const parent = dirname(folder);
        if (parent === folder) throw new Error(`@tabler/icons is not installed above ${from}`);
        folder = parent;
    }
}

/**
 * Fails when the pinned `@tabler/icons` version does not ship a name, a category and tags for every icon, naming the
 * version so a bump to a package without the metadata is caught at build time
 */
export function checkMetadata(version: string, metadata: Readonly<Record<string, TablerMetadata>>): void {
    const names = Object.keys(metadata);
    const problems: string[] = [];
    if (names.length === 0) problems.push('it lists no icons');
    for (const name of names) {
        const entry = metadata[name] as TablerMetadata;
        const missing: string[] = [];
        if (typeof entry.name !== 'string' || entry.name === '') missing.push('name');
        if (typeof entry.category !== 'string' || entry.category === '') missing.push('category');
        if (!Array.isArray(entry.tags) || entry.tags.length === 0) missing.push('tags');
        if (missing.length > 0) problems.push(`"${name}" has no ${missing.join(', ')}`);
    }
    if (problems.length > 0) {
        const shown = problems.slice(0, 5).join('; ');
        const more = problems.length > 5 ? ` (and ${problems.length - 5} more)` : '';
        throw new Error(`@tabler/icons@${version} does not ship the icon metadata (name, category, tags): ${shown}${more}`);
    }
}

async function readVersion(tablerRoot: string): Promise<string> {
    const manifest = JSON.parse(await readFile(join(tablerRoot, 'package.json'), 'utf8')) as { version?: unknown };
    if (typeof manifest.version !== 'string') throw new Error(`${tablerRoot}/package.json has no version`);
    return manifest.version;
}

async function readIconFiles(folder: string): Promise<Set<string>> {
    const files = await readdir(folder);
    return new Set(files.filter((file) => file.endsWith('.svg')).map((file) => file.slice(0, -'.svg'.length)));
}

/** Builds the contents of `icons.json` from the installed `@tabler/icons` package */
export async function buildIcons(tablerRoot: string = findTablerRoot()): Promise<IconsFile> {
    const version = await readVersion(tablerRoot);
    const metadata = JSON.parse(await readFile(join(tablerRoot, 'icons.json'), 'utf8')) as Record<
        string,
        TablerMetadata
    >;
    checkMetadata(version, metadata);

    const filledNames = await readIconFiles(join(tablerRoot, 'icons', 'filled'));
    const icons: Record<string, IconEntry> = {};
    for (const name of Object.keys(metadata).sort()) {
        if (name.startsWith(BRAND_PREFIX)) continue;
        const entry = metadata[name] as TablerMetadata;
        const outlineSvg = await readFile(join(tablerRoot, 'icons', 'outline', `${name}.svg`), 'utf8').catch(() => {
            throw new Error(`@tabler/icons@${version} has no outline icon file for "${name}"`);
        });
        const outline = svgToPaths(outlineSvg, 'outline');
        if (outline.length === 0) throw new Error(`The outline icon "${name}" has no paths`);
        const base = { category: entry.category as string, tags: entry.tags as string[], outline };
        if (filledNames.has(name)) {
            const filledSvg = await readFile(join(tablerRoot, 'icons', 'filled', `${name}.svg`), 'utf8');
            icons[name] = { ...base, filled: svgToPaths(filledSvg, 'filled') };
        } else {
            icons[name] = base;
        }
    }

    for (const [alias, target] of Object.entries(ICON_ALIASES)) {
        if (icons[target] === undefined) throw new Error(`The icon alias "${alias}" points to "${target}", which is not an icon`);
        if (icons[alias] !== undefined) throw new Error(`The icon alias "${alias}" is also an icon name`);
    }
    return { tablerVersion: version, aliases: { ...ICON_ALIASES }, icons };
}

/** Writes `icons.json` (compact) into `outFile` and returns the icon count */
export async function writeIcons(outFile: string, tablerRoot?: string): Promise<number> {
    const file = await buildIcons(tablerRoot);
    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, JSON.stringify(file));
    return Object.keys(file.icons).length;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
    const outFile = resolve(PACKAGE_ROOT, process.argv[2] ?? 'dist/icons.json');
    writeIcons(outFile).then(
        (count) => {
            process.stdout.write(`Wrote ${count} icons to ${outFile}\n`);
        },
        (error: unknown) => {
            process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
            process.exit(1);
        }
    );
}
