import { report } from '@punyts/core';
import { applyLinks, disposeLinks, resolveRowLinks, runtimePath } from '@punyts/stateui-app/core';
import type { Link, Node } from '@punyts/stateui-app/core';
import type { ControllerContext } from '@punyts/stateui';
import { layoutTree } from '../shared/diagram/layoutTree.js';
import type { LayoutTreeOptions, TreeLinkIn, TreeNodeIn } from '../shared/diagram/layoutTree.js';
import { removeLinked } from '../shared/records/slotPool.js';

/** A card as the view draws it, under `cards.<name>`; `node.main` is the card template drawn for its record */
interface Card {
    id: string;
    parent: string | null;
    wrap: boolean;
    /** The store path of the record, which the card's `row` points at */
    record: string;
    level: number;
    x: number;
    y: number;
    side: number;
    placed: boolean;
    selected: boolean;
    tab: boolean;
}

interface Edge {
    from: string;
    to: string;
    kind: string;
    path: string;
    label: string;
}

/** The gaps of each `spacing`, in pixels: between leaves, between groups, and between a card and its children's column */
const SPACING: Readonly<Record<string, Required<Pick<LayoutTreeOptions, 'rowGap' | 'groupGap' | 'columnGap'>>>> = {
    sm: { rowGap: 6, groupGap: 18, columnGap: 48 },
    md: { rowGap: 10, groupGap: 28, columnGap: 72 },
    lg: { rowGap: 14, groupGap: 36, columnGap: 96 }
};

/** The card drawn when the diagram has no `card` template: the record's `label` above its `note` */
const DEFAULT_CARD: Node = {
    component: 'card',
    padding: 'sm',
    children: {
        label: { component: 'text', textRole: 'label', '<-_text': '$row.label' },
        note: { component: 'text', textRole: 'caption', '<-_text': '$row.note' }
    }
} as unknown as Node;

/** Elements inside a card that act on a press themselves, so a press on them does not select the card */
const CONTROLS = 'button, a[href], input, select, textarea, [role="button"], [role="menuitem"], [contenteditable]';

const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '');

