import { ancestorsOf, pathLabel, readTreeOptions, visibleRows } from './treeOptions.js';

const PLACES = [
    { id: 'eu', label: 'Europe' },
    { id: 'fr', label: 'France', parentId: 'eu' },
    { id: 'paris', label: 'Paris', parentId: 'fr' },
    { id: 'de', label: 'Germany', parentId: 'eu' },
    { id: 'as', label: 'Asia' }
];

describe('treeOptions', () => {
    it('should read a list into roots and children in their own order', () => {
        // Act
        const tree = readTreeOptions(PLACES, 'id', 'parentId', 'label');

        // Assert
        expect(tree.roots).toEqual(['eu', 'as']);
        expect(tree.byKey.get('eu')?.children).toEqual(['fr', 'de']);
        expect(tree.byKey.get('paris')?.parent).toBe('fr');
    });

    it('should read a keyed map, take a missing parent as a root, break a cycle at its first option, and fall back to the key for a label', () => {
        // Act
        const tree = readTreeOptions({ a: { parentId: 'b' }, b: { parentId: 'a', _label: 'Bee' }, c: { parentId: 'gone', label: 'Sea' }, d: 'not a record' }, 'id', 'parentId', 'label');

        // Assert
        expect(tree.roots).toEqual(['a', 'c']);
        expect(tree.byKey.get('a')?.children).toEqual(['b']);
        expect(tree.byKey.get('a')?.label).toBe('a');
        expect(tree.byKey.get('b')?.label).toBe('Bee');
        expect(tree.byKey.has('d')).toBe(false);
    });

    it('should show the rows of the expanded options, depth first, with their levels', () => {
        // Arrange
        const tree = readTreeOptions(PLACES, 'id', 'parentId', 'label');

        // Act
        const closed = visibleRows(tree, new Set());
        const open = visibleRows(tree, new Set(['eu', 'fr', 'paris']));

        // Assert
        expect(closed.map((row) => row.key)).toEqual(['eu', 'as']);
        expect(closed[0]).toEqual({ key: 'eu', label: 'Europe', level: 1, hasChildren: true, expanded: false });
        expect(open.map((row) => `${row.key}:${row.level}`)).toEqual(['eu:1', 'fr:2', 'paris:3', 'de:2', 'as:1']);
        expect(open.find((row) => row.key === 'paris')?.expanded).toBe(false);
    });

    it('should give the ancestors and the path of labels of an option', () => {
        // Arrange
        const tree = readTreeOptions(PLACES, 'id', 'parentId', 'label');

        // Assert
        expect(ancestorsOf(tree, 'paris')).toEqual(['eu', 'fr']);
        expect(ancestorsOf(tree, 'nowhere')).toEqual([]);
        expect(pathLabel(tree, 'paris')).toBe('Europe / France / Paris');
        expect(pathLabel(tree, 'nowhere')).toBe('');
    });
});
