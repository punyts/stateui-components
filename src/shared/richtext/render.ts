import { LINK_ROLE, headingTag } from '../markdown/render.js';
import { LIST_TYPES, MARKS } from './model.js';
import type { Block, Cell, KeyedBlock, Mark, Run } from './model.js';

/**
 * Draws blocks into an element. Every element comes from `createElement` and every character reaches the page as a text
 * node, so nothing in a value is read as markup. List items of a run of list blocks are grouped into nested `ul` and `ol`
 * lists by their indent; a check item is an `li` with a disabled checkbox. A link is a `span` with `role="link"` and
 * `data-href`, as in `markdown`, so it cannot navigate and the component raises `press` for it. Each block's element
 * carries `data-key`, its block key
 */

export interface RichTextRenderOptions {
    /** Added to a heading's level: with 1, a level 1 heading is an `h2`. The result is at most 6 */
    headingOffset: number;
    /** The URL a stored file is read from (the runtime's `fileUrl` hook); an image without one is drawn as its alt text */
    fileUrl?: (id: string) => string | undefined;
}

/**
 * An image block as a `figure`: the `img` read from `url` with its alt text, drawn at its width (`data-width`), and the
 * caption as a `figcaption`. Without a URL, or once the picture fails to load, the figure shows a box with the alt text
 * (or the file's name) instead (`.missing`)
 */
export function imageFigure(document: Document, block: Pick<Block, 'file' | 'alt' | 'caption' | 'width'>, url: string | undefined): HTMLElement {
    const figure = document.createElement('figure');
    figure.className = 'image';
    figure.dataset['width'] = block.width ?? 'full';
    const missing = (): void => {
        const box = document.createElement('span');
        box.className = 'missing';
        box.setAttribute('role', 'img');
        box.setAttribute('aria-label', block.alt || block.file?.name || '');
        box.textContent = block.alt || block.file?.name || '';
        figure.querySelector('img')?.remove();
        figure.prepend(box);
    };
    if (url === undefined) missing();
    else {
        const image = document.createElement('img');
        image.src = url;
        image.alt = block.alt ?? '';
        image.decoding = 'async';
        image.addEventListener('error', missing, { once: true });
        figure.appendChild(image);
    }
    if (block.caption !== undefined) {
        const caption = document.createElement('figcaption');
        caption.textContent = block.caption;
        figure.appendChild(caption);
    }
    return figure;
}

const MARK_TAGS: Readonly<Record<Mark, string>> = { code: 'code', strike: 's', italic: 'em', bold: 'strong' };

/** A run as a text node inside its mark elements, code innermost */
export function markedNode(document: Document, run: Run): Node {
    let node: Node = document.createTextNode(run.text);
    for (const mark of MARKS) {
        if (!(run.marks ?? []).includes(mark)) continue;
        const element = document.createElement(MARK_TAGS[mark]);
        if (mark === 'code') element.className = 'inline';
        element.appendChild(node);
        node = element;
    }
    return node;
}

/** A mention: `span.mention` with `data-mention`, its id, holding the text it shows; the editor makes it not editable */
export function mentionNode(document: Document, run: Run): HTMLElement {
    const element = document.createElement('span');
    element.className = 'mention';
    element.dataset['mention'] = run.mention ?? '';
    element.appendChild(markedNode(document, run));
    return element;
}

/**
 * A table: `table` with the first row in `thead` as `th` cells and the rest in `tbody`. Each cell carries `data-row`
 * and `data-column`, and `data-align` when its column has one; `fill` puts the cell's content in
 */
export function tableElement(document: Document, block: Pick<Block, 'rows' | 'align'>, fill: (cell: HTMLElement, content: Cell, row: number, column: number) => void): HTMLTableElement {
    const table = document.createElement('table');
    const head = document.createElement('thead');
    const body = document.createElement('tbody');
    (block.rows ?? []).forEach((row, rowIndex) => {
        const line = document.createElement('tr');
        row.cells.forEach((content, column) => {
            const cell = document.createElement(rowIndex === 0 ? 'th' : 'td');
            cell.dataset['row'] = String(rowIndex);
            cell.dataset['column'] = String(column);
            const align = block.align?.[column];
            if (align !== undefined && align !== '') cell.dataset['align'] = align;
            fill(cell, content, rowIndex, column);
            line.appendChild(cell);
        });
        (rowIndex === 0 ? head : body).appendChild(line);
    });
    table.appendChild(head);
    if (body.childNodes.length > 0) table.appendChild(body);
    return table;
}

