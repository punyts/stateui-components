import type { ControllerContext } from '@punyts/stateui';
import { runtimePath } from '@punyts/stateui-app/core';

type Entry = Record<string, unknown>;

interface CommandHost {
    commands?: Record<string, (value?: unknown) => void>;
}

/** A toast on screen: its message key, the time it stays and whether the pointer or focus holds it */
interface Shown {
    key: string;
    duration: number;
    timer: ReturnType<typeof setTimeout> | undefined;
    hover: boolean;
    focus: boolean;
}

const DEFAULT_DURATION = 5000;
const DEFAULT_MAX = 3;

const isEntry = (value: unknown): value is Entry => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Shows the toasts of `messages`. `show` (the value is a message key) writes a `toast` node at
 * `$.runtime.nodes.<path>.items.<id>`, never into `$.app`; `items` is an alias of that runtime object for the view.
 * The locale step treats a node that appears under `$.app` as one written later and translates it, and it would replace a
 * toast written whole, so the node is written as an empty object, then property by property, with `component` last
 * (the content is already in the current language). At most `max` toasts are on screen, later ones wait in a queue and appear as room is made. A toast leaves after
 * `duration` ms (`danger` stays until closed when `duration` is not set; 0 is sticky); the time stops while the pointer
 * is over the toast or focus is inside it, and starts again when both have left. Every removed toast raises `close`
 * with `{ key }` on the region. An unknown key throws, which the runtime reports as `SUI-RUN-ON-COMMAND`
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as Element & CommandHost;
    const itemsPath = `${runtimePath(basePath)}.items`;
    const listPath = `${basePath}.items`;
    const shown = new Map<string, Shown>();
    const queue: string[] = [];
    let counter = 0;
    let disposed = false;

    const read = (path: string): unknown => store.get<unknown>(path);
    const maxToasts = (): number => {
        const value = read(`${basePath}.max`);
        return typeof value === 'number' && value >= 1 ? Math.floor(value) : DEFAULT_MAX;
    };

    /** The store creates no parents, so each missing object between `$.runtime.nodes` and the items is written first */
    const ensure = (path: string): void => {
        const segments = path.split('.');
        for (let length = 3; length <= segments.length; length++) {
            const prefix = segments.slice(0, length).join('.');
            if (read(prefix) === undefined) store.set(prefix, {});
        }
    };

    const durationOf = (tone: string): number => {
        const value = read(`${basePath}.duration`);
        if (typeof value === 'number' && value >= 0) return value;
        return tone === 'danger' ? 0 : DEFAULT_DURATION;
    };

    const stop = (toast: Shown): void => {
        if (toast.timer !== undefined) clearTimeout(toast.timer);
        toast.timer = undefined;
    };

    const start = (id: string, toast: Shown): void => {
        stop(toast);
        if (toast.duration <= 0 || toast.hover || toast.focus) return;
        toast.timer = setTimeout(() => remove(id), toast.duration);
    };

    function remove(id: string): void {
        const toast = shown.get(id);
        if (!toast) return;
        stop(toast);
        shown.delete(id);
        store.delete(`${itemsPath}.${id}`);
        element.dispatchEvent(new CustomEvent('close', { detail: { key: toast.key }, bubbles: true, composed: true }));
        pump();
    }

    const messageOf = (key: string): Entry | undefined => {
        const messages = read(`${basePath}.messages`);
        if (!isEntry(messages) || !Object.hasOwn(messages, key)) return undefined;
        const message: unknown = JSON.parse(JSON.stringify(messages[key]));
        return isEntry(message) ? message : undefined;
    };

    const display = (key: string): void => {
        const message = messageOf(key);
        if (!message) return;
        const tone = text(message['tone']) || 'neutral';
        const node: Entry = {
            tone,
            icon: '',
            dismissible: true,
            glyph: '',
            closeGlyph: 'x',
            _title: text(message['_title']),
            _text: text(message['_text']),
            _closeLabel: text(read(`${basePath}._closeLabel`))
        };
        if (isEntry(message['action'])) node['action'] = message['action'];
        counter += 1;
        const id = `t${counter}`;
        const toast: Shown = { key, duration: durationOf(tone), timer: undefined, hover: false, focus: false };
        shown.set(id, toast);
        ensure(itemsPath);
        const path = `${itemsPath}.${id}`;
        store.set(path, {});
        for (const [name, value] of Object.entries(node)) if (name !== 'component') store.set(`${path}.${name}`, value);
        store.set(`${path}.component`, 'toast');
        start(id, toast);
    };

    function pump(): void {
        if (disposed) return;
        while (shown.size < maxToasts() && queue.length > 0) display(queue.shift() as string);
    }

    const show = (value?: unknown): void => {
        if (typeof value !== 'string' || messageOf(value) === undefined) {
            throw new Error(`toastRegion has no message "${String(value)}"`);
        }
        queue.push(value);
        pump();
    };

    const dismissAll = (): void => {
        queue.length = 0;
        for (const id of Array.from(shown.keys())) remove(id);
    };

    const holder = (event: Event): { id: string; toast: Shown } | undefined => {
        const id = (event.currentTarget as HTMLElement | null)?.dataset['id'];
        const toast = id === undefined ? undefined : shown.get(id);
        return id !== undefined && toast ? { id, toast } : undefined;
    };

    host.commands = { show, dismissAll };
    const watched = [`${basePath}.max`];
    store.on(watched, pump);
    ensure(itemsPath);
    //the controller runs while the node renders, and removing the default of `items` there would render the node again
    queueMicrotask(() => {
        if (disposed) return;
        if (read(listPath) !== undefined) store.delete(listPath);
        store.link(listPath, itemsPath);
    });
    return {
        onEnter: (event: Event) => {
            const found = holder(event);
            if (!found) return;
            if (event.type === 'focusin') found.toast.focus = true;
            else found.toast.hover = true;
            stop(found.toast);
        },
        onLeave: (event: Event) => {
            const found = holder(event);
            if (!found) return;
            found.toast.hover = false;
            start(found.id, found.toast);
        },
        onFocusOut: (event: Event) => {
            const found = holder(event);
            if (!found) return;
            const next = (event as FocusEvent).relatedTarget;
            if (next instanceof Node && (event.currentTarget as Node).contains(next)) return;
            found.toast.focus = false;
            start(found.id, found.toast);
        },
        onClose: (event: Event) => {
            event.stopPropagation();
            const found = holder(event);
            if (found) remove(found.id);
        },
        dispose: () => {
            disposed = true;
            store.off(watched, pump);
            for (const toast of shown.values()) stop(toast);
            shown.clear();
            queue.length = 0;
            store.unlink(listPath);
            store.delete(itemsPath);
            delete host.commands;
        }
    };
}
