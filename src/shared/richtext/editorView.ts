import { LIST_TYPES, plainText } from './model.js';
import type { KeyedBlock, Run } from './model.js';
import { markedNode, mentionNode, tableElement } from './render.js';
import type { CellPoint, Point, TextSelection } from './edit.js';

/**
 * The DOM of the rich-text editor: one flat element per block inside the `contenteditable` root, keyed by the block key.
 * Every element comes from `createElement` and every character is a text node, so nothing in a value is read as markup.
 * A redraw replaces only the blocks whose content changed and moves the rest into order. It maps points between the
 * model (block key and character offset) and the DOM, and reads a block's text back only after an input method wrote
 * into it (docs/design/stateui-text-editor.md)
 *
 * A block is `div.block` with `data-key` and `data-type` (and `data-level`, `data-indent`, `data-number`, `data-checked`
 * and `data-language` as the type has them). Its text is in `span.text`, runs as text nodes in their mark elements; a
 * link is `span.link` with `data-href`. An empty block, and a block whose text ends in a line break, end in a `br` so the
 * caret has a line. A check item's box is in `span.marker`, which is not editable; a divider's block is not editable. A
 * mention is `span.mention`, not editable, so the caret goes around it. A table's block holds a `table` whose cells
 * (`data-row`, `data-column`) each hold a `span.text`; a point in a table names its cell
 */

export interface EditorView {
    /** Draws the blocks in order; a key in `stale` is redrawn even when its content did not change (an input method wrote into it) */
    render(blocks: readonly KeyedBlock[], stale?: ReadonlySet<string>): void;
    /** The model point of a DOM point inside the root, or null outside it */
    pointAt(node: Node, offset: number): Point | null;
    /** Puts the page's selection on a model selection */
    select(selection: TextSelection): void;
    /** The page's selection as a model selection, or null when it is not inside the root */
    readSelection(): TextSelection | null;
    /** A model selection from a DOM range (a `beforeinput` target range), or null */
    selectionOfRange(range: StaticRange | AbstractRange): TextSelection | null;
    /** The text of a block (of a table's cell) as the page now holds it */
    textOf(key: string, cell?: CellPoint): string | null;
    /** The key of the block a node is in */
    blockOf(node: Node): string | null;
    /** The element drawn for a block */
    elementOf(key: string): HTMLElement | undefined;
}

export interface EditorViewOptions {
    /** The accessible name of a check item's box */
    readonly checkLabel: () => string;
}

interface Drawn {
    element: HTMLElement;
    signature: string;
}

/** The number of each `numbered` block, counted from the run of numbered items at its indent */
export function numbering(blocks: readonly KeyedBlock[]): Map<string, number> {
    const numbers = new Map<string, number>();
    const counts: number[] = [];
    const types: string[] = [];
    for (const block of blocks) {
        if (!LIST_TYPES.includes(block.type)) {
            counts.length = 0;
            types.length = 0;
            continue;
        }
        const indent = block.indent ?? 0;
        counts.length = Math.min(counts.length, indent + 1);
        types.length = Math.min(types.length, indent + 1);
        const count = block.type === 'numbered' ? (types[indent] === 'numbered' ? (counts[indent] ?? 0) + 1 : 1) : 0;
        counts[indent] = count;
        types[indent] = block.type;
        if (block.type === 'numbered') numbers.set(block.key, count);
    }
    return numbers;
}

/** The text nodes of a block in order, leaving out those in a part that is not editable (a check item's box) */
function textNodes(element: HTMLElement): Text[] {
    const found: Text[] = [];
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
        acceptNode: (node) => (node instanceof Element && node.classList.contains('marker') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) if (node.nodeType === Node.TEXT_NODE) found.push(node as Text);
    return found;
}

/** The element of a table's cell */
const cellElement = (block: HTMLElement, cell: CellPoint): HTMLElement | null => block.querySelector<HTMLElement>(`[data-row="${cell.row}"][data-column="${cell.column}"]`);

function appendRuns(document: Document, parent: HTMLElement, type: KeyedBlock['type'], runs: readonly Run[]): void {
    if (type === 'code') {
        const text = plainText(runs);
        if (text !== '') parent.appendChild(document.createTextNode(text));
        return;
    }
    let at = 0;
    while (at < runs.length) {
        if (runs[at]?.mention !== undefined) {
            const mention = mentionNode(document, runs[at] as Run);
            mention.contentEditable = 'false';
            parent.appendChild(mention);
            at++;
            continue;
        }
        const link = runs[at]?.link;
        if (link === undefined) {
            parent.appendChild(markedNode(document, runs[at] as Run));
            at++;
            continue;
        }
        const element = document.createElement('span');
        element.className = 'link';
        element.dataset['href'] = link;
        while (at < runs.length && runs[at]?.link === link) {
            element.appendChild(markedNode(document, runs[at] as Run));
            at++;
        }
        parent.appendChild(element);
    }
}

