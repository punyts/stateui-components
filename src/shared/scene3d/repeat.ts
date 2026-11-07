import { buildError } from '@punyts/stateui-app/core';
import type { BuildError, JsonObject, JsonValue } from '@punyts/stateui-app/core';
import { createRowBinder } from '../drawing/rows.js';
import type { RowBinding } from '../drawing/rows.js';
import { NODE3D_PROPERTIES, isNode3dKind } from './tree.js';
import type { Node3dKind, Scene3dTree } from './tree.js';

/** The renderer a `repeat3d`'s copies are capped for (`ROW_CAPS.webgl`, 20,000: one instanced mesh, G3.6) */
export const REPEAT3D_RENDERER = 'webgl';

/** The row components a `repeat3d` draws as instances (its `row` slot's `childComponents`) */
export const REPEAT3D_ROW_KINDS: readonly Node3dKind[] = ['mesh'];

/**
 * The properties of a `repeat3d`'s row that each instance has its own value of: its place, turn and size, whether it
 * shows, whether it is pressed and its name (G3.8), and `material.color` (the instance colour). Every other property
 * (`geometry`, the rest of `material`, `castShadow`, `receiveShadow`, `transition`, `animate`) is shared by all
 * instances: the renderer takes the first copy's, and a row whose copies differ in one is `SUI-RUN-DRAW`
 */
export const INSTANCE_PROPERTIES = ['position', 'rotation', 'scale', 'visible', 'hidden', 'interactive', '_label'] as const;

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

/** True when two JSON values are equal, objects compared key by key whatever their order */
function sameValue(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        return a.every((item, index) => sameValue(item, b[index]));
    }
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
}

/** A property of a copy as it is shared: `material` without its `color` */
const sharedValue = (name: string, value: JsonValue | undefined): JsonValue | undefined => {
    if (name !== 'material' || !isObject(value)) return value;
    const { color: _color, ...rest } = value;
    return rest;
};

/**
 * The names of the shared properties (all but `INSTANCE_PROPERTIES` and `material.color`) whose values differ between
 * the copies of a repeat, in the order first found: `geometry`, `castShadow`, `material.opacity` and the like (a
 * `material` field is named with its field). Empty when every copy can be one instance of the same mesh. Pure
 */
export function mixedProperties(copies: readonly Scene3dTree[]): string[] {
    const first = copies[0];
    if (first === undefined) return [];
    const mixed = new Set<string>();
    const instanceOwn = INSTANCE_PROPERTIES as readonly string[];
    for (const copy of copies.slice(1)) {
        for (const name of new Set([...Object.keys(first.properties), ...Object.keys(copy.properties)])) {
            if (instanceOwn.includes(name)) continue;
            const a = sharedValue(name, first.properties[name]);
            const b = sharedValue(name, copy.properties[name]);
            if (sameValue(a, b)) continue;
            if (name === 'material' && (isObject(a) || isObject(b))) {
                const left = isObject(a) ? a : {};
                const right = isObject(b) ? b : {};
                for (const field of new Set([...Object.keys(left), ...Object.keys(right)])) {
                    if (!sameValue(left[field], right[field])) mixed.add(`material.${field}`);
                }
            } else {
                mixed.add(name);
            }
        }
    }
    return [...mixed];
}

/** One `repeat3d` of a scene and what its bind gave */
export interface BoundRepeat3d {
    /** The state path of the repeat */
    readonly path: string;
    readonly binding: RowBinding;
    /** The shared properties the copies differ in (`mixedProperties`) */
    readonly mixed: readonly string[];
}

/** What `expandRepeats3d` gives: the nodes with each repeat's copies as its `children`, and each repeat's binding */
export interface ExpandedScene3d {
    readonly nodes: readonly Scene3dTree[];
    readonly repeats: readonly BoundRepeat3d[];
}

export interface ExpandRepeats3dOptions {
    /** Reads one value by its state path, links followed (the store's `get`); the raw row template and the records come from it */
    read(statePath: string): JsonValue | undefined;
    /** The path with every store link followed (the store's `resolve`), so the watched paths name the data itself */
    resolve?(statePath: string): string;
    /** A cap other than `ROW_CAPS.webgl` (tests) */
    readonly cap?: number;
}

/** A copy the row binder made, as a 3D node (the template is a `mesh`, which has no children) */
const asNode = (copy: { kind: string; key: string; path: string; properties: Readonly<Record<string, JsonValue>> }): Scene3dTree => ({
    kind: copy.kind as Node3dKind,
    key: copy.key,
    path: copy.path,
    properties: copy.properties,
    children: []
});

/**
 * Binds every `repeat3d` of a 3D node tree (at the top or inside a `group3d`) with the row binder of the 2D repeats
 * (`createRowBinder`, G1.4b/G1.4c, without a node per record) and gives the tree with each repeat's copies as its
 * `children`, which the renderer draws as one instanced mesh. The template is the raw node `read(<repeat>.row)` gives
 * (a `$row` link is still a `<-key` there), the records `read(<repeat>.records)`, links followed; each copy is a `mesh`
 * at `<repeat>.rows.<recordKey>` keyed by its record key, with every property resolved (literals, `$row` links from
 * the record, other links from the store). The records are cut at `ROW_CAPS.webgl` (20,000). Each repeat's binding
 * is in `repeats`, for the feeder to watch `recordsPath` and `watch` and to report `cut`, `unknown`, `errors` and
 * `mixed`. Pure: the tree it is given is not changed
 */
