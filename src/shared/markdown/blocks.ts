/**
 * The block parser of the `markdown` component: a pure function from source text to a tree of blocks. It follows the
 * CommonMark block structure for the supported subset (paragraphs, ATX and setext headings, bullet and ordered lists
 * with nesting, block quotes, fenced and indented code, horizontal rules) and has no HTML path: a raw HTML block becomes
 * a `text` block that is shown as its characters.
 *
 * It reads the source once, line by line, with a stack of the open containers (block quotes and list items) and one open
 * leaf (a paragraph, a code block or an HTML block). Every character is looked at a bounded number of times, and there is
 * no regular expression on the text, so the time is linear in the input. The depth of the containers is capped at
 * `MAX_BLOCK_DEPTH`; markers past the cap are ordinary text, so a long run of `>` or `- ` cannot build a deep tree
 */

export type BlockType = 'paragraph' | 'heading' | 'bulletList' | 'orderedList' | 'listItem' | 'blockquote' | 'code' | 'rule' | 'text';

export interface BlockNode {
    type: BlockType;
    children: BlockNode[];
    /** The raw inline source of a paragraph or heading, the characters of a code or `text` block, empty for containers */
    text: string;
    /** The heading level (1 to 6) of a heading, the first number of an ordered list, 0 for every other block */
    level: number;
}

/** The most open containers (a list and its item are two) at one point; deeper markers are text */
export const MAX_BLOCK_DEPTH = 32;

const SPACE = 32;
const TAB = 9;
const GT = 62;
const HASH = 35;
const DASH = 45;
const PLUS = 43;
const STAR = 42;
const UNDERSCORE = 95;
const EQUALS = 61;
const BACKTICK = 96;
const TILDE = 126;
const LT = 60;
const DOT = 46;
const PAREN = 41;
const SLASH = 47;
const BANG = 33;
const QUESTION = 63;

type FrameKind = 'quote' | 'list' | 'item';

interface Frame {
    kind: FrameKind;
    node: BlockNode;
    /** An item: the columns its content is indented by. A list: unused */
    content: number;
    /** A list: what a sibling item must share (`-`, `+`, `*`, or a number's delimiter `.` or `)` with a `#` before it) */
    marker: string;
}

type LeafKind = 'paragraph' | 'fence' | 'indented' | 'html';

interface Leaf {
    kind: LeafKind;
    node: BlockNode;
    lines: string[];
    fenceCode: number;
    fenceLength: number;
    fenceIndent: number;
    /** Indented code: blank lines seen since the last code line, kept only if more code follows */
    blanks: number;
}

const make = (type: BlockType, text = '', level = 0): BlockNode => ({ type, children: [], text, level });
const isSpace = (code: number): boolean => code === SPACE || code === TAB;
const isDigit = (code: number): boolean => code >= 48 && code <= 57;
const isLetter = (code: number): boolean => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);

const indentAt = (line: string, from: number): number => {
    let at = from;
    while (line.charCodeAt(at) === SPACE) at++;
    return at - from;
};

const isBlank = (line: string, from: number): boolean => {
    for (let at = from; at < line.length; at++) if (!isSpace(line.charCodeAt(at))) return false;
    return true;
};

/** Tabs in the leading whitespace and marker run of a line become spaces to the next multiple of four, so indentation counts columns */
const expandTabs = (line: string): string => {
    if (line.indexOf('\t') === -1) return line;
    let out = '';
    let column = 0;
    let at = 0;
    for (; at < line.length; at++) {
        const code = line.charCodeAt(at);
        if (code === TAB) {
            const width = 4 - (column % 4);
            out += ' '.repeat(width);
            column += width;
        } else if (code === SPACE || code === GT || code === DASH || code === PLUS || code === STAR || code === DOT || code === PAREN || isDigit(code)) {
            out += line[at];
            column++;
        } else break;
    }
    return out + line.slice(at);
};

/** The length of the run of `code` at `from` */
const runOf = (line: string, from: number, code: number): number => {
    let at = from;
    while (line.charCodeAt(at) === code) at++;
    return at - from;
};

/** A thematic break: three or more of one of `-`, `*` and `_`, with only spaces between and after */
const isRule = (line: string, from: number): boolean => {
    const code = line.charCodeAt(from);
    if (code !== DASH && code !== STAR && code !== UNDERSCORE) return false;
    let count = 0;
    for (let at = from; at < line.length; at++) {
        const current = line.charCodeAt(at);
        if (current === code) count++;
        else if (!isSpace(current)) return false;
    }
    return count >= 3;
};

