import type { ControllerContext } from '@punyts/stateui';

interface CommandHost {
    commands?: Record<string, (value?: unknown) => void>;
}

const DISCLOSURE = 'disclosure';

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Keeps the accordion's `open` and the `open` of each disclosure child consistent, whichever one is written: a key
 * (a string) without `multiple`, a list of keys with it. A value that names no disclosure child is dropped, a list
 * without `multiple` keeps its first key, and a string with `multiple` becomes a one-key list. Opening a child
 * without `multiple` closes the open one. At load, an empty `open` takes the children that are already open. Every
 * change of `open` after that raises `change` with the new value. The commands `open` and `close` take a child key
 * (`close` without one closes everything), `expandAll` works only with `multiple`, and a key that is not a
 * disclosure child is ignored. Up, Down, Home and End move focus between the enabled headers
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as Element & CommandHost;
    const openPath = `${basePath}.open`;
    const multiplePath = `${basePath}.multiple`;
    const childrenPath = `${basePath}.children`;
    const childPrefix = `${childrenPath}.`;
    const childOpenPath = (key: string): string => `${childPrefix}${key}.open`;
    const isMultiple = (): boolean => store.get<unknown>(multiplePath) === true;

    const keys = (): string[] => {
        const children = store.get<unknown>(childrenPath);
        if (children === null || typeof children !== 'object') return [];
        return Object.keys(children).filter((key) => store.get<unknown>(`${childPrefix}${key}.component`) === DISCLOSURE);
    };
    const listOf = (raw: unknown): string[] => {
        const all = keys();
        const wanted: unknown[] = Array.isArray(raw) ? raw : typeof raw === 'string' && raw !== '' ? [raw] : [];
        const list: string[] = [];
        for (const entry of wanted) {
            if (typeof entry === 'string' && all.includes(entry) && !list.includes(entry)) list.push(entry);
        }
        return isMultiple() ? list : list.slice(0, 1);
    };
    const valueOf = (list: string[]): string | string[] => (isMultiple() ? list : (list[0] ?? ''));
    const current = (): string[] => listOf(store.get<unknown>(openPath));
    const childOpen = (key: string): boolean => store.get<unknown>(childOpenPath(key)) === true;
    const opened = (list: string[], key: string): string[] => {
        if (list.includes(key)) return list;
        return isMultiple() ? [...list, key] : [key];
    };

    const startList = (): string[] => {
        const given = current();
        if (given.length > 0) return given;
        const already = keys().filter(childOpen);
        return isMultiple() ? already : already.slice(0, 1);
    };
    let last = JSON.stringify(valueOf(startList()));

    const apply = (list: string[]): void => {
        const value = valueOf(list);
        if (!sameJson(store.get<unknown>(openPath), value)) store.set(openPath, value);
        for (const key of keys()) {
            const open = list.includes(key);
            if (childOpen(key) !== open) store.set(childOpenPath(key), open);
        }
        const serial = JSON.stringify(value);
        if (serial === last) return;
        last = serial;
        element.dispatchEvent(new CustomEvent('change', { detail: value, bubbles: true, composed: true }));
    };

    let known = new Set(keys());
    const onOpen = (): void => apply(current());
    const onChildOpen = (key: string): void => {
        const list = current();
        if (childOpen(key)) apply(opened(list, key));
        else apply(list.filter((entry) => entry !== key));
    };
    const onChildren = (path?: unknown): void => {
        const tail = typeof path === 'string' && path.startsWith(childPrefix) ? path.slice(childPrefix.length).split('.') : [];
        if (tail.length === 2 && tail[1] === 'open' && known.has(tail[0] as string)) {
            onChildOpen(tail[0] as string);
            return;
        }
        let list = current();
        const now = keys();
        for (const key of now) {
            if (!known.has(key) && childOpen(key)) list = opened(list, key);
        }
        known = new Set(now);
        apply(list);
    };
    apply(startList());

    const keyOf = (value: unknown): string | undefined =>
        typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
    host.commands = {
        open: (value?: unknown) => {
            const key = keyOf(value);
            if (key !== undefined && keys().includes(key)) apply(opened(current(), key));
        },
        close: (value?: unknown) => {
            const key = keyOf(value);
            apply(key === undefined ? [] : current().filter((entry) => entry !== key));
        },
        expandAll: () => {
            if (isMultiple()) apply(keys());
        },
        collapseAll: () => apply([])
    };

    const watchedOpen = [openPath, multiplePath];
    const watchedChildren = [childrenPath, `${childrenPath}.$all`];
    store.on(watchedOpen, onOpen);
    store.on(watchedChildren, onChildren);

    const headers = (): HTMLButtonElement[] => {
        const found: HTMLButtonElement[] = [];
        const all = keys();
        for (const node of Array.from(element.shadowRoot?.querySelectorAll('.accordion > sui-node') ?? [])) {
            const state = node.getAttribute('state') ?? '';
            if (!state.startsWith(childPrefix) || !all.includes(state.slice(childPrefix.length))) continue;
            const header = node.firstElementChild?.shadowRoot?.querySelector<HTMLButtonElement>('.toggle') ?? null;
            if (header !== null && !header.disabled) found.push(header);
        }
        return found;
    };
    return {
        onKeydown: (event: KeyboardEvent) => {
            const list = headers();
            const path = event.composedPath();
            const index = list.findIndex((header) => path.includes(header));
            if (index < 0) return;
            let next: HTMLButtonElement | undefined;
            if (event.key === 'ArrowDown') next = list[(index + 1) % list.length];
            else if (event.key === 'ArrowUp') next = list[(index - 1 + list.length) % list.length];
            else if (event.key === 'Home') next = list[0];
            else if (event.key === 'End') next = list[list.length - 1];
            if (next === undefined) return;
            event.preventDefault();
            next.focus();
        },
        dispose: () => {
            store.off(watchedOpen, onOpen);
            store.off(watchedChildren, onChildren);
            delete host.commands;
        }
    };
}
