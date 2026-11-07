import { report } from '@punyts/core';
import type { ControllerContext } from '@punyts/stateui';
import { buildError } from '@punyts/stateui-app';
import { requestScene3dChunk } from '../shared/scene3d/load.js';
import type { Load3dFailure } from '../shared/scene3d/load.js';

/**
 * The 3D scene (G3.4 of the graphics epic 3), a skeleton. The view holds the host (`role="img"`, labelled by `_title`
 * and described by `_description` when there is one), the surface the renderer will draw into and the `_fallback`
 * text, shown while the element carries `data-fallback`.
 *
 * On mount the element is `data-render="pending"` and the controller asks for the 3D renderer chunk with the bubbling,
 * composed `ui-load-3d` event (`requestScene3dChunk`). An unanswered event (a host without the `load3d` hook, which
 * G3.3 adds to the dispatcher) or a failed load shows `_fallback` and marks the scene `ready`, so a screenshot does
 * not wait for it. A loaded chunk marks it `ready` too: drawing the node subtree with `createScene3d` is G3.5, which
 * replaces that step with the first complete frame.
 *
 * A failure is reported once as `SUI-RUN-3D` with the scene's path (G3.3). Its reason is `no_chunk` when nothing
 * answered (the host serves no chunk), the hook's code when it rejected (`load_failed`, `script_error`, `timeout`),
 * and `script_error` when the chunk's global is not the renderer's
 */
export default function controller({ element, basePath }: ControllerContext) {
    let disposed = false;

    const showFallback = (failure: Load3dFailure): void => {
        element.setAttribute('data-fallback', '');
        element.setAttribute('data-render', 'ready');
        const reason = reasonOf(failure);
        const error = buildError('SUI-RUN-3D', { component: 'scene3d', path: basePath, reason, statePath: basePath });
        report.error(error.message, { code: 'SUI-RUN-3D', path: basePath });
    };

    element.setAttribute('data-render', 'pending');

    //the element is in the page once the controller has returned, so the request bubbles to the dispatcher a microtask later
    queueMicrotask(() => {
        if (disposed) return;
        requestScene3dChunk(element).then(
            () => {
                if (disposed) return;
                element.removeAttribute('data-fallback');
                element.setAttribute('data-render', 'ready');
            },
            (failure: Load3dFailure) => {
                if (!disposed) showFallback(failure);
            }
        );
    });

    return {
        dispose: () => {
            disposed = true;
        }
    };
}

/** The `SUI-RUN-3D` reason of a failed chunk request */
function reasonOf(failure: Load3dFailure): string {
    if (failure.code === 'offline') return 'no_chunk';
    if (failure.code === 'invalid') return 'script_error';
    const code = (failure.cause as { code?: unknown } | undefined)?.code;
    return typeof code === 'string' ? code : 'load_failed';
}
