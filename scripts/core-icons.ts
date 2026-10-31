import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ICON_ALIASES } from '../src/icons/aliases.ts';
import { CORE_ICON_NAMES } from '../src/icons/coreNames.ts';
import type { IconPath } from '../src/icons/types.ts';
import { findTablerRoot } from './build-icons.ts';
import { svgToPaths } from './icon-convert.ts';

/** The path data of one core icon: the same form as an entry of `icons.json` without its category and tags */
export interface CoreIcon {
    readonly outline: readonly IconPath[];
    readonly filled?: readonly IconPath[];
}

/** Reads the path data of every core icon from the installed `@tabler/icons` package */
export async function buildCoreIcons(tablerRoot: string = findTablerRoot()): Promise<Record<string, CoreIcon>> {
    const icons: Record<string, CoreIcon> = {};
    for (const name of [...CORE_ICON_NAMES].sort()) {
        const outline = svgToPaths(await readFile(join(tablerRoot, 'icons', 'outline', `${name}.svg`), 'utf8'), 'outline');
        if (outline.length === 0) throw new Error(`The core icon "${name}" has no outline paths`);
        const filledFile = join(tablerRoot, 'icons', 'filled', `${name}.svg`);
        icons[name] = existsSync(filledFile)
            ? { outline, filled: svgToPaths(await readFile(filledFile, 'utf8'), 'filled') }
            : { outline };
    }
    return icons;
}

/**
 * The text of `icons/core.js`: the core icons and the alias table, as plain data. The icon controller imports it, so
 * the set is part of the compiled library and needs no request
 */
export function coreIconsModule(icons: Readonly<Record<string, CoreIcon>>): string {
    return [
        '/** Path data of the icons the library\'s own components use (generated from @tabler/icons by scripts/core-icons.ts) */',
        `export const CORE_ICONS = ${JSON.stringify(icons)};`,
        '',
        '/** The semantic icon names and the Tabler icon each one draws */',
        `export const CORE_ICON_ALIASES = ${JSON.stringify(ICON_ALIASES)};`,
        ''
    ].join('\n');
}

/** The text of `icons/core.d.ts` */
export function coreIconsTypes(): string {
    return [
        'export type CoreIconPath = string | { readonly d: string; readonly fill?: true; readonly stroke?: false; readonly opacity?: number };',
        '',
        'export interface CoreIcon {',
        '    readonly outline: readonly CoreIconPath[];',
        '    readonly filled?: readonly CoreIconPath[];',
        '}',
        '',
        'export declare const CORE_ICONS: Readonly<Record<string, CoreIcon>>;',
        'export declare const CORE_ICON_ALIASES: Readonly<Record<string, string>>;',
        ''
    ].join('\n');
}
