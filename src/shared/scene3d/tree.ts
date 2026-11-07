import type { JsonObject, JsonValue } from '@punyts/stateui-app/core';

/**
 * The plain 3D node tree the renderer of `@punyts/stateui-3d` draws, and its API, declared here by structure: the
 * component library must not depend on that package at runtime (it is loaded as a second script, the runtime chunk),
 * and a type import would make its declarations a dependency of this package's published types. These types mirror
 * `src/tree.ts` and `src/scene3d.ts` of `@punyts/stateui-3d`; the browser test with the real chunk
 * (`test/composites/scene3d-chunk.browser.test.ts`) checks that they still fit.
 */

/** The 3D node components the renderer draws today, by component name (`repeat3d` and `label3d` come with G3.6, G3.6b) */
export const NODE3D_KINDS = ['camera', 'light', 'mesh', 'model', 'group3d'] as const;

export type Node3dKind = (typeof NODE3D_KINDS)[number];

/** True for the name of a 3D node component the renderer draws */
export const isNode3dKind = (name: unknown): name is Node3dKind => typeof name === 'string' && (NODE3D_KINDS as readonly string[]).includes(name);

/** One node of a 3D scene, as the renderer takes it (`Scene3dTree` of `@punyts/stateui-3d`) */
export interface Scene3dTree {
    readonly kind: Node3dKind;
    /** The key of the node in its parent's `children` map */
    readonly key: string;
    /** The state path of the node; it is also its id for `boundsOf` and `elementOf` of the scene */
    readonly path: string;
    /** The resolved properties of the node, links followed; the reserved keys and the node slots are not among them */
    readonly properties: Readonly<Record<string, JsonValue>>;
    /** The nodes of a `group3d`'s `children`, in the order of the map; empty for every other kind */
    readonly children: readonly Scene3dTree[];
}

/** The scene's own properties the renderer takes (`Scene3dSettings` of `@punyts/stateui-3d`) */
export interface Scene3dSettings {
    readonly background?: JsonValue;
    readonly ambient?: JsonValue;
    readonly environment?: JsonValue;
    readonly fog?: JsonValue;
}

/** Resolves a colour value (a literal or a token reference) to a CSS colour, or undefined (`ColorResolver`) */
export type ColorResolver = (value: JsonValue) => string | undefined;

/**
 * What a scene tells by itself (`Scene3dStatus` of `@punyts/stateui-3d`): `pending` for a frame it asked for (a resize,
 * a restored context), `lost` for a lost WebGL context, `failed` when it was not restored within 5 s
 */
export type Scene3dStatus = 'pending' | 'lost' | 'failed';

/** What a scene is made with (`Scene3dOptions` of `@punyts/stateui-3d`) */
export interface Scene3dOptions {
    readonly reducedMotion?: boolean;
    readonly resolveColor?: ColorResolver;
    readonly onStatus?: (status: Scene3dStatus) => void;
}

/** A drawn scene (`Scene3d` of `@punyts/stateui-3d`) */
export interface Scene3d {
    update(tree: readonly Scene3dTree[], settings?: Scene3dSettings): void;
    hit(x: number, y: number): Scene3dTree | undefined;
    boundsOf(path: string): { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] } | undefined;
    elementOf(path: string): Element | undefined;
    /** Resolves every colour again and draws (a theme or mode change) */
    restyle(): void;
    setReducedMotion(reduced: boolean): void;
    readonly reducedMotion: boolean;
    drawn(): Promise<void>;
    dispose(): void;
}

/** Makes a scene in a host element; throws a `Scene3dError` (`name` `Scene3dError`, `code` `no_webgl`) without WebGL */
export type CreateScene3d = (host: Element, options?: Scene3dOptions) => Scene3d;

/** True for the error `createScene3d` throws when it cannot draw, made in the chunk's realm, so known by its name */
export function isScene3dError(value: unknown): value is Error & { readonly code: string } {
    const error = value as { name?: unknown; code?: unknown } | null;
    return typeof error === 'object' && error !== null && error.name === 'Scene3dError' && typeof error.code === 'string';
}

/** A node of a scene whose component is not a 3D node the renderer draws; it is left out with everything below it */
export interface UnknownNode3d {
    readonly path: string;
    /** The component the node names, or an empty string when the value is not a node */
    readonly component: string;
}

/** What `readScene3dTree` gives: the nodes in the order of the tree and the nodes it left out */
export interface Scene3dTreeResult {
    readonly nodes: readonly Scene3dTree[];
    readonly unknown: readonly UnknownNode3d[];
}

