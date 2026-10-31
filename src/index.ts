/**
 * The folders of `components/` that group components by size. Grouping only: the folder name sets the `size` of a
 * component's catalog entry and nothing else, and a component folder sits directly inside one of them
 */
export const COMPONENT_GROUPS = ['atoms', 'molecules', 'composites', 'composed'] as const;

export type ComponentGroup = (typeof COMPONENT_GROUPS)[number];