/** Appends a block's runs to `parent`; consecutive runs with the same link share one link, and a mention is `span.mention` */
export function renderRuns(document: Document, parent: Node, runs: readonly Run[]): void {
    let at = 0;
    while (at < runs.length) {
        const link = runs[at]?.link;
        if (runs[at]?.mention !== undefined) {
            parent.appendChild(mentionNode(document, runs[at] as Run));
            at++;
            continue;
        }
        if (link === undefined) {
            parent.appendChild(markedNode(document, runs[at] as Run));
            at++;
            continue;
        }
        const element = document.createElement('span');
        element.className = 'link';
        element.setAttribute('role', LINK_ROLE);
        element.setAttribute('tabindex', '0');
        element.dataset['href'] = link;
        while (at < runs.length && runs[at]?.link === link) {
            element.appendChild(markedNode(document, runs[at] as Run));
            at++;
        }
        parent.appendChild(element);
    }
}

function blockElement(document: Document, block: KeyedBlock, options: RichTextRenderOptions): HTMLElement {
    let element: HTMLElement;
    switch (block.type) {
        case 'heading':
            element = document.createElement(headingTag(block.level ?? 1, options.headingOffset));
            renderRuns(document, element, block.runs);
            break;
        case 'quote':
            element = document.createElement('blockquote');
            renderRuns(document, element, block.runs);
            break;
        case 'code': {
            element = document.createElement('pre');
            const code = document.createElement('code');
            code.textContent = block.runs.map((run) => run.text).join('');
            if (block.language !== undefined) element.dataset['language'] = block.language;
            element.appendChild(code);
            break;
        }
        case 'divider':
            element = document.createElement('hr');
            break;
        case 'table':
            element = tableElement(document, block, (cell, content) => renderRuns(document, cell, content.runs));
            break;
        case 'image':
            element = imageFigure(document, block, block.file === undefined ? undefined : options.fileUrl?.(block.file.id));
            break;
        default:
            element = document.createElement('p');
            renderRuns(document, element, block.runs);
            break;
    }
    element.dataset['key'] = block.key;
    return element;
}

interface OpenList {
    element: HTMLElement;
    indent: number;
    tag: 'ul' | 'ol';
    check: boolean;
}

function listItem(document: Document, block: KeyedBlock): HTMLElement {
    const item = document.createElement('li');
    item.dataset['key'] = block.key;
    if (block.type === 'check') {
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.disabled = true;
        box.checked = block.checked === true;
        box.tabIndex = -1;
        item.appendChild(box);
        item.toggleAttribute('data-checked', block.checked === true);
        const text = document.createElement('span');
        renderRuns(document, text, block.runs);
        item.appendChild(text);
    } else renderRuns(document, item, block.runs);
    return item;
}

/** Replaces the children of `target` with the blocks, in the order given */
export function renderRichText(target: HTMLElement, blocks: readonly KeyedBlock[], options: RichTextRenderOptions): void {
    const document = target.ownerDocument;
    const fragment = document.createDocumentFragment();
    const open: OpenList[] = [];
    for (const block of blocks) {
        if (!LIST_TYPES.includes(block.type)) {
            open.length = 0;
            fragment.appendChild(blockElement(document, block, options));
            continue;
        }
        const indent = block.indent ?? 0;
        const tag = block.type === 'numbered' ? 'ol' : 'ul';
        const check = block.type === 'check';
        while (open.length > 0) {
            const top = open[open.length - 1] as OpenList;
            if (top.indent > indent || (top.indent === indent && (top.tag !== tag || top.check !== check))) open.pop();
            else break;
        }
        let top = open[open.length - 1];
        if (top === undefined || top.indent < indent) {
            const list = document.createElement(tag);
            if (check) list.className = 'checks';
            //a deeper list goes inside the last item of the list above it, or at the top level when there is none
            const parent: Node = top?.element.lastElementChild ?? fragment;
            parent.appendChild(list);
            top = { element: list, indent, tag, check };
            open.push(top);
        }
        top.element.appendChild(listItem(document, block));
    }
    target.replaceChildren(fragment);
}
