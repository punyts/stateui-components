import { boxPoly, readPoly, runOperation, subdivide } from './operations.js';
import type { OperationResult, Poly, Vec3 } from './operations.js';

/** The geometry of a result that must have made one */
function geometryOf(result: OperationResult): Poly {
    if (!result.ok) throw new Error(result.reason);
    return result.geometry;
}

/** True when every edge is gone round once each way: the mesh is closed and its faces all look out or all look in */
function isClosed(poly: Poly): boolean {
    const directed = new Map<string, number>();
    for (const face of poly.faces) face.forEach((a, i) => {
        const key = `${a}>${face[(i + 1) % face.length]}`;
        directed.set(key, (directed.get(key) ?? 0) + 1);
    });
    return [...directed].every(([key, count]) => {
        const [a, b] = key.split('>');
        return count === 1 && directed.get(`${b}>${a}`) === 1;
    });
}

/** The volume a closed mesh holds, positive when its faces look out */
function volume(poly: Poly): number {
    let sum = 0;
    for (const face of poly.faces) {
        const a = poly.vertices[face[0] as number] as Vec3;
        for (let i = 1; i + 1 < face.length; i += 1) {
            const b = poly.vertices[face[i] as number] as Vec3;
            const c = poly.vertices[face[i + 1] as number] as Vec3;
            sum += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
        }
    }
    return sum / 6;
}

/** The index of the box's top face (y = +0.5) */
const TOP = 3;

