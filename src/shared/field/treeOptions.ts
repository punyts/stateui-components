/**
 * The pure parts of `treeSelectField`: reading hierarchical options and the rows of the tree as it is expanded. Options
 * are a keyed map or a list of records; each names its parent by key (`parentField`). A record whose parent is missing,
 * or that would make a cycle, is a root; order is the options' own order. A list's records are keyed by `keyField`
 */

/** One option of the tree */
export interface TreeOption {
    readonly key: string;
    readonly label: string;
    readonly parent: string | undefined;
    readonly children: readonly string[];
}

/** The options in order, keyed, with their children; the roots are the options with no parent */
export interface TreeOptions {
    readonly byKey: ReadonlyMap<string, TreeOption>;
    readonly roots: readonly string[];
}

/** One row of the tree as the popup draws it */
export interface TreeRow {
    readonly key: string;
    readonly label: string;
    readonly level: number;
    readonly hasChildren: boolean;
    readonly expanded: boolean;
}

const keyOf = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined);

/** Reads `options` (a keyed map or a list of records) into a tree */
export function readTreeOptions(options: unknown, keyField: string, parentField: string, labelField: string): TreeOptions {
    const records: { key: string; label: string; parent: string | undefined }[] = [];
    const seen = new Set<string>();
    const add = (key: string | undefined, value: unknown): void => {
        if (key === undefined || seen.has(key) || value === null || typeof value !== 'object') return;
        const record = value as Record<string, unknown>;
        const label = record[labelField] ?? record['_label'];
        seen.add(key);
        records.push({ key, label: typeof label === 'string' && label !== '' ? label : key, parent: keyOf(record[parentField]) });
    };
    if (Array.isArray(options)) for (const value of options) add(value !== null && typeof value === 'object' ? keyOf((value as Record<string, unknown>)[keyField]) : undefined, value);
    else if (options !== null && typeof options === 'object') for (const [key, value] of Object.entries(options as Record<string, unknown>)) add(key, value);

    const parentOf = new Map<string, string | undefined>(records.map((record) => [record.key, record.parent !== undefined && seen.has(record.parent) && record.parent !== record.key ? record.parent : undefined]));
    // a record whose chain of parents comes back to itself is a root
    for (const record of records) {
        const visited = new Set<string>([record.key]);
        for (let step = parentOf.get(record.key); step !== undefined; step = parentOf.get(step)) {
            if (visited.has(step)) {
                parentOf.set(record.key, undefined);
                break;
            }
            visited.add(step);
        }
    }
    const children = new Map<string, string[]>(records.map((record) => [record.key, []]));
    const roots: string[] = [];
    for (const record of records) {
        const parent = parentOf.get(record.key);
        if (parent === undefined) roots.push(record.key);
        else children.get(parent)?.push(record.key);
    }
    const byKey = new Map<string, TreeOption>(records.map((record) => [record.key, { key: record.key, label: record.label, parent: parentOf.get(record.key), children: children.get(record.key) ?? [] }]));
    return { byKey, roots };
}

/** The keys from the root down to `key`'s parent; empty for a root or an unknown key */
export function ancestorsOf(tree: TreeOptions, key: string): string[] {
    const chain: string[] = [];
    for (let step = tree.byKey.get(key)?.parent; step !== undefined; step = tree.byKey.get(step)?.parent) chain.unshift(step);
    return chain;
}

/** The labels from the root down to `key`, joined by `separator`; '' for an unknown key */
export function pathLabel(tree: TreeOptions, key: string, separator = ' / '): string {
    const option = tree.byKey.get(key);
    if (option === undefined) return '';
    return [...ancestorsOf(tree, key).map((step) => tree.byKey.get(step)?.label ?? step), option.label].join(separator);
}

/** The rows shown with the options of `expanded` open, depth first */
export function visibleRows(tree: TreeOptions, expanded: ReadonlySet<string>): TreeRow[] {
    const rows: TreeRow[] = [];
    const walk = (keys: readonly string[], level: number): void => {
        for (const key of keys) {
            const option = tree.byKey.get(key);
            if (option === undefined) continue;
            const open = option.children.length > 0 && expanded.has(key);
            rows.push({ key, label: option.label, level, hasChildren: option.children.length > 0, expanded: open });
            if (open) walk(option.children, level + 1);
        }
    };
    walk(tree.roots, 1);
    return rows;
}
