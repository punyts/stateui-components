import { safeHref } from '../markdown/links.js';
import { fromMarkdown } from './markdown.js';
import { MARKS, MAX_BLOCKS, MAX_COLUMNS, MAX_HEADING_LEVEL, MAX_INDENT, MAX_ROWS, joinRunsOf, readBlock, readRichText } from './model.js';
import type { Block, BlockType, Mark, Row, Run } from './model.js';

/**
 * What a paste or drop brings into the rich-text editor, as blocks without key or order (`Shape`), which `insertBlocks`
 * (`edit.ts`) puts in at the selection. Plain text is one paragraph per line, unless it reads as Markdown, which goes
 * through `fromMarkdown`. HTML is read from a document the caller parsed with `DOMParser` (inert: no script runs and
 * nothing loads), and only these elements count: `p`, `h1` to `h6` (above 3 drawn as 3), `ul`, `ol`, `li` (a task item
 * with a checkbox is a check), `blockquote`, `pre`, `code`, `hr`, `table` (its rows and cells, the first row its header), `br`, `b`, `strong`, `i`, `em`, `s`, `del`, `strike` and
 * `a` with a safe `href`; an element's inline `font-weight`, `font-style` and `line-through` count as marks, as editors
 * such as Google Docs mark text that way. Every other element gives its text only, and no attribute is kept but a
 * checked link (docs/design/stateui-text-editor.md, T3)
 */

/** A block as a paste brings it: no key, no order */
export type Shape = Omit<Block, 'order'>;

const BLOCK_MARKER = /^(?:#{1,6} |[-*+] |\d{1,9}[.)] |> |```|(?:---|\*\*\*|___)[ \t]*$|\|? *:?-{3,}:? *(?:\| *:?-{3,}:? *)+\|? *$)/mu;
const INLINE_MARKER = /\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)/u;

/** Whether pasted text reads as Markdown: a line that starts like a heading, list item, quote, fence or rule, a table's delimiter row, or inline marks or a link */
export function looksLikeMarkdown(text: string): boolean {
    return BLOCK_MARKER.test(text) || INLINE_MARKER.test(text);
}

const shapeOf = (block: Block): Shape => {
    const { order: _order, ...shape } = block;
    return shape;
};

/** Pasted plain text as blocks: Markdown through `fromMarkdown`, any other text one paragraph per line */
export function textToShapes(text: string): Shape[] {
    const clean = text.replace(/\r\n?/gu, '\n');
    if (looksLikeMarkdown(clean)) {
        const read = readRichText(fromMarkdown(clean));
        if (read.length > 0) return read.map(({ key: _key, ...block }) => shapeOf(block));
    }
    return clean
        .split('\n')
        .slice(0, MAX_BLOCKS)
        .map((line) => ({ type: 'paragraph' as const, runs: line === '' ? [] : [{ text: line }] }));
}

/** Elements whose content is never text (scripts, styles, media) */
const SKIPPED = new Set(['script', 'style', 'template', 'head', 'title', 'meta', 'link', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'img', 'video', 'audio', 'canvas', 'select', 'button', 'textarea', 'input']);
/** Elements that hold blocks: each starts a new block of the kind around it */
const CONTAINERS = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure', 'figcaption', 'address', 'dl', 'dt', 'dd', 'thead', 'tbody', 'tfoot', 'tr', 'caption', 'details', 'summary', 'form', 'fieldset', 'center']);
const MARK_TAGS: Readonly<Record<string, Mark>> = { b: 'bold', strong: 'bold', i: 'italic', em: 'italic', s: 'strike', del: 'strike', strike: 'strike', code: 'code' };

interface Context {
    readonly marks: ReadonlySet<Mark>;
    readonly link: string | undefined;
    /** The kind a new block takes here: a paragraph, a quote inside `blockquote`, a list item inside `li` */
    readonly kind: Shape;
    readonly lists: ReadonlyArray<'bullet' | 'numbered'>;
}