function blockElement(document: Document, block: KeyedBlock, number: number | undefined, options: EditorViewOptions): HTMLElement {
    const element = document.createElement('div');
    element.className = 'block';
    element.dataset['key'] = block.key;
    element.dataset['type'] = block.type;
    if (block.type === 'divider') {
        element.contentEditable = 'false';
        element.appendChild(document.createElement('hr'));
        return element;
    }
    if (block.type === 'table') {
        element.appendChild(tableElement(document, block, (cell, content) => {
            const text = document.createElement('span');
            text.className = 'text';
            appendRuns(document, text, 'paragraph', content.runs);
            if (content.runs.length === 0) text.appendChild(document.createElement('br'));
            cell.appendChild(text);
        }));
        return element;
    }
    if (block.type === 'heading') element.dataset['level'] = String(block.level ?? 1);
    if (LIST_TYPES.includes(block.type)) element.dataset['indent'] = String(block.indent ?? 0);
    if (number !== undefined) element.dataset['number'] = `${number}.`;
    if (block.type === 'code' && block.language !== undefined) element.dataset['language'] = block.language;
    if (block.type === 'check') {
        element.toggleAttribute('data-checked', block.checked === true);
        const marker = document.createElement('span');
        marker.className = 'marker';
        marker.contentEditable = 'false';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.tabIndex = -1;
        box.checked = block.checked === true;
        box.setAttribute('aria-label', options.checkLabel());
        marker.appendChild(box);
        element.appendChild(marker);
    }
    const text = document.createElement('span');
    text.className = 'text';
    appendRuns(document, text, block.type, block.runs);
    const content = plainText(block.runs);
    if (content === '' || content.endsWith('\n')) text.appendChild(document.createElement('br'));
    element.appendChild(text);
    return element;
}

const signatureOf = (block: KeyedBlock, number: number | undefined): string =>
    JSON.stringify([block.type, block.level, block.indent, block.checked, block.language, block.runs, block.rows, block.align, number]);

/** The selection a shadow root holds: Chromium answers it on the root; elsewhere the document's composed range is read */
function shadowSelection(root: HTMLElement): { anchorNode: Node | null; anchorOffset: number; focusNode: Node | null; focusOffset: number } | null {
    const container = root.getRootNode() as ShadowRoot | Document;
    const own = (container as unknown as { getSelection?: () => Selection | null }).getSelection;
    if (typeof own === 'function') {
        const selection = own.call(container);
        return selection === null ? null : selection;
    }
    const selection = root.ownerDocument.getSelection();
    if (selection === null) return null;
    const composed = (selection as Selection & { getComposedRanges?: (options: { shadowRoots: ShadowRoot[] }) => StaticRange[] }).getComposedRanges;
    if (typeof composed !== 'function' || !(container instanceof ShadowRoot)) return selection;
    const range = composed.call(selection, { shadowRoots: [container] })[0];
    if (range === undefined) return null;
    const backward = (selection as Selection & { direction?: string }).direction === 'backward';
    return backward
        ? { anchorNode: range.endContainer, anchorOffset: range.endOffset, focusNode: range.startContainer, focusOffset: range.startOffset }
        : { anchorNode: range.startContainer, anchorOffset: range.startOffset, focusNode: range.endContainer, focusOffset: range.endOffset };
}

