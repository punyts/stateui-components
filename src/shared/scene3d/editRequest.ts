import type { JsonValue } from '@punyts/stateui-app/core';
import { EDIT_MODES, MESH_OPERATIONS, readPoly, runOperation } from '../model/operations.js';
import type { EditMode, MeshOperation, OperationRequest } from '../model/operations.js';
import { requestToken } from './glbExport.js';
import type { MeshHistory } from './history.js';
import type { Scene3dTree } from './tree.js';

/**
 * A mesh's `editRequest` (docs/design/stateui-mesh-editor.md, V4): while it is set and differs from `edit.done`, the
 * scene runs it once on the mesh's pick, writes `geometry` and `edit.picked`, and records it in `edit.done`, as the
 * export records its request in `exported.request`. A reload, or a page that already has the result, does not run it
 * again; a counter `n` makes the same operation a new request
 */

/** What running the requests needs from the scene: the store and the scene's undo history */
export interface EditRequestHost {
    read(path: string): JsonValue | undefined;
    write(path: string, value: JsonValue): void;
    readonly history: MeshHistory;
    /** A request that made nothing: the operation, the mode and why, reported once by the caller */
    refused(path: string, reason: string): void;
}

const isObject = (value: unknown): value is Record<string, JsonValue> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The meshes of a tree, in tree order; the copies of a `repeat3d` are not nodes of the store and take no request */
function meshesOf(nodes: readonly Scene3dTree[], into: Scene3dTree[] = []): Scene3dTree[] {
    for (const node of nodes) {
        if (node.kind === 'mesh') into.push(node);
        if (node.kind === 'group3d') meshesOf(node.children, into);
    }
    return into;
}

/** Runs every mesh's new `editRequest`; meshes whose request is unset or already done are left alone */
export function runEditRequests(nodes: readonly Scene3dTree[], host: EditRequestHost): void {
    for (const mesh of meshesOf(nodes)) {
        const request = mesh.properties['editRequest'];
        const token = requestToken(request);
        if (token === undefined || request === undefined) continue;
        const edit = mesh.properties['edit'];
        if (requestToken(isObject(edit) ? edit['done'] : undefined) === token) continue;
        run(mesh, request, isObject(edit) ? edit : {}, host);
    }
}

/** Runs one request and records it as done, whether it made something or was refused */
function run(mesh: Scene3dTree, request: JsonValue, edit: Record<string, JsonValue>, host: EditRequestHost): void {
    const done = (): void => host.write(`${mesh.path}.edit.done`, JSON.parse(JSON.stringify(request)) as JsonValue);
    const mode: EditMode = EDIT_MODES.includes(edit['mode'] as EditMode) ? (edit['mode'] as EditMode) : 'none';
    const op = isObject(request) ? request['op'] : undefined;
    if (typeof op !== 'string' || !MESH_OPERATIONS.includes(op as MeshOperation)) {
        host.refused(mesh.path, `editRequest names no operation (${MESH_OPERATIONS.join(', ')})`);
        done();
        return;
    }
    if (op === 'undo' || op === 'redo') {
        // As the keys: the scene's history, over every mesh of the scene
        const step = op === 'undo' ? host.history.undo(host.read) : host.history.redo(host.read);
        if (step !== undefined) host.write(step.path, step.value);
        done();
        return;
    }
    const geometryPath = `${mesh.path}.geometry`;
    const geometry = mesh.properties['geometry'];
    const poly = readPoly(geometry);
    if (poly === undefined) {
        host.refused(mesh.path, `${op} needs a custom geometry the editor can read`);
        done();
        return;
    }
    const amount = isObject(request) ? request['amount'] : undefined;
    const result = runOperation(poly, mode, edit['picked'], { op: op as OperationRequest['op'], ...(typeof amount === 'number' && { amount }) });
    if (!result.ok) {
        host.refused(mesh.path, result.reason);
        done();
        return;
    }
    const shading = isObject(geometry) ? geometry['shading'] : undefined;
    const next: JsonValue = {
        kind: 'custom',
        vertices: result.geometry.vertices.map((vertex) => [...vertex]),
        faces: result.geometry.faces.map((face) => [...face]),
        ...(typeof shading === 'string' && { shading })
    };
    host.history.record(geometryPath, host.read(geometryPath), next);
    host.write(geometryPath, next);
    host.write(`${mesh.path}.edit.picked`, result.picked);
    done();
}
