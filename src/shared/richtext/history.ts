import type { Block, KeyedBlock } from './model.js';
import type { Edit, TextSelection } from './edit.js';

/**
 * The editor's undo history: the user's own edits, block by block, kept in the controller and never written to the
 * value. An entry holds each changed block as it was before and after the edit (null for a block that did not exist).
 * Typing in one block is grouped until a pause of `GROUP_PAUSE_MS`, a different kind of edit or a caret move. Undo skips
 * a block someone else changed since the edit, so it never takes back another person's work
 */

export const GROUP_PAUSE_MS = 1000;
export const HISTORY_LIMIT = 200;

/** What kind of edit an entry is, for grouping: only `typing` groups */
export type EditKind = 'typing' | 'other';

interface Entry {
    before: Map<string, KeyedBlock | null>;
    after: Map<string, KeyedBlock | null>;
    selectionBefore: TextSelection;
    selectionAfter: TextSelection;
    kind: EditKind;
    at: number;
}

/** The writes an undo or redo makes, and the selection after it */
export interface HistoryStep {
    written: Map<string, KeyedBlock>;
    removed: Set<string>;
    selection: TextSelection;
}

const same = (a: Block | null | undefined, b: Block | null | undefined): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface History {
    /** Records an edit made on `blocks` (the blocks before it) */
    record(blocks: readonly KeyedBlock[], edit: Edit, selectionBefore: TextSelection, kind: EditKind, now: number): void;
    /** Ends the current group, so the next typing starts a new entry */
    seal(): void;
    /** The writes that take back the last edit, given the blocks now; null when there is nothing to undo */
    undo(blocks: readonly KeyedBlock[]): HistoryStep | null;
    /** The writes that make the last undone edit again; null when there is nothing to redo */
    redo(blocks: readonly KeyedBlock[]): HistoryStep | null;
    canUndo(): boolean;
    canRedo(): boolean;
    clear(): void;
}

export function createHistory(): History {
    const done: Entry[] = [];
    const undone: Entry[] = [];
    let sealed = true;

    /** The writes that turn the blocks from `from` to `to`, skipping a block that is no longer as `from` holds it */
    const step = (blocks: readonly KeyedBlock[], from: Map<string, KeyedBlock | null>, to: Map<string, KeyedBlock | null>, selection: TextSelection): HistoryStep | null => {
        const now = new Map(blocks.map((block) => [block.key, block]));
        const written = new Map<string, KeyedBlock>();
        const removed = new Set<string>();
        for (const [key, target] of to) {
            if (!same(now.get(key), from.get(key))) continue;
            if (target === null) {
                if (now.has(key)) removed.add(key);
            } else written.set(key, target);
        }
        if (written.size === 0 && removed.size === 0) return null;
        return { written, removed, selection };
    };

    return {
        record: (blocks, edit, selectionBefore, kind, now) => {
            const byKey = new Map(blocks.map((block) => [block.key, block]));
            const keys = [...edit.written.keys(), ...edit.removed];
            const last = done[done.length - 1];
            const grouped = !sealed && kind === 'typing' && last !== undefined && last.kind === 'typing' && now - last.at < GROUP_PAUSE_MS;
            const entry: Entry = grouped
                ? (last as Entry)
                : { before: new Map(), after: new Map(), selectionBefore, selectionAfter: edit.selection, kind, at: now };
            for (const key of keys) {
                if (!entry.before.has(key)) entry.before.set(key, byKey.get(key) ?? null);
                entry.after.set(key, edit.written.get(key) ?? null);
            }
            entry.selectionAfter = edit.selection;
            entry.at = now;
            if (!grouped) {
                done.push(entry);
                if (done.length > HISTORY_LIMIT) done.shift();
            }
            undone.length = 0;
            sealed = kind !== 'typing';
        },
        seal: () => {
            sealed = true;
        },
        undo: (blocks) => {
            sealed = true;
            while (done.length > 0) {
                const entry = done.pop() as Entry;
                undone.push(entry);
                const result = step(blocks, entry.after, entry.before, entry.selectionBefore);
                if (result !== null) return result;
            }
            return null;
        },
        redo: (blocks) => {
            sealed = true;
            while (undone.length > 0) {
                const entry = undone.pop() as Entry;
                done.push(entry);
                const result = step(blocks, entry.before, entry.after, entry.selectionAfter);
                if (result !== null) return result;
            }
            return null;
        },
        canUndo: () => done.length > 0,
        canRedo: () => undone.length > 0,
        clear: () => {
            done.length = 0;
            undone.length = 0;
            sealed = true;
        }
    };
}
