import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { IconsFile } from './types.js';

/** What the server needs to know about the icon names of one `icons.json` */
export interface IconNames {
    /** True for a Tabler icon name or an alias; pass it to `validateNode` as `isIconName` */
    isIconName(name: string): boolean;
    /** The Tabler icon name a name draws: the name itself, or the target of an alias; undefined for an unknown name */
    resolve(name: string): string | undefined;
    /** True when the name (or its alias target) has a filled variant */
    hasFilled(name: string): boolean;
}

/** Builds the name lookups over the contents of an `icons.json` */
export function createIconNames(file: IconsFile): IconNames {
    const resolve = (name: string): string | undefined => {
        if (Object.hasOwn(file.icons, name)) return name;
        const target = Object.hasOwn(file.aliases, name) ? file.aliases[name] : undefined;
        return target !== undefined && Object.hasOwn(file.icons, target) ? target : undefined;
    };
    return {
        isIconName: (name) => resolve(name) !== undefined,
        resolve,
        hasFilled(name) {
            const target = resolve(name);
            return target !== undefined && file.icons[target]?.filled !== undefined;
        }
    };
}

/** Reads and parses an `icons.json` from a file path or a `file:` URL */
export function loadIconsFile(location: string | URL): IconsFile {
    const path = typeof location === 'string' ? location : fileURLToPath(location);
    return JSON.parse(readFileSync(path, 'utf8')) as IconsFile;
}

let packaged: IconNames | undefined;

/** The name lookups over the `icons.json` that sits beside the compiled library (`dist/icons.json`), read on first use */
export function packagedIconNames(): IconNames {
    packaged ??= createIconNames(loadIconsFile(new URL('../icons.json', import.meta.url)));
    return packaged;
}

/**
 * Server-side check of an icon name against the library's `icons.json`: the names and the aliases. It is the
 * `isIconName` option of `validateNode`, so every property of type `icon` is checked against the same list
 */
export function isIconName(name: string): boolean {
    return packagedIconNames().isIconName(name);
}
