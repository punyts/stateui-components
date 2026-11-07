import { createStore } from '@punyts/state';
import type { JsonObject, JsonValue } from '@punyts/stateui-app/core';
import { describe, expect, it } from 'vitest';
import { ROW_CAPS, bindRows, createRowBinder, expandRepeats, recordKeys, rowCap, targetOf } from './rows.js';
import { readShapeTree } from './tree.js';

const REPEAT = '$.app.children.map.children.seats';

/** A seat template as the store holds it: `$row` links kept as `<-key`, a default beside one of them */
const seat: JsonObject = {
    component: 'rect',
    width: 8,
    height: 8,
    x: 0,
    '<-x': '$row.x',
    '<-y': '$row.y',
    '<-fill': '$row.fill'
};

describe('bindRows', () => {
    it('should resolve literals as written and $row links from each record, keyed rows.<recordKey>', () => {
        // Arrange
        const records = { a: { x: 1, y: 2, fill: '{color.accent.base}' }, b: { x: 3, y: 4, fill: '#fff' } };

        // Act
        const { copies, cut, errors } = bindRows(seat, records, { path: REPEAT, renderer: 'svg' });

        // Assert
        expect(cut).toBeUndefined();
        expect(errors).toEqual([]);
        expect(copies.map((copy) => [copy.kind, copy.key, copy.path])).toEqual([
            ['rect', 'a', `${REPEAT}.rows.a`],
            ['rect', 'b', `${REPEAT}.rows.b`]
        ]);
        expect(copies[0]?.properties).toEqual({ width: 8, height: 8, x: 1, y: 2, fill: '{color.accent.base}' });
        expect(copies[1]?.properties).toEqual({ width: 8, height: 8, x: 3, y: 4, fill: '#fff' });
    });

    it('should report the record path of each $row property with targetOf, and none for a literal', () => {
        // Arrange
        const records = { s1: { x: 1, y: 2, pos: { left: 5 } } };
        const template = { component: 'circle', r: 3, '<-cx': '$row.pos.left', '<-cy': '$row.y', '<-_label': '$row' };

        // Act
        const [copy] = bindRows(template, records, { path: REPEAT, renderer: 'svg', recordsPath: '$.data.seats' }).copies;

        // Assert
        expect(copy?.properties['cx']).toBe(5);
        expect(targetOf(copy!, 'cx')).toBe('$.data.seats.s1.pos.left');
        expect(targetOf(copy!, 'cy')).toBe('$.data.seats.s1.y');
        expect(targetOf(copy!, '_label')).toBe('$.data.seats.s1');
        expect(targetOf(copy!, 'r')).toBeUndefined();
        expect(targetOf(copy!, 'fill')).toBeUndefined();
    });

    it('should give record paths under the data a linked records property resolves to', () => {
        // Arrange
        const store = createStore<Record<string, unknown>>({
            data: { seats: [{ id: 'a1', x: 1, y: 1, fill: 'red' }] },
            app: { children: { map: { children: { seats: { component: 'drawRepeat', row: seat } } } } }
        });
        store.link(`${REPEAT}.records`, '$.data.seats');

        // Act
        const [copy] = bindRows(seat, store.get<JsonValue>(`${REPEAT}.records`), {
            path: REPEAT,
            renderer: 'svg',
            read: (path) => store.get<JsonValue>(path),
            resolve: (path) => store.resolve(path)
        }).copies;

        // Assert
        expect(copy?.path).toBe(`${REPEAT}.rows.a1`);
        expect(targetOf(copy!, 'x')).toBe('$.data.seats.0.x');
    });

    it('should read a link to $.data from the store once and list it in watch', () => {
        // Arrange
        const store = createStore<Record<string, unknown>>({ data: { theme: { seatFill: '#0a0' } } });
        const template = { component: 'rect', width: 8, height: 8, '<-x': '$row.x', '<-fill': '$.data.theme.seatFill' };
        const records = [{ x: 1 }, { x: 2 }];

        // Act
        const binding = bindRows(template, records, { path: REPEAT, renderer: 'svg', read: (path) => store.get<JsonValue>(path) });

        // Assert
        expect(binding.copies.map((copy) => copy.properties['fill'])).toEqual(['#0a0', '#0a0']);
        expect(binding.watch).toEqual(['$.data.theme.seatFill']);
        expect(targetOf(binding.copies[0]!, 'fill')).toBeUndefined();
        expect(binding.copies.map((copy) => copy.path)).toEqual([`${REPEAT}.rows.0`, `${REPEAT}.rows.1`]);
    });

    it('should follow a link the mount applied to the template, through properties and resolve', () => {
        // Arrange: the mount applies a link to $.data as a store alias the node object does not show
        const store = createStore<Record<string, unknown>>({
            data: { stroke: '#123' },
            app: { children: { map: { children: { seats: { component: 'drawRepeat', records: [], row: { component: 'rect', '<-x': '$row.x' } } } } } }
        });
        store.link(`${REPEAT}.row.stroke`, '$.data.stroke');

        // Act
        const binding = bindRows(store.get<JsonValue>(`${REPEAT}.row`), [{ x: 4 }], {
            path: REPEAT,
            renderer: 'svg',
            read: (path) => store.get<JsonValue>(path),
            resolve: (path) => store.resolve(path),
            properties: () => ['x', 'y', 'stroke', 'fill']
        });

        // Assert
        expect(binding.copies[0]?.properties).toEqual({ x: 4, stroke: '#123' });
        expect(binding.watch).toEqual(['$.data.stroke']);
    });

    it('should show a field a record gains later on the next bind', () => {
        // Arrange
        const records: Record<string, JsonObject> = { a: { x: 1, y: 2 } };
        const binder = createRowBinder(seat, { path: REPEAT, renderer: 'svg' });
        const before = binder.bind(records).copies[0];

        // Act
        records['a'] = { ...records['a'], fill: '#f00' };
        const after = binder.bind(records).copies[0];

        // Assert
        expect(before?.properties).not.toHaveProperty('fill');
        expect(after?.properties['fill']).toBe('#f00');
        expect(targetOf(before!, 'fill')).toBe(`${REPEAT}.records.a.fill`);
    });

    it('should leave a field the record lacks unset, without an error, and still name its record path', () => {
        // Act
        const binding = bindRows(seat, [{ y: 2 }], { path: REPEAT, renderer: 'svg' });
        const [copy] = binding.copies;

        // Assert: the default written beside the link is not used either; the shape's own default applies
        expect(copy?.properties).toEqual({ width: 8, height: 8, y: 2 });
        expect(binding.errors).toEqual([]);
        expect(binding.cut).toBeUndefined();
        expect(targetOf(copy!, 'x')).toBe(`${REPEAT}.records.0.x`);
    });

    it('should give no copies and no error for an empty or missing record set', () => {
        for (const records of [[], {}, undefined, null, 'nope']) {
            // Act
            const binding = bindRows(seat, records as JsonValue | undefined, { path: REPEAT, renderer: 'svg' });

            // Assert
            expect(binding.copies).toEqual([]);
            expect(binding.cut).toBeUndefined();
            expect(binding.errors).toEqual([]);
        }
    });

    it('should cut a record set over the cap to the cap and give one SUI-RUN-CAP', () => {
        // Arrange
        const records = Array.from({ length: 2500 }, (_value, index) => ({ x: index, y: 0 }));

        // Act
        const binding = bindRows(seat, records, { path: REPEAT, renderer: 'svg' });

        // Assert
        expect(binding.copies).toHaveLength(2000);
        expect(binding.copies.at(-1)?.properties['x']).toBe(1999);
        expect(binding.cut).toMatchObject({ code: 'SUI-RUN-CAP', path: REPEAT, total: 2500, cap: 2000, renderer: 'svg' });
        expect(binding.cut?.error).toMatchObject({ code: 'SUI-RUN-CAP', statePath: REPEAT, component: 'drawRepeat' });
        expect(binding.cut?.error.message).toBe(
            `The drawRepeat at ${REPEAT} has 2500 records, more than the 2000 the svg renderer draws; only the first 2000 are drawn`
        );
    });

    it('should take the cap per renderer, or the one given', () => {
        // Arrange
        const records = Array.from({ length: 30 }, () => ({}));

        // Act
        const exact = bindRows(seat, records.slice(0, 20), { path: REPEAT, renderer: 'canvas', cap: 20 });
        const over = bindRows(seat, records, { path: REPEAT, renderer: 'canvas', cap: 20 });

        // Assert
        expect(ROW_CAPS).toEqual({ svg: 2000, canvas: 20000, webgl: 20000 });
        expect(rowCap('canvas')).toBe(20000);
        expect(exact.copies).toHaveLength(20);
        expect(exact.cut).toBeUndefined();
        expect(over.copies).toHaveLength(20);
        expect(over.cut?.cap).toBe(20);
    });

    it('should copy a group template with its children and clip at paths below the copy', () => {
        // Arrange
        const template = {
            component: 'drawGroup',
            '<-x': '$row.x',
            children: {
                dot: { component: 'circle', r: 2, '<-fill': '$row.fill' },
                odd: { component: 'button' }
            },
            clip: { component: 'rect', width: 4, height: 4 }
        };

        // Act
        const binding = bindRows(template, { k: { x: 7, fill: 'blue' } }, { path: REPEAT, renderer: 'svg' });
        const [copy] = binding.copies;

        // Assert
        expect(copy?.properties).toEqual({ x: 7 });
        expect(copy?.children.map((child) => [child.key, child.path, child.properties])).toEqual([
            ['dot', `${REPEAT}.rows.k.children.dot`, { r: 2, fill: 'blue' }]
        ]);
        expect(copy?.clip?.path).toBe(`${REPEAT}.rows.k.clip`);
        expect(targetOf(copy!.children[0]!, 'fill')).toBe(`${REPEAT}.records.k.fill`);
        expect(binding.unknown).toEqual([{ path: `${REPEAT}.row.children.odd`, component: 'button' }]);
    });

    it('should give no copies when the template is not a shape, and list it', () => {
        // Act
        const binding = bindRows({ component: 'button' }, [{}], { path: REPEAT, renderer: 'svg' });

        // Assert
        expect(binding.copies).toEqual([]);
        expect(binding.unknown).toEqual([{ path: `${REPEAT}.row`, component: 'button' }]);
    });

    it('should leave out a link with a target the document check refuses, and return its error', () => {
        // Act
        const binding = bindRows({ component: 'rect', '<-x': '$.app.other' }, [{}], { path: REPEAT, renderer: 'svg' });

        // Assert
        expect(binding.copies[0]?.properties).toEqual({});
        expect(binding.errors.map((error) => error.code)).toEqual(['SUI-LINK-TARGET']);
    });

    it('should make one copy for a single record with copy', () => {
        // Act
        const copy = createRowBinder(seat, { path: REPEAT, renderer: 'svg', recordsPath: '$.data.list' }).copy('id7', { x: 9, y: 1 }, '3');

        // Assert
        expect(copy?.path).toBe(`${REPEAT}.rows.id7`);
        expect(copy?.properties['x']).toBe(9);
        expect(targetOf(copy!, 'x')).toBe('$.data.list.3.x');
    });

    it('should neither write to the store nor link anything over 5,000 records', () => {
        // Arrange
        const records = Array.from({ length: 5000 }, (_value, index) => ({ id: `s${index}`, x: index, y: index % 50, fill: '#abc' }));
        const store = createStore<Record<string, unknown>>({
            data: { seats: records, theme: { stroke: '#000' } },
            app: { children: { map: { children: { seats: { component: 'drawRepeat', row: { ...seat, '<-stroke': '$.data.theme.stroke' } } } } } }
        });
        store.link(`${REPEAT}.records`, '$.data.seats');
        let changes = 0;
        store.on('$', () => {
            changes += 1;
        });
        const counted = { set: 0, link: 0, delete: 0 };
        const wrap = <K extends keyof typeof counted>(name: K): void => {
            const original = (store as unknown as Record<K, (...args: unknown[]) => unknown>)[name].bind(store);
            (store as unknown as Record<K, (...args: unknown[]) => unknown>)[name] = (...args: unknown[]) => {
                counted[name] += 1;
                return original(...args);
            };
        };
        wrap('set');
        wrap('link');
        wrap('delete');

        // Act
        const binding = bindRows(store.get<JsonValue>(`${REPEAT}.row`), store.get<JsonValue>(`${REPEAT}.records`), {
            path: REPEAT,
            renderer: 'canvas',
            read: (path) => store.get<JsonValue>(path),
            resolve: (path) => store.resolve(path)
        });

        // Assert
        expect(binding.copies).toHaveLength(5000);
        expect(binding.copies[4999]?.path).toBe(`${REPEAT}.rows.s4999`);
        expect(binding.copies[4999]?.properties['stroke']).toBe('#000');
        expect(changes).toBe(0);
        expect(counted).toEqual({ set: 0, link: 0, delete: 0 });
        expect(store.get(`${REPEAT}.rows`)).toBeUndefined();
    });
});

