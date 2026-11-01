import type { ControllerContext } from '@punyts/stateui';
import { runtimePath } from '@punyts/stateui-app/core';
import type { RecordViewElement } from '../shared/records/recordView.js';

/** The properties of the message list that its `recordGrid` body reads through a link, by the body's property name */
const PASSED: Readonly<Record<string, string>> = {
    records: 'records',
    row: 'row',
    key: 'key'
};

interface CommandHost {
    commands?: Record<string, (value?: unknown) => void>;
}

/** The last record of an array, or of a keyed map, as it stands now */
const lastRecord = (records: unknown): { count: number; last: unknown } => {
    if (Array.isArray(records)) return { count: records.length, last: records[records.length - 1] };
    if (typeof records === 'object' && records !== null) {
        const values = Object.values(records);
        return { count: values.length, last: values[values.length - 1] };
    }
    return { count: 0, last: undefined };
};

/**
 * A conversation drawn by a `recordGrid` of one column: the body is a `recordGrid` node held in the runtime property `body` and
 * drawn with `<sui-node>`, like the body of a `list`. Its `records`, `row` and `key` are store aliases of the message list's own, so
 * the slot pool, the measured heights (a message is as tall as its text), the `$row` links and the recycling are the grid's. The
 * grid is written with `follow: true` and one column (`--ui-recordgrid-itemmin` is wider than any list), so it stays at the
 * newest message while records are added, or the last one grows because a reply is streaming in, unless the user has scrolled up.
 *
 * `pinned` is the grid's `atEnd`. While the user is away from the end and a message arrives or the last one changes, `unread` turns
 * on and the view shows the button `_newMessages`; pressing it, or the command `scrollToEnd`, takes the view to the end
 * and the grid follows from there. `unread` clears when the view is at the end again, however it got there.
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as Element & CommandHost;
    const runtime = runtimePath(basePath);
    const bodyPath = `${basePath}.body`;
    const recordsPath = `${basePath}.records`;
    const atEndPath = `${bodyPath}.atEnd`;
    const pinnedPath = `${basePath}.pinned`;
    const unreadPath = `${basePath}.unread`;
    let disposed = false;
    let scheduled = false;
    let seen = '';

    //the store creates no parents, so each missing object between `$.runtime.nodes` and the message list's branch is written first
    const segments = runtime.split('.');
    for (let length = 3; length <= segments.length; length++) {
        const prefix = segments.slice(0, length).join('.');
        if (store.get<unknown>(prefix) === undefined) store.set(prefix, {});
    }

    const linked: string[] = [];
    for (const [name, source] of Object.entries(PASSED)) {
        const alias = `${bodyPath}.${name}`;
        if (store.link(alias, `${basePath}.${source}`, { allowMissing: true })) linked.push(alias);
    }

    const setIfChanged = (path: string, value: unknown): void => {
        if (store.get<unknown>(path) !== value) store.set(path, value);
    };
    const body = (): RecordViewElement | undefined => element.shadowRoot?.querySelector('.messages > sui-node')?.firstElementChild ?? undefined;
    const atEnd = (): boolean => store.get<unknown>(atEndPath) !== false;

    /** What the last message is now, so a new message and a change of the last one are both noticed, and an edit above is not */
    const signature = (): string => {
        const { count, last } = lastRecord(store.get<unknown>(recordsPath));
        return `${count}|${JSON.stringify(last) ?? ''}`;
    };
    const syncEnd = (): void => {
        const end = atEnd();
        setIfChanged(pinnedPath, end);
        if (end) setIfChanged(unreadPath, false);
    };
    const onRecords = (): void => {
        if (scheduled || disposed) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            if (disposed) return;
            const next = signature();
            if (next === seen) return;
            seen = next;
            if (!atEnd()) setIfChanged(unreadPath, true);
        });
    };

    const watchedRecords = [recordsPath, `${recordsPath}.$every`, `${recordsPath}.$all`];
    store.on(watchedRecords, onRecords);
    store.on([atEndPath], syncEnd);
    seen = signature();
    syncEnd();

    const scrollToEnd = (): void => {
        setIfChanged(unreadPath, false);
        body()?.commands?.scrollToEnd?.();
    };
    host.commands = { scrollToEnd };

    return {
        onNewMessages: () => scrollToEnd(),
        dispose: () => {
            disposed = true;
            store.off(watchedRecords, onRecords);
            store.off([atEndPath], syncEnd);
            for (const alias of linked) store.unlink(alias);
            delete host.commands;
        }
    };
}
