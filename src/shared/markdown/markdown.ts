import { parseBlocks } from './blocks.js';
import type { BlockNode } from './blocks.js';
import { parseInline } from './inlines.js';
import { markdownNode } from './nodes.js';
import type { MarkdownNode } from './nodes.js';
import { tableFrom } from './tables.js';

export type MarkdownProfile = 'basic' | 'inline';

export interface MarkdownOptions {
    /** `basic`: every block, inline and table construct; `inline`: emphasis, code and links only. Default `basic` */
    profile?: MarkdownProfile;
    /** The source is cut to at most this many characters, at a block boundary. Default 20,000 */
    maxLength?: number;
}

export interface ParsedMarkdown {
    /** The blocks of a `basic` source, or the inline nodes of an `inline` source */
    children: MarkdownNode[];
    /** True when the source was longer than `maxLength` and was cut */
    truncated: boolean;
}

export const DEFAULT_MAX_LENGTH = 20_000;

const isBlankLine = (source: string, from: number, to: number): boolean => {
    for (let at = from; at < to; at++) {
        const code = source.charCodeAt(at);
        if (code !== 32 && code !== 9) return false;
    }
    return true;
};

/**
 * Where to cut a source of more than `max` characters: at the end of the last block that fits whole (just before a blank line) (a blank line inside
 * an open code fence is not a boundary), else at the end of the last whole line that fits, else at `max`
 */
export function cutPoint(source: string, max: number): number {
    let boundary = -1;
    let lineEnd = -1;
    let fence = 0;
    let fenceLength = 0;
    let from = 0;
    while (from <= source.length) {
        let to = from;
        while (to < source.length && source.charCodeAt(to) !== 10) to++;
        const blank = isBlankLine(source, from, to);
        if (to > max && !(blank && from - 1 <= max)) break;
        let indent = from;
        while (indent < to && indent - from < 4 && source.charCodeAt(indent) === 32) indent++;
        const code = source.charCodeAt(indent);
        if (indent - from <= 3 && (code === 96 || code === 126)) {
            let run = indent;
            while (source.charCodeAt(run) === code) run++;
            if (run - indent >= 3) {
                if (fence === 0) {
                    fence = code;
                    fenceLength = run - indent;
                } else if (code === fence && run - indent >= fenceLength && isBlankLine(source, run, to)) fence = 0;
            }
        }
        if (fence === 0 && from > 0 && blank) boundary = from - 1;
        if (to <= max) lineEnd = to;
        from = to + 1;
    }
    if (boundary !== -1) return boundary;
    if (lineEnd > 0) return lineEnd;
    return max > 0 && (source.charCodeAt(max - 1) & 0xfc00) === 0xd800 ? max - 1 : max;
}

const convert = (block: BlockNode): MarkdownNode => {
    switch (block.type) {
        case 'paragraph':
            return tableFrom(block.text) ?? markdownNode('paragraph', { children: parseInline(block.text) });
        case 'heading':
            return markdownNode('heading', { level: block.level, children: parseInline(block.text) });
        case 'bulletList':
        case 'orderedList':
        case 'listItem':
        case 'blockquote':
            return markdownNode(block.type, { level: block.level, children: block.children.map(convert) });
        case 'code':
        case 'text':
            return markdownNode(block.type, { text: block.text });
        case 'rule':
            return markdownNode('rule');
    }
};

/**
 * Parses Markdown source into a tree with no HTML anywhere in it: raw HTML is `text`, and a link keeps only a target
 * that is `#`, a relative in-app target or `https:` (a link with any other target is its text). The `inline` profile has
 * no blocks: the whole source is read as inline content. A source longer than `maxLength` is cut at a block boundary and
 * `truncated` is true
 */
export function parseMarkdown(source: string, options: MarkdownOptions = {}): ParsedMarkdown {
    const max = Math.max(0, Math.floor(options.maxLength ?? DEFAULT_MAX_LENGTH));
    const truncated = source.length > max;
    const text = truncated ? source.slice(0, cutPoint(source, max)) : source;
    if (options.profile === 'inline') return { children: parseInline(text), truncated };
    return { children: parseBlocks(text).map(convert), truncated };
}