export function createEditorView(root: HTMLElement, options: EditorViewOptions): EditorView {
    const document = root.ownerDocument;
    const drawn = new Map<string, Drawn>();

    const blockElementOf = (node: Node): HTMLElement | null => {
        const element = node instanceof Element ? node : node.parentElement;
        const block = element?.closest<HTMLElement>('.block') ?? null;
        return block !== null && block.parentElement === root ? block : null;
    };

    const lengthOf = (element: HTMLElement): number => textNodes(element).reduce((total, text) => total + text.data.length, 0);

    const pointAt = (node: Node, offset: number): Point | null => {
        if (node === root) {
            const blocks = Array.from(root.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.dataset['key'] !== undefined);
            const after = root.childNodes[offset];
            const next = blocks.find((block) => block === after);
            if (next !== undefined) return { block: next.dataset['key'] as string, offset: 0 };
            const last = blocks[blocks.length - 1];
            return last === undefined ? null : { block: last.dataset['key'] as string, offset: lengthOf(last) };
        }
        if (!root.contains(node)) return null;
        const block = blockElementOf(node);
        if (block === null) return null;
        const key = block.dataset['key'] as string;
        if (block.dataset['type'] === 'divider') return { block: key, offset: 0 };
        if (block.dataset['type'] === 'table') {
            const element = node instanceof Element ? node : node.parentElement;
            const cell = element?.closest<HTMLElement>('[data-row]');
            if (cell === null || cell === undefined || !block.contains(cell)) return { block: key, offset: 0, cell: { row: 0, column: 0 } };
            const at: CellPoint = { row: Number(cell.dataset['row']), column: Number(cell.dataset['column']) };
            return { ...offsetIn(cell, key, node, offset), cell: at };
        }
        const marker = block.querySelector('.marker');
        if (marker !== null && marker.contains(node)) return { block: key, offset: 0 };
        return offsetIn(block, key, node, offset);
    };

    /** The character offset of a DOM point counted over the text nodes of `container` (a block, or a table's cell) */
    const offsetIn = (container: HTMLElement, key: string, node: Node, offset: number): Point => {
        const block = container;
        let total = 0;
        if (node.nodeType === Node.TEXT_NODE) {
            for (const text of textNodes(block)) {
                if (text === node) return { block: key, offset: total + Math.min(offset, text.data.length) };
                total += text.data.length;
            }
            return { block: key, offset: total };
        }
        const boundary = node.childNodes[offset] ?? null;
        for (const text of textNodes(block)) {
            const before = boundary !== null
                ? (boundary.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_PRECEDING) !== 0
                : node.contains(text) || (node.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
            if (!before) break;
            total += text.data.length;
        }
        return { block: key, offset: total };
    };

    const domPoint = (point: Point): { node: Node; offset: number } | null => {
        const element = drawn.get(point.block)?.element;
        if (element === undefined || element.parentElement !== root) return null;
        if (element.dataset['type'] === 'divider') return { node: root, offset: Array.prototype.indexOf.call(root.childNodes, element) };
        const container = element.dataset['type'] === 'table' ? cellElement(element, point.cell ?? { row: 0, column: 0 }) : element;
        if (container === null) return null;
        let rest = Math.max(0, point.offset);
        const texts = textNodes(container);
        for (const text of texts) {
            if (rest <= text.data.length) {
                //the caret goes beside a mention, never into its text
                const mention = text.parentElement?.closest('.mention');
                if (mention === null || mention === undefined || mention.parentNode === null) return { node: text, offset: rest };
                const index = Array.prototype.indexOf.call(mention.parentNode.childNodes, mention) as number;
                return { node: mention.parentNode, offset: rest === 0 ? index : index + 1 };
            }
            rest -= text.data.length;
        }
        const last = texts[texts.length - 1];
        if (last !== undefined) return { node: last, offset: last.data.length };
        const holder = container.querySelector('.text') ?? container;
        return { node: holder, offset: 0 };
    };

    return {
        render: (blocks, stale) => {
            const numbers = numbering(blocks);
            const kept = new Set<string>();
            let previous: Node | null = null;
            for (const block of blocks) {
                const number = numbers.get(block.key);
                const signature = signatureOf(block, number);
                let entry = drawn.get(block.key);
                if (entry === undefined || entry.signature !== signature || stale?.has(block.key) === true) {
                    const element = blockElement(document, block, number, options);
                    if (entry !== undefined && entry.element.parentNode === root) entry.element.replaceWith(element);
                    entry = { element, signature };
                    drawn.set(block.key, entry);
                }
                const expected: Node | null = previous === null ? root.firstChild : previous.nextSibling;
                if (expected !== entry.element) root.insertBefore(entry.element, expected);
                previous = entry.element;
                kept.add(block.key);
            }
            for (const [key, entry] of drawn) {
                if (kept.has(key)) continue;
                entry.element.remove();
                drawn.delete(key);
            }
            //anything else in the root was put there by the browser, not drawn from the value
            for (const child of Array.from(root.childNodes)) {
                const key = child instanceof HTMLElement ? child.dataset['key'] : undefined;
                if (key === undefined || drawn.get(key)?.element !== child) child.remove();
            }
        },
        pointAt,
        select: (selection) => {
            const anchor = domPoint(selection.anchor);
            const focus = domPoint(selection.focus);
            const page = document.getSelection();
            if (anchor === null || focus === null || page === null) return;
            page.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
        },
        readSelection: () => {
            const selection = shadowSelection(root);
            if (selection === null || selection.anchorNode === null || selection.focusNode === null) return null;
            const anchor = pointAt(selection.anchorNode, selection.anchorOffset);
            const focus = pointAt(selection.focusNode, selection.focusOffset);
            return anchor === null || focus === null ? null : { anchor, focus };
        },
        selectionOfRange: (range) => {
            const anchor = pointAt(range.startContainer, range.startOffset);
            const focus = pointAt(range.endContainer, range.endOffset);
            return anchor === null || focus === null ? null : { anchor, focus };
        },
        textOf: (key, cell) => {
            const element = drawn.get(key)?.element;
            const container = element !== undefined && cell !== undefined ? cellElement(element, cell) : element;
            return container === undefined || container === null ? null : textNodes(container).map((text) => text.data).join('');
        },
        blockOf: (node) => blockElementOf(node)?.dataset['key'] ?? null,
        elementOf: (key) => drawn.get(key)?.element
    };
}
