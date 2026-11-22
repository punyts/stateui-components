import { parseMarkdown } from '../markdown/markdown.js';
import type { MarkdownNode } from '../markdown/nodes.js';
import { LIST_TYPES, MAX_HEADING_LEVEL, MAX_INDENT, normalizeRuns, plainText, readRichText, valueOf } from './model.js';
import type { Block, KeyedBlock, Mark, RichTextValue, Run } from './model.js';

/**
 * Markdown to the block value and back. `fromMarkdown` reads through `parseMarkdown`, so the source never reaches the
 * page as markup and links keep only the targets it keeps. `toMarkdown` writes CommonMark that `fromMarkdown` reads back
 * to the same blocks for the constructs the value has (a code block's language and Markdown's strikethrough aside, which
 * the parser does not read: `~~` is recognised inside one run of text only)
 */

type Draft = Omit<Block, 'order'>;

const withMark = (marks: readonly Mark[], mark: Mark): Mark[] => (marks.includes(mark) ? [...marks] : [...marks, mark]);

/** A soft line break reads as a space; a hard break (a backslash or two spaces before the line end) as a line break */
const breaks = (text: string): string => text.replace(/(?:\\| {2,})\n/g, '\u0000').replace(/\n/g, ' ').replace(/\u0000/g, '\n');

/** Splits `~~struck~~` spans out of one text, each pair of `~~` on the same text */
function strikeRuns(text: string, marks: readonly Mark[], link: string | undefined): Run[] {
    const runs: Run[] = [];
    const parts = text.split('~~');
    parts.forEach((part, index) => {
        //an odd part is between a pair; an unpaired last `~~` stays as its characters
        const struck = index % 2 === 1 && index < parts.length - 1;
        const unpaired = index % 2 === 1 && index === parts.length - 1;
        const shown = unpaired ? `~~${part}` : part;
        if (shown === '') return;
        const run: Run = { text: breaks(shown), marks: struck ? withMark(marks, 'strike') : [...marks] };
        if (link !== undefined) run.link = link;
        runs.push(run);
    });
    return runs;
}

function inlineRuns(nodes: readonly MarkdownNode[], marks: readonly Mark[] = [], link?: string): Run[] {
    const runs: Run[] = [];
    for (const node of nodes) {
        switch (node.type) {
            case 'text':
                runs.push(...strikeRuns(node.text, marks, link));
                break;
            case 'emphasis':
                runs.push(...inlineRuns(node.children, withMark(marks, 'italic'), link));
                break;
            case 'strong':
                runs.push(...inlineRuns(node.children, withMark(marks, 'bold'), link));
                break;
            case 'inlineCode': {
                const run: Run = { text: node.text, marks: withMark(marks, 'code') };
                if (link !== undefined) run.link = link;
                runs.push(run);
                break;
            }
            case 'link':
                runs.push(...inlineRuns(node.children, marks, node.href));
                break;
            default:
                break;
        }
    }
    return normalizeRuns(runs);
}

const TASK_OPEN = '[ ] ';
const TASK_DONE = ['[x] ', '[X] '];

/** A list item: its first paragraph is the item, more paragraphs join it on new lines, nested lists go one indent deeper */
function listItem(item: MarkdownNode, type: 'bullet' | 'numbered', indent: number, out: Draft[]): void {
    let runs: Run[] | undefined;
    const after: MarkdownNode[] = [];
    for (const child of item.children) {
        if ((child.type === 'paragraph' || child.type === 'text') && runs === undefined) runs = child.type === 'text' ? [{ text: child.text }] : inlineRuns(child.children);
        else if (child.type === 'paragraph' && runs !== undefined && after.length === 0) runs = normalizeRuns([...runs, { text: '\n' }, ...inlineRuns(child.children)]);
        else after.push(child);
    }
    const draft: Draft = { type, indent: Math.min(indent, MAX_INDENT), runs: runs ?? [] };
    const first = draft.runs[0];
    if (type === 'bullet' && first !== undefined && first.marks === undefined && first.link === undefined) {
        const done = TASK_DONE.some((marker) => first.text.startsWith(marker));
        if (done || first.text.startsWith(TASK_OPEN)) {
            draft.type = 'check';
            draft.checked = done;
            draft.runs = normalizeRuns([{ text: first.text.slice(TASK_OPEN.length) }, ...draft.runs.slice(1)]);
        }
    }
    out.push(draft);
    for (const child of after) {
        if (child.type === 'bulletList' || child.type === 'orderedList') list(child, indent + 1, out);
        else block(child, out);
    }
}

function list(node: MarkdownNode, indent: number, out: Draft[]): void {
    const type = node.type === 'orderedList' ? 'numbered' : 'bullet';
    for (const item of node.children) listItem(item, type, indent, out);
}

