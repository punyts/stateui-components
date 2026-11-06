import { buildError, extractLinks, recordKeys } from '@punyts/stateui-app/core';
import type { BuildError, JsonObject, JsonValue, Link, Node, ReferenceOptions } from '@punyts/stateui-app/core';
import type { RendererKind } from './render.js';
import { isShapeKind } from './tree.js';
import type { ShapeKind, ShapeTree, UnknownShape } from './tree.js';

/** The most records a `drawRepeat` draws per renderer; more is `SUI-RUN-CAP` and the first ones are drawn */
export const ROW_CAPS: Readonly<Record<RendererKind, number>> = { svg: 2000, canvas: 20000 };

/** The cap of a renderer (`ROW_CAPS`) */
export const rowCap = (renderer: RendererKind): number => ROW_CAPS[renderer];

/** What a row binder is made with */
export interface RowBinderOptions extends ReferenceOptions {
    /** The state path of the `drawRepeat` node; the template is at `<path>.row` and the copies at `<path>.rows.<recordKey>` */
    readonly path: string;
    /** The renderer that draws the copies, for its cap (`ROW_CAPS`) and the `SUI-RUN-CAP` text */
    readonly renderer: RendererKind;
    /** A cap other than the renderer's own (3D, tests) */
    readonly cap?: number;
    /**
     * The store path of the records, for `targetOf`; `<path>.records` when absent. Passed through `resolve` once, so a
     * `records` linked to `$.data.seats` gives record paths under `$.data.seats`
     */
    readonly recordsPath?: string;
    /**
     * Reads one value by its state path, links followed (the store's `get`). A property of the template that is not a
     * `$row` link is read through it at `<template path>.<name>`, so a link the mount applied is followed; a `<-` link to
     * another target is read at its target. Without it, or when it gives undefined, the value written in the template is used
     */
    read?(statePath: string): JsonValue | undefined;
    /** The path with every store link followed (the store's `resolve`), so `watch` and the record paths name the data itself */
    resolve?(statePath: string): string;
    /**
     * The property names a shape kind declares (its catalog shape). A link the mount applied to the template is a store
     * alias that the node object does not show, so with this and `resolve` each declared property the template neither
     * writes nor links is tried: one that resolves elsewhere is read through `read` and its target is watched
     */
    properties?(kind: ShapeKind): readonly string[];
}

/** What `bind` gives when the records are over the cap; the feeder reports it once with `report.error` */
export interface RowCut {
    readonly code: 'SUI-RUN-CAP';
    /** The state path of the repeat */
    readonly path: string;
    readonly total: number;
    readonly cap: number;
    readonly renderer: RendererKind;
    /** The `SUI-RUN-CAP` error, its message filled in */
    readonly error: BuildError;
}

/** The copies of one bind and what the feeder needs to follow them */
export interface RowBinding {
    /** One copy of the template per record, in record order, at most the cap */
    readonly copies: readonly ShapeTree[];
    /** Set when the records were over the cap */
    readonly cut?: RowCut;
    /** The store path of the records the copies' `targetOf` paths sit under */
    readonly recordsPath: string;
    /**
     * The store paths the template reads that are not records: the targets of its links other than `$row`, resolved,
     * and the targets of the properties the mount linked. A change there changes every copy
     */
    readonly watch: readonly string[];
    /** The nodes of the template whose component is not a 2D shape, left out with their subtree */
    readonly unknown: readonly UnknownShape[];
    /** Links of the template with a target the document check refuses (`SUI-LINK-TARGET` and the like), left out */
    readonly errors: readonly BuildError[];
}

/** A row template read once and bound to any number of record sets */
export interface RowBinder {
    /** The copies for a record set (an array or a keyed map; anything else is no records), at most the cap */
    bind(records: JsonValue | undefined): RowBinding;
    /**
     * The copy for one record, for a feeder that follows a single record's change: `key` its record key (`recordKeys`)
     * and `recordKey` its key in the records (the array index for an array). Undefined when the template is not a shape
     */
    copy(key: string, record: JsonValue | undefined, recordKey?: string): ShapeTree | undefined;
}

