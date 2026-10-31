import type { ControllerContext } from '@punyts/stateui';

/** The first letter of the first and of the last word of a name, in capitals: one word gives one letter */
function initialsOf(name: string): string {
    const words = name.split(/\s+/).filter((word) => word !== '');
    const first = words[0];
    const last = words.length > 1 ? words[words.length - 1] : undefined;
    return [first, last]
        .map((word) => (word === undefined ? '' : (Array.from(word)[0] ?? '')))
        .join('')
        .toLocaleUpperCase();
}

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