export function expandRepeats3d(nodes: readonly Scene3dTree[], options: ExpandRepeats3dOptions): ExpandedScene3d {
    const repeats: BoundRepeat3d[] = [];
    const visit = (node: Scene3dTree): Scene3dTree => {
        if (node.kind === 'repeat3d') {
            const binder = createRowBinder(options.read(`${node.path}.row`), {
                path: node.path,
                renderer: REPEAT3D_RENDERER,
                component: 'repeat3d',
                cap: options.cap,
                read: options.read,
                resolve: options.resolve,
                isKind: (component) => (REPEAT3D_ROW_KINDS as readonly string[]).includes(component),
                properties: (kind: string) => (isNode3dKind(kind) ? NODE3D_PROPERTIES[kind] : [])
            });
            const binding = binder.bind(options.read(`${node.path}.records`));
            const copies = binding.copies.map(asNode);
            repeats.push({ path: node.path, binding, mixed: mixedProperties(copies) });
            return { ...node, children: copies };
        }
        if (node.kind !== 'group3d') return node;
        let changed = false;
        const children = node.children.map((child) => {
            const next = visit(child);
            if (next !== child) changed = true;
            return next;
        });
        return changed ? { ...node, children } : node;
    };
    return { nodes: nodes.map(visit), repeats };
}

/** What a `Repeat3dFeeder` is made with: how it reads the store, watches paths and reports */
export interface Repeat3dFeederOptions extends ExpandRepeats3dOptions {
    /** Starts watching store paths (the feeder redraws on a change there) */
    on(paths: string[]): void;
    /** Stops watching store paths */
    off(paths: string[]): void;
    /** Reports one error once (`report.error` with its code and path) */
    report(error: BuildError, path: string): void;
}

/**
 * Binds the `repeat3d`s of a scene's tree on every draw (`expandRepeats3d`) and keeps up what the `scene3d` component
 * needs around it: it watches each repeat's record path and the store paths its template reads (links to data outside
 * the scene), so a record change redraws, and reports each problem once: records over the cap (`SUI-RUN-CAP`, again
 * after they fell under it), a template node that is not a `mesh` (`SUI-RUN-3D`, not drawn), a template link the
 * document check refuses, and a shared property the copies differ in (`SUI-RUN-DRAW` naming the property: it is
 * known only once the rows are resolved, so it is not a validator error; the first copy's value is drawn)
 */
export class Repeat3dFeeder {
    private watched: string[] = [];
    private readonly reported = new Set<string>();
    private readonly cut = new Set<string>();

    constructor(private readonly options: Repeat3dFeederOptions) {}

    /** The tree with each repeat's copies, its watches and reports brought up to date */
    expand(nodes: readonly Scene3dTree[]): readonly Scene3dTree[] {
        const { nodes: expanded, repeats } = expandRepeats3d(nodes, this.options);
        const paths = new Set<string>();
        const stillCut = new Set<string>();
        for (const { path, binding, mixed } of repeats) {
            for (const watch of [binding.recordsPath, ...binding.watch]) paths.add(watch).add(`${watch}.$all`);
            for (const node of binding.unknown) {
                const what = node.component === '' ? 'it is not a node' : `component "${node.component}" is not a mesh`;
                const reason = `${what}, and a repeat3d draws only a mesh row, so it is not drawn`;
                this.once(`${node.path}\u0000${node.component}`, buildError('SUI-RUN-3D', { component: 'repeat3d', path: node.path, reason, statePath: node.path }), node.path);
            }
            for (const error of binding.errors) this.once(`${error.code}\u0000${error.message}`, error, error.statePath ?? path);
            for (const property of mixed) {
                const reason = `the row's "${property}" differs between records, but every instance of a repeat3d shares it, so the first record's is drawn for all`;
                this.once(`${path}\u0000mixed\u0000${property}`, buildError('SUI-RUN-DRAW', { path, reason, statePath: path }), path);
            }
            if (binding.cut === undefined) continue;
            stillCut.add(path);
            if (this.cut.has(path)) continue;
            this.cut.add(path);
            this.options.report(binding.cut.error, path);
        }
        for (const path of this.cut) if (!stillCut.has(path)) this.cut.delete(path);
        const next = [...paths];
        const added = next.filter((path) => !this.watched.includes(path));
        const removed = this.watched.filter((path) => !paths.has(path));
        if (removed.length > 0) this.options.off(removed);
        if (added.length > 0) this.options.on(added);
        this.watched = next;
        return expanded;
    }

    /** Stops every watch */
    dispose(): void {
        if (this.watched.length > 0) this.options.off(this.watched);
        this.watched = [];
    }

    private once(key: string, error: BuildError, path: string): void {
        if (this.reported.has(key)) return;
        this.reported.add(key);
        this.options.report(error, path);
    }
}
