/**
 * `layoutTree`, the function of the `treeDiagram` component at `$.components.treeDiagram.functions.layoutTree`: the
 * arithmetic of a tree of cards laid out in columns from a root, made pure. It takes the cards' sizes and gives each
 * card its place and each edge its path, so the component (or an app's compute) needs no DOM to know where things go
 */

/**
 * A card of the tree: its parent's id (`null` or absent for a root) and its measured size. `wrap` lets a card without
 * children share a block with its siblings that also wrap (see `leafBlock`)
 */
export interface TreeNodeIn {
    readonly id: string;
    readonly parent?: string | null;
    readonly width: number;
    readonly height: number;
    readonly wrap?: boolean;
}

/** A link across the tree, from one card to another; `kind` is passed on to the edge */
export interface TreeLinkIn {
    readonly from: string;
    readonly to: string;
    readonly kind?: string;
}

export interface LayoutTreeOptions {
    /** The space between two leaves stacked in one column; default 10 */
    readonly rowGap?: number;
    /** The space between two siblings when either has children; default 28 */
    readonly groupGap?: number;
    /** The space between a card and the column of its children; default 72 */
    readonly columnGap?: number;
    /** The root's branches share the two sides, split where the heights come closest; default false: all go right */
    readonly twoSided?: boolean;
    /**
     * How many levels below the root stand in shared columns, each as wide as its widest card; a deeper card sits just
     * beside its parent. Default 0: every level stands in a column
     */
    readonly columns?: number;
    /**
     * The width in pixels of a block of leaves: the children of one card that wrap and have no children of their own,
     * when there are two or more, stand in rows inside that width (`rowGap` apart both ways) instead of one column. The
     * block stands where its first card would, and one edge runs from the parent to the block, its `to` the first card.
     * Default 0: no blocks
     */
    readonly leafBlock?: number;
}

export interface LayoutTreeInput {
    readonly nodes: readonly TreeNodeIn[];
    readonly links?: readonly TreeLinkIn[];
    readonly options?: LayoutTreeOptions;
}

/** A placed card: its top-left corner and the side of the root it stands on (1 right, -1 left) */
export interface PlacedNode {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly side: 1 | -1;
}

/** An edge as SVG path data: `tree` from a parent to a child, or the `kind` of a link across the tree (`link` when it has none) */
export interface PlacedEdge {
    readonly from: string;
    readonly to: string;
    readonly kind: string;
    readonly path: string;
}

export interface LayoutTreeOutput {
    /** The placed cards, in the order of the input; a card in a cycle of parents is left out */
    readonly nodes: readonly PlacedNode[];
    readonly edges: readonly PlacedEdge[];
    /** The size of the box that holds every card, whose top-left corner is 0, 0 */
    readonly width: number;
    readonly height: number;
}

interface Item {
    readonly id: string;
    readonly w: number;
    readonly h: number;
    readonly children: Item[];
    parent: Item | undefined;
    x: number;
    y: number;
    depth: number;
    side: 1 | -1;
    /** The root put above several roots: it has no size and draws no edges */
    readonly virtual: boolean;
    readonly wrap: boolean;
    /** A block of leaves: the cards it holds, each with its place inside the block (from the block's leading corner) */
    readonly members?: { item: Item; dx: number; dy: number }[];
}

const ROOT_ID = '\u0000root';

