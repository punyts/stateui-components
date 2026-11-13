import type { ControllerContext } from '@punyts/stateui';

interface CommandHost {
    commands?: Record<string, () => void>;
}

/** How long the copy button says `_copied` after a copy, in milliseconds */
const COPIED_MS = 2000;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Shows `code` as given in a `<pre><code>`, one block per line (the runtime `lines`, keyed `l0`, `l1`, ...) when
 * `lineNumbers` is on, so each line gets its number from a CSS counter that is not part of the text. The block scrolls
 * across unless `wrap` is on, and it is a focusable region named by `language` or else `_label`, so a keyboard can
 * scroll it. The copy button (and the command `copy`) writes `code` to the clipboard with `navigator.clipboard`; once it
 * is written the button says `_copied` for two seconds (the runtime `copied`, also spoken by a polite status), and `copy`
 * is raised with `{ text }`. When the clipboard refuses, nothing is raised. A native `copy` event of a selection inside
 * the block stops at the block, so the host raises only its own
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const refresh = (): void => {
        const lines: Record<string, { text: string }> = {};
        text(read('code'))
            .split(/\r\n|\r|\n/)
            .forEach((line, index) => {
                lines[`l${index}`] = { text: line };
            });
        store.set(`${basePath}.lines`, lines);
    };
    const watched = [`${basePath}.code`];
    store.on(watched, refresh);
    refresh();

    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const copy = async (): Promise<void> => {
        const code = text(read('code'));
        try {
            await navigator.clipboard.writeText(code);
        } catch {
            return;
        }
        if (disposed) return;
        store.set(`${basePath}.copied`, true);
        clearTimeout(timer);
        timer = setTimeout(() => {
            timer = undefined;
            if (!disposed) store.set(`${basePath}.copied`, false);
        }, COPIED_MS);
        element.dispatchEvent(new CustomEvent('copy', { detail: { text: code }, bubbles: true, composed: true }));
    };
    const host = element as Element & CommandHost;
    host.commands = {
        copy: () => void copy()
    };
    return {
        /** The name of the code region: the language when there is one, else `_label` */
        regionLabel: (language: unknown, label: unknown): string => (text(language).trim() !== '' ? text(language).trim() : text(label)),
        onCopy: () => void copy(),
        // A copy of a selection is the browser's own; the host raises only the button's `copy`
        onNativeCopy: (event: Event) => {
            event.stopPropagation();
        },
        dispose: () => {
            disposed = true;
            clearTimeout(timer);
            store.off(watched, refresh);
            delete host.commands;
        }
    };
}
