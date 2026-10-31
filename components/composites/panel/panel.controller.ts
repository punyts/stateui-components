import type { ControllerContext } from '@punyts/stateui';

interface CommandHost {
    commands?: Record<string, () => void>;
}

/**
 * Owns `collapsed`. The commands `expand`, `collapse` and `toggle` and the header control write it, and every change of
 * it, whoever wrote it, raises `toggle` with `{ collapsed }`. A collapsed body is hidden by the view, not removed, so the
 * children keep their state
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as Element & CommandHost;
    const collapsedPath = `${basePath}.collapsed`;
    const isCollapsed = (): boolean => store.get<unknown>(collapsedPath) === true;
    let last = isCollapsed();
    const raise = (): void => {
        const collapsed = isCollapsed();
        if (collapsed === last) return;
        last = collapsed;
        element.dispatchEvent(new CustomEvent('toggle', { detail: { collapsed }, bubbles: true, composed: true }));
    };
    const toggle = (): void => store.set(collapsedPath, !isCollapsed());
    host.commands = {
        expand: () => store.set(collapsedPath, false),
        collapse: () => store.set(collapsedPath, true),
        toggle
    };
    store.on([collapsedPath], raise);
    return {
        onToggle: toggle,
        dispose: () => {
            store.off([collapsedPath], raise);
            delete host.commands;
        }
    };
}