/** A shape of the template, compiled once */
interface Compiled {
    readonly kind: ShapeKind;
    readonly key: string;
    /** The path below the template root (`''` for the root, `.children.dot` for a group's child) */
    readonly suffix: string;
    /** The properties as written, links taken out */
    readonly written: Readonly<Record<string, JsonValue>>;
    /** The properties a `$row` link sets: the field path below the record (empty for `$row` itself) */
    readonly rowFields: ReadonlyMap<string, readonly string[]>;
    /** The properties another link sets, with its target */
    readonly storeLinks: ReadonlyMap<string, string>;
    readonly children: readonly Compiled[];
    readonly row?: Compiled;
    readonly clip?: Compiled;
}

/** The properties of each compiled shape at one bind, by suffix: the written and store-linked values */
type BaseValues = Map<string, Record<string, JsonValue>>;

const RESERVED = new Set(['component', 'children', 'layout', 'placement', 'theme', 'on']);
const NODE_SLOTS: Readonly<Partial<Record<ShapeKind, readonly string[]>>> = { drawGroup: ['clip'], drawRepeat: ['row'] };
const ROW = '$row';

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Where each copy's properties came from: property name to record path */
const targets = new WeakMap<ShapeTree, Readonly<Record<string, string>>>();

/**
 * The record path a copy's property was taken from (`$.data.seats.s1.x` for `"<-x": "$row.x"`), which a drag of the
 * copy writes to; undefined for a literal, a property linked to anything but `$row`, and a shape that is not a copy.
 * A field the record lacks still has its path, so a write there adds it
 */
export function targetOf(copy: ShapeTree, property: string): string | undefined {
    const known = targets.get(copy);
    return known !== undefined && Object.hasOwn(known, property) ? known[property] : undefined;
}

/**
 * The keys of a record set in order, each with the key the record has in the set: an array by distinct `id` (a path
 * segment), else by index; a map by its own keys. It is `recordKeys` of `@punyts/stateui-app/core`, which the
 * dispatcher also uses to find the record of a copy's event (G1.7), so the two always agree
 */
export { recordKeys };

/** The value at a field path below a record; undefined where a step is missing */
function fieldOf(record: JsonValue | undefined, field: readonly string[]): JsonValue | undefined {
    let value = record;
    for (const segment of field) {
        if (Array.isArray(value)) value = /^\d+$/.test(segment) ? value[Number(segment)] : undefined;
        else if (isObject(value)) value = Object.hasOwn(value, segment) ? value[segment] : undefined;
        else return undefined;
    }
    return value;
}

class TemplateCompiler {
    readonly unknown: UnknownShape[] = [];

    constructor(
        private readonly rowPath: string,
        private readonly links: ReadonlyMap<string, readonly Link[]>
    ) {}

    compile(value: JsonValue | undefined, key: string, suffix: string): Compiled | undefined {
        if (value === undefined || value === null) return undefined;
        const component = isObject(value) && typeof value.component === 'string' ? value.component : '';
        if (!isObject(value) || !isShapeKind(component)) {
            this.unknown.push({ path: `${this.rowPath}${suffix}`, component });
            return undefined;
        }
        const slots = NODE_SLOTS[component] ?? [];
        const written: Record<string, JsonValue> = {};
        for (const [name, raw] of Object.entries(value)) {
            if (!RESERVED.has(name) && !slots.includes(name)) written[name] = raw;
        }
        const rowFields = new Map<string, readonly string[]>();
        const storeLinks = new Map<string, string>();
        for (const link of this.links.get(`${this.rowPath}${suffix}`) ?? []) {
            if (RESERVED.has(link.key) || slots.includes(link.key)) continue;
            if (link.target === ROW || link.target.startsWith(`${ROW}.`)) {
                rowFields.set(link.key, link.target.split('.').slice(1));
            } else {
                storeLinks.set(link.key, link.target);
            }
            // A link wins over a value written beside it
            delete written[link.key];
        }
        const children: Compiled[] = [];
        if (component === 'drawGroup' && isObject(value.children)) {
            for (const [childKey, child] of Object.entries(value.children)) {
                const compiled = this.compile(child, childKey, `${suffix}.children.${childKey}`);
                if (compiled !== undefined) children.push(compiled);
            }
        }
        const shape: { -readonly [K in keyof Compiled]: Compiled[K] } = { kind: component, key, suffix, written, rowFields, storeLinks, children };
        for (const slot of slots) {
            const compiled = this.compile(value[slot], slot, `${suffix}.${slot}`);
            if (compiled === undefined) continue;
            if (slot === 'row') shape.row = compiled;
            else shape.clip = compiled;
        }
        return shape;
    }
}

