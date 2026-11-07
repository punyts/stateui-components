import type { CreateScene3d } from './tree.js';

/** The event a `scene3d` raises to ask for the 3D renderer chunk (the dispatcher answers it with `hooks.load3d`, G3.3) */
export const LOAD_3D_EVENT = 'ui-load-3d';

/**
 * The 3D renderer chunk as the host's `load3d` hook gives it: the value of `globalThis.__stateui3d` once the second
 * classic script has run (`@punyts/stateui-3d`). `createScene3d` is typed by structure (`tree.ts`), since the
 * component library does not depend on that package; `isScene3dChunk` checks only that it is a function
 */
export interface Scene3dChunk {
    readonly version: string;
    readonly createScene3d: CreateScene3d;
}

/** The detail of a `ui-load-3d` event: the dispatcher calls `respond` with the hook's promise */
export interface Load3dRequest {
    readonly respond: (result: Promise<unknown>) => void;
}

/** Why the chunk cannot be had: no hook answered (`offline`), the hook failed (`failed`), or its value is no chunk (`invalid`) */
export type Load3dFailure = { readonly code: 'offline' | 'failed' | 'invalid'; readonly cause?: unknown };

/** True when a value has the shape of the chunk's global: a `version` string and a `createScene3d` function */
export function isScene3dChunk(value: unknown): value is Scene3dChunk {
    if (typeof value !== 'object' || value === null) return false;
    const chunk = value as { version?: unknown; createScene3d?: unknown };
    return typeof chunk.version === 'string' && typeof chunk.createScene3d === 'function';
}

/**
 * Asks for the 3D renderer chunk with the bubbling, composed `ui-load-3d` event raised on `target`, in the request
 * shape of `ui-file-read` (`detail.respond(promise)`). The promise rejects with a `Load3dFailure`: `offline` when
 * nothing answers (a host without the hook), `failed` when the hook's promise rejects (a missing chunk, a script
 * error, the timeout), `invalid` when it resolves to something that is not the chunk's global
 */
export function requestScene3dChunk(target: EventTarget): Promise<Scene3dChunk> {
    return new Promise((resolve, reject) => {
        let answered = false;
        const detail: Load3dRequest = {
            respond: (result) => {
                if (answered) return;
                answered = true;
                result.then(
                    (value) => (isScene3dChunk(value) ? resolve(value) : reject({ code: 'invalid' } satisfies Load3dFailure)),
                    (cause: unknown) => reject({ code: 'failed', cause } satisfies Load3dFailure)
                );
            }
        };
        target.dispatchEvent(new CustomEvent(LOAD_3D_EVENT, { detail, bubbles: true, composed: true }));
        if (!answered) reject({ code: 'offline' } satisfies Load3dFailure);
    });
}
