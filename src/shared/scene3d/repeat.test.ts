import { createStore } from '@punyts/state';
import type { BuildError, JsonValue } from '@punyts/stateui-app/core';
import { describe, expect, it } from 'vitest';
import { INSTANCE_PROPERTIES, Repeat3dFeeder, expandRepeats3d, mixedProperties } from './repeat.js';
import { readScene3dTree } from './tree.js';
import type { Scene3dTree } from './tree.js';

const CHILDREN = '$.app.children';
const REPEAT = `${CHILDREN}.crates`;

/** A crate template as the store holds it: `$row` links kept as `<-key` */
const crate = { component: 'mesh', geometry: { kind: 'box', width: 0.5 }, '<-position': '$row.at', '<-material': '$row.paint', '<-_label': '$row.name', interactive: true };

/** A scene's children map with one repeat over `$.data.crates`, and its store */
function sceneStore(records: JsonValue, row: JsonValue = crate) {
    const store = createStore<Record<string, unknown>>({
        data: { crates: records },
        app: { component: 'scene3d', children: { crates: { component: 'repeat3d', position: [0, 1, 0], row } } }
    });
    store.link(`${REPEAT}.records`, '$.data.crates');
    return store;
}

/** The tree of the store's scene, read as the controller reads it, with its repeats bound */
function expand(store: ReturnType<typeof sceneStore>, cap?: number) {
    const read = (path: string): JsonValue | undefined => store.get<JsonValue | undefined>(path) ?? undefined;
    const { nodes } = readScene3dTree(read(CHILDREN), CHILDREN, { read });
    return expandRepeats3d(nodes, { read, resolve: (path) => store.resolve(path), cap });
}

const copyOf = (key: string, properties: Record<string, JsonValue>): Scene3dTree => ({ kind: 'mesh', key, path: `${REPEAT}.rows.${key}`, properties, children: [] });

describe('expandRepeats3d (G3.6 of the graphics epic 3)', () => {
    it('should read a repeat3d without its row and records, and bind one mesh copy per record, keyed rows.<recordKey>', () => {
        // Arrange
        const store = sceneStore([
            { id: 'a', at: [1, 0, 0], paint: { color: '#ff0000' }, name: 'Crate A' },
            { id: 'b', at: [2, 0, 0], paint: { color: '#00ff00' }, name: 'Crate B' }
        ]);

        // Act
        const { nodes, repeats } = expand(store);

        // Assert
        const [repeat] = nodes;
        expect(repeat?.kind).toBe('repeat3d');
        expect(repeat?.properties).toEqual({ position: [0, 1, 0] });
        expect(repeat?.children.map((copy) => [copy.kind, copy.key, copy.path])).toEqual([
            ['mesh', 'a', `${REPEAT}.rows.a`],
            ['mesh', 'b', `${REPEAT}.rows.b`]
        ]);
        expect(repeat?.children[1]?.properties).toEqual({
            geometry: { kind: 'box', width: 0.5 },
            interactive: true,
            position: [2, 0, 0],
            material: { color: '#00ff00' },
            _label: 'Crate B'
        });
        expect(repeats.map(({ path, binding, mixed }) => [path, binding.recordsPath, binding.cut, mixed])).toEqual([[REPEAT, '$.data.crates', undefined, []]]);
    });

    it('should bind a repeat inside a group3d, and records keyed by a map', () => {
        // Arrange
        const read = (path: string): JsonValue | undefined =>
            ({ [`${CHILDREN}.rig.children.dots.row`]: { component: 'mesh', '<-position': '$row' }, [`${CHILDREN}.rig.children.dots.records`]: { p: [0, 0, 1], q: [0, 0, 2] } })[path];
        const group: Scene3dTree = { kind: 'group3d', key: 'rig', path: `${CHILDREN}.rig`, properties: {}, children: [{ kind: 'repeat3d', key: 'dots', path: `${CHILDREN}.rig.children.dots`, properties: {}, children: [] }] };

        // Act
        const { nodes } = expandRepeats3d([group], { read });

        // Assert
        expect(nodes[0]?.children[0]?.children.map((copy) => [copy.key, copy.properties.position])).toEqual([
            ['p', [0, 0, 1]],
            ['q', [0, 0, 2]]
        ]);
    });

    it('should bind nothing for an empty or missing record set', () => {
        // Act
        const empty = expand(sceneStore([]));
        const missing = expand(sceneStore(null));

        // Assert
        expect(empty.nodes[0]?.children).toEqual([]);
        expect(missing.nodes[0]?.children).toEqual([]);
        expect([...empty.repeats, ...missing.repeats].map((repeat) => [repeat.binding.cut, repeat.binding.unknown, repeat.mixed])).toEqual([
            [undefined, [], []],
            [undefined, [], []]
        ]);
    });

    it('should cut the records at the webgl cap of 20,000 with SUI-RUN-CAP naming repeat3d', () => {
        // Arrange
        const store = sceneStore(Array.from({ length: 20_003 }, (_, index) => ({ at: [index, 0, 0] })));

        // Act
        const { nodes, repeats } = expand(store);

        // Assert
        const cut = repeats[0]?.binding.cut;
        expect(nodes[0]?.children).toHaveLength(20_000);
        expect([cut?.code, cut?.total, cut?.cap, cut?.renderer]).toEqual(['SUI-RUN-CAP', 20_003, 20_000, 'webgl']);
        expect(cut?.error.message).toContain('repeat3d');
        expect(cut?.error.message).toContain('20003 records');
    });

    it('should leave out a row that is not a mesh and list it', () => {
        // Act
        const { nodes, repeats } = expand(sceneStore([{ at: [0, 0, 0] }], { component: 'light', kind: 'point' }));

        // Assert
        expect(nodes[0]?.children).toEqual([]);
        expect(repeats[0]?.binding.unknown).toEqual([{ path: `${REPEAT}.row`, component: 'light' }]);
    });

    it('should name the shared row properties the copies differ in', () => {
        // Arrange
        const store = sceneStore(
            [
                { at: [0, 0, 0], paint: { color: '#ff0000', opacity: 1 } },
                { at: [1, 0, 0], paint: { color: '#00ff00', opacity: 0.5 } }
            ],
            { component: 'mesh', geometry: { kind: 'box' }, '<-position': '$row.at', '<-material': '$row.paint' }
        );

        // Act
        const { repeats } = expand(store);

        // Assert: the position and the colour are each instance's own
        expect(repeats[0]?.mixed).toEqual(['material.opacity']);
    });
});