export interface ReadScene3dTreeOptions {
    /**
     * Reads one property by its state path, links followed (the store's `get`). A linked property's value lives at its
     * target, so the `scene3d` component passes this; without it, or when it gives undefined, the node object's value is used
     */
    read?(statePath: string): JsonValue | undefined;
}

/** The properties of the shared 3D partials (`transform3d`, `interaction3d`, `motion3d`) every 3D node merges in, and the shared `hidden` */
const SHARED_PROPERTIES = ['position', 'rotation', 'scale', 'visible', 'interactive', '_label', 'transition', 'animate', 'hidden'] as const;

/**
 * The properties each 3D node declares (its own and the partials'), `children` left out. A test compares it with the
 * built catalog, so it follows the `state.json` files. A link the mount applied is a store alias the node object no
 * longer shows, so the reader reads each of these through the store
 */
export const NODE3D_PROPERTIES: Readonly<Record<Node3dKind, readonly string[]>> = (() => {
    const own: Record<Node3dKind, readonly string[]> = {
        camera: ['kind', 'target', 'fov', 'active'],
        light: ['kind', 'color', 'intensity', 'target', 'shadows'],
        mesh: ['geometry', 'material', 'castShadow', 'receiveShadow'],
        model: ['src', 'animation', 'playing'],
        group3d: []
    };
    const all = {} as Record<Node3dKind, readonly string[]>;
    for (const kind of NODE3D_KINDS) all[kind] = Object.freeze([...new Set([...SHARED_PROPERTIES, ...own[kind]])]);
    return Object.freeze(all);
})();

/** The keys of a node that are not properties (`RESERVED_KEYS` of `@punyts/stateui-app/core`) */
const RESERVED = new Set(['component', 'children', 'layout', 'placement', 'theme', 'on']);
const LINK_PREFIX = '<-';

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A copy of a value read from the store: the store may change an array or object it holds in place on a later write,
 * and the renderer compares the tree it was given with the next one, so the tree must not share them
 */
const copy = (value: JsonValue): JsonValue => (typeof value === 'object' && value !== null ? (JSON.parse(JSON.stringify(value)) as JsonValue) : value);

class TreeReader {
    readonly unknown: UnknownNode3d[] = [];

    constructor(private readonly options: ReadScene3dTreeOptions) {}

    readChildren(map: JsonValue | undefined, path: string): Scene3dTree[] {
        if (!isObject(map)) return [];
        const nodes: Scene3dTree[] = [];
        for (const [key, value] of Object.entries(map)) {
            const node = this.readNode(value, key, `${path}.${key}`);
            if (node !== undefined) nodes.push(node);
        }
        return nodes;
    }

    readNode(value: JsonValue | undefined, key: string, path: string): Scene3dTree | undefined {
        if (value === undefined || value === null) return undefined;
        const component = isObject(value) && typeof value.component === 'string' ? value.component : '';
        if (!isObject(value) || !isNode3dKind(component)) {
            this.unknown.push({ path, component });
            return undefined;
        }
        const properties: Record<string, JsonValue> = {};
        for (const [name, raw] of Object.entries(value)) {
            if (RESERVED.has(name) || name.startsWith(LINK_PREFIX)) continue;
            const read = this.options.read?.(`${path}.${name}`);
            properties[name] = copy(read === undefined ? raw : read);
        }
        // A linked property the node object lacks, in its `<-name` form or no form at all once the mount applied it
        const linked = Object.keys(value)
            .filter((name) => name.startsWith(LINK_PREFIX))
            .map((name) => name.slice(LINK_PREFIX.length));
        for (const property of new Set([...linked, ...NODE3D_PROPERTIES[component]])) {
            if (Object.hasOwn(properties, property) || RESERVED.has(property) || this.options.read === undefined) continue;
            const read = this.options.read(`${path}.${property}`);
            if (read !== undefined) properties[property] = copy(read);
        }
        return {
            kind: component,
            key,
            path,
            properties,
            children: component === 'group3d' ? this.readChildren(value.children, `${path}.children`) : []
        };
    }
}

/**
 * Reads the `children` map of a `scene3d` (`children` is the map's value as the store holds it, `path` its state path)
 * into the plain 3D node tree. A node whose component is not a 3D node the renderer draws is left out with its subtree
 * and listed in `unknown`, for the caller to report; an empty or null entry is skipped. Pure: it writes nothing
 */
export function readScene3dTree(children: JsonValue | undefined, path: string, options: ReadScene3dTreeOptions = {}): Scene3dTreeResult {
    const reader = new TreeReader(options);
    const nodes = reader.readChildren(children, path);
    return { nodes, unknown: reader.unknown };
}
