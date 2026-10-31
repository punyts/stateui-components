/**
 * The folders of `components/` that group components by size. Grouping only: the folder name sets the `size` of a
 * component's catalog entry and nothing else, and a component folder sits directly inside one of them
 */
export const COMPONENT_GROUPS = ['atoms', 'molecules', 'composites', 'composed'] as const;

export type ComponentGroup = (typeof COMPONENT_GROUPS)[number];

export { ICON_ALIASES } from './icons/aliases.js';
export { CORE_ICON_NAMES } from './icons/coreNames.js';
export { createIconNames, isIconName, loadIconsFile, packagedIconNames } from './icons/names.js';
export type { IconNames } from './icons/names.js';
export { validateIconNode } from './icons/validate.js';
export type { IconEntry, IconPath, IconStyledPath, IconsFile } from './icons/types.js';
export { VALUE_FORMATS, formatValue, toNumber } from './shared/format/format.js';
export type { FormatOptions, ValueFormat } from './shared/format/format.js';
