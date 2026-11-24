import type { JsonValue } from '@punyts/stateui-app/core';
import { boxPoly } from '../model/operations.js';
import { runEditRequests } from './editRequest.js';
import { MeshHistory } from './history.js';
import type { Scene3dTree } from './tree.js';

const PATH = '$.app.children.scene.children.stool';
const box = (): JsonValue => ({ kind: 'custom', ...(JSON.parse(JSON.stringify(boxPoly())) as Record<string, JsonValue>), shading: 'flat' });

/** A store of plain paths, the mesh's node read from it as the scene reads its tree, and the refusals told */
function scene(properties: Record<string, JsonValue>) {
    const values = new Map<string, JsonValue>(Object.entries(properties).map(([name, value]) => [`${PATH}.${name}`, value]));
    const writes: string[] = [];
    const refused: string[] = [];
    const history = new MeshHistory();
    const read = (path: string): JsonValue | undefined => values.get(path);
    const node = (): Scene3dTree => {
        const edit: Record<string, JsonValue> = {};
        for (const name of ['mode', 'picked', 'done']) {
            const value = values.get(`${PATH}.edit.${name}`);
            if (value !== undefined) edit[name] = value;
        }
        const props: Record<string, JsonValue> = { edit };
        for (const name of ['geometry', 'editRequest']) {
            const value = values.get(`${PATH}.${name}`);
            if (value !== undefined) props[name] = value;
        }
        return { kind: 'mesh', key: 'stool', path: PATH, properties: props, children: [] };
    };
    const host = {
        read,
        write: (path: string, value: JsonValue) => {
            writes.push(path.slice(PATH.length + 1));
            values.set(path, value);
        },
        history,
        refused: (_path: string, reason: string) => refused.push(reason)
    };
    return { values, writes, refused, run: () => runEditRequests([node()], host), set: (name: string, value: JsonValue) => values.set(`${PATH}.${name}`, value) };
}

describe('a mesh\'s editRequest', () => {
    it('should run a new request once, writing the geometry, the pick and the request done', () => {
        // Arrange
        const s = scene({ geometry: box(), 'edit.mode': 'face', 'edit.picked': [3], editRequest: { op: 'extrude', amount: 0.5, n: 1 } });

        // Act: the scene draws again after its own writes, and again after a reload
        s.run();
        s.run();

        // Assert
        expect(s.writes).toEqual(['geometry', 'edit.picked', 'edit.done']);
        const geometry = s.values.get(`${PATH}.geometry`) as { vertices: unknown[]; faces: unknown[]; shading: string };
        expect([geometry.vertices.length, geometry.faces.length, geometry.shading]).toEqual([12, 10, 'flat']);
        expect(s.values.get(`${PATH}.edit.done`)).toEqual({ op: 'extrude', amount: 0.5, n: 1 });
    });

    it('should run the same operation again when its counter changes, and undo it through the history', () => {
        // Arrange
        const s = scene({ geometry: box(), 'edit.mode': 'face', 'edit.picked': [3], editRequest: { op: 'extrude', n: 1 } });
        s.run();

        // Act
        s.set('editRequest', { op: 'extrude', n: 2 });
        s.run();
        const twice = (s.values.get(`${PATH}.geometry`) as { faces: unknown[] }).faces.length;
        s.set('editRequest', { op: 'undo', n: 3 });
        s.run();

        // Assert
        expect(twice).toBe(14);
        expect((s.values.get(`${PATH}.geometry`) as { faces: unknown[] }).faces).toHaveLength(10);
    });

    it('should refuse an operation the mode does not take, writing only the request done', () => {
        // Arrange
        const s = scene({ geometry: box(), 'edit.mode': 'vertex', 'edit.picked': [0], editRequest: { op: 'extrude' } });

        // Act
        s.run();
        s.run();

        // Assert
        expect(s.writes).toEqual(['edit.done']);
        expect(s.refused).toEqual(['extrude does not work in vertex mode']);
    });

    it('should refuse an operation on a mesh that is not custom, and leave a mesh with no request alone', () => {
        // Arrange
        const primitive = scene({ geometry: { kind: 'box', width: 1 }, 'edit.mode': 'face', editRequest: { op: 'subdivide' } });
        const idle = scene({ geometry: box(), 'edit.mode': 'face', editRequest: null });

        // Act
        primitive.run();
        idle.run();

        // Assert
        expect(primitive.refused).toEqual(['subdivide needs a custom geometry the editor can read']);
        expect(idle.writes).toEqual([]);
    });
});
