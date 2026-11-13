import type { ControllerContext } from '@punyts/stateui';
import { initialsOf } from '../shared/avatar/initials.js';

/** Keeps the runtime property `initials` in step with `_name`, so a language switch or a linked name redraws them */
export default function controller({ store, basePath }: ControllerContext) {
    const path = `${basePath}._name`;
    const refresh = (): void => {
        const name = store.get<unknown>(path);
        store.set(`${basePath}.initials`, initialsOf(typeof name === 'string' ? name : ''));
    };
    store.on(path, refresh);
    refresh();
    return {
        dispose: () => {
            store.off(path, refresh);
        }
    };
}
