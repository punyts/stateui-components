/** What a tree is read with: the record key field and how records relate */
export interface TreeOptions {
    /** The field of an array record that holds its key; a keyed map is keyed by its own keys */
    key: string;
    /** The field of a record that holds the key of its parent; empty or an unknown key makes the record a root */
    parentField: string;
    /** The field of a record that holds the list of its children's keys; when it is not empty it replaces `parentField` */
    childrenField: string;
    /** The field of a record that is true when it has children that are not loaded yet */
    hasChildrenField: string;
}

/** One record of the tree and how it relates to the others */
export interface TreeNode {
    key: string;
    parent: string | undefined;
    /** The keys of the children that are loaded, in display order */
    children: string[];
    /** The record is marked as having children (the `hasChildrenField` value is true) */
    marked: boolean;
}

/** The records read once: every node, the roots in display order and the keys a cycle makes unreachable */
export interface TreeModel {
    nodes: Map<string, TreeNode>;
    roots: string[];
    /** The keys of the records that no root reaches: a cycle of parent keys and every record below it */
    cyclic: string[];
}

/** One visible row of the tree */
export interface TreeRow {
    key: string;
    /** The depth: 0 for a root */
    level: number;
    parent: string | undefined;
    /** The number of siblings, with the row itself, and its place among them from 1 */
    setsize: number;
    posinset: number;
    /** The record has children, loaded or marked */
    expandable: boolean;
    /** The record is expandable and its key is in `expanded` */
    expanded: boolean;
    /** The record is marked as having children and none are loaded */
    unloaded: boolean;
}

/** The visible rows in display order, and the keys a cycle hides */
export interface FlatTree {
    rows: TreeRow[];
    cyclic: string[];
}

const keyText = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value === '' ? undefined : value;
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The records by key in their order: an array keyed by `key`, or a keyed map; a record with no key is left out and the last of a repeated key wins */
function readRecords(records: unknown, key: string): Map<string, Record<string, unknown>> {
    const found = new Map<string, Record<string, unknown>>();
    if (Array.isArray(records)) {
        for (const record of records as unknown[]) {
            const recordKey = isRecord(record) ? keyText(record[key]) : undefined;
            if (recordKey !== undefined && isRecord(record)) found.set(recordKey, record);
        }
    } else if (isRecord(records)) {
        for (const [mapKey, record] of Object.entries(records)) if (isRecord(record)) found.set(mapKey, record);
    }
    return found;
}

/** Reads the records into a tree model: who is whose parent, the roots in display order and the keys no root reaches */
export function buildTree(records: unknown, options: TreeOptions): TreeModel {
    const source = readRecords(records, options.key);
    const nodes = new Map<string, TreeNode>();
    for (const [key, record] of source) nodes.set(key, { key, parent: undefined, children: [], marked: record[options.hasChildrenField] === true });

    if (options.childrenField !== '') {
        for (const [key, record] of source) {
            const node = nodes.get(key) as TreeNode;
            const listed = record[options.childrenField];
            const seen = new Set<string>();
            for (const item of Array.isArray(listed) ? (listed as unknown[]) : []) {
                const childKey = keyText(item);
                const child = childKey === undefined ? undefined : nodes.get(childKey);
                if (childKey === undefined || child === undefined || seen.has(childKey)) continue;
                seen.add(childKey);
                node.children.push(childKey);
                if (child.parent === undefined) child.parent = key;
            }
        }
    } else {
        for (const [key, record] of source) {
            const parentKey = keyText(record[options.parentField]);
            const parent = parentKey === undefined ? undefined : nodes.get(parentKey);
            if (parent === undefined) continue;
            (nodes.get(key) as TreeNode).parent = parentKey;
            parent.children.push(key);
        }
    }

    const roots = [...nodes.values()].filter((node) => node.parent === undefined).map((node) => node.key);
    const reached = new Set<string>();
    const stack = [...roots];
    while (stack.length > 0) {
        const key = stack.pop() as string;
        if (reached.has(key)) continue;
        reached.add(key);
        for (const child of (nodes.get(key) as TreeNode).children) stack.push(child);
    }
    const cyclic = [...nodes.keys()].filter((key) => !reached.has(key));
    return { nodes, roots, cyclic };
}

interface Pending {
    key: string;
    level: number;
    setsize: number;
    posinset: number;
}

/** The visible rows of a model: a node's children follow it, in order, while its key is in `expanded`. Iterative, so a deep tree cannot overflow */
export function flattenModel(model: TreeModel, expanded: ReadonlySet<string>): TreeRow[] {
    const rows: TreeRow[] = [];
    const seen = new Set<string>();
    const stack: Pending[] = [];
    for (let index = model.roots.length - 1; index >= 0; index--) {
        stack.push({ key: model.roots[index] as string, level: 0, setsize: model.roots.length, posinset: index + 1 });
    }
    while (stack.length > 0) {
        const next = stack.pop() as Pending;
        if (seen.has(next.key)) continue;
        seen.add(next.key);
        const node = model.nodes.get(next.key) as TreeNode;
        const expandable = node.children.length > 0 || node.marked;
        const open = expandable && expanded.has(next.key);
        rows.push({
            key: next.key,
            level: next.level,
            parent: node.parent,
            setsize: next.setsize,
            posinset: next.posinset,
            expandable,
            expanded: open,
            unloaded: node.children.length === 0 && node.marked
        });
        if (!open) continue;
        for (let index = node.children.length - 1; index >= 0; index--) {
            stack.push({ key: node.children[index] as string, level: next.level + 1, setsize: node.children.length, posinset: index + 1 });
        }
    }
    return rows;
}

/**
 * The records of a tree as the rows to show, in display order, each with its level. A record is a root when it has no
 * parent (or its parent is not among the records); the children of a record whose key is in `expanded` follow it, in the
 * order of the records (or of the `childrenField` list). `cyclic` lists the records a cycle of parent keys hides: a record
 * that is its own ancestor is never reachable from a root, so neither it nor anything below it is shown
 */
export function flattenTree(records: unknown, options: TreeOptions, expanded: Iterable<string>): FlatTree {
    const model = buildTree(records, options);
    return { rows: flattenModel(model, new Set(expanded)), cyclic: model.cyclic };
}