function block(node: MarkdownNode, out: Draft[], quoted = false): void {
    const plain = (draft: Draft): Draft => (quoted ? { type: 'quote', runs: draft.runs } : draft);
    switch (node.type) {
        case 'paragraph':
            out.push(plain({ type: 'paragraph', runs: inlineRuns(node.children) }));
            break;
        case 'text':
            out.push(plain({ type: 'paragraph', runs: normalizeRuns([{ text: node.text }]) }));
            break;
        case 'heading':
            out.push(plain({ type: 'heading', level: Math.min(MAX_HEADING_LEVEL, Math.max(1, node.level)), runs: inlineRuns(node.children) }));
            break;
        case 'bulletList':
        case 'orderedList':
            list(node, 0, out);
            break;
        case 'blockquote':
            for (const child of node.children) block(child, out, true);
            break;
        case 'code':
            out.push({ type: 'code', runs: node.text === '' ? [] : [{ text: node.text.replace(/\n$/, '') }] });
            break;
        case 'rule':
            out.push({ type: 'divider', runs: [] });
            break;
        case 'table': {
            //the first row is the header; its cells give each column's alignment
            const rows = node.children.map((row) => ({ cells: row.children.map((cell) => ({ runs: inlineRuns(cell.children) })) }));
            const header = node.children[0]?.children ?? [];
            const align = header.map((cell) => cell.align ?? '');
            const table: Draft = { type: 'table', runs: [], rows };
            if (align.some((one) => one !== '')) table.align = align;
            out.push(table);
            break;
        }
        default:
            break;
    }
}

export interface FromMarkdownOptions {
    /** The source is cut to at most this many characters, at a block boundary, as `markdown` cuts it */
    maxLength?: number;
}

/** Markdown source as a block value, with new block keys and order keys in the source's order */
export function fromMarkdown(source: string, options: FromMarkdownOptions = {}): RichTextValue {
    const parsed = parseMarkdown(source, { profile: 'basic', ...(options.maxLength === undefined ? {} : { maxLength: options.maxLength }) });
    const drafts: Draft[] = [];
    for (const node of parsed.children) block(node, drafts);
    return valueOf(drafts);
}

const ESCAPED = new Set(['\\', '`', '*', '_', '[', ']', '~', '<', '>', '&', '|']);

/** Escapes every character Markdown could read as syntax inside a line; line breaks become hard breaks */
function escapeText(text: string): string {
    let out = '';
    for (const char of text) {
        if (char === '\n') out += '\\\n';
        else out += ESCAPED.has(char) ? `\\${char}` : char;
    }
    return out;
}

/** Escapes what would start another block at the start of a line: `#`, `>`, `-`, `+`, `=`, `1.` and `1)` */
function escapeLineStart(text: string): string {
    const first = text.charAt(0);
    if (first === '#' || first === '-' || first === '+' || first === '=') return `\\${text}`;
    const digits = /^\d+/.exec(text);
    if (digits !== null) {
        const next = text.charAt(digits[0].length);
        if (next === '.' || next === ')') return `${digits[0]}\\${text.slice(digits[0].length)}`;
    }
    return text;
}

const codeSpan = (text: string): string => {
    let longest = 0;
    for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
    const fence = '`'.repeat(longest + 1);
    const pad = text.startsWith('`') || text.endsWith('`') || text.startsWith(' ') ? ' ' : '';
    return `${fence}${pad}${text}${pad}${fence}`;
};

const DELIMITER: Readonly<Record<Exclude<Mark, 'code'>, string>> = { bold: '**', italic: '*', strike: '~~' };
/** The order marks open in, outermost first; they close in reverse */
const OPEN_ORDER: readonly Exclude<Mark, 'code'>[] = ['bold', 'italic', 'strike'];

/** A run's leading and trailing spaces moved outside its marks, which Markdown would not read at a space */
function splitSpaces(runs: readonly Run[]): Run[] {
    const out: Run[] = [];
    for (const run of runs) {
        if (run.marks === undefined || run.marks.includes('code')) {
            out.push(run);
            continue;
        }
        const lead = /^\s*/.exec(run.text)?.[0] ?? '';
        const trail = /\s*$/.exec(run.text.slice(lead.length))?.[0] ?? '';
        const core = run.text.slice(lead.length, run.text.length - trail.length);
        const bare = (text: string): Run => (run.link === undefined ? { text } : { text, link: run.link });
        if (lead !== '') out.push(bare(lead));
        if (core !== '') out.push({ ...run, text: core });
        if (trail !== '') out.push(bare(trail));
    }
    return out;
}

