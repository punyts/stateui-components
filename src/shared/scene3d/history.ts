import type { JsonValue } from '@punyts/stateui-app/core';

/**
 * The undo history of the meshes a person edits in a scene (docs/design/stateui-mesh-editor.md, V3). It lives in the
 * page and is never written to state: each entry is a mesh's `geometry` before and after one edit made here
 */

/** The edits a scene keeps, the oldest dropped first */
export const MESH_HISTORY_LIMIT = 100;

/** One edit: the state path of a mesh's `geometry`, and its value before and after */
interface MeshEdit {
    readonly path: string;
    readonly before: JsonValue;
    readonly after: JsonValue;
}

/** A value to write back: the path and the value */
export interface HistoryStep {
    readonly path: string;
    readonly value: JsonValue;
}

const same = (a: JsonValue | undefined, b: JsonValue): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A copy of a value read from the store, so a later change there does not reach the history */
const copy = (value: JsonValue | undefined): JsonValue => (value === undefined ? null : (JSON.parse(JSON.stringify(value)) as JsonValue));

/**
 * The edits made in this page, to undo and redo. An undo or redo whose mesh changed since (someone else's change, or a
 * write from logic) is skipped and forgotten, so it never takes back another person's work
 */
export class MeshHistory {
    private done: MeshEdit[] = [];
    private undone: MeshEdit[] = [];

    /** An edit made here: kept to undo, and what was undone is no longer redone */
    record(path: string, before: JsonValue | undefined, after: JsonValue): void {
        this.done.push({ path, before: copy(before), after: copy(after) });
        if (this.done.length > MESH_HISTORY_LIMIT) this.done.shift();
        this.undone = [];
    }

    /** True when there is an edit to undo (`undo`) or to redo (`redo`) */
    has(step: 'undo' | 'redo'): boolean {
        return (step === 'undo' ? this.done : this.undone).length > 0;
    }

    /** The latest edit whose mesh still has its value after, to write back as it was before */
    undo(read: (path: string) => JsonValue | undefined): HistoryStep | undefined {
        for (let edit = this.done.pop(); edit !== undefined; edit = this.done.pop()) {
            if (!same(read(edit.path), edit.after)) continue;
            this.undone.push(edit);
            return { path: edit.path, value: copy(edit.before) };
        }
        return undefined;
    }

    /** The latest undone edit whose mesh still has its value before, to write again */
    redo(read: (path: string) => JsonValue | undefined): HistoryStep | undefined {
        for (let edit = this.undone.pop(); edit !== undefined; edit = this.undone.pop()) {
            if (!same(read(edit.path), edit.before)) continue;
            this.done.push(edit);
            return { path: edit.path, value: copy(edit.after) };
        }
        return undefined;
    }
}

/** The history step a key press asks for: Ctrl+Z (Cmd on macOS) undoes, with Shift it redoes; Alt held asks for none */
export function historyKey(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): 'undo' | 'redo' | undefined {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'z') return undefined;
    return event.shiftKey ? 'redo' : 'undo';
}
