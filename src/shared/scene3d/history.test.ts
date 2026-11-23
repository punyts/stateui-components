import type { JsonValue } from '@punyts/stateui-app/core';
import { MESH_HISTORY_LIMIT, MeshHistory, historyKey } from './history.js';

const PATH = '$.app.children.shape.geometry';

/** A store of one value, read as the controller reads the store */
function holder(value: JsonValue): { value: JsonValue; read: (path: string) => JsonValue | undefined } {
    const held = { value, read: (path: string) => (path === PATH ? held.value : undefined) };
    return held;
}

describe('MeshHistory', () => {
    it('should undo an edit to the value before it and redo it to the value after', () => {
        // Arrange
        const history = new MeshHistory();
        const store = holder({ v: 2 });
        history.record(PATH, { v: 1 }, { v: 2 });

        // Act
        const undone = history.undo(store.read);
        store.value = { v: 1 };
        const redone = history.redo(store.read);

        // Assert
        expect(undone).toEqual({ path: PATH, value: { v: 1 } });
        expect(redone).toEqual({ path: PATH, value: { v: 2 } });
        expect(history.has('redo')).toBe(false);
        expect(history.has('undo')).toBe(true);
    });

    it('should skip and forget an edit whose mesh someone else changed since, and undo the one before on another mesh', () => {
        // Arrange
        const OTHER = '$.app.children.other.geometry';
        const history = new MeshHistory();
        history.record(PATH, { v: 1 }, { v: 2 });
        history.record(OTHER, { w: 1 }, { w: 2 });
        const values: Record<string, JsonValue> = { [PATH]: { v: 2 }, [OTHER]: { w: 7 } };

        // Act: someone else made the other mesh 7 after the second edit
        const undone = history.undo((path) => values[path]);
        const more = history.undo((path) => values[path]);

        // Assert
        expect(undone).toEqual({ path: PATH, value: { v: 1 } });
        expect(more).toBeUndefined();
        expect(history.has('redo')).toBe(true);
    });

    it('should forget what was undone when a new edit is made', () => {
        // Arrange
        const history = new MeshHistory();
        history.record(PATH, { v: 1 }, { v: 2 });
        history.undo(holder({ v: 2 }).read);

        // Act
        history.record(PATH, { v: 1 }, { v: 5 });

        // Assert
        expect(history.has('redo')).toBe(false);
    });

    it('should keep the latest edits up to the limit', () => {
        // Arrange
        const history = new MeshHistory();
        for (let at = 0; at <= MESH_HISTORY_LIMIT; at += 1) history.record(PATH, at, at + 1);
        let value: JsonValue = MESH_HISTORY_LIMIT + 1;

        // Act
        let steps = 0;
        for (let step = history.undo(() => value); step !== undefined; step = history.undo(() => value)) {
            value = step.value;
            steps += 1;
        }

        // Assert
        expect(steps).toBe(MESH_HISTORY_LIMIT);
        expect(value).toBe(1);
    });

    it('should keep its own copy of a value the store changes later', () => {
        // Arrange
        const history = new MeshHistory();
        const before = { vertices: [[0, 0, 0]] };
        history.record(PATH, before, { vertices: [[1, 0, 0]] });
        before.vertices[0] = [5, 5, 5];

        // Act
        const undone = history.undo(holder({ vertices: [[1, 0, 0]] }).read);

        // Assert
        expect(undone?.value).toEqual({ vertices: [[0, 0, 0]] });
    });

    it('should read Ctrl+Z and Cmd+Z as undo, with Shift as redo, and nothing else', () => {
        // Arrange
        const key = (key: string, held: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...held });

        // Act and assert
        expect(historyKey(key('z', { ctrlKey: true }))).toBe('undo');
        expect(historyKey(key('z', { metaKey: true }))).toBe('undo');
        expect(historyKey(key('Z', { ctrlKey: true, shiftKey: true }))).toBe('redo');
        expect(historyKey(key('z'))).toBeUndefined();
        expect(historyKey(key('z', { ctrlKey: true, altKey: true }))).toBeUndefined();
        expect(historyKey(key('y', { ctrlKey: true }))).toBeUndefined();
    });
});
