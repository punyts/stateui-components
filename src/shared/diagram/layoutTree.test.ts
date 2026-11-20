import { describe, expect, it } from 'vitest';
import { layoutTree } from './layoutTree.js';
import type { TreeNodeIn } from './layoutTree.js';

const card = (id: string, parent: string | null, width = 100, height = 20): TreeNodeIn => ({ id, parent, width, height });

const at = (output: ReturnType<typeof layoutTree>, id: string) => {
    const found = output.nodes.find((node) => node.id === id);
    if (found === undefined) throw new Error(`no node ${id}`);
    return found;
};

describe('layoutTree', () => {
    it('should put the root at the left and each level a column further out, a parent across from the middle of its children', () => {
        // Arrange
        const nodes = [card('app', null), card('data', 'app'), card('a', 'data'), card('b', 'data')];

        // Act
        const output = layoutTree({ nodes });

        // Assert
        expect(at(output, 'app').x).toBe(0);
        expect(at(output, 'data').x).toBe(100 + 72);
        expect(at(output, 'a').x).toBe(100 + 72 + 100 + 72);
        expect(at(output, 'b').y - at(output, 'a').y).toBe(20 + 10);
        expect(at(output, 'data').y).toBe((at(output, 'a').y + at(output, 'b').y) / 2);
        expect(at(output, 'app').y).toBe(at(output, 'data').y);
        expect(output.width).toBe(3 * 100 + 2 * 72);
        expect(output.height).toBe(20 + 10 + 20);
        expect(output.nodes.every((node) => node.side === 1)).toBe(true);
    });

    it('should share the root\'s branches between two sides where the heights come closest', () => {
        // Arrange
        const nodes = [card('app', null), card('one', 'app'), card('two', 'app'), card('three', 'app'), card('four', 'app')];

        // Act
        const output = layoutTree({ nodes, options: { twoSided: true } });

        // Assert
        expect(output.nodes.map((node) => [node.id, node.side])).toEqual([['app', 1], ['one', 1], ['two', 1], ['three', -1], ['four', -1]]);
        expect(at(output, 'three').x + 100 + 72).toBe(at(output, 'app').x);
        expect(at(output, 'one').x).toBe(at(output, 'app').x + 100 + 72);
    });

    it('should put a card deeper than the shared columns just beside its parent', () => {
        // Arrange
        const nodes = [card('app', null), card('data', 'app', 300), card('orders', 'data', 60), card('field', 'orders'), card('model', 'app', 50), card('x', 'model', 40), card('y', 'x')];

        // Act
        const output = layoutTree({ nodes, options: { columns: 2 } });

        // Assert
        expect(at(output, 'orders').x).toBe(at(output, 'x').x);
        expect(at(output, 'field').x).toBe(at(output, 'orders').x + 60 + 72);
        expect(at(output, 'y').x).toBe(at(output, 'x').x + 40 + 72);
    });

    it('should draw a tree edge from parent to child and a link across, with the link\'s kind', () => {
        // Arrange
        const nodes = [card('app', null), card('a', 'app'), card('b', 'app')];

        // Act
        const output = layoutTree({ nodes, links: [{ from: 'a', to: 'b', kind: 'uses' }, { from: 'a', to: 'missing' }] });

        // Assert
        expect(output.edges.map((edge) => [edge.from, edge.to, edge.kind])).toEqual([['app', 'a', 'tree'], ['app', 'b', 'tree'], ['a', 'b', 'uses']]);
        const tree = output.edges[0]!;
        expect(tree.path.startsWith(`M100,${at(output, 'app').y + 10} C`)).toBe(true);
        expect(tree.path.endsWith(`${at(output, 'a').x},${at(output, 'a').y + 10}`)).toBe(true);
    });

    it('should stack several roots in the first column and leave out a card in a cycle', () => {
        // Arrange
        const nodes = [card('one', null), card('two', null), card('loopA', 'loopB'), card('loopB', 'loopA'), card('lost', 'nobody')];

        // Act
        const output = layoutTree({ nodes });

        // Assert
        expect(output.nodes.map((node) => node.id)).toEqual(['one', 'two', 'lost']);
        expect(output.nodes.map((node) => node.x)).toEqual([0, 0, 0]);
        expect(output.edges).toEqual([]);
        expect(at(output, 'one').y).toBe(0);
    });

    it('should give an empty layout for no cards and treat a size that is not a number as 0', () => {
        // Act
        const empty = layoutTree({ nodes: [] });
        const odd = layoutTree({ nodes: [{ id: 'a', parent: null, width: Number.NaN, height: -4 }] });

        // Assert
        expect(empty).toEqual({ nodes: [], edges: [], width: 0, height: 0 });
        expect(odd.nodes).toEqual([{ id: 'a', x: 0, y: 0, side: 1 }]);
    });
    it('should wrap the leaves of a card that wrap into one block of rows, with one edge to it, mirrored on the left side', () => {
        // Arrange
        const leaf = (id: string, parent: string) => ({ id, parent, width: 50, height: 20, wrap: true });
        const nodes = [card('app', null), card('right', 'app'), leaf('r1', 'right'), leaf('r2', 'right'), leaf('r3', 'right'), card('left', 'app'), leaf('l1', 'left'), leaf('l2', 'left'), card('single', 'left'), leaf('alone', 'single')];

        // Act
        const output = layoutTree({ nodes, options: { leafBlock: 115, twoSided: true, rowGap: 10, columnGap: 72 } });

        // Assert
        const [r1, r2, r3] = ['r1', 'r2', 'r3'].map((id) => at(output, id));
        expect(r2!.x).toBe(r1!.x + 60);
        expect(r2!.y).toBe(r1!.y);
        expect([r3!.x, r3!.y]).toEqual([r1!.x, r1!.y + 30]);
        expect(at(output, 'r1').x).toBe(at(output, 'right').x + 100 + 72);
        const [l1, l2] = ['l1', 'l2'].map((id) => at(output, id));
        expect(l1!.side).toBe(-1);
        expect(l1!.x).toBe(l2!.x + 60);
        expect(l1!.x + 50).toBe(at(output, 'left').x - 72);
        const tree = output.edges.filter((edge) => edge.kind === 'tree').map((edge) => edge.from + '>' + edge.to);
        expect(tree).toEqual(expect.arrayContaining(['right>r1', 'left>l1', 'single>alone']));
        expect(tree).not.toContain('right>r2');
        expect(tree).not.toContain('left>l2');
    });
});
