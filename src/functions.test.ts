import { FunctionTable } from '@punyts/stateui-app/core';
import { describe, expect, it } from 'vitest';
import { COMPONENT_FUNCTIONS } from './functions.js';

describe('COMPONENT_FUNCTIONS', () => {
    it('should install beside a host catalog and run layoutTree as a compute on either side', () => {
        // Arrange
        const path = '$.components.treeDiagram.functions.layoutTree';
        const table = new FunctionTable([COMPONENT_FUNCTIONS], 'browser');

        // Act
        const loading = table.prepare([path]);
        const layout = table.compute(path)?.({ nodes: [{ id: 'root', parent: null, width: 80, height: 20 }, { id: 'leaf', parent: 'root', width: 60, height: 20 }] });

        // Assert
        expect(loading).toBeUndefined();
        expect(table.pointer(path)).toEqual({ fn: '816de370-aafe-42db-868d-bb94a9b146f1' });
        expect(new FunctionTable([COMPONENT_FUNCTIONS], 'server').has(path, 'compute')).toBe(true);
        expect(layout?.['nodes']).toEqual([
            { id: 'root', x: 0, y: 0, side: 1 },
            { id: 'leaf', x: 152, y: 0, side: 1 }
        ]);
    });
});
