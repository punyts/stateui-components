import type { ControllerContext } from '@punyts/stateui';

type Entry = Record<string, unknown>;

const isEntry = (value: unknown): value is Entry => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** What a source row shows: its number, a link only for an http or https URL, the host, the title and the excerpt */
interface SourceRow {
    number: number;
    href: string;
    host: string;
    title: string;
    excerpt: string;
}

/** The URL of a source as a link, and its host; anything but http and https is no link, so a source never runs script */
function linkOf(url: string): { href: string; host: string } {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { href: '', host: '' };
        return { href: parsed.href, host: parsed.hostname.replace(/^www\./, '') };
    } catch {
        return { href: '', host: '' };
    }
}

/**
 * Keeps the runtime `rows` in step with `items`: each source numbered from 1 in key order, its title (the host, then
 * the key, when it has none), its host and its excerpt. Only an http or https `url` becomes a link, opened in a new tab
 * with `noopener`; a number in an answer's text (`[1]`) points at the row of that number
 */
export default function controller({ store, basePath }: ControllerContext) {
    const itemsPath = `${basePath}.items`;
    const rowsPath = `${basePath}.rows`;
    const watched = [itemsPath, `${itemsPath}.$all`];

    const sync = (): void => {
        const items = store.get<unknown>(itemsPath);
        const rows: Record<string, SourceRow> = {};
        if (isEntry(items)) {
            let number = 0;
            for (const [key, item] of Object.entries(items)) {
                if (!isEntry(item)) continue;
                number += 1;
                const { href, host } = linkOf(text(item['url']));
                rows[key] = { number, href, host, title: text(item['_title']) || host || key, excerpt: text(item['_excerpt']) };
            }
        }
        if (JSON.stringify(store.get<unknown>(rowsPath)) !== JSON.stringify(rows)) store.replace(rowsPath, rows);
    };
    store.on(watched, sync);
    sync();
    return {
        dispose: () => store.off(watched, sync)
    };
}