/** Runs with one link (or none) as Markdown: marks open and close at the run boundaries, outermost first */
function markedText(runs: readonly Run[]): string {
    let out = '';
    const open: Exclude<Mark, 'code'>[] = [];
    for (const run of runs) {
        const marks = run.marks ?? [];
        const wanted = OPEN_ORDER.filter((mark) => marks.includes(mark));
        //close back to the longest open prefix the run keeps
        let keep = 0;
        while (keep < open.length && wanted.includes(open[keep] as Exclude<Mark, 'code'>)) keep++;
        while (open.length > keep) out += DELIMITER[open.pop() as Exclude<Mark, 'code'>];
        for (const mark of wanted) {
            if (open.includes(mark)) continue;
            out += DELIMITER[mark];
            open.push(mark);
        }
        out += marks.includes('code') ? codeSpan(run.text) : escapeText(run.text);
    }
    while (open.length > 0) out += DELIMITER[open.pop() as Exclude<Mark, 'code'>];
    return out;
}

/** A block's runs as one line of Markdown: runs with the same link are written as one link */
export function inlineMarkdown(runs: readonly Run[]): string {
    const spaced = splitSpaces(runs);
    let out = '';
    let at = 0;
    while (at < spaced.length) {
        const link = spaced[at]?.link;
        let end = at;
        while (end < spaced.length && spaced[end]?.link === link) end++;
        const group = spaced.slice(at, end);
        const text = markedText(group);
        out += link === undefined ? text : `[${text}](<${link.replace(/[<>\\]/g, (char) => `\\${char}`)}>)`;
        at = end;
    }
    return escapeLineStart(out);
}

const fenceFor = (text: string): string => {
    let longest = 2;
    for (const match of text.matchAll(/`{3,}/g)) longest = Math.max(longest, match[0].length);
    return '`'.repeat(longest + 1);
};

/** A table as a GFM table: the header row, the delimiter row with each column's alignment, then the other rows */
function tableMarkdown(table: KeyedBlock): string {
    const rows = table.rows ?? [];
    const line = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;
    const cellText = (runs: readonly Run[]): string => {
        const text = inlineMarkdown(runs);
        return text === '' ? ' ' : text;
    };
    const columns = rows[0]?.cells.length ?? 0;
    const delimiter = Array.from({ length: columns }, (_, index) => {
        const align = table.align?.[index] ?? '';
        return align === 'center' ? ':---:' : align === 'right' ? '---:' : align === 'left' ? ':---' : '---';
    });
    const [head, ...body] = rows.map((row) => line(row.cells.map((cell) => cellText(cell.runs))));
    return [head ?? line([]), line(delimiter), ...body].join('\n');
}

/** A block value as CommonMark: list items of one list on consecutive lines, every other block apart by a blank line */
export function toMarkdown(value: unknown): string {
    const blocks: KeyedBlock[] = readRichText(value);
    const lines: string[] = [];
    /** The column each open list level's content starts at, and the number of the next numbered item per level */
    const columns: number[] = [];
    const numbers: number[] = [];
    let previous: KeyedBlock | undefined;
    for (const current of blocks) {
        const isList = LIST_TYPES.includes(current.type);
        const wasList = previous !== undefined && LIST_TYPES.includes(previous.type);
        if (previous !== undefined) lines.push(isList && wasList ? '\n' : '\n\n');
        if (!isList) {
            columns.length = 0;
            numbers.length = 0;
        }
        switch (current.type) {
            case 'paragraph':
                lines.push(inlineMarkdown(current.runs));
                break;
            case 'heading':
                lines.push(`${'#'.repeat(current.level ?? 1)} ${inlineMarkdown(current.runs)}`);
                break;
            case 'quote':
                lines.push(`> ${inlineMarkdown(current.runs).replace(/\n/g, '\n> ')}`);
                break;
            case 'code': {
                const text = plainText(current.runs);
                const fence = fenceFor(text);
                lines.push(`${fence}${current.language ?? ''}\n${text}\n${fence}`);
                break;
            }
            case 'divider':
                lines.push('---');
                break;
            case 'table':
                lines.push(tableMarkdown(current));
                break;
            default: {
                const indent = Math.min(current.indent ?? 0, columns.length);
                columns.length = indent;
                numbers.length = indent + 1;
                const previousType = previous !== undefined && LIST_TYPES.includes(previous.type) && (previous.indent ?? 0) === indent ? previous.type : undefined;
                //a numbered item after another type at its level starts a new count, as the list it starts is a new list
                if (current.type !== 'numbered' || previousType !== 'numbered') numbers[indent] = 1;
                const number = numbers[indent] ?? 1;
                const marker = current.type === 'numbered' ? `${number}. ` : current.type === 'check' ? (current.checked === true ? '- [x] ' : '- [ ] ') : '- ';
                if (current.type === 'numbered') numbers[indent] = number + 1;
                const column = indent === 0 ? 0 : (columns[indent - 1] ?? 0);
                const text = inlineMarkdown(current.runs).replace(/\n/g, `\n${' '.repeat(column + marker.length)}`);
                lines.push(`${' '.repeat(column)}${marker}${text}`);
                columns[indent] = column + (current.type === 'check' ? 2 : marker.length);
                break;
            }
        }
        previous = current;
    }
    return lines.join('');
}
