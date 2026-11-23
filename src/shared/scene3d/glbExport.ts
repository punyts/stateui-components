import type { JsonValue } from '@punyts/stateui-app/core';
import { isFileRef, MAX_FILE_SIZE, transferCode } from '../field/files.js';
import type { FileRef } from '../field/files.js';

// The scene3d's GLB export (docs/design/stateui-3d-glb-export.md): when `exportRequest` changes to a value that is set
// and differs from `exported.request`, the drawn scene is written as a GLB, handed to the host's file hook and recorded
// in `exported`

/** The media type of an exported scene */
export const GLB_FILE_TYPE = 'model/gltf-binary';

/** The characters a file name may not hold (as `paintField`'s) */
const NAME_UNSAFE = /[\u0000-\u001f\u007f/\\:*?"<>|]+/g;

/** The file name of an export: the scene's `_title` made safe and cut to 100 characters, `scene` without one, and `.glb` */
export function exportFileName(title: unknown): string {
    const base = typeof title === 'string' ? title.replace(NAME_UNSAFE, ' ').trim().slice(0, 100).trim() : '';
    return `${base === '' ? 'scene' : base}.glb`;
}

/** A comparable token of an export request; undefined for one that is not set (absent, `null` or `""`) */
export function requestToken(request: unknown): string | undefined {
    if (request === undefined || request === null || request === '') return undefined;
    return JSON.stringify(request);
}

/** The scene an export reads (`Scene3d` of `@punyts/stateui-3d`) */
export interface ExportedScene {
    drawn(): Promise<void>;
    exportGlb(): ArrayBuffer;
}

/** What an export needs from its scene3d */
export interface SceneExportHost {
    /** The current `exportRequest` */
    request(): JsonValue | undefined;
    /** The current `exported` */
    exported(): JsonValue | undefined;
    /** The current `_title` */
    title(): JsonValue | undefined;
    /** The drawn scene, undefined before it is made and after it is disposed */
    scene(): ExportedScene | undefined;
    /** Hands the file to the host (`ui-file-transfer`); rejects with `{ code }` */
    hand(file: File, signal: AbortSignal): Promise<unknown>;
    /** Writes `exported` */
    write(value: JsonValue): void;
    /** Raises the `exported` event */
    raise(file: FileRef): void;
}

/** Lets any draw the change asked for run first: the store's watchers draw in a microtask */
const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Runs one export per new request; a changed request stops the running one */
export class SceneExport {
    private running: { readonly token: string; readonly abort: AbortController } | undefined;

    constructor(private readonly host: SceneExportHost) {}

    /** Exports when the request is set, new and not already running; stops a running export of another request */
    sync(): void {
        const request = this.host.request();
        const token = requestToken(request);
        if (this.running !== undefined && this.running.token === token) return;
        this.running?.abort.abort();
        this.running = undefined;
        if (token === undefined || request === undefined) return;
        const exported = this.host.exported();
        const done = typeof exported === 'object' && exported !== null && !Array.isArray(exported) ? exported.request : undefined;
        if (requestToken(done) === token) return;
        const abort = new AbortController();
        this.running = { token, abort };
        void this.run(request, abort);
    }

    /** Stops a running export; nothing is written after */
    dispose(): void {
        this.running?.abort.abort();
        this.running = undefined;
    }

    private async run(request: JsonValue, abort: AbortController): Promise<void> {
        const { signal } = abort;
        const finish = (value: JsonValue): void => {
            if (this.running?.abort === abort) this.running = undefined;
            this.host.write(value);
        };
        try {
            await nextTask();
            const scene = this.host.scene();
            if (signal.aborted) return;
            if (scene === undefined) {
                this.running = undefined;
                return;
            }
            await scene.drawn();
            if (signal.aborted) return;
            const bytes = scene.exportGlb();
            if (bytes.byteLength > MAX_FILE_SIZE) throw { code: 'too_large' };
            const name = exportFileName(this.host.title());
            const result = await this.host.hand(new File([bytes], name, { type: GLB_FILE_TYPE }), signal);
            if (signal.aborted) return;
            if (!isFileRef(result)) throw { code: 'internal' };
            const file: FileRef = { id: result.id, name: result.name, size: result.size, type: result.type };
            finish({ request, file: { ...file } });
            this.host.raise(file);
        } catch (error) {
            if (signal.aborted) return;
            finish({ request, error: transferCode(error) });
        }
    }
}
