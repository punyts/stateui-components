import { MAX_EDIT_FACES, MAX_EDIT_VERTICES, MAX_FACE_SIDES } from '@punyts/stateui-app/core';
import type { JsonValue } from '@punyts/stateui-app/core';

/**
 * The mesh editor's operations (docs/design/stateui-mesh-editor.md, V4): pure code over a custom geometry's `vertices`
 * and `faces` and a mesh's pick. No DOM, no three.js and no store, so the same code runs in a page and in Node; the
 * `scene3d` controller runs one per changed `editRequest` and writes what it gives back.
 */

export type Vec3 = [number, number, number];

/** A custom geometry's shape: vertices and faces of vertex indices, counter-clockwise seen from the side they look to */
export interface Poly {
    readonly vertices: readonly Vec3[];
    readonly faces: readonly (readonly number[])[];
}

/** The operations `editRequest.op` names; `undo` and `redo` are the scene's history, not run here */
export const MESH_OPERATIONS = ['extrude', 'inset', 'delete', 'merge', 'fill', 'flip', 'subdivide', 'undo', 'redo'] as const;
export type MeshOperation = (typeof MESH_OPERATIONS)[number];

/** The edit modes of `edit.mode` */
export const EDIT_MODES = ['none', 'vertex', 'edge', 'face'] as const;
export type EditMode = (typeof EDIT_MODES)[number];

/** How far an extrude moves the faces when the request sets no `amount`, in scene units */
export const DEFAULT_EXTRUDE = 0.2;
/** How far an inset goes towards each face's centre when the request sets no `amount`, 0 to 1 */
export const DEFAULT_INSET = 0.2;
/** The decimals a written number keeps */
const DECIMALS = 4;

/** What an operation made: the whole geometry and the new pick, or why it made nothing */
export type OperationResult =
    | { readonly ok: true; readonly geometry: Poly; readonly picked: JsonValue[] }
    | { readonly ok: false; readonly reason: string };

/** An operation's request: its name and optional amount */
export interface OperationRequest {
    readonly op: Exclude<MeshOperation, 'undo' | 'redo'>;
    readonly amount?: number;
}

const round = (value: number): number => {
    const rounded = Math.round(value * 10 ** DECIMALS) / 10 ** DECIMALS;
    return Object.is(rounded, -0) ? 0 : rounded;
};
const roundVec = (v: Vec3): Vec3 => [round(v[0]), round(v[1]), round(v[2])];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const average = (points: readonly Vec3[]): Vec3 => scale(points.reduce<Vec3>((sum, point) => add(sum, point), [0, 0, 0]), 1 / points.length);
const edgeKey = (a: number, b: number): string => (a < b ? `${a},${b}` : `${b},${a}`);

const isVec3 = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n));

/**
 * The shape of a custom geometry value, or undefined when it is not one the operations can take: a vertex that is not
 * three finite numbers, a face of fewer than 3 or more than 32 indices, an index out of range or repeated, or a count
 * past the limits (what the `polyMesh` validator refuses)
 */
export function readPoly(geometry: unknown): Poly | undefined {
    if (typeof geometry !== 'object' || geometry === null || Array.isArray(geometry)) return undefined;
    const { kind, vertices, faces } = geometry as Record<string, unknown>;
    if (kind !== 'custom' || !Array.isArray(vertices) || !Array.isArray(faces)) return undefined;
    if (vertices.length > MAX_EDIT_VERTICES || faces.length > MAX_EDIT_FACES || !vertices.every(isVec3)) return undefined;
    for (const face of faces) {
        if (!Array.isArray(face) || face.length < 3 || face.length > MAX_FACE_SIDES) return undefined;
        if (!face.every((index) => Number.isInteger(index) && index >= 0 && index < vertices.length)) return undefined;
        if (new Set(face).size !== face.length) return undefined;
    }
    return { vertices: vertices.map((v) => [...v] as Vec3), faces: (faces as number[][]).map((face) => [...face]) };
}

/** The picked vertex or face indices that are in range, in pick order and once each */
function pickedIndices(picked: unknown, count: number): number[] {
    if (!Array.isArray(picked)) return [];
    return [...new Set(picked.filter((index): index is number => Number.isInteger(index) && index >= 0 && index < count))];
}

/** The picked edges, as `[a, b]` pairs of vertices in range, once each */
function pickedEdges(picked: unknown, count: number): Array<[number, number]> {
    if (!Array.isArray(picked)) return [];
    const seen = new Map<string, [number, number]>();
    for (const edge of picked) {
        if (!Array.isArray(edge) || edge.length !== 2) continue;
        const [a, b] = edge as unknown[];
        if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) continue;
        const [x, y] = [a as number, b as number];
        if (x < 0 || y < 0 || x >= count || y >= count) continue;
        seen.set(edgeKey(x, y), x < y ? [x, y] : [y, x]);
    }
    return [...seen.values()];
}