/** A setext underline: a run of `code` and then only spaces */
const isUnderline = (line: string, from: number, code: number): boolean => {
    const end = from + runOf(line, from, code);
    return isBlank(line, end);
};

/** The heading level and text of an ATX heading line at `from`, or undefined */
const atxHeading = (line: string, from: number): { level: number; text: string } | undefined => {
    const level = runOf(line, from, HASH);
    if (level < 1 || level > 6) return undefined;
    const after = from + level;
    if (after < line.length && !isSpace(line.charCodeAt(after))) return undefined;
    let text = line.slice(after).trim();
    let end = text.length;
    while (end > 0 && text.charCodeAt(end - 1) === HASH) end--;
    if (end === 0) text = '';
    else if (end < text.length && isSpace(text.charCodeAt(end - 1))) text = text.slice(0, end).trimEnd();
    return { level, text };
};

interface ListStart {
    ordered: boolean;
    marker: string;
    number: number;
    /** The index after the marker and the spaces that belong to it */
    contentAt: number;
    /** The columns, from the container's content start, the item's content is indented by */
    content: number;
    empty: boolean;
}

/** A list item marker at `from` (after `indent` spaces), or undefined */
const listStart = (line: string, from: number, indent: number): ListStart | undefined => {
    const code = line.charCodeAt(from);
    let width = 1;
    let ordered = false;
    let marker = '';
    let number = 0;
    if (code === DASH || code === PLUS || code === STAR) marker = line[from] as string;
    else if (isDigit(code)) {
        let at = from;
        while (isDigit(line.charCodeAt(at)) && at - from < 10) {
            number = number * 10 + (line.charCodeAt(at) - 48);
            at++;
        }
        const delimiter = line.charCodeAt(at);
        if (at - from > 9 || (delimiter !== DOT && delimiter !== PAREN)) return undefined;
        ordered = true;
        marker = `#${line[at] as string}`;
        width = at - from + 1;
    } else return undefined;
    const after = from + width;
    if (after < line.length && line.charCodeAt(after) !== SPACE) return undefined;
    const spaces = indentAt(line, after);
    const empty = after + spaces >= line.length;
    if (empty) return { ordered, marker, number, contentAt: line.length, content: indent + width + 1, empty };
    if (spaces >= 5) return { ordered, marker, number, contentAt: after + 1, content: indent + width + 1, empty };
    return { ordered, marker, number, contentAt: after + spaces, content: indent + width + spaces, empty };
};

/** An HTML block starts with `<` and a letter, `/`, `!` or `?` */
const startsHtml = (line: string, from: number): boolean => {
    if (line.charCodeAt(from) !== LT) return false;
    const next = line.charCodeAt(from + 1);
    return isLetter(next) || next === SLASH || next === BANG || next === QUESTION;
};

