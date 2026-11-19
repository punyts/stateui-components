import type { FunctionCatalog, FunctionCode, FunctionEntry, LogicComputeFunction } from '@punyts/stateui-app/core';
import { layoutTree } from './shared/diagram/layoutTree.js';
import type { LayoutTreeInput } from './shared/diagram/layoutTree.js';

/** The GUID of `layoutTree`, kept for its life whatever its path becomes */
const LAYOUT_TREE_ID = '816de370-aafe-42db-868d-bb94a9b146f1';

const NUMBER = { type: 'number' } as const;

/** The functions of the library's components, each at `$.components.<component>.functions.<name>` */
const ENTRIES: readonly FunctionEntry[] = [
    {
        id: LAYOUT_TREE_ID,
        path: '$.components.treeDiagram.functions.layoutTree',
        kind: 'compute',
        runs: ['server', 'browser'],
        summary: 'Lays out a tree of cards in columns from a root: each card\'s x, y and side, and each edge\'s SVG path',
        inputs: {
            type: 'object',
            properties: {
                nodes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, parent: { type: ['string', 'null'] }, width: NUMBER, height: NUMBER }, required: ['id', 'width', 'height'] } },
                links: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, kind: { type: 'string' } }, required: ['from', 'to'] } },
                options: { type: 'object', properties: { rowGap: NUMBER, groupGap: NUMBER, columnGap: NUMBER, twoSided: { type: 'boolean' }, columns: NUMBER } }
            },
            required: ['nodes']
        },
        outputs: {
            type: 'object',
            properties: {
                nodes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, x: NUMBER, y: NUMBER, side: NUMBER } } },
                edges: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, kind: { type: 'string' }, path: { type: 'string' } } } },
                width: NUMBER,
                height: NUMBER
            }
        }
    }
];

const CODE: Readonly<Record<string, FunctionCode>> = {
    [LAYOUT_TREE_ID]: ((inputs) => layoutTree(inputs as unknown as LayoutTreeInput) as never) satisfies LogicComputeFunction
};

/**
 * The catalog of the components' functions. A component's functions go with the component: a host that installs the
 * library installs this catalog, and none of its functions is turned off on its own. The code is in the library
 * already (the component calls it), so it loads at once
 */
export const COMPONENT_FUNCTIONS: FunctionCatalog = Object.freeze({
    name: 'components',
    entries: ENTRIES,
    load: (id: string): FunctionCode => {
        const code = CODE[id];
        if (code === undefined) throw new Error(`The component library has no function ${id}`);
        return code;
    }
});