/** The normal of a face by Newell's method, not normalised; zero for a face with no area */
function faceNormal(vertices: readonly Vec3[], face: readonly number[]): Vec3 {
    const normal: Vec3 = [0, 0, 0];
    for (let i = 0; i < face.length; i += 1) {
        const a = vertices[face[i] as number] as Vec3;
        const b = vertices[face[(i + 1) % face.length] as number] as Vec3;
        normal[0] += (a[1] - b[1]) * (a[2] + b[2]);
        normal[1] += (a[2] - b[2]) * (a[0] + b[0]);
        normal[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    return normal;
}

/**
 * The geometry without the vertices no face uses, the faces' indices renumbered; `keep` are vertices kept although no
 * face uses them (a merged vertex, a picked one), and `map` gives each kept old index its new one
 */
function compact(vertices: readonly Vec3[], faces: readonly (readonly number[])[], keep: Iterable<number> = []): { poly: Poly; map: Map<number, number> } {
    const used = new Set<number>(keep);
    for (const face of faces) for (const index of face) used.add(index);
    const map = new Map<number, number>();
    const kept: Vec3[] = [];
    vertices.forEach((vertex, index) => {
        if (!used.has(index)) return;
        map.set(index, kept.length);
        kept.push(vertex);
    });
    return { poly: { vertices: kept, faces: faces.map((face) => face.map((index) => map.get(index) as number)) }, map };
}

/** The vertices no face of a geometry uses: an operation keeps them, and drops only those it left unused */
function loose(poly: Poly): number[] {
    const used = new Set(poly.faces.flat());
    return poly.vertices.map((_v, index) => index).filter((index) => !used.has(index));
}

/** The result of an operation, its numbers rounded, or a refusal when it passes the limits */
function made(poly: Poly, picked: JsonValue[]): OperationResult {
    if (poly.vertices.length > MAX_EDIT_VERTICES || poly.faces.length > MAX_EDIT_FACES) return { ok: false, reason: 'the result would pass the limits' };
    return { ok: true, geometry: { vertices: poly.vertices.map(roundVec), faces: poly.faces.map((face) => [...face]) }, picked };
}

/** The modes each operation takes; the rest are refused */
const MODES_OF: Readonly<Record<OperationRequest['op'], readonly EditMode[]>> = {
    extrude: ['face'],
    inset: ['face'],
    delete: ['vertex', 'edge', 'face'],
    merge: ['vertex'],
    fill: ['vertex'],
    flip: ['face'],
    subdivide: EDIT_MODES
};

/**
 * Runs one operation on a geometry and its pick, in the mesh's `edit.mode`. An operation that does not fit the mode or
 * the pick (an `extrude` of vertices, a `fill` of two) makes nothing and says why
 */
export function runOperation(poly: Poly, mode: EditMode, picked: unknown, request: OperationRequest): OperationResult {
    if (!MODES_OF[request.op].includes(mode)) return { ok: false, reason: `${request.op} does not work in ${mode} mode` };
    switch (request.op) {
        case 'extrude':
            return extrude(poly, pickedIndices(picked, poly.faces.length), request.amount ?? DEFAULT_EXTRUDE);
        case 'inset':
            return inset(poly, pickedIndices(picked, poly.faces.length), request.amount ?? DEFAULT_INSET);
        case 'delete':
            return remove(poly, mode, picked);
        case 'merge':
            return merge(poly, pickedIndices(picked, poly.vertices.length));
        case 'fill':
            return fill(poly, pickedIndices(picked, poly.vertices.length), picked);
        case 'flip':
            return flip(poly, pickedIndices(picked, poly.faces.length), picked);
        case 'subdivide':
            return subdivide(poly);
    }
}

/**
 * Moves the picked faces out by `amount` along their average normal and joins them to where they were with a side face
 * for each edge of the picked region's rim. The moved faces keep their places and stay picked; the sides come last
 */
export function extrude(poly: Poly, faces: readonly number[], amount: number): OperationResult {
    if (faces.length === 0) return { ok: false, reason: 'extrude needs picked faces' };
    if (!Number.isFinite(amount) || amount === 0) return { ok: false, reason: 'extrude needs an amount other than 0' };
    const normal = faces.reduce<Vec3>((sum, index) => {
        const n = faceNormal(poly.vertices, poly.faces[index] as number[]);
        const length = Math.hypot(...n);
        return length === 0 ? sum : add(sum, scale(n, 1 / length));
    }, [0, 0, 0]);
    const length = Math.hypot(...normal);
    if (length === 0) return { ok: false, reason: 'the picked faces look no one way' };
    const offset = scale(normal, amount / length);
    const vertices = [...poly.vertices];
    const moved = new Map<number, number>();
    const movedOf = (index: number): number => {
        let to = moved.get(index);
        if (to === undefined) {
            to = vertices.length;
            vertices.push(add(poly.vertices[index] as Vec3, offset));
            moved.set(index, to);
        }
        return to;
    };
    // The rim: the picked faces' edges that no other picked face shares, in the direction their face goes round
    const directed = new Set<string>();
    for (const index of faces) {
        const face = poly.faces[index] as number[];
        face.forEach((a, i) => directed.add(`${a}>${face[(i + 1) % face.length]}`));
    }
    const out = poly.faces.map((face) => [...face]);
    const sides: number[][] = [];
    for (const index of faces) {
        const face = poly.faces[index] as number[];
        face.forEach((a, i) => {
            const b = face[(i + 1) % face.length] as number;
            if (!directed.has(`${b}>${a}`)) sides.push([a, b, movedOf(b), movedOf(a)]);
        });
        out[index] = face.map(movedOf);
    }
    return made(compact(vertices, [...out, ...sides], loose(poly)).poly, [...faces]);
}

/**
 * Makes a smaller copy of each picked face, `amount` of the way to its centre, in the face's place, and a ring of faces
 * between it and the face's edges after the other faces. The inner faces stay picked
 */
export function inset(poly: Poly, faces: readonly number[], amount: number): OperationResult {
    if (faces.length === 0) return { ok: false, reason: 'inset needs picked faces' };
    if (!Number.isFinite(amount) || amount <= 0 || amount >= 1) return { ok: false, reason: 'inset needs an amount between 0 and 1' };
    const vertices = [...poly.vertices];
    const out = poly.faces.map((face) => [...face]);
    const ring: number[][] = [];
    for (const index of faces) {
        const face = poly.faces[index] as number[];
        const centre = average(face.map((v) => poly.vertices[v] as Vec3));
        const inner = face.map((v) => {
            vertices.push(lerp(poly.vertices[v] as Vec3, centre, amount));
            return vertices.length - 1;
        });
        face.forEach((a, i) => {
            const next = (i + 1) % face.length;
            ring.push([a, face[next] as number, inner[next] as number, inner[i] as number]);
        });
        out[index] = inner;
    }
    return made({ vertices, faces: [...out, ...ring] }, [...faces]);
}

/** Removes the picked faces, the faces that use a picked edge or vertex, and the vertices no face uses any more */
export function remove(poly: Poly, mode: EditMode, picked: unknown): OperationResult {
    let gone: (face: readonly number[], index: number) => boolean;
    if (mode === 'face') {
        const faces = new Set(pickedIndices(picked, poly.faces.length));
        gone = (_face, index) => faces.has(index);
    } else if (mode === 'edge') {
        const edges = new Set(pickedEdges(picked, poly.vertices.length).map(([a, b]) => edgeKey(a, b)));
        gone = (face) => face.some((a, i) => edges.has(edgeKey(a, face[(i + 1) % face.length] as number)));
    } else {
        const points = new Set(pickedIndices(picked, poly.vertices.length));
        gone = (face) => face.some((index) => points.has(index));
    }
    const kept = poly.faces.filter((face, index) => !gone(face, index));
    if (kept.length === poly.faces.length) return { ok: false, reason: 'delete needs a pick' };
    return made(compact(poly.vertices, kept, loose(poly)).poly, []);
}

/**
 * Moves the picked vertices to their centre and makes them one, the first picked; a face left with fewer than three
 * vertices is removed. The merged vertex is picked
 */
export function merge(poly: Poly, points: readonly number[]): OperationResult {
    if (points.length < 2) return { ok: false, reason: 'merge needs two picked vertices or more' };
    const into = points[0] as number;
    const vertices = [...poly.vertices];
    vertices[into] = average(points.map((index) => poly.vertices[index] as Vec3));
    const merged = new Set(points);
    const faces: number[][] = [];
    for (const face of poly.faces) {
        const next: number[] = [];
        for (const index of face.map((v) => (merged.has(v) ? into : v))) if (next[next.length - 1] !== index) next.push(index);
        while (next.length > 1 && next[0] === next[next.length - 1]) next.pop();
        if (next.length >= 3 && new Set(next).size === next.length) faces.push(next);
    }
    const { poly: kept, map } = compact(vertices, faces, [into, ...loose(poly).filter((index) => !merged.has(index))]);
    return made(kept, [map.get(into) as number]);
}

/** Makes a face of the picked vertices in the order they were picked; they stay picked */
export function fill(poly: Poly, points: readonly number[], picked: unknown): OperationResult {
    if (points.length < 3) return { ok: false, reason: 'fill needs three picked vertices or more' };
    if (points.length > MAX_FACE_SIDES) return { ok: false, reason: `fill takes at most ${MAX_FACE_SIDES} vertices` };
    const key = [...points].sort((a, b) => a - b).join(',');
    if (poly.faces.some((face) => [...face].sort((a, b) => a - b).join(',') === key)) return { ok: false, reason: 'the picked vertices already make a face' };
    return made({ vertices: poly.vertices, faces: [...poly.faces, [...points]] }, pickedJson(picked));
}

/** Turns the picked faces to look the other way; they stay picked */
export function flip(poly: Poly, faces: readonly number[], picked: unknown): OperationResult {
    if (faces.length === 0) return { ok: false, reason: 'flip needs picked faces' };
    const flipped = new Set(faces);
    return made({ vertices: poly.vertices, faces: poly.faces.map((face, index) => (flipped.has(index) ? [...face].reverse() : [...face])) }, pickedJson(picked));
}

/**
 * One level of Catmull-Clark subdivision of the whole mesh: every face of n sides becomes n quads. An edge of one face
 * (an open rim) keeps its midpoint, and a vertex on the rim moves along it only. Vertices no face uses stay where they
 * are. The pick is cleared, since every index changes
 */
export function subdivide(poly: Poly): OperationResult {
    const { vertices, faces } = poly;
    const edges = new Map<string, { a: number; b: number; faces: number[] }>();
    faces.forEach((face, index) => {
        face.forEach((a, i) => {
            const b = face[(i + 1) % face.length] as number;
            const key = edgeKey(a, b);
            const edge = edges.get(key) ?? { a, b, faces: [] };
            edge.faces.push(index);
            edges.set(key, edge);
        });
    });
    const count = vertices.length + faces.length + edges.size;
    const sides = faces.reduce((sum, face) => sum + face.length, 0);
    if (count > MAX_EDIT_VERTICES || sides > MAX_EDIT_FACES) return { ok: false, reason: 'the result would pass the limits' };
    const facePoints = faces.map((face) => average(face.map((v) => vertices[v] as Vec3)));
    const edgeIndex = new Map<string, number>();
    const edgePoints: Vec3[] = [];
    const facesOf = vertices.map((): number[] => []);
    const edgesOf = vertices.map((): Array<{ a: number; b: number; faces: number[] }> => []);
    faces.forEach((face, index) => face.forEach((v) => facesOf[v]?.push(index)));
    for (const [key, edge] of edges) {
        const mid = lerp(vertices[edge.a] as Vec3, vertices[edge.b] as Vec3, 0.5);
        edgeIndex.set(key, vertices.length + faces.length + edgePoints.length);
        edgePoints.push(edge.faces.length === 2 ? average([vertices[edge.a] as Vec3, vertices[edge.b] as Vec3, facePoints[edge.faces[0] as number] as Vec3, facePoints[edge.faces[1] as number] as Vec3]) : mid);
        edgesOf[edge.a]?.push(edge);
        edgesOf[edge.b]?.push(edge);
    }
    const moved = vertices.map((point, index): Vec3 => {
        const around = edgesOf[index] ?? [];
        if (around.length === 0) return point;
        const rim = around.filter((edge) => edge.faces.length !== 2);
        if (rim.length > 0) {
            if (rim.length !== 2) return point;
            const mids = rim.map((edge) => lerp(vertices[edge.a] as Vec3, vertices[edge.b] as Vec3, 0.5));
            return scale(add(add(mids[0] as Vec3, mids[1] as Vec3), scale(point, 6)), 1 / 8);
        }
        const n = (facesOf[index] ?? []).length;
        if (n < 3) return point;
        const f = average((facesOf[index] ?? []).map((face) => facePoints[face] as Vec3));
        const r = average(around.map((edge) => lerp(vertices[edge.a] as Vec3, vertices[edge.b] as Vec3, 0.5)));
        return scale(add(add(f, scale(r, 2)), scale(point, n - 3)), 1 / n);
    });
    const quads: number[][] = [];
    faces.forEach((face, index) => {
        const centre = vertices.length + index;
        face.forEach((v, i) => {
            const next = face[(i + 1) % face.length] as number;
            const prev = face[(i - 1 + face.length) % face.length] as number;
            quads.push([v, edgeIndex.get(edgeKey(v, next)) as number, centre, edgeIndex.get(edgeKey(prev, v)) as number]);
        });
    });
    return made({ vertices: [...moved, ...facePoints, ...edgePoints], faces: quads }, []);
}

/** A pick as written back: a copy of the list */
const pickedJson = (picked: unknown): JsonValue[] => (Array.isArray(picked) ? (JSON.parse(JSON.stringify(picked)) as JsonValue[]) : []);

/** A box of the given size centred on the origin, as a custom geometry: the shape the editor starts from */
export function boxPoly(width = 1, height = 1, depth = 1): Poly {
    const [x, y, z] = [width / 2, height / 2, depth / 2];
    return {
        vertices: [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]],
        faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]]
    };
}