/**
 * Reads a `drawRepeat`'s row template once (`row`, the node as the store holds it at `<path>.row`: a `$row` link is
 * kept there as `<-key`, the mount having applied the others) and binds it to record sets without a node per record.
 * Each copy is the template's shape tree with every property resolved: a value as written (read through `read`, so a
 * link the mount applied is followed); a `<-prop` link to `$row…` from the record (a missing field leaves the property
 * unset, so the shape's default applies); a link to any other target from the store, read once per bind and listed in
 * `watch`. Node references (`^name.path`) resolve when `library` and `owner` are given, as for a record view's row.
 *
 * The copy of the record with key `k` has the path `<path>.rows.<k>`, its inner shapes `<path>.rows.<k>.children.…`,
 * and `targetOf(copy, prop)` gives the record path of each property a `$row` link set. Pure: it never writes to the
 * store, creates no node and no link
 */
export function createRowBinder(row: JsonValue | undefined, options: RowBinderOptions): RowBinder {
    const { path, renderer, read, resolve } = options;
    const cap = options.cap ?? rowCap(renderer);
    const rowPath = `${path}.row`;
    const rowsPath = `${path}.rows`;
    const recordsPath = resolve ? resolve(options.recordsPath ?? `${path}.records`) : (options.recordsPath ?? `${path}.records`);

    const { library, instances, owner } = options;
    const extracted = isObject(row) ? extractLinks(row as unknown as Node, { path: rowPath, library, instances, owner }) : undefined;
    const byPath = new Map<string, Link[]>();
    for (const link of extracted?.links ?? []) {
        const list = byPath.get(link.statePath) ?? [];
        list.push(link);
        byPath.set(link.statePath, list);
    }
    const compiler = new TemplateCompiler(rowPath, byPath);
    const template = compiler.compile(extracted ? (extracted.tree as unknown as JsonValue) : row, 'row', '');
    const unknown = compiler.unknown;
    const errors = extracted?.errors ?? [];

    /** The values of every shape that do not depend on the record, and the store paths they come from */
    const readBase = (): { base: BaseValues; watch: string[] } => {
        const base: BaseValues = new Map();
        const watch = new Set<string>();
        const visit = (shape: Compiled): void => {
            const values: Record<string, JsonValue> = {};
            const at = `${rowPath}${shape.suffix}`;
            for (const [name, raw] of Object.entries(shape.written)) {
                const statePath = `${at}.${name}`;
                const value = read?.(statePath);
                values[name] = value === undefined ? raw : value;
                const target = resolve?.(statePath);
                if (target !== undefined && target !== statePath) watch.add(target);
            }
            for (const [name, target] of shape.storeLinks) {
                const value = read?.(target);
                if (value !== undefined) values[name] = value;
                watch.add(resolve ? resolve(target) : target);
            }
            if (resolve !== undefined && options.properties !== undefined) {
                for (const name of options.properties(shape.kind)) {
                    if (Object.hasOwn(shape.written, name) || shape.rowFields.has(name) || shape.storeLinks.has(name)) continue;
                    const statePath = `${at}.${name}`;
                    const target = resolve(statePath);
                    if (target === statePath) continue;
                    watch.add(target);
                    const value = read?.(statePath);
                    if (value !== undefined) values[name] = value;
                }
            }
            base.set(shape.suffix, values);
            for (const child of shape.children) visit(child);
            if (shape.row) visit(shape.row);
            if (shape.clip) visit(shape.clip);
        };
        if (template !== undefined) visit(template);
        return { base, watch: [...watch] };
    };

    const build = (shape: Compiled, base: BaseValues, key: string, record: JsonValue | undefined, recordPath: string): ShapeTree => {
        const properties: Record<string, JsonValue> = { ...base.get(shape.suffix) };
        const from: Record<string, string> = {};
        for (const [name, field] of shape.rowFields) {
            const value = fieldOf(record, field);
            if (value === undefined) delete properties[name];
            else properties[name] = value;
            from[name] = field.length === 0 ? recordPath : `${recordPath}.${field.join('.')}`;
        }
        const copyPath = `${rowsPath}.${key}${shape.suffix}`;
        const tree: { -readonly [K in keyof ShapeTree]: ShapeTree[K] } = {
            kind: shape.kind,
            key: shape.suffix === '' ? key : shape.key,
            path: copyPath,
            properties,
            children: shape.children.map((child) => build(child, base, key, record, recordPath))
        };
        if (shape.row) tree.row = build(shape.row, base, key, record, recordPath);
        if (shape.clip) tree.clip = build(shape.clip, base, key, record, recordPath);
        if (shape.rowFields.size > 0) targets.set(tree, from);
        return tree;
    };

    return {
        bind(records) {
            const { base, watch } = readBase();
            const keys = template === undefined ? [] : recordKeys(records);
            const copies: ShapeTree[] = [];
            const count = Math.min(keys.length, cap);
            for (let i = 0; i < count; i++) {
                const { key, recordKey } = keys[i] as { key: string; recordKey: string };
                const record = Array.isArray(records) ? records[Number(recordKey)] : isObject(records) ? records[recordKey] : undefined;
                copies.push(build(template as Compiled, base, key, record, `${recordsPath}.${recordKey}`));
            }
            const binding: { -readonly [K in keyof RowBinding]: RowBinding[K] } = { copies, recordsPath, watch, unknown, errors };
            if (keys.length > cap) {
                const total = keys.length;
                const error = buildError('SUI-RUN-CAP', { component: 'drawRepeat', path, actual: total, limit: cap, name: renderer, statePath: path });
                binding.cut = { code: 'SUI-RUN-CAP', path, total, cap, renderer, error };
            }
            return binding;
        },
        copy(key, record, recordKey = key) {
            if (template === undefined) return undefined;
            return build(template, readBase().base, key, record, `${recordsPath}.${recordKey}`);
        }
    };
}

