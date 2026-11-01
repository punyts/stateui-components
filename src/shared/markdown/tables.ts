import { parseInline } from './inlines.js';
import { markdownNode } from './nodes.js';
import type { MarkdownAlign, MarkdownNode } from './nodes.js';

/**
 * GFM tables. A paragraph whose first line is a header row and whose second line is a delimiter row (`| --- | :-: |`,
 * with the same number of cells) is a table; every later line of the paragraph is a body row. A row with more cells than the header loses the extra ones; a row with fewer keeps only the cells it has (nothing is padded, so the tree is no larger than the source). A table has to start the
 * paragraph: a table directly after a line of text stays a paragraph. Cells are split on `|` that a backslash does not
 * escape, in one pass over each line
 */

const BACKSLASH = 92;
const PIPE = 124;

/** The cells of a row, trimmed, with the optional outer pipes removed and `\|` turned into `|` */
export function splitRow(line: string): string[] {
    let start = 0;
    let end = line.length;
    while (start < end && (line.charCodeAt(start) === 32 || line.charCodeAt(start) === 9)) start++;
    while (end > start && (line.charCodeAt(end - 1) === 32 || line.charCodeAt(end - 1) === 9)) end--;
    if (start < end && line.charCodeAt(start) === PIPE) start++;
    if (end > start && line.charCodeAt(end - 1) === PIPE && line.charCodeAt(end - 2) !== BACKSLASH) end--;
    if (start >= end) return [];
    const cells: string[] = [];
    let cell = '';
    let from = start;
    for (let at = start; at < end; at++) {
        if (line.charCodeAt(at) === BACKSLASH && line.charCodeAt(at + 1) === PIPE) {
            cell += `${line.slice(from, at)}|`;
            at++;
            from = at + 1;
        } else if (line.charCodeAt(at) === PIPE) {
            cells.push((cell + line.slice(from, at)).trim());
            cell = '';
            from = at + 1;
        }
    }
    cells.push((cell + line.slice(from, end)).trim());
    return cells;
}

/** The alignments of a delimiter row, or undefined when the line is not one */
function readDelimiterRow(line: string): MarkdownAlign[] | undefined {
    if (line.indexOf('|') === -1) return undefined;
    const cells = splitRow(line);
    if (cells.length === 0) return undefined;
    const aligns: MarkdownAlign[] = [];
    for (const cell of cells) {
        const left = cell.charCodeAt(0) === 58;
        const right = cell.length > 1 && cell.charCodeAt(cell.length - 1) === 58;
        const dashes = cell.slice(left ? 1 : 0, right ? -1 : undefined);
        if (dashes.length === 0) return undefined;
        for (let at = 0; at < dashes.length; at++) if (dashes.charCodeAt(at) !== 45) return undefined;
        aligns.push(left && right ? 'center' : left ? 'left' : right ? 'right' : '');
    }
    return aligns;
}

/** The table a paragraph's text is, or undefined when it is not one */
export function tableFrom(text: string): MarkdownNode | undefined {
    const firstBreak = text.indexOf('\n');
    if (firstBreak === -1) return undefined;
    let secondBreak = text.indexOf('\n', firstBreak + 1);
    if (secondBreak === -1) secondBreak = text.length;
    const aligns = readDelimiterRow(text.slice(firstBreak + 1, secondBreak));
    if (aligns === undefined) return undefined;
    const header = splitRow(text.slice(0, firstBreak));
    if (header.length !== aligns.length) return undefined;

    const row = (cells: readonly string[], type: 'headerCell' | 'tableCell'): MarkdownNode =>
        markdownNode('tableRow', {
            children: cells.slice(0, aligns.length).map((cell, column) => markdownNode(type, { align: aligns[column] ?? '', children: parseInline(cell) }))
        });
    const rows = [row(header, 'headerCell')];
    let from = secondBreak + 1;
    while (from < text.length) {
        let to = text.indexOf('\n', from);
        if (to === -1) to = text.length;
        rows.push(row(splitRow(text.slice(from, to)), 'tableCell'));
        from = to + 1;
    }
    return markdownNode('table', { children: rows });
}
