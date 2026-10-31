import { buildError } from '@punyts/stateui-app/core';
import type { BuildError } from '@punyts/stateui-app/core';
import { packagedIconNames } from './names.js';
import type { IconNames } from './names.js';

/**
 * The validation the shape format cannot express for the `icon` component: `filled: true` on a name with no filled
 * variant draws the outline, so it is a `SUI-STATE-FILLED` warning at the node's state path. Other nodes, an unset
 * `filled`, a `<-` link and an unknown name (which `isIconName` reports) give nothing. Run it beside `validateNode`
 */
export function validateIconNode(
    node: Readonly<Record<string, unknown>>,
    statePath: string,
    names: IconNames = packagedIconNames()
): BuildError[] {
    if (node.component !== 'icon' || node.filled !== true || typeof node.name !== 'string') return [];
    if (names.resolve(node.name) === undefined || names.hasFilled(node.name)) return [];
    return [buildError('SUI-STATE-FILLED', { name: 'filled', other: node.name, path: statePath, statePath })];
}