/**
 * A tree of cards laid out by the component's own function, `layoutTree` (`$.components.treeDiagram.functions.layoutTree`,
 * in `src/shared/diagram/layoutTree.ts`). Each record of `nodes` (an array, or an object keyed by id) is drawn with the
 * consumer's `card` template (a row template: `$row` is the record), or a label-and-note card without one. The cards
 * live in the runtime map `cards`, each with its template copy at `cards.<name>.node.main` and that copy's `row` linked to
 * the record, so the template's `$row` links and its `on` commands reach the record as a list row's do. The cards are
 * drawn unplaced (hidden), measured, laid out and placed; the edges go to the runtime map `edges` as SVG path data. A
 * record's `wrapField` lets it share a block of leaves (`leafBlock`). `links` are the edges across the tree
 * ({ from, to, kind, label }), drawn faintly and lit when one of their ends is selected, or always (`linksShown`).
 *
 * A press on a card selects it (`selected`, the event `select` with { id, box }), a press on the selected card lets it
 * go ({ id: '' }), as a press between the cards does; a press on a control inside the card (a button, a link, a field)
 * is the card's own. A double press or Enter raises `open` with { id, box }. `box` is the card's place in the diagram
 * ({ x, y, width, height }), for a viewport's `lookAt`. The cards are a tree for the keyboard: one tab stop, the arrows move along the tree, Space selects.
 * The layout runs again when the records, the links, the template or the options change and when a card's size changes;
 * a layout of a new size or a new set of cards raises `layout` with { width, height }.
 * A parent loop leaves its cards out, reported once as `SUI-RUN-BINDING`
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const runtime = runtimePath(basePath);
    const nodesPath = `${basePath}.nodes`;
    const linksPath = `${basePath}.links`;
    const selectedPath = `${basePath}.selected`;
    const cardPath = `${basePath}.card`;
    const cardsPath = `${runtime}.cards`;
    const edgesPath = `${basePath}.edges`;
    const fieldNames = ['key', 'parentField', 'wrapField'] as const;
    const optionPaths = ['twoSided', 'columns', 'spacing', 'leafBlock', 'linksShown'].map((name) => `${basePath}.${name}`);
    let disposed = false;
    let scheduled = false;
    let cards = new Map<string, Card>();
    const links = new Map<string, Link[]>();
    let templateJson = '';
    let edges: Edge[] = [];
    let sizes = new Map<string, { width: number; height: number }>();
    /** The size and card count of the last layout raised */
    let laidOut = '';
    let observer: ResizeObserver | undefined;
    let reportedLoop = '';
    let tabId = '';
    const names = new Map<string, string>();

    //the store creates no parents, so each missing object between `$.runtime.nodes` and the diagram's branch is written first
    const segments = runtime.split('.');
    for (let length = 3; length <= segments.length; length++) {
        const prefix = segments.slice(0, length).join('.');
        if (store.get<unknown>(prefix) === undefined) store.set(prefix, {});
    }
    store.set(cardsPath, {});
    // The view reads `cards` through an alias of the runtime map, made before it is drawn: `cards` is not a property,
    // so nothing but an earlier mount's alias stands there
    store.unlink(`${basePath}.cards`);
    store.link(`${basePath}.cards`, cardsPath);

    const text = (name: string, fallback: string): string => {
        const value = store.get<unknown>(`${basePath}.${name}`);
        return typeof value === 'string' && value !== '' ? value : fallback;
    };
    const selected = (): string => textOf(store.get<unknown>(selectedPath));
    /** The runtime key of a card: never integer-like, since `cards` is an ordered map */
    const nameOf = (id: string): string => {
        const known = names.get(id);
        if (known !== undefined) return known;
        const name = SAFE_KEY.test(id) ? `k_${id}` : `u${names.size}`;
        names.set(id, name);
        return name;
    };
    const cardBase = (id: string): string => `${cardsPath}.${nameOf(id)}`;
    const setIfChanged = (path: string, value: unknown): void => {
        if (store.get<unknown>(path) !== value) store.set(path, value);
    };

    /** The cards of the records, in their order; a record without an id is left out */
    const readCards = (): Map<string, Card> => {
        const records = store.get<unknown>(nodesPath);
        const at = store.resolve(nodesPath);
        const key = text('key', 'id');
        const parentField = text('parentField', 'parent');
        const wrapField = text('wrapField', '');
        const entries: [string, unknown, string][] = Array.isArray(records)
            ? (records as unknown[]).map((record, index) => [textOf(isRecord(record) ? record[key] : undefined), record, `${at}.${index}`])
            : isRecord(records)
              ? Object.entries(records).map(([id, record]) => [id, record, `${at}.${id}`])
              : [];
        const found = new Map<string, Card>();
        const choice = selected();
        for (const [id, record, path] of entries) {
            if (id === '' || found.has(id) || !isRecord(record)) continue;
            const parent = textOf(record[parentField]);
            found.set(id, { id, parent: parent === '' ? null : parent, wrap: wrapField !== '' && record[wrapField] === true, record: path, level: 1, x: 0, y: 0, side: 1, placed: false, selected: id === choice, tab: false });
        }
        for (const card of found.values()) {
            let level = 1;
            const seen = new Set([card.id]);
            for (let parent = card.parent; parent !== null && !seen.has(parent); parent = found.get(parent)?.parent ?? null) {
                if (!found.has(parent)) break;
                seen.add(parent);
                level++;
            }
            card.level = level;
        }
        return found;
    };

    const readLinks = (): (TreeLinkIn & { label: string })[] => {
        const value = store.get<unknown>(linksPath);
        if (!Array.isArray(value)) return [];
        return (value as unknown[]).flatMap((link) => {
            if (!isRecord(link) || typeof link['from'] !== 'string' || typeof link['to'] !== 'string') return [];
            return [{ from: link['from'], to: link['to'], ...(typeof link['kind'] === 'string' && { kind: link['kind'] }), label: textOf(link['label']) }];
        });
    };

    const template = (): string => {
        const value = store.get<unknown>(cardPath);
        return JSON.stringify(isRecord(value) && typeof value['component'] === 'string' ? value : DEFAULT_CARD);
    };

    const cardElements = (): HTMLElement[] => Array.from(element.shadowRoot?.querySelectorAll<HTMLElement>('.card') ?? []);
    const cardElement = (id: string): HTMLElement | undefined => cardElements().find((card) => card.dataset['id'] === id);

    const removeCard = (id: string): void => {
        const base = cardBase(id);
        store.unlink(`${base}.node.main.row`);
        disposeLinks(store, links.get(id) ?? []);
        links.delete(id);
        store.delete(base);
    };

    /**
     * Writes a card: its entry with the template copy not yet drawn (`ready: false`), then the copy's `row` link to the
     * record and its own links, and only then `ready`, so the copy starts with its data
     */
    const addCard = (card: Card): void => {
        const base = cardBase(card.id);
        const nodePath = `${base}.node.main`;
        const rewritten = resolveRowLinks(JSON.parse(templateJson) as Node, `${nodePath}.row`, { path: nodePath });
        const tree = rewritten.tree as unknown as Record<string, unknown>;
        removeLinked(tree, nodePath, rewritten.links);
        const { record: _record, wrap: _wrap, ...shown } = card;
        store.set(base, { ...shown, ready: false, node: { main: tree } });
        store.link(`${nodePath}.row`, card.record, { allowMissing: true });
        for (const error of applyLinks(store, rewritten.links)) report.error(error.message, { code: error.code, path: basePath });
        links.set(card.id, rewritten.links);
        store.set(`${base}.ready`, true);
    };

    /** Writes the cards: every card again when the ids, their order or the template changed, else each changed field */
    const writeCards = (next: Map<string, Card>): void => {
        const json = template();
        const same = json === templateJson && next.size === cards.size && [...next.keys()].every((id, at) => [...cards.keys()][at] === id);
        if (!same) {
            for (const id of cards.keys()) removeCard(id);
            templateJson = json;
            for (const card of next.values()) addCard(card);
        } else {
            for (const [id, card] of next) {
                const before = cards.get(id) as Card;
                if (before.record !== card.record) store.link(`${cardBase(id)}.node.main.row`, card.record, { allowMissing: true });
                for (const field of ['selected', 'level'] as const) setIfChanged(`${cardBase(id)}.${field}`, card[field]);
                Object.assign(card, { x: before.x, y: before.y, side: before.side, placed: before.placed });
            }
        }
        cards = next;
        markTab();
        observe();
    };

    /** One card holds the tab stop: the last one focused, else the selected one, else the first */
    const markTab = (): void => {
        const stop = cards.has(tabId) ? tabId : cards.has(selected()) ? selected() : ([...cards.keys()][0] ?? '');
        for (const [id, card] of cards) {
            card.tab = id === stop;
            setIfChanged(`${cardBase(id)}.tab`, card.tab);
        }
    };

    const isLit = (edge: Edge, choice: string): boolean =>
        edge.kind !== 'tree' && (text('linksShown', 'selected') === 'always' || (choice !== '' && (edge.from === choice || edge.to === choice)));

    /** Measures the drawn cards, lays them out with `layoutTree`, and places them and the edges */
    const place = (): void => {
        sizes = new Map();
        for (const card of cardElements()) {
            const id = card.dataset['id'];
            // The used size, unscaled and rounded up: `offsetWidth` rounds to the nearest pixel, and a card half a pixel
            // wider than its place makes the diagram overflow
            const style = getComputedStyle(card);
            if (id !== undefined) sizes.set(id, { width: Math.ceil(parseFloat(style.width) || 0), height: Math.ceil(parseFloat(style.height) || 0) });
        }
        const nodes: TreeNodeIn[] = [...cards.values()].map((card) => ({ id: card.id, parent: card.parent, wrap: card.wrap, ...(sizes.get(card.id) ?? { width: 0, height: 0 }) }));
        const spacing = SPACING[text('spacing', 'md')] ?? SPACING['md'];
        const columns = store.get<unknown>(`${basePath}.columns`);
        const leafBlock = store.get<unknown>(`${basePath}.leafBlock`);
        const given = readLinks();
        const layout = layoutTree({
            nodes,
            links: given,
            options: {
                ...spacing,
                twoSided: store.get<unknown>(`${basePath}.twoSided`) === true,
                columns: typeof columns === 'number' ? columns : 0,
                leafBlock: typeof leafBlock === 'number' ? leafBlock : 0
            }
        });
        const placed = new Set(layout.nodes.map((node) => node.id));
        const left = [...cards.keys()].filter((id) => !placed.has(id));
        const loop = left.join('\u0000');
        if (loop !== '' && loop !== reportedLoop) {
            report.warning('treeDiagram: some cards are their own ancestors, so they are not shown', { code: 'SUI-RUN-BINDING', path: basePath, count: left.length });
        }
        reportedLoop = loop;
        for (const node of layout.nodes) {
            const card = cards.get(node.id);
            if (card === undefined) continue;
            Object.assign(card, { x: node.x, y: node.y, side: node.side, placed: true });
            const base = cardBase(node.id);
            setIfChanged(`${base}.x`, node.x);
            setIfChanged(`${base}.y`, node.y);
            setIfChanged(`${base}.side`, node.side);
            setIfChanged(`${base}.placed`, true);
        }
        const labels = new Map(given.map((link) => [`${link.from}\u0000${link.to}\u0000${link.kind ?? 'link'}`, link.label]));
        edges = layout.edges.map((edge) => ({ ...edge, label: labels.get(`${edge.from}\u0000${edge.to}\u0000${edge.kind}`) ?? '' }));
        const choice = selected();
        const map: Record<string, unknown> = {};
        edges.forEach((edge, index) => {
            map[`e${index}`] = { ...edge, lit: isLit(edge, choice) };
        });
        store.set(edgesPath, map);
        setIfChanged(`${basePath}.width`, layout.width);
        setIfChanged(`${basePath}.height`, layout.height);
        // A new size or a new set of cards is a new layout: a viewport around the diagram can fit it now
        const laid = `${layout.width}x${layout.height}x${layout.nodes.length}`;
        if (laid !== laidOut) {
            laidOut = laid;
            element.dispatchEvent(new CustomEvent('layout', { detail: { width: layout.width, height: layout.height }, bubbles: true, composed: true }));
        }
    };

    const show = (): void => {
        writeCards(readCards());
        place();
    };
    const refresh = (): void => {
        scheduled = false;
        if (!disposed) show();
    };
    const schedule = (): void => {
        if (scheduled || disposed) return;
        scheduled = true;
        queueMicrotask(refresh);
    };

    /** A card whose size changes (a font that loads, a label that wraps) moves the others */
    const observe = (): void => {
        if (typeof ResizeObserver === 'undefined') return;
        observer?.disconnect();
        observer = new ResizeObserver(() => {
            if (!disposed) place();
        });
        for (const card of cardElements()) observer.observe(card);
    };

    const onSelected = (): void => {
        const choice = selected();
        for (const [id, card] of cards) {
            card.selected = id === choice;
            setIfChanged(`${cardBase(id)}.selected`, card.selected);
        }
        edges.forEach((edge, index) => setIfChanged(`${edgesPath}.e${index}.lit`, isLit(edge, choice)));
        markTab();
    };

    const recordPaths = (): string[] => [nodesPath, `${nodesPath}.$every`, ...fieldNames.map((name) => `${nodesPath}.$every.${text(name, '')}`).filter((path) => !path.endsWith('.'))];
    let watched = recordPaths();
    const onFields = (): void => {
        store.off(watched, schedule);
        watched = recordPaths();
        store.on(watched, schedule);
        schedule();
    };
    const fieldPaths = fieldNames.map((name) => `${basePath}.${name}`);
    const linkPaths = [linksPath, `${linksPath}.$every`];
    store.on(watched, schedule);
    store.on(fieldPaths, onFields);
    store.on(linkPaths, schedule);
    store.on(optionPaths, schedule);
    store.on([cardPath], schedule);
    store.on([selectedPath], onSelected);

    /** The card's place in the diagram, for a viewport's `lookAt` */
    const boxOf = (id: string): { x: number; y: number; width: number; height: number } => {
        const card = cards.get(id);
        const size = sizes.get(id) ?? { width: 0, height: 0 };
        return { x: card?.x ?? 0, y: card?.y ?? 0, ...size };
    };
    const raise = (name: string, id: string): void => {
        element.dispatchEvent(new CustomEvent(name, { detail: { id, box: boxOf(id) }, bubbles: true, composed: true }));
    };
    /** The card an event passed through, and whether it passed through a control of the card first */
    const cardOf = (event: Event): { id: string; control: boolean } | undefined => {
        let control = false;
        for (const target of event.composedPath()) {
            if (target === element) return undefined;
            if (!(target instanceof HTMLElement)) continue;
            if (target.classList.contains('card') && target.dataset['id'] !== undefined && target.getRootNode() === element.shadowRoot) return { id: target.dataset['id'], control };
            if (target.matches(CONTROLS)) control = true;
        }
        return undefined;
    };
    const toggle = (id: string): void => {
        const next = selected() === id ? '' : id;
        store.set(selectedPath, next);
        raise('select', next);
    };
    const focus = (id: string | undefined): void => {
        if (id === undefined) return;
        tabId = id;
        markTab();
        cardElement(id)?.focus();
    };
    /** The card the arrow key leads to: up and down in the records' order, out to the first child and in to the parent */
    const step = (id: string, key: string): string | undefined => {
        const ids = [...cards.keys()].filter((each) => cards.get(each)?.placed === true);
        const at = ids.indexOf(id);
        const card = cards.get(id) as Card;
        if (key === 'ArrowDown') return ids[at + 1];
        if (key === 'ArrowUp') return ids[at - 1];
        if (key === 'Home') return ids[0];
        if (key === 'End') return ids[ids.length - 1];
        const way = key === 'ArrowRight' ? 1 : -1;
        if (card.parent === null) return ids.find((each) => cards.get(each)?.parent === id && cards.get(each)?.side === way);
        if (card.side === way) return ids.find((each) => cards.get(each)?.parent === id);
        return card.parent;
    };

    schedule();

    return {
        onClick: (event: MouseEvent) => {
            const pressed = cardOf(event);
            if (pressed === undefined) {
                //a press on the diagram between the cards lets the selected card go
                if (selected() !== '' && event.detail <= 1) toggle(selected());
                return;
            }
            if (pressed.control || event.detail > 1) return;
            tabId = pressed.id;
            toggle(pressed.id);
        },
        onDoubleClick: (event: MouseEvent) => {
            const pressed = cardOf(event);
            if (pressed !== undefined && !pressed.control) raise('open', pressed.id);
        },
        onKeyDown: (event: KeyboardEvent) => {
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            const pressed = cardOf(event);
            if (pressed === undefined || pressed.control) return;
            if (event.key === 'Enter') raise('open', pressed.id);
            else if (event.key === ' ') toggle(pressed.id);
            else if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) focus(step(pressed.id, event.key));
            else return;
            event.preventDefault();
        },
        dispose: () => {
            disposed = true;
            observer?.disconnect();
            store.off(watched, schedule);
            store.off(fieldPaths, onFields);
            store.off(linkPaths, schedule);
            store.off(optionPaths, schedule);
            store.off([cardPath], schedule);
            store.off([selectedPath], onSelected);
            for (const id of cards.keys()) removeCard(id);
            store.unlink(`${basePath}.cards`);
        }
    };
}