function finite(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function round(value: number): number {
    return Math.round(value * 100) / 100;
}

function itemsOf(item: Item): Item[] {
    return [item, ...item.children.flatMap(itemsOf)];
}

function shift(item: Item, dy: number): void {
    item.y += dy;
    for (const child of item.children) shift(child, dy);
}

/** The tree of the input: one root, or a root without size above several; cards whose parents loop are not reached */
function treeOf(nodes: readonly TreeNodeIn[]): Item {
    const items = new Map<string, Item>();
    for (const node of nodes) {
        if (typeof node.id !== 'string' || items.has(node.id)) continue;
        items.set(node.id, { id: node.id, w: finite(node.width, 0), h: finite(node.height, 0), children: [], parent: undefined, x: 0, y: 0, depth: 0, side: 1, virtual: false, wrap: node.wrap === true });
    }
    const roots: Item[] = [];
    for (const node of nodes) {
        const item = items.get(node.id);
        if (item === undefined || item.parent !== undefined || roots.includes(item)) continue;
        const parent = typeof node.parent === 'string' ? items.get(node.parent) : undefined;
        if (parent === undefined || parent === item) {
            roots.push(item);
            continue;
        }
        item.parent = parent;
        parent.children.push(item);
    }
    if (roots.length === 1) return roots[0] as Item;
    const root: Item = { id: ROOT_ID, w: 0, h: 0, children: roots, parent: undefined, x: 0, y: 0, depth: 0, side: 1, virtual: true, wrap: false };
    for (const item of roots) item.parent = root;
    return root;
}

/**
 * Puts the children of each card that wrap and have none of their own, two or more, into one block in the place of the
 * first: rows of cards inside `width`, `gap` apart. The block is an item of its own, with the cards as its members
 */
function block(item: Item, width: number, gap: number): void {
    for (const child of item.children) block(child, width, gap);
    const leaves = item.children.filter((child) => child.wrap && child.children.length === 0);
    if (leaves.length < 2) return;
    const members: { item: Item; dx: number; dy: number }[] = [];
    let x = 0;
    let y = 0;
    let row = 0;
    let w = 0;
    for (const leaf of leaves) {
        if (x > 0 && x + leaf.w > width) {
            y += row + gap;
            x = 0;
            row = 0;
        }
        members.push({ item: leaf, dx: x, dy: y });
        w = Math.max(w, x + leaf.w);
        x += leaf.w + gap;
        row = Math.max(row, leaf.h);
    }
    const first = leaves[0] as Item;
    const made: Item = { id: first.id, w, h: y + row, children: [], parent: item, x: 0, y: 0, depth: 0, side: 1, virtual: false, wrap: false, members };
    const at = item.children.indexOf(first);
    item.children.splice(0, item.children.length, ...item.children.slice(0, at), made, ...item.children.slice(at).filter((child) => !leaves.includes(child)));
}

/** The cards of a list of items: a block gives its members, each placed inside it (mirrored on the left side) */
function cardsOf(items: readonly Item[]): Item[] {
    return items.flatMap((item) => {
        if (item.members === undefined) return [item];
        for (const { item: member, dx, dy } of item.members) {
            member.x = item.side < 0 ? item.x + item.w - dx - member.w : item.x + dx;
            member.y = item.y + dy;
            member.side = item.side;
            member.depth = item.depth;
        }
        return item.members.map((member) => member.item);
    });
}

/** Places every card of the tree: each subtree stacked down, a parent across from the middle of its children */
function place(root: Item, options: Required<LayoutTreeOptions>): void {
    const { rowGap, groupGap, columnGap, twoSided, columns } = options;
    // Stacks a list of siblings down from top, each beside its own children; the bottom
    const stack = (list: readonly Item[], depth: number, top: number, widths: number[]): number => {
        let y = top;
        list.forEach((item, index) => {
            const before = list[index - 1];
            if (before !== undefined) y += item.children.length > 0 || before.children.length > 0 ? groupGap : rowGap;
            widths[depth] = Math.max(widths[depth] ?? 0, item.w);
            item.depth = depth;
            if (item.children.length === 0) {
                item.y = y;
                y += item.h;
                return;
            }
            const bottom = stack(item.children, depth + 1, y, widths);
            const first = item.children[0] as Item;
            const last = item.children[item.children.length - 1] as Item;
            item.y = (first.y + first.h / 2 + last.y + last.h / 2) / 2 - item.h / 2;
            if (item.y < y) {
                const down = y - item.y;
                item.y = y;
                for (const child of item.children) shift(child, down);
                y = bottom + down;
            } else y = Math.max(bottom, item.y + item.h);
        });
        return y;
    };
    root.x = 0;
    root.y = -root.h / 2;
    root.depth = 0;
    root.side = 1;
    // Two-sided: the first branches go right and the rest left, split where the two heights come closest
    let split = root.children.length;
    if (twoSided && root.children.length > 1) {
        const heights = root.children.map((item) => stack([item], 1, 0, []));
        const total = heights.reduce((sum, height) => sum + height, 0);
        let best = Infinity;
        for (let count = 1, right = 0; count <= root.children.length; count++) {
            right += heights[count - 1] as number;
            const apart = Math.abs(right - (total - right));
            if (apart < best) {
                best = apart;
                split = count;
            }
        }
    }
    const sideOf = (item: Item, way: 1 | -1): void => {
        item.side = way;
        for (const child of item.children) sideOf(child, way);
    };
    root.children.forEach((item, index) => sideOf(item, index < split ? 1 : -1));
    for (const side of [1, -1] as const) {
        const list = root.children.filter((item) => item.side === side);
        if (list.length === 0) continue;
        const widths: number[] = [];
        const height = stack(list, 1, 0, widths);
        for (const item of list) shift(item, -height / 2);
        // The columns go out from the root: left-aligned to its right, right-aligned to its left
        const start = [side > 0 ? root.w : 0];
        for (let depth = 1; depth < widths.length; depth++) {
            const gap = root.virtual && depth === 1 ? 0 : columnGap;
            start[depth] = (start[depth - 1] as number) + side * ((depth > 1 ? (widths[depth - 1] as number) : 0) + gap);
        }
        for (const item of list.flatMap(itemsOf)) {
            const parent = item.parent as Item;
            if (columns > 0 && item.depth > columns) item.x = side > 0 ? parent.x + parent.w + columnGap : parent.x - columnGap - item.w;
            else item.x = side > 0 ? (start[item.depth] as number) : (start[item.depth] as number) - item.w;
        }
    }
}

/** A curve from one point to another, leaving and arriving level */
function curve(x1: number, y1: number, x2: number, y2: number): string {
    const bend = Math.max(24, Math.abs(x2 - x1) / 2) * (x2 >= x1 ? 1 : -1);
    return `M${round(x1)},${round(y1)} C${round(x1 + bend)},${round(y1)} ${round(x2 - bend)},${round(y2)} ${round(x2)},${round(y2)}`;
}

/** A link across the tree: on one side from outer edge to outer edge, bowing outwards; from one side to the other, between the inner edges */
function across(a: Item, b: Item): string {
    const middle = (item: Item): number => item.y + item.h / 2;
    const bow = 40 + Math.abs(middle(a) - middle(b)) / 8;
    if (a.side < 0 && b.side < 0) {
        const x = Math.min(a.x, b.x) - bow;
        return `M${round(a.x)},${round(middle(a))} C${round(x)},${round(middle(a))} ${round(x)},${round(middle(b))} ${round(b.x)},${round(middle(b))}`;
    }
    if (a.side > 0 && b.side > 0) {
        const x = Math.max(a.x + a.w, b.x + b.w) + bow;
        return `M${round(a.x + a.w)},${round(middle(a))} C${round(x)},${round(middle(a))} ${round(x)},${round(middle(b))} ${round(b.x + b.w)},${round(middle(b))}`;
    }
    return curve(a.side < 0 ? a.x + a.w : a.x, middle(a), b.side < 0 ? b.x + b.w : b.x, middle(b));
}

/**
 * Lays out a tree of cards: the root at the left (or in the middle, `twoSided`), each level a column further out, each
 * subtree stacked down with its parent across from the middle of its children. Several roots stand in the first column.
 * Edges run from a parent's outer side to a child's inner side, and links across the tree bow outwards. Never throws:
 * a size that is not a number counts as 0, a parent that is not a card makes a root, and a card in a cycle is left out
 */
export function layoutTree(input: LayoutTreeInput): LayoutTreeOutput {
    const given = input.options ?? {};
    const options: Required<LayoutTreeOptions> = {
        rowGap: finite(given.rowGap, 10),
        groupGap: finite(given.groupGap, 28),
        columnGap: finite(given.columnGap, 72),
        twoSided: given.twoSided === true,
        columns: Math.floor(finite(given.columns, 0)),
        leafBlock: finite(given.leafBlock, 0)
    };
    const nodes = Array.isArray(input.nodes) ? input.nodes : [];
    if (nodes.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };
    const root = treeOf(nodes);
    if (options.leafBlock > 0) block(root, options.leafBlock, options.rowGap);
    place(root, options);
    const items = itemsOf(root).filter((item) => !item.virtual);
    const minX = Math.min(...items.map((item) => item.x));
    const minY = Math.min(...items.map((item) => item.y));
    for (const item of itemsOf(root)) {
        item.x -= minX;
        item.y -= minY;
    }
    const all = cardsOf(items);
    const byId = new Map(all.map((item) => [item.id, item]));
    const edges: PlacedEdge[] = [];
    // A block's members draw no edge of their own: the block's edge, to its first card, stands for them
    for (const item of items) {
        if (item.parent === undefined || item.parent.virtual) continue;
        const parent = item.parent;
        const path = item.side < 0 ? curve(parent.x, parent.y + parent.h / 2, item.x + item.w, item.y + item.h / 2) : curve(parent.x + parent.w, parent.y + parent.h / 2, item.x, item.y + item.h / 2);
        edges.push({ from: parent.id, to: item.id, kind: 'tree', path });
    }
    for (const link of Array.isArray(input.links) ? input.links : []) {
        const a = byId.get(link.from);
        const b = byId.get(link.to);
        if (a === undefined || b === undefined || a === b) continue;
        edges.push({ from: a.id, to: b.id, kind: typeof link.kind === 'string' && link.kind !== '' ? link.kind : 'link', path: across(a, b) });
    }
    return {
        nodes: nodes.flatMap((node) => {
            const item = byId.get(node.id);
            return item === undefined || item.id !== node.id ? [] : [{ id: item.id, x: round(item.x), y: round(item.y), side: item.side }];
        }).filter((node, index, list) => list.findIndex((other) => other.id === node.id) === index),
        edges,
        width: round(Math.max(...items.map((item) => item.x + item.w))),
        height: round(Math.max(...items.map((item) => item.y + item.h)))
    };
}