/** What `expandRepeats` is made with: the binder options every repeat of a tree shares */
export interface ExpandRepeatsOptions extends Omit<RowBinderOptions, 'path' | 'recordsPath' | 'read'> {
    /** Reads one value by its state path, links followed (the store's `get`); the raw row template and the records come from it */
    read(statePath: string): JsonValue | undefined;
}

/** One `drawRepeat` of a tree and what its bind gave */
export interface BoundRepeat {
    /** The state path of the repeat */
    readonly path: string;
    readonly binding: RowBinding;
}

/** What `expandRepeats` gives: the tree with each repeat's copies, and the binding of each repeat */
export interface ExpandedTree {
    readonly shapes: readonly ShapeTree[];
    readonly repeats: readonly BoundRepeat[];
}

/**
 * Binds every `drawRepeat` of a shape tree (at the top or inside groups) and gives the tree with each repeat's copies
 * as its `children`, which the renderers draw (SVG one group per copy, canvas each copy directly). The template is the
 * raw node `read(<repeat>.row)` gives (where a `$row` link is still a `<-key`; the repeat's `row` in the tree has lost
 * it) and the records are `read(<repeat>.records)`, links followed. Each repeat's binding is in `repeats`, for the
 * feeder to watch `recordsPath` and `watch`, and to report `cut`, `unknown` and `errors`. A repeat inside a row
 * template is not bound. Pure: the tree it is given is not changed
 */
export function expandRepeats(shapes: readonly ShapeTree[], options: ExpandRepeatsOptions): ExpandedTree {
    const repeats: BoundRepeat[] = [];
    const visit = (shape: ShapeTree): ShapeTree => {
        if (shape.kind === 'drawRepeat') {
            const binder = createRowBinder(options.read(`${shape.path}.row`), { ...options, path: shape.path });
            const binding = binder.bind(options.read(`${shape.path}.records`));
            repeats.push({ path: shape.path, binding });
            return { ...shape, children: binding.copies };
        }
        if (shape.kind !== 'drawGroup') return shape;
        let changed = false;
        const children = shape.children.map((child) => {
            const next = visit(child);
            if (next !== child) changed = true;
            return next;
        });
        return changed ? { ...shape, children } : shape;
    };
    const expanded = shapes.map(visit);
    return { shapes: expanded, repeats };
}

/** Binds a row template to one record set: `createRowBinder(row, options).bind(records)` */
export function bindRows(row: JsonValue | undefined, records: JsonValue | undefined, options: RowBinderOptions): RowBinding {
    return createRowBinder(row, options).bind(records);
}