export function parseBlocks(source: string): BlockNode[] {
    const document: BlockNode[] = [];
    const frames: Frame[] = [];
    let leaf: Leaf | undefined;

    const top = (): Frame | undefined => frames[frames.length - 1];
    const container = (): BlockNode[] => top()?.node.children ?? document;

    const closeLeaf = (): void => {
        if (leaf === undefined) return;
        const text = leaf.lines.join('\n');
        leaf.node.text = leaf.kind === 'paragraph' ? text.trimEnd() : text;
        leaf = undefined;
    };
    /** Closes the open leaf and every container past the first `keep` */
    const closeTo = (keep: number): void => {
        closeLeaf();
        if (frames.length > keep) frames.length = keep;
    };
    /** Puts a block where a block can go: a list holds items only, so a list on top is finished first */
    const place = (node: BlockNode): void => {
        while (top()?.kind === 'list') frames.pop();
        container().push(node);
    };
    const open = (kind: LeafKind, node: BlockNode, lines: string[]): Leaf => {
        place(node);
        const created: Leaf = { kind, node, lines, fenceCode: 0, fenceLength: 0, fenceIndent: 0, blanks: 0 };
        leaf = created;
        return created;
    };

    const processLine = (line: string): void => {
        let at = 0;
        let matched = 0;
        for (; matched < frames.length; matched++) {
            const frame = frames[matched] as Frame;
            if (frame.kind === 'quote') {
                const indent = indentAt(line, at);
                if (indent > 3 || line.charCodeAt(at + indent) !== GT) break;
                at += indent + 1;
                if (line.charCodeAt(at) === SPACE) at++;
            } else if (frame.kind === 'item') {
                if (isBlank(line, at)) {
                    if (frame.node.children.length === 0) break;
                } else {
                    if (indentAt(line, at) < frame.content) break;
                    at += frame.content;
                }
            }
        }
        let all = matched === frames.length;

        if (all && leaf?.kind === 'fence') {
            const indent = indentAt(line, at);
            const run = runOf(line, at + indent, leaf.fenceCode);
            if (indent <= 3 && run >= leaf.fenceLength && isBlank(line, at + indent + run)) closeLeaf();
            else leaf.lines.push(line.slice(at + Math.min(indent, leaf.fenceIndent)));
            return;
        }

        if (isBlank(line, at)) {
            if (!all) closeTo(matched);
            else if (leaf?.kind === 'indented') leaf.blanks++;
            else closeLeaf();
            return;
        }

        if (all && leaf?.kind === 'html') {
            leaf.lines.push(line.slice(at));
            return;
        }

        for (;;) {
            if (isBlank(line, at)) return;
            const indent = indentAt(line, at);
            const at0 = at + indent;
            const code = line.charCodeAt(at0);
            const paragraph = leaf?.kind === 'paragraph' ? leaf : undefined;

            if (indent >= 4) {
                if (paragraph !== undefined) paragraph.lines.push(line.slice(at0));
                else if (all && leaf?.kind === 'indented') {
                    for (; leaf.blanks > 0; leaf.blanks--) leaf.lines.push('');
                    leaf.lines.push(line.slice(at + 4));
                } else {
                    closeTo(matched);
                    open('indented', make('code'), [line.slice(at + 4)]);
                }
                return;
            }

            if (code === GT && frames.length < MAX_BLOCK_DEPTH) {
                closeTo(matched);
                const node = make('blockquote');
                place(node);
                frames.push({ kind: 'quote', node, content: 0, marker: '' });
                at = at0 + 1;
                if (line.charCodeAt(at) === SPACE) at++;
                matched = frames.length;
                all = true;
                continue;
            }

            if (code === HASH) {
                const heading = atxHeading(line, at0);
                if (heading !== undefined) {
                    closeTo(matched);
                    place(make('heading', heading.text, heading.level));
                    return;
                }
            }

            if (code === BACKTICK || code === TILDE) {
                const run = runOf(line, at0, code);
                if (run >= 3 && (code === TILDE || line.indexOf('`', at0 + run) === -1)) {
                    closeTo(matched);
                    const fence = open('fence', make('code'), []);
                    fence.fenceCode = code;
                    fence.fenceLength = run;
                    fence.fenceIndent = indent;
                    return;
                }
            }

            if (paragraph === undefined && startsHtml(line, at0)) {
                closeTo(matched);
                open('html', make('text'), [line.slice(at0)]);
                return;
            }

            if (paragraph !== undefined && all && (code === EQUALS || code === DASH) && isUnderline(line, at0, code)) {
                paragraph.node.type = 'heading';
                paragraph.node.level = code === EQUALS ? 1 : 2;
                closeLeaf();
                return;
            }

            if (isRule(line, at0)) {
                closeTo(matched);
                place(make('rule'));
                return;
            }

            const start = frames.length + 2 <= MAX_BLOCK_DEPTH ? listStart(line, at0, indent) : undefined;
            if (start !== undefined && (paragraph === undefined || !all || (!start.empty && (!start.ordered || start.number === 1)))) {
                closeTo(matched);
                let list = top();
                if (list?.kind !== 'list' || list.marker !== start.marker) {
                    while (top()?.kind === 'list') frames.pop();
                    const node = make(start.ordered ? 'orderedList' : 'bulletList', '', start.ordered ? start.number : 0);
                    container().push(node);
                    list = { kind: 'list', node, content: 0, marker: start.marker };
                    frames.push(list);
                }
                const item = make('listItem');
                list.node.children.push(item);
                frames.push({ kind: 'item', node: item, content: start.content, marker: '' });
                at = start.contentAt;
                matched = frames.length;
                all = true;
                if (start.empty) return;
                continue;
            }

            if (paragraph !== undefined) paragraph.lines.push(line.slice(at0));
            else {
                closeTo(matched);
                open('paragraph', make('paragraph'), [line.slice(at0)]);
            }
            return;
        }
    };

    const total = source.length;
    let from = 0;
    while (from <= total) {
        let to = from;
        while (to < total) {
            const code = source.charCodeAt(to);
            if (code === 10 || code === 13) break;
            to++;
        }
        processLine(expandTabs(source.slice(from, to)));
        if (to < total && source.charCodeAt(to) === 13 && source.charCodeAt(to + 1) === 10) to++;
        from = to + 1;
    }
    closeTo(0);
    return document;
}
