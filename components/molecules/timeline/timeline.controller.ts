import type { ControllerContext } from '@punyts/stateui';

/** One event the view draws: its title, time and text as given, its icon and its tone (empty for the timeline's own) */
interface Row {
    readonly title: string;
    readonly time: string;
    readonly text: string;
    readonly icon: string;
    readonly tone: string;
}

const TONES: readonly string[] = ['neutral', 'accent', 'danger', 'warning', 'success', 'info'];

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The event as the view draws it: `_title` before `title`, a tone outside the list left to the timeline's own */
function rowOf(entry: Record<string, unknown>): Row {
    const title = text(entry['_title']) !== '' ? text(entry['_title']) : text(entry['title']);
    const tone = text(entry['tone']);
    return { title, time: text(entry['time']), text: text(entry['text']), icon: text(entry['icon']), tone: TONES.includes(tone) ? tone : '' };
}

/**
 * Keeps the runtime `rows` (keyed `e0`, `e1`, ... in the order given) in step with `entries`, a list or a map in key
 * order of `{ _title or title, time, text, icon, tone }`. The order is the author's: a newest-first history is given
 * newest first. `time` is shown as given, never parsed. The view draws the rows as an `<ol>` named by `_label`, each
 * with a dot (or its icon) on the line at the start edge, painted in its own `tone` or else the timeline's; with no
 * entries it shows `_empty` instead
 */
export default function controller({ store, basePath }: ControllerContext) {
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const refresh = (): void => {
        const entries = read('entries');
        const list: unknown[] = Array.isArray(entries) ? entries : typeof entries === 'object' && entries !== null ? Object.values(entries) : [];
        const rows: Record<string, Row> = {};
        list.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null && !Array.isArray(entry)).forEach((entry, index) => {
            rows[`e${index}`] = rowOf(entry);
        });
        store.set(`${basePath}.rows`, rows);
    };
    const watched = [`${basePath}.entries`, `${basePath}.entries.$all`];
    store.on(watched, refresh);
    refresh();
    return {
        /** Whether there is an event to list, so an empty list is not announced */
        hasRows: (rows: unknown): boolean => typeof rows === 'object' && rows !== null && Object.keys(rows).length > 0,
        dispose: () => {
            store.off(watched, refresh);
        }
    };
}
