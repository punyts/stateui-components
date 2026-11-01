import type { BlockType } from './blocks.js';

/** Every node type of the finished tree: the block types, the inline types and the table types */
export type MarkdownType = BlockType | 'emphasis' | 'strong' | 'inlineCode' | 'link' | 'table' | 'tableRow' | 'headerCell' | 'tableCell';

/** Column alignment of a table cell; empty when the delimiter row sets none */
export type MarkdownAlign = '' | 'left' | 'center' | 'right';

/**
 * One node of the tree `parseMarkdown` returns. Every node has every field; the ones that do not apply are empty:
 * `text` holds the characters of a `text` node (inline or block), of `inlineCode` and of a block `code`; `href` is a
 * kept link target; `level` is the heading level or the first number of an ordered list; `align` is a table cell's
 */
export interface MarkdownNode {
    type: MarkdownType;
    children: MarkdownNode[];
    text: string;
    href: string;
    level: number;
    align: MarkdownAlign;
}

export const markdownNode = (type: MarkdownType, fields: Partial<Omit<MarkdownNode, 'type'>> = {}): MarkdownNode => ({
    type,
    children: [],
    text: '',
    href: '',
    level: 0,
    align: '',
    ...fields
});
