import type { MarkdownNode } from './nodes.js';

/**
 * Turns the tree `parseMarkdown` returns into DOM. Every element comes from `createElement` and every character of the
 * source reaches the page through `textContent` or a text node, so nothing in the source is ever read as markup. A link is
 * a `span` with `role="link"` and `data-href`: it has no `href`, so it cannot navigate, and the component raises `press`
 * for it. A table cell's alignment is the `data-align` attribute the stylesheet reads
 */

export interface RenderOptions {
    /** Added to a heading's level: with 1, `#` becomes an `h2`. The result is at most 6 */
    headingOffset: number;
}

export const LINK_ROLE = 'link';

/** The heading element for a source level: shifted by the offset and capped at `h6` */
export function headingTag(level: number, offset: number): string {
    return `h${Math.min(6, Math.max(1, level + offset))}`;
}

const make = (document: Document, tag: string, className?: string): HTMLElement => {
    const element = document.createElement(tag);
    if (className !== undefined) element.className = className;
    return element;
};

function renderInline(document: Document, parent: Node, nodes: readonly MarkdownNode[]): void {
    for (const node of nodes) {
        switch (node.type) {
            case 'text':
                parent.appendChild(document.createTextNode(node.text));
                break;
            case 'emphasis':
            case 'strong': {
                const element = make(document, node.type === 'emphasis' ? 'em' : 'strong');
                renderInline(document, element, node.children);
                parent.appendChild(element);
                break;
            }
            case 'inlineCode': {
                const element = make(document, 'code', 'inline');
                element.textContent = node.text;
                parent.appendChild(element);
                break;
            }
            case 'link': {
                const element = make(document, 'span', 'link');
                element.setAttribute('role', LINK_ROLE);
                element.setAttribute('tabindex', '0');
                element.dataset['href'] = node.href;
                renderInline(document, element, node.children);
                parent.appendChild(element);
                break;
            }
            default:
                break;
        }
    }
}

function renderBlock(document: Document, parent: Node, node: MarkdownNode, options: RenderOptions): void {
    let element: HTMLElement;
    switch (node.type) {
        case 'paragraph':
            element = make(document, 'p');
            renderInline(document, element, node.children);
            break;
        case 'text':
            element = make(document, 'p', 'raw');
            element.textContent = node.text;
            break;
        case 'heading':
            element = make(document, headingTag(node.level, options.headingOffset));
            renderInline(document, element, node.children);
            break;
        case 'bulletList':
        case 'orderedList':
            element = make(document, node.type === 'bulletList' ? 'ul' : 'ol');
            if (node.type === 'orderedList' && node.level !== 1) element.setAttribute('start', String(node.level));
            for (const child of node.children) renderBlock(document, element, child, options);
            break;
        case 'listItem':
            element = make(document, 'li');
            for (const child of node.children) renderBlock(document, element, child, options);
            break;
        case 'blockquote':
            element = make(document, 'blockquote');
            for (const child of node.children) renderBlock(document, element, child, options);
            break;
        case 'code': {
            element = make(document, 'pre');
            const code = make(document, 'code');
            code.textContent = node.text;
            element.appendChild(code);
            break;
        }
        case 'rule':
            element = make(document, 'hr');
            break;
        case 'table': {
            element = make(document, 'table');
            const [header, ...rows] = node.children;
            const head = make(document, 'thead');
            const body = make(document, 'tbody');
            for (const [section, group] of [[head, header === undefined ? [] : [header]], [body, rows]] as const) {
                for (const row of group) {
                    const line = make(document, 'tr');
                    for (const cell of row.children) {
                        const td = make(document, cell.type === 'headerCell' ? 'th' : 'td');
                        if (cell.type === 'headerCell') td.setAttribute('scope', 'col');
                        if (cell.align !== '') td.dataset['align'] = cell.align;
                        renderInline(document, td, cell.children);
                        line.appendChild(td);
                    }
                    section.appendChild(line);
                }
                if (section.childNodes.length > 0) element.appendChild(section);
            }
            break;
        }
        default:
            return;
    }
    parent.appendChild(element);
}

/** Replaces the children of `root` with the rendered nodes: blocks, or inline nodes when `inline` is true */
export function renderMarkdown(root: Element, nodes: readonly MarkdownNode[], options: RenderOptions, inline = false): void {
    const document = root.ownerDocument;
    const fragment = document.createDocumentFragment();
    if (inline) renderInline(document, fragment, nodes);
    else for (const node of nodes) renderBlock(document, fragment, node, options);
    root.replaceChildren(fragment);
}
