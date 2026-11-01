import type { ChartInput } from './scene.js';

/** The values of a chart as a table: a header row, then a row per category, every cell as text */
export interface TableModel {
    readonly headers: readonly string[];
    readonly rows: readonly (readonly string[])[];
}

/**
 * The data table that stays beside the SVG for screen readers. A bar, line or area chart has a column per series; a donut
 * has the value and the share of the total. It holds all the data, also the series or slices the user hid with the legend
 */
export function tableModel(input: ChartInput): TableModel {
    const { categories, series, format, percent, texts } = input;
    if (input.type === 'donut') {
        const entry = series[0];
        const values = categories.map((_label, at) => Math.max(0, entry?.values[at] ?? 0));
        const total = values.reduce((sum, value) => sum + value, 0);
        return {
            headers: [texts.category, texts.value, texts.share],
            rows: categories.map((label, at) => [label, format(values[at] as number), total > 0 ? percent((values[at] as number) / total) : percent(0)])
        };
    }
    return {
        headers: [texts.category, ...series.map((entry) => entry.label)],
        rows: categories.map((label, at) => [label, ...series.map((entry) => format(entry.values[at] ?? 0))])
    };
}

interface Cell {
    readonly element: HTMLElement;
    text: string;
}

/** The data table drawn into a host element; it remembers what it wrote, so a redraw writes only the cells that changed */
export interface DataTable {
    draw(caption: string, model: TableModel): void;
    clear(): void;
}

/** Draws `model` as a `<table>` with a caption, column headers and row headers in `host`, with `createElement` and `textContent` */
export function createDataTable(host: HTMLElement): DataTable {
    const document = host.ownerDocument;
    let table: HTMLTableElement | undefined;
    let caption: Cell | undefined;
    let shape = '';
    let cells: Cell[][] = [];

    const cell = (tag: 'th' | 'td', scope?: string): Cell => {
        const element = document.createElement(tag);
        if (scope !== undefined) element.setAttribute('scope', scope);
        return { element, text: '' };
    };
    const write = (target: Cell, text: string): void => {
        if (target.text === text) return;
        target.text = text;
        target.element.textContent = text;
    };
    const clear = (): void => {
        table?.remove();
        table = undefined;
        caption = undefined;
        shape = '';
        cells = [];
    };
    const build = (model: TableModel): void => {
        clear();
        table = document.createElement('table');
        const captionElement = document.createElement('caption');
        caption = { element: captionElement, text: '' };
        table.append(captionElement);
        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        const headerCells = model.headers.map(() => cell('th', 'col'));
        headRow.append(...headerCells.map((entry) => entry.element));
        head.append(headRow);
        const body = document.createElement('tbody');
        const rows = model.rows.map((row) => {
            const tr = document.createElement('tr');
            const rowCells = row.map((_value, column) => cell(column === 0 ? 'th' : 'td', column === 0 ? 'row' : undefined));
            tr.append(...rowCells.map((entry) => entry.element));
            body.append(tr);
            return rowCells;
        });
        table.append(head, body);
        cells = [headerCells, ...rows];
        host.append(table);
    };

    return {
        draw: (title, model) => {
            const next = `${model.headers.length}x${model.rows.length}`;
            if (table === undefined || next !== shape) {
                build(model);
                shape = next;
            }
            if (caption) write(caption, title);
            [model.headers, ...model.rows].forEach((row, at) => row.forEach((text, column) => write((cells[at] as Cell[])[column] as Cell, text)));
        },
        clear
    };
}
