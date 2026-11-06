import type { ControllerContext } from '@punyts/stateui';

/** The renderers a drawing can use; `svg` is the default */
const RENDERERS = ['svg', 'canvas'] as const;

type Renderer = (typeof RENDERERS)[number];

const rendererOf = (value: unknown): Renderer => ((RENDERERS as readonly unknown[]).includes(value) ? (value as Renderer) : 'svg');

/**
 * The skeleton of the drawing (G1.3 of the graphics epic 1): the view holds the host (`role="img"`, labelled by
 * `_title` and described by `_description` when there is one) and an empty surface. The controller reads `renderer`
 * and marks the surface with it (`data-renderer`), which is where the SVG renderer (G1.5) and the canvas renderer
 * (G1.6) take over: until then a drawing draws nothing, and its shape nodes are only state
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const rendererPath = `${basePath}.renderer`;
    const surface = (): HTMLElement | null => element.shadowRoot?.querySelector<HTMLElement>('.surface') ?? null;

    const onRenderer = (): void => {
        surface()?.setAttribute('data-renderer', rendererOf(store.get<unknown>(rendererPath)));
    };

    store.on(rendererPath, onRenderer);
    queueMicrotask(onRenderer);

    return {
        dispose: () => {
            store.off(rendererPath, onRenderer);
        }
    };
}