/** Marks an element's inline style gives (Google Docs marks text with `span` styles) */
function styleMarks(element: Element): Mark[] {
    const style = (element as HTMLElement).style as CSSStyleDeclaration | undefined;
    if (style === undefined) return [];
    const found: Mark[] = [];
    const weight = style.fontWeight;
    if (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600) found.push('bold');
    if (style.fontStyle === 'italic' || style.fontStyle === 'oblique') found.push('italic');
    if (`${style.textDecorationLine} ${style.textDecoration}`.includes('line-through')) found.push('strike');
    return found;
}

/** Pasted HTML as blocks, read from an inert document */
export function htmlToShapes(document: Document): Shape[] {
    const shapes: Shape[] = [];
    let current: { shape: Shape; runs: Run[]; code: boolean } | null = null;

    const flush = (): void => {
        if (current === null) return;
        const { shape, runs, code } = current;
        current = null;
        if (code) {
            //a code block keeps its text as written, less the line break a `pre` ends with
            const text = runs.map((run) => run.text).join('').replace(/\n$/u, '');
            shapes.push({ ...shape, runs: text === '' ? [] : [{ text }] });
            return;
        }
        //runs of one style are joined first, so a space and a line break in two text nodes meet
        const joined = readBlock({ ...shape, order: '', runs })?.runs ?? [];
        const trimmed = joined.map((run) => ({ ...run, text: run.text.replace(/ *\n */gu, '\n') }));
        const first = trimmed[0];
        if (first !== undefined) first.text = first.text.replace(/^\s+/u, '');
        const last = trimmed[trimmed.length - 1];
        if (last !== undefined) last.text = last.text.replace(/\s+$/u, '');
        const block = readBlock({ ...shape, order: '', runs: trimmed });
        if (block !== undefined && block.runs.length > 0) shapes.push(shapeOf(block));
    };
    const start = (kind: Shape, code = false): void => {
        flush();
        current = { shape: { ...kind, runs: [] }, runs: [], code };
    };
    /** A container's first text goes into an empty block that is open, else into a new one */
    const fresh = (kind: Shape): void => {
        const open = current as { shape: Shape; runs: Run[]; code: boolean } | null;
        if (open !== null && !open.code && open.runs.every((run) => run.text.trim() === '')) {
            open.shape = { ...kind, runs: [] };
            open.runs = [];
            return;
        }
        start(kind);
    };
    const append = (text: string, context: Context): void => {
        if (current === null) {
            if (text.trim() === '') return;
            start(context.kind);
        }
        const open = current as unknown as { runs: Run[]; code: boolean };
        const run: Run = { text };
        if (!open.code) {
            const marks = MARKS.filter((mark) => context.marks.has(mark));
            if (marks.length > 0) run.marks = marks;
            if (context.link !== undefined) run.link = context.link;
        }
        open.runs.push(run);
    };
    const end = (): void => {
        flush();
    };

    const walk = (node: Node, context: Context, pre: boolean): void => {
        if (shapes.length >= MAX_BLOCKS) return;
        if (node.nodeType === 3) {
            const data = (node as Text).data;
            append(pre ? data : data.replace(/\s+/gu, ' '), context);
            return;
        }
        if (node.nodeType !== 1) return;
        const element = node as Element;
        const tag = element.localName;
        if (SKIPPED.has(tag)) return;
        const children = (inner: Context, innerPre = pre): void => {
            for (const child of Array.from(element.childNodes)) walk(child, inner, innerPre);
        };
        if (tag === 'br') {
            if (current !== null) append('\n', context);
            return;
        }
        if (tag === 'hr') {
            flush();
            shapes.push({ type: 'divider', runs: [] });
            return;
        }
        const heading = /^h([1-6])$/u.exec(tag);
        if (heading !== null) {
            start({ type: 'heading', level: Math.min(MAX_HEADING_LEVEL, Number(heading[1])), runs: [] });
            children(context);
            end();
            return;
        }
        if (tag === 'pre') {
            start({ type: 'code', runs: [] }, true);
            children(context, true);
            end();
            return;
        }
        if (tag === 'blockquote') {
            const kind: Shape = { type: 'quote', runs: [] };
            start(kind);
            children({ ...context, kind });
            end();
            return;
        }
        if (tag === 'ul' || tag === 'ol') {
            flush();
            children({ ...context, lists: [...context.lists, tag === 'ol' ? 'numbered' : 'bullet'] });
            flush();
            return;
        }
        if (tag === 'li') {
            const type = context.lists[context.lists.length - 1] ?? 'bullet';
            const box = element.querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox], :scope > label > input[type=checkbox]');
            const indent = Math.min(MAX_INDENT, Math.max(0, context.lists.length - 1));
            const kind: Shape = box !== null ? { type: 'check', indent, checked: box.hasAttribute('checked'), runs: [] } : { type, indent, runs: [] };
            start(kind);
            children({ ...context, kind });
            end();
            return;
        }
        if (CONTAINERS.has(tag)) {
            fresh(context.kind);
            children(context);
            //text after a container, inside the same parent, starts a new block
            if (current !== null && (current as { runs: Run[] }).runs.some((run) => run.text.trim() !== '')) flush();
            return;
        }
        if (tag === 'table') {
            flush();
            const rows: Row[] = [];
            for (const line of Array.from(element.querySelectorAll(':scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr')).slice(0, MAX_ROWS)) {
                const cells = Array.from(line.querySelectorAll(':scope > td, :scope > th')).slice(0, MAX_COLUMNS).map((cell) => {
                    //a cell's blocks are read as blocks and taken back out, joined into one line
                    const before = shapes.length;
                    start({ type: 'paragraph', runs: [] });
                    for (const child of Array.from(cell.childNodes)) walk(child, { ...context, kind: { type: 'paragraph', runs: [] } }, false);
                    flush();
                    const lines = shapes.splice(before).filter((shape) => shape.type !== 'table' && shape.type !== 'divider').map((shape) => shape.runs);
                    return { runs: joinRunsOf(lines, ' ') };
                });
                if (cells.length > 0) rows.push({ cells });
            }
            const block = readBlock({ type: 'table', order: '', runs: [], rows });
            if (block !== undefined && rows.length > 0) shapes.push(shapeOf(block));
            return;
        }
        if (tag === 'td' || tag === 'th') {
            if (current !== null && element.previousElementSibling !== null) append(' ', context);
            children(context);
            return;
        }
        //an inline element: its marks and link reach its text
        const marks = new Set(context.marks);
        const tagMark = MARK_TAGS[tag];
        //Google Docs wraps a whole copy in a `b` that is not bold
        if (tagMark !== undefined && !(tag === 'b' && element.id.startsWith('docs-internal-guid'))) marks.add(tagMark);
        for (const mark of styleMarks(element)) marks.add(mark);
        let link = context.link;
        if (tag === 'a') {
            const href = element.getAttribute('href');
            link = href === null ? undefined : safeHref(href);
        }
        children({ ...context, marks, link });
    };

    const body = document.body ?? document.documentElement;
    if (body !== null) walk(body, { marks: new Set(), link: undefined, kind: { type: 'paragraph', runs: [] }, lists: [] }, false);
    flush();
    return shapes.slice(0, MAX_BLOCKS);
}

/** Shapes the field allows: a type it leaves out becomes a paragraph (a divider is dropped, a table is a paragraph per row, its cells joined by ` | `), and list fields go with it */
export function allowedShapes(shapes: readonly Shape[], allowed: readonly BlockType[]): Shape[] {
    const result: Shape[] = [];
    for (const shape of shapes) {
        if (shape.type === 'paragraph' || allowed.includes(shape.type)) {
            result.push(shape);
            continue;
        }
        if (shape.type === 'divider') continue;
        if (shape.type === 'table') {
            for (const row of shape.rows ?? []) result.push({ type: 'paragraph', runs: joinRunsOf(row.cells.map((cell) => cell.runs), ' | ') });
            continue;
        }
        result.push({ type: 'paragraph', runs: shape.runs });
    }
    return result;
}
