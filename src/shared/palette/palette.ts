import { labelContains } from '../field/combo.js';

/** One command of a palette as it is listed: its key, label, icon, group, shortcut text and search words */
export interface PaletteCommand {
    readonly key: string;
    readonly label: string;
    readonly icon: string;
    readonly group: string;
    readonly shortcut: string;
    readonly keywords: readonly string[];
}

/** The commands of one group that match, in command order, under the group's name (empty for commands with none) */
export interface PaletteGroup {
    readonly label: string;
    readonly commands: readonly PaletteCommand[];
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * The commands of a palette's `commands` map in key order: the label is the content `_label` (the key when there is
 * none), `keywords` a list of words (a single string is one word) and every other field a string
 */
export function readCommands(commands: unknown): PaletteCommand[] {
    if (typeof commands !== 'object' || commands === null || Array.isArray(commands)) return [];
    const found: PaletteCommand[] = [];
    for (const [key, entry] of Object.entries(commands as Record<string, unknown>)) {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
        const fields = entry as Record<string, unknown>;
        const label = text(fields['_label']).trim();
        const words = fields['keywords'];
        const keywords = Array.isArray(words) ? words.filter((word): word is string => typeof word === 'string') : typeof words === 'string' ? [words] : [];
        found.push({ key, label: label !== '' ? label : key, icon: text(fields['icon']), group: text(fields['group']).trim(), shortcut: text(fields['shortcut']), keywords });
    }
    return found;
}

/** True when the command's label or one of its keywords holds the query, apart from case and accents in the language; every command matches an empty query */
export function commandMatches(command: PaletteCommand, query: string, locale: string): boolean {
    const wanted = query.trim();
    if (wanted === '') return true;
    return labelContains(command.label, wanted, locale) || command.keywords.some((word) => labelContains(word, wanted, locale));
}

/** The commands that match the query, grouped by `group` in the order each group first appears, the commands in their own order */
export function groupCommands(commands: readonly PaletteCommand[], query: string, locale: string): PaletteGroup[] {
    const groups = new Map<string, PaletteCommand[]>();
    for (const command of commands) {
        if (!commandMatches(command, query, locale)) continue;
        const list = groups.get(command.group);
        if (list) list.push(command);
        else groups.set(command.group, [command]);
    }
    return [...groups].map(([label, list]) => ({ label, commands: list }));
}
