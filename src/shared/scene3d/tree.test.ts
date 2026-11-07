import { describe, expect, it } from 'vitest';
import type { JsonValue } from '@punyts/stateui-app/core';
import { NODE3D_PROPERTIES, isScene3dError, readScene3dTree } from './tree.js';

const PATH = '$.app.children';

describe('readScene3dTree (G3.5 of the graphics epic 3)', () => {
    it('should read the 3D nodes in order, with a group3d its children and without the reserved keys', () => {
        // Act
        const { nodes, unknown } = readScene3dTree(
            {
                eye: { component: 'camera', position: [0, 0, 5], active: true },
                rig: { component: 'group3d', position: [1, 0, 0], on: { press: [] }, children: { box: { component: 'mesh', geometry: { kind: 'box' } } } },
                sun: { component: 'light', kind: 'directional', intensity: 2 }
            },
            PATH
        );

        // Assert
        expect(unknown).toEqual([]);
        expect(nodes.map((node) => [node.kind, node.key, node.path])).toEqual([
            ['camera', 'eye', `${PATH}.eye`],
            ['group3d', 'rig', `${PATH}.rig`],
            ['light', 'sun', `${PATH}.sun`]
        ]);
        expect(nodes[1]?.properties).toEqual({ position: [1, 0, 0] });
        expect(nodes[1]?.children).toEqual([{ kind: 'mesh', key: 'box', path: `${PATH}.rig.children.box`, properties: { geometry: { kind: 'box' } }, children: [] }]);
        expect(nodes[0]?.children).toEqual([]);
    });

    it('should leave out and list a node that is not a 3D node, with its subtree, and skip an empty entry', () => {
        // Act
        const { nodes, unknown } = readScene3dTree(
            { box: { component: 'mesh' }, square: { component: 'rect', children: { inner: { component: 'mesh' } } }, odd: 3, none: null },
            PATH
        );

        // Assert
        expect(nodes.map((node) => node.key)).toEqual(['box']);
        expect(unknown).toEqual([
            { path: `${PATH}.square`, component: 'rect' },
            { path: `${PATH}.odd`, component: '' }
        ]);
    });

    it('should read properties through the store, following a link in either form and one the mount applied', () => {
        // Arrange
        const store: Record<string, JsonValue> = {
            [`${PATH}.box.position`]: [0, 2, 0],
            [`${PATH}.box.material`]: { color: '#ff0000' },
            [`${PATH}.box.visible`]: false
        };

        // Act
        const { nodes } = readScene3dTree({ box: { component: 'mesh', position: [0, 0, 0], '<-material': '$.data.paint' } }, PATH, { read: (path) => store[path] });

        // Assert
        expect(nodes[0]?.properties).toEqual({ position: [0, 2, 0], material: { color: '#ff0000' }, visible: false });
    });

    it('should know the Scene3dError of another realm by its name and code', () => {
        // Assert
        expect(isScene3dError(Object.assign(new Error('no'), { name: 'Scene3dError', code: 'no_webgl' }))).toBe(true);
        expect(isScene3dError(new Error('no'))).toBe(false);
        expect(isScene3dError(undefined)).toBe(false);
    });

    it('should list the shared 3D properties for every node', () => {
        // Assert
        for (const properties of Object.values(NODE3D_PROPERTIES)) {
            expect(properties).toEqual(expect.arrayContaining(['position', 'rotation', 'scale', 'visible', 'interactive', '_label', 'transition', 'animate']));
        }
    });
});
