import { describe, expect, it } from 'vitest';
import { placeholderKey } from './placeholder.js';
import { buildTree, flattenModel, flattenTree } from './tree.js';
import type { TreeOptions } from './tree.js';

const options: TreeOptions = { key: 'id', parentField: 'parentId', childrenField: '', hasChildrenField: 'hasChildren' };
const keysOf = (records: unknown, expanded: string[], used: TreeOptions = options): string[] =>
    flattenTree(records, used, expanded).rows.map((row) => row.key);
const levelsOf = (records: unknown, expanded: string[], used: TreeOptions = options): [string, number][] =>
    flattenTree(records, used, expanded).rows.map((row) => [row.key, row.level]);

const nested = [
    { id: 'a' },
    { id: 'a1', parentId: 'a' },
    { id: 'a2', parentId: 'a' },
    { id: 'a2x', parentId: 'a2' },
    { id: 'b' },
    { id: 'b1', parentId: 'b' }
];

describe('flattenTree', () => {
    it('should list flat records as roots in record order, all at level 0', () => {
        // Arrange
        const records = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];

        // Act
        const flat = flattenTree(records, options, []);

        // Assert
        expect(flat.rows.map((row) => [row.key, row.level])).toEqual([['x', 0], ['y', 0], ['z', 0]]);
        expect(flat.cyclic).toEqual([]);
    });

    it('should show only the roots while nothing is expanded', () => {
        // Assert
        expect(keysOf(nested, [])).toEqual(['a', 'b']);
    });

    it('should put the children of an expanded record after it, in record order, with their levels', () => {
        // Assert
        expect(levelsOf(nested, ['a'])).toEqual([['a', 0], ['a1', 1], ['a2', 1], ['b', 0]]);
        expect(levelsOf(nested, ['a', 'a2', 'b'])).toEqual([
            ['a', 0],
            ['a1', 1],
            ['a2', 1],
            ['a2x', 2],
            ['b', 0],
            ['b1', 1]
        ]);
    });

    it('should not show the descendants of a collapsed record even when they are in expanded', () => {
        // Assert
        expect(keysOf(nested, ['a2x', 'a2'])).toEqual(['a', 'b']);
    });

    it('should order children by record order whatever the order of the keys in expanded', () => {
        // Assert
        expect(keysOf(nested, ['b', 'a'])).toEqual(['a', 'a1', 'a2', 'b', 'b1']);
    });

    it('should keep a child that comes before its parent in the records under that parent', () => {
        // Arrange
        const records = [{ id: 'kid', parentId: 'p' }, { id: 'p' }, { id: 'q' }];

        // Assert
        expect(keysOf(records, ['p'])).toEqual(['p', 'kid', 'q']);
    });

    it('should treat a record whose parent is not among the records as a root', () => {
        // Arrange
        const records = [{ id: 'a' }, { id: 'lost', parentId: 'gone' }];

        // Assert
        expect(keysOf(records, [])).toEqual(['a', 'lost']);
    });

    it('should read a keyed map of records by its keys, and numbers as keys', () => {
        // Arrange
        const map = { one: { name: 'One' }, two: { name: 'Two', parentId: 'one' } };
        const numbered = [{ id: 1 }, { id: 2, parentId: 1 }];

        // Assert
        expect(keysOf(map, ['one'])).toEqual(['one', 'two']);
        expect(keysOf(numbered, ['1'])).toEqual(['1', '2']);
    });

    it('should read the children from childrenField when it is set, in the listed order', () => {
        // Arrange
        const used: TreeOptions = { ...options, childrenField: 'kids' };
        const records = [
            { id: 'r', kids: ['c', 'a', 'missing', 'a'] },
            { id: 'a' },
            { id: 'c', kids: ['d'] },
            { id: 'd' }
        ];

        // Assert
        expect(levelsOf(records, ['r', 'c'], used)).toEqual([['r', 0], ['c', 1], ['d', 2], ['a', 1]]);
    });

    it('should number the siblings with setsize and posinset', () => {
        // Act
        const rows = flattenTree(nested, options, ['a']).rows;

        // Assert
        expect(rows.map((row) => [row.key, row.posinset, row.setsize])).toEqual([['a', 1, 2], ['a1', 1, 2], ['a2', 2, 2], ['b', 2, 2]]);
    });

    it('should tell expandable, expanded and unloaded records apart', () => {
        // Arrange
        const records = [{ id: 'leaf' }, { id: 'lazy', hasChildren: true }, { id: 'full' }, { id: 'kid', parentId: 'full' }];

        // Act
        const rows = Object.fromEntries(flattenTree(records, options, ['lazy', 'full', 'leaf']).rows.map((row) => [row.key, row]));

        // Assert
        expect(rows['leaf']).toMatchObject({ expandable: false, expanded: false, unloaded: false });
        expect(rows['lazy']).toMatchObject({ expandable: true, expanded: true, unloaded: true });
        expect(rows['full']).toMatchObject({ expandable: true, expanded: true, unloaded: false });
    });

    it('should put one placeholder row under an expanded record that is marked and has no children loaded', () => {
        // Arrange
        const records = [{ id: 'lazy', hasChildren: true }, { id: 'other' }];

        // Act
        const rows = flattenTree(records, options, ['lazy']).rows;

        // Assert
        expect(rows.map((row) => [row.key, row.level, row.placeholder])).toEqual([
            ['lazy', 0, false],
            [placeholderKey('lazy'), 1, true],
            ['other', 0, false]
        ]);
        expect(rows[1]).toMatchObject({ parent: 'lazy', expandable: false, setsize: 1, posinset: 1 });
    });

    it('should show no placeholder while the marked record is closed, and none once its children are loaded', () => {
        // Arrange
        const marked = [{ id: 'lazy', hasChildren: true }];
        const loaded = [{ id: 'lazy', hasChildren: true }, { id: 'c', parentId: 'lazy' }];

        // Assert
        expect(flattenTree(marked, options, []).rows.map((row) => row.placeholder)).toEqual([false]);
        expect(flattenTree(loaded, options, ['lazy']).rows.map((row) => row.placeholder)).toEqual([false, false]);
    });

    it('should not call a record unloaded once children are present, whatever its marker says', () => {
        // Arrange
        const records = [{ id: 'p', hasChildren: true }, { id: 'c', parentId: 'p' }];

        // Act
        const rows = flattenTree(records, options, ['p']).rows;

        // Assert
        expect(rows.map((row) => [row.key, row.unloaded])).toEqual([['p', false], ['c', false]]);
    });

    it('should leave out a cycle of parent keys and everything below it, and name the hidden keys', () => {
        // Arrange
        const records = [
            { id: 'ok' },
            { id: 'x', parentId: 'y' },
            { id: 'y', parentId: 'x' },
            { id: 'below', parentId: 'x' },
            { id: 'self', parentId: 'self' }
        ];

        // Act
        const flat = flattenTree(records, options, ['ok', 'x', 'y', 'self']);

        // Assert
        expect(flat.rows.map((row) => row.key)).toEqual(['ok']);
        expect(flat.cyclic.sort()).toEqual(['below', 'self', 'x', 'y']);
    });

    it('should show the rest of the tree when one branch is cyclic', () => {
        // Arrange
        const records = [{ id: 'a' }, { id: 'a1', parentId: 'a' }, { id: 'p', parentId: 'q' }, { id: 'q', parentId: 'p' }];

        // Assert
        expect(keysOf(records, ['a', 'p'])).toEqual(['a', 'a1']);
    });

    it('should show a record once when childrenField lists it under two parents', () => {
        // Arrange
        const used: TreeOptions = { ...options, childrenField: 'kids' };
        const records = [{ id: 'p', kids: ['c'] }, { id: 'q', kids: ['c'] }, { id: 'c' }];

        // Assert
        expect(keysOf(records, ['p', 'q'], used)).toEqual(['p', 'c', 'q']);
    });

    it('should return no rows for records that are not a list or a map', () => {
        // Assert
        expect(keysOf(undefined, [])).toEqual([]);
        expect(keysOf('text', [])).toEqual([]);
        expect(keysOf([1, 'a', null, { name: 'no key' }], [])).toEqual([]);
    });

    it('should flatten 10,000 records, a long chain and a wide tree, without overflowing', () => {
        // Arrange
        const chain = Array.from({ length: 10_000 }, (_unused, index) => ({ id: `n${index}`, parentId: index === 0 ? '' : `n${index - 1}` }));
        const expanded = chain.map((record) => record.id);

        // Act
        const deep = flattenTree(chain, options, expanded);

        // Assert
        expect(deep.rows).toHaveLength(10_000);
        expect(deep.rows[9_999]?.level).toBe(9_999);
        expect(flattenTree(chain, options, []).rows).toHaveLength(1);
    });
});

describe('buildTree and flattenModel', () => {
    it('should flatten one model again for another set of expanded keys', () => {
        // Arrange
        const model = buildTree(nested, options);

        // Assert
        expect(model.roots).toEqual(['a', 'b']);
        expect(flattenModel(model, new Set(['b'])).map((row) => row.key)).toEqual(['a', 'b', 'b1']);
        expect(flattenModel(model, new Set(['a'])).map((row) => row.key)).toEqual(['a', 'a1', 'a2', 'b']);
    });
});