describe('recordKeys', () => {
    it('should key an array by distinct ids, by index otherwise, and a map by its keys', () => {
        expect(recordKeys([{ id: 'a' }, { id: 2 }])).toEqual([
            { key: 'a', recordKey: '0' },
            { key: '2', recordKey: '1' }
        ]);
        expect(recordKeys([{ id: 'a' }, { id: 'a' }]).map((entry) => entry.key)).toEqual(['0', '1']);
        expect(recordKeys([{ id: 'a b' }, 4]).map((entry) => entry.key)).toEqual(['0', '1']);
        expect(recordKeys({ x: {}, y: {} })).toEqual([
            { key: 'x', recordKey: 'x' },
            { key: 'y', recordKey: 'y' }
        ]);
        expect(recordKeys(null)).toEqual([]);
    });
});

describe('expandRepeats', () => {
    it('should give each repeat, at the top or in a group, its copies as children from the raw template and the records', () => {
        // Arrange
        const ROOT = '$.app.children';
        const store = createStore<Record<string, unknown>>({
            data: { seats: { s1: { x: 1, y: 2, fill: '#f00' }, s2: { x: 3, y: 4, fill: '#0f0' } } },
            app: {
                children: {
                    top: { component: 'drawRepeat', records: [{ id: 'a', x: 9 }], row: { component: 'circle', r: 2, '<-cx': '$row.x' } },
                    set: { component: 'drawGroup', children: { seats: { component: 'drawRepeat', row: seat } } },
                    box: { component: 'rect', width: 1, height: 1 }
                }
            }
        });
        store.link(`${ROOT}.set.children.seats.records`, '$.data.seats');
        const read = (path: string): JsonValue | undefined => store.get<JsonValue | undefined>(path) ?? undefined;
        const shapes = readShapeTree(store.get<JsonValue>(ROOT), ROOT, { read }).shapes;

        // Act
        const { shapes: expanded, repeats } = expandRepeats(shapes, { renderer: 'svg', read, resolve: (path) => store.resolve(path) });

        // Assert
        expect(expanded[0]?.children.map((copy) => [copy.path, copy.properties['cx']])).toEqual([[`${ROOT}.top.rows.a`, 9]]);
        const inner = expanded[1]?.children[0];
        expect(inner?.children.map((copy) => [copy.path, copy.properties['fill']])).toEqual([
            [`${ROOT}.set.children.seats.rows.s1`, '#f00'],
            [`${ROOT}.set.children.seats.rows.s2`, '#0f0']
        ]);
        expect(targetOf(inner!.children[0]!, 'x')).toBe('$.data.seats.s1.x');
        expect(expanded[2]).toBe(shapes[2]);
        expect(shapes[0]?.children).toEqual([]);
        expect(repeats.map((repeat) => [repeat.path, repeat.binding.recordsPath])).toEqual([
            [`${ROOT}.top`, `${ROOT}.top.records`],
            [`${ROOT}.set.children.seats`, '$.data.seats']
        ]);
    });

    it('should cap the copies for the renderer and carry the cut, and give no copies for missing records', () => {
        // Arrange
        const records = Array.from({ length: 2500 }, (_value, index) => ({ id: `r${index}`, x: index }));
        const values: Record<string, JsonValue> = { [`${REPEAT}.row`]: { component: 'rect', width: 1, height: 1, '<-x': '$row.x' }, [`${REPEAT}.records`]: records };
        const tree = [{ kind: 'drawRepeat' as const, key: 'seats', path: REPEAT, properties: {}, children: [] }];

        // Act
        const svg = expandRepeats(tree, { renderer: 'svg', read: (path) => values[path] });
        const none = expandRepeats(tree, { renderer: 'svg', read: (path) => (path.endsWith('.row') ? values[path] : undefined) });

        // Assert
        expect(svg.shapes[0]?.children).toHaveLength(2000);
        expect(svg.repeats[0]?.binding.cut).toMatchObject({ code: 'SUI-RUN-CAP', total: 2500, cap: 2000 });
        expect(none.shapes[0]?.children).toEqual([]);
        expect(none.repeats[0]?.binding.cut).toBeUndefined();
    });
});