describe('mixedProperties (G3.6)', () => {
    it('should allow each instance its own place, turn, size, visibility, label and colour, and nothing else', () => {
        // Arrange
        const own = Object.fromEntries(INSTANCE_PROPERTIES.map((name) => [name, name]));
        const a = copyOf('a', { geometry: { kind: 'box' }, material: { color: '#f00', roughness: 0.5 }, castShadow: true });
        const b = copyOf('b', { ...own, geometry: { kind: 'box' }, material: { roughness: 0.5, color: '#0f0' }, castShadow: true });
        const c = copyOf('c', { geometry: { kind: 'sphere' }, material: { color: '#f00' }, castShadow: false, transition: { duration: 200 } });

        // Assert
        expect(mixedProperties([])).toEqual([]);
        expect(mixedProperties([a, b])).toEqual([]);
        expect(mixedProperties([a, b, c])).toEqual(['geometry', 'material.roughness', 'castShadow', 'transition']);
    });
});

describe('Repeat3dFeeder (G3.6)', () => {
    /** A feeder over a store, with its watches and reports recorded */
    function feeder(store: ReturnType<typeof sceneStore>) {
        const watched = new Set<string>();
        const reports: [string, string][] = [];
        const read = (path: string): JsonValue | undefined => store.get<JsonValue | undefined>(path) ?? undefined;
        const feeder = new Repeat3dFeeder({
            read,
            resolve: (path) => store.resolve(path),
            cap: 3,
            on: (paths) => paths.forEach((path) => watched.add(path)),
            off: (paths) => paths.forEach((path) => watched.delete(path)),
            report: (error: BuildError, path) => void reports.push([error.code, path])
        });
        const draw = () => feeder.expand(readScene3dTree(read(CHILDREN), CHILDREN, { read }).nodes);
        return { feeder, watched, reports, draw };
    }

    it('should watch the records and a linked template value, and stop on dispose', () => {
        // Arrange
        const store = sceneStore([{ at: [0, 0, 0] }], { component: 'mesh', '<-position': '$row.at', '<-material': '$.data.paint' });
        const { feeder: repeats, watched, draw } = feeder(store);

        // Act
        draw();
        const during = [...watched].sort();
        repeats.dispose();

        // Assert
        expect(during).toEqual(['$.data.crates', '$.data.crates.$all', '$.data.paint', '$.data.paint.$all']);
        expect(watched.size).toBe(0);
    });

    it('should report a cut, a non-mesh row and a mixed property once each, and a cut again after it was undone', () => {
        // Arrange
        const store = sceneStore(
            [
                { at: [0, 0, 0], g: { kind: 'box' } },
                { at: [1, 0, 0], g: { kind: 'sphere' } },
                { at: [2, 0, 0], g: { kind: 'box' } },
                { at: [3, 0, 0], g: { kind: 'box' } }
            ],
            { component: 'mesh', '<-position': '$row.at', '<-geometry': '$row.g' }
        );
        const { reports, draw } = feeder(store);

        // Act
        draw();
        draw();
        store.set('$.data.crates', [{ at: [0, 0, 0] }]);
        draw();
        store.set('$.data.crates', [{ at: [0, 0, 0] }, { at: [0, 0, 0] }, { at: [0, 0, 0] }, { at: [0, 0, 0] }]);
        draw();

        // Assert
        expect(reports).toEqual([
            ['SUI-RUN-DRAW', REPEAT],
            ['SUI-RUN-CAP', REPEAT],
            ['SUI-RUN-CAP', REPEAT]
        ]);
    });

    it('should report a row that is not a mesh as SUI-RUN-3D at the row, once', () => {
        // Arrange
        const store = sceneStore([{}], { component: 'camera' });
        const { reports, draw } = feeder(store);

        // Act
        draw();
        draw();

        // Assert
        expect(reports).toEqual([['SUI-RUN-3D', `${REPEAT}.row`]]);
    });
});