describe('the mesh operations', () => {
    it('should start from a closed box whose faces look out', () => {
        // Act
        const box = boxPoly();

        // Assert
        expect(isClosed(box)).toBe(true);
        expect(volume(box)).toBeCloseTo(1, 6);
        expect(box.faces[TOP]?.map((v) => box.vertices[v]?.[1])).toEqual([0.5, 0.5, 0.5, 0.5]);
    });

    it('should extrude a face out along its normal, joined by side faces, and keep it picked', () => {
        // Act
        const result = runOperation(boxPoly(), 'face', [TOP], { op: 'extrude', amount: 0.5 });

        // Assert
        const made = geometryOf(result);
        expect(made.vertices).toHaveLength(12);
        expect(made.faces).toHaveLength(10);
        expect(isClosed(made)).toBe(true);
        expect(volume(made)).toBeCloseTo(1.5, 6);
        expect(made.faces[TOP]?.map((v) => made.vertices[v]?.[1])).toEqual([1, 1, 1, 1]);
        expect(result.ok && result.picked).toEqual([TOP]);
    });

    it('should extrude two touching faces as one region, with no side face between them', () => {
        // Act: the top and the front (z = +0.5) faces
        const made = geometryOf(runOperation(boxPoly(), 'face', [TOP, 1], { op: 'extrude', amount: 0.2 }));

        // Assert: 6 rim edges, so 6 sides
        expect(made.faces).toHaveLength(12);
        expect(isClosed(made)).toBe(true);
    });

    it('should keep a vertex no face used before an operation', () => {
        // Arrange
        const box = boxPoly();
        const withLoose: Poly = { vertices: [...box.vertices, [5, 5, 5]], faces: box.faces };

        // Act
        const made = geometryOf(runOperation(withLoose, 'face', [TOP], { op: 'extrude' }));

        // Assert
        expect(made.vertices).toContainEqual([5, 5, 5]);
        expect(made.vertices).toHaveLength(13);
    });

    it('should inset a face towards its centre with a ring of faces, and keep the inner face picked', () => {
        // Act
        const result = runOperation(boxPoly(), 'face', [TOP], { op: 'inset', amount: 0.5 });

        // Assert
        const made = geometryOf(result);
        expect(made.vertices).toHaveLength(12);
        expect(made.faces).toHaveLength(10);
        expect(isClosed(made)).toBe(true);
        expect(volume(made)).toBeCloseTo(1, 6);
        expect(made.faces[TOP]?.map((v) => made.vertices[v])).toEqual([[-0.25, 0.5, -0.25], [-0.25, 0.5, 0.25], [0.25, 0.5, 0.25], [0.25, 0.5, -0.25]]);
        expect(result.ok && result.picked).toEqual([TOP]);
    });

    it('should delete the picked faces, or the faces that use a picked edge or vertex, and the vertices left unused', () => {
        // Act
        const face = geometryOf(runOperation(boxPoly(), 'face', [TOP], { op: 'delete' }));
        const edge = geometryOf(runOperation(boxPoly(), 'edge', [[0, 1]], { op: 'delete' }));
        const vertex = geometryOf(runOperation(boxPoly(), 'vertex', [0], { op: 'delete' }));

        // Assert
        expect([face.faces.length, face.vertices.length]).toEqual([5, 8]);
        expect([edge.faces.length, edge.vertices.length]).toEqual([4, 8]);
        expect([vertex.faces.length, vertex.vertices.length]).toEqual([3, 7]);
        expect(vertex.vertices).not.toContainEqual([-0.5, -0.5, -0.5]);
    });

    it('should merge the picked vertices at their centre, drop the faces left with two, and pick the merged one', () => {
        // Act: the two ends of the top's right edge
        const result = runOperation(boxPoly(), 'vertex', [2, 6], { op: 'merge' });

        // Assert
        const made = geometryOf(result);
        expect(made.vertices).toHaveLength(7);
        expect(made.faces).toHaveLength(6);
        expect(made.faces.filter((face) => face.length === 3)).toHaveLength(2);
        expect(isClosed(made)).toBe(true);
        expect(result.ok && made.vertices[result.picked[0] as number]).toEqual([0.5, 0.5, 0]);
    });

    it('should fill a hole with a face of the picked vertices in their order, and refuse two', () => {
        // Arrange
        const open = geometryOf(runOperation(boxPoly(), 'face', [TOP], { op: 'delete' }));

        // Act
        const filled = geometryOf(runOperation(open, 'vertex', [3, 7, 6, 2], { op: 'fill' }));
        const two = runOperation(open, 'vertex', [3, 7], { op: 'fill' });

        // Assert
        expect(isClosed(filled)).toBe(true);
        expect(volume(filled)).toBeCloseTo(1, 6);
        expect(two).toEqual({ ok: false, reason: 'fill needs three picked vertices or more' });
    });

    it('should flip the picked faces, and refuse to in vertex mode', () => {
        // Act
        const made = geometryOf(runOperation(boxPoly(), 'face', [TOP], { op: 'flip' }));
        const vertex = runOperation(boxPoly(), 'vertex', [0], { op: 'flip' });

        // Assert
        expect(made.faces[TOP]).toEqual([2, 6, 7, 3]);
        expect(isClosed(made)).toBe(false);
        expect(vertex).toEqual({ ok: false, reason: 'flip does not work in vertex mode' });
    });

    it('should subdivide a box into 24 quads that stay closed and round its corners in', () => {
        // Act
        const result = runOperation(boxPoly(), 'none', [], { op: 'subdivide' });

        // Assert
        const made = geometryOf(result);
        expect(made.vertices).toHaveLength(26);
        expect(made.faces).toHaveLength(24);
        expect(made.faces.every((face) => face.length === 4)).toBe(true);
        expect(isClosed(made)).toBe(true);
        expect(volume(made)).toBeCloseTo(0.4167, 4);
        expect(made.vertices[0]).toEqual([-0.2778, -0.2778, -0.2778]);
        expect(result.ok && result.picked).toEqual([]);
    });

    it('should keep the rim of an open mesh on its edges when it subdivides', () => {
        // Arrange: one square, open all round
        const square: Poly = { vertices: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], faces: [[0, 3, 2, 1]] };

        // Act
        const made = geometryOf(subdivide(square));

        // Assert
        expect(made.vertices).toHaveLength(9);
        expect(made.faces).toHaveLength(4);
        expect(made.vertices[0]).toEqual([0.0625, 0, 0.0625]);
        expect(made.vertices[4]).toEqual([0.5, 0, 0.5]);
    });

    it('should refuse a subdivision past the limits', () => {
        // Arrange: 1,001 loose triangles
        const vertices: Vec3[] = [];
        const faces: number[][] = [];
        for (let i = 0; i < 1001; i += 1) {
            vertices.push([i, 0, 0], [i, 1, 0], [i, 0, 1]);
            faces.push([3 * i, 3 * i + 1, 3 * i + 2]);
        }

        // Act
        const result = subdivide({ vertices, faces });

        // Assert
        expect(result).toEqual({ ok: false, reason: 'the result would pass the limits' });
    });

    it('should refuse an operation with no pick, or an amount out of range', () => {
        // Act
        const found = [
            runOperation(boxPoly(), 'face', [], { op: 'extrude' }),
            runOperation(boxPoly(), 'face', [TOP], { op: 'inset', amount: 1 }),
            runOperation(boxPoly(), 'vertex', [], { op: 'delete' }),
            runOperation(boxPoly(), 'vertex', [1], { op: 'merge' })
        ];

        // Assert
        expect(found.map((result) => (result.ok ? 'made' : result.reason))).toEqual([
            'extrude needs picked faces',
            'inset needs an amount between 0 and 1',
            'delete needs a pick',
            'merge needs two picked vertices or more'
        ]);
    });

    it('should read a custom geometry and refuse one the operations cannot take', () => {
        // Arrange
        const box = boxPoly();

        // Act
        const read = readPoly({ kind: 'custom', vertices: box.vertices, faces: box.faces, shading: 'flat' });
        const refused = [
            readPoly({ kind: 'box', width: 1 }),
            readPoly({ kind: 'custom', vertices: [[0, 0]], faces: [] }),
            readPoly({ kind: 'custom', vertices: box.vertices, faces: [[0, 1]] }),
            readPoly({ kind: 'custom', vertices: box.vertices, faces: [[0, 1, 9]] }),
            readPoly({ kind: 'custom', vertices: box.vertices, faces: [[0, 1, 1]] })
        ];

        // Assert
        expect(read).toEqual(box);
        expect(refused).toEqual([undefined, undefined, undefined, undefined, undefined]);
    });
});
