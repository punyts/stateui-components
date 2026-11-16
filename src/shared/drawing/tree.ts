import type { JsonObject, JsonValue } from '@punyts/stateui-app/core';

/** The 2D shape components a drawing draws, by component name */
export const SHAPE_KINDS = ['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'drawText', 'drawImage', 'drawGroup', 'drawRepeat'] as const;

export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** True for the name of a 2D shape component */
export const isShapeKind = (name: unknown): name is ShapeKind => typeof name === 'string' && (SHAPE_KINDS as readonly string[]).includes(name);

/**
 * One shape of a drawing, as the renderers take it: a plain object, never state. The `drawing` component reads it from
 * the store with `readShapeTree`; a feeder such as the chart adapter builds it itself.
 */
export interface ShapeTree {
    readonly kind: ShapeKind;
    /** The key of the shape in its parent's `children` map (`row` for a repeat's template, `clip` for a group's clip) */
    readonly key: string;
    /** The state path of the shape node; it is also the shape's id for `boundsOf` and `elementOf` of the renderer */
    readonly path: string;
    /** The resolved properties of the node, links followed; the reserved keys and the node slots are not among them */
    readonly properties: Readonly<Record<string, JsonValue>>;
    /**
     * The shapes of a `drawGroup`'s `children`, in the order of the map. For a `drawRepeat`, its copies in record order
     * once a feeder has bound them (`expandRepeats` of `rows.ts`; `readShapeTree` leaves them empty). Empty for every other kind
     */
    readonly children: readonly ShapeTree[];
    /** The row template of a `drawRepeat` */
    readonly row?: ShapeTree;
    /** The clip shape of a `drawGroup` */
    readonly clip?: ShapeTree;
    /**
     * Attributes the SVG renderer writes as given (`class`, `role`, `tabindex`, `aria-*`, `data-*` only, see
     * `isShapeAttr`); canvas writes only `role`, `tabindex` and `data-*` to the proxy of an interactive shape. No shape has such a property, so a node cannot set them: only a feeder can
     */
    readonly attrs?: Readonly<Record<string, string>>;
}

/** A node of a drawing whose component is not a 2D shape; it is left out of the tree with everything below it */
export interface UnknownShape {
    readonly path: string;
    /** The component the node names, or an empty string when the value is not a node */
    readonly component: string;
}

/** What `readShapeTree` gives: the shapes in drawing order and the nodes it left out */
export interface ShapeTreeResult {
    readonly shapes: readonly ShapeTree[];
    readonly unknown: readonly UnknownShape[];
}

export interface ReadShapeTreeOptions {
    /**
     * Reads one property by its state path, links followed (the store's `get`). A linked property's value lives at its
     * target, not in the node object, so the `drawing` component passes this; without it, or when it gives undefined,
     * the value in the node object is used
     */
    read?(statePath: string): JsonValue | undefined;
    /**
     * The properties a shape kind declares (`shapeProperties`). A link the mount applied is a store alias that the node
     * object no longer shows (neither `<-key` nor `key`), so with this and `read` each declared property the node object
     * lacks is read through `read`, and kept when it has a value
     */
    properties?(kind: ShapeKind): readonly string[];
}

/** The properties of the shared partials (`src/shared/shape/`) every 2D shape merges in, and the shared `hidden` */
const SHARED_PROPERTIES = [
    'fill',
    'stroke',
    'strokeWidth',
    'opacity',
    'dash',
    'cap',
    'join',
    'x',
    'y',
    'rotate',
    'scale',
    'origin',
    'interactive',
    '_label',
    'draggable',
    'bounds',
    'step',
    'transition',
    'animate',
    'hidden'
] as const;

/**
 * The properties each 2D shape declares (its own and the partials'), node slots (`clip`, `row`) left out. A test
 * compares it with the built catalog, so it follows the `state.json` files
 */
export const SHAPE_PROPERTIES: Readonly<Record<ShapeKind, readonly string[]>> = (() => {
    const own: Record<ShapeKind, readonly string[]> = {
        rect: ['width', 'height', 'radius'],
        circle: ['cx', 'cy', 'r'],
        ellipse: ['cx', 'cy', 'rx', 'ry'],
        line: ['points'],
        polyline: ['points'],
        polygon: ['points'],
        path: ['d'],
        drawText: ['_text', 'anchor', 'baseline', 'font', 'fontSize'],
        drawImage: ['src', 'width', 'height', 'fit'],
        drawGroup: [],
        drawRepeat: ['records']
    };
    const all = {} as Record<ShapeKind, readonly string[]>;
    for (const kind of SHAPE_KINDS) all[kind] = Object.freeze([...SHARED_PROPERTIES, ...own[kind]]);
    return Object.freeze(all);
})();

/** The properties a 2D shape declares; the `properties` option of `readShapeTree` (and of the row binder) */
export const shapeProperties = (kind: ShapeKind): readonly string[] => SHAPE_PROPERTIES[kind];

/** The keys of a node that are not shape properties (`RESERVED_KEYS` of `@punyts/stateui-app/core`) */
const RESERVED = new Set(['component', 'children', 'layout', 'placement', 'theme', 'on']);
/** The node-valued properties a shape reads as shapes; any other key is a property */
const NODE_SLOTS: Readonly<Partial<Record<ShapeKind, readonly string[]>>> = { drawGroup: ['clip'], drawRepeat: ['row'] };
const LINK_PREFIX = '<-';
const ATTR_NAME = /^(class|role|tabindex|aria-[a-z][a-z0-9-]*|data-[a-z][a-z0-9-]*)$/;

/** True for an attribute name a feeder may give in `attrs`: `class`, `role`, `tabindex`, `aria-*` and `data-*` */
export const isShapeAttr = (name: string): boolean => ATTR_NAME.test(name);

/** The entries of `attrs` whose names `isShapeAttr` allows; the renderers write only these */
export function shapeAttrs(attrs: Readonly<Record<string, string>> | undefined): Record<string, string> {
    const result: Record<string, string> = {};
    if (attrs === undefined) return result;
    for (const [name, value] of Object.entries(attrs)) {
        if (isShapeAttr(name) && typeof value === 'string') result[name] = value;
    }
    return result;
}

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

class TreeReader {
    readonly unknown: UnknownShape[] = [];

    constructor(private readonly options: ReadShapeTreeOptions) {}

    /** The shapes of a `children` map at `path` (the map's own path), in the map's order */
    readChildren(map: JsonValue | undefined, path: string): ShapeTree[] {
        if (!isObject(map)) return [];
        const shapes: ShapeTree[] = [];
        for (const [key, value] of Object.entries(map)) {
            const shape = this.readShape(value, key, `${path}.${key}`);
            if (shape !== undefined) shapes.push(shape);
        }
        return shapes;
    }

    readShape(value: JsonValue | undefined, key: string, path: string): ShapeTree | undefined {
        if (value === undefined || value === null) return undefined;
        const component = isObject(value) && typeof value.component === 'string' ? value.component : '';
        if (!isObject(value) || !isShapeKind(component)) {
            this.unknown.push({ path, component });
            return undefined;
        }
        const slots = NODE_SLOTS[component] ?? [];
        const properties: Record<string, JsonValue> = {};
        for (const [name, raw] of Object.entries(value)) {
            if (RESERVED.has(name) || name.startsWith(LINK_PREFIX) || slots.includes(name)) continue;
            const read = this.options.read?.(`${path}.${name}`);
            properties[name] = read === undefined ? raw : read;
        }
        // A linked property the node object lacks (no default) is still read from its target
        for (const name of Object.keys(value)) {
            if (!name.startsWith(LINK_PREFIX)) continue;
            const property = name.slice(LINK_PREFIX.length);
            if (Object.hasOwn(properties, property) || RESERVED.has(property) || slots.includes(property)) continue;
            const read = this.options.read?.(`${path}.${property}`);
            if (read !== undefined) properties[property] = read;
        }
        // A link the mount applied shows in neither form: each declared property the node lacks is read from the store
        if (this.options.read !== undefined && this.options.properties !== undefined) {
            for (const property of this.options.properties(component)) {
                if (Object.hasOwn(properties, property) || Object.hasOwn(value, property) || slots.includes(property)) continue;
                const read = this.options.read(`${path}.${property}`);
                if (read !== undefined) properties[property] = read;
            }
        }
        const shape: { -readonly [K in keyof ShapeTree]: ShapeTree[K] } = {
            kind: component,
            key,
            path,
            properties,
            children: component === 'drawGroup' ? this.readChildren(value.children, `${path}.children`) : []
        };
        for (const slot of slots) {
            const node = this.readShape(value[slot], slot, `${path}.${slot}`);
            if (node === undefined) continue;
            if (slot === 'row') shape.row = node;
            else shape.clip = node;
        }
        return shape;
    }
}

/**
 * Reads the `children` map of a drawing (`children` is the map's value as the store holds it, `path` its state path,
 * `$.app.….children`) into the plain shape tree. A node whose component is not a 2D shape is left out with its subtree
 * and listed in `unknown`, for the caller to report; an empty or null entry is skipped. Pure: it writes nothing
 */
export function readShapeTree(children: JsonValue | undefined, path: string, options: ReadShapeTreeOptions = {}): ShapeTreeResult {
    const reader = new TreeReader(options);
    const shapes = reader.readChildren(children, path);
    return { shapes, unknown: reader.unknown };
}

/** The shape at a state path, with its ancestors from the top (the shape last); undefined when no shape has the path */
export function locateShape(shapes: readonly ShapeTree[], path: string): ShapeTree[] | undefined {
    for (const shape of shapes) {
        if (shape.path === path) return [shape];
        if (!path.startsWith(`${shape.path}.`)) continue;
        const inner = [...shape.children, ...(shape.row ? [shape.row] : []), ...(shape.clip ? [shape.clip] : [])];
        const found = locateShape(inner, path);
        if (found !== undefined) return [shape, ...found];
    }
    return undefined;
}
