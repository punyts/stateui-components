import { report } from '@punyts/core';
import type { ControllerContext } from '@punyts/stateui';
import { layoutTree } from '../shared/diagram/layoutTree.js';
import type { LayoutTreeOptions, TreeLinkIn, TreeNodeIn } from '../shared/diagram/layoutTree.js';

/** A card as the view draws it, under `cards.<name>` */
interface Card {
    id: string;
    parent: string | null;
    label: string;
    note: string;
    addLabel: string;
    x: number;
    y: number;
    side: number;
    placed: boolean;
    selected: boolean;
}

/** The gaps of each `spacing`, in pixels: between leaves, between groups, and between a card and its children's column */
const SPACING: Readonly<Record<string, Required<Pick<LayoutTreeOptions, 'rowGap' | 'groupGap' | 'columnGap'>>>> = {
    sm: { rowGap: 6, groupGap: 18, columnGap: 48 },
    md: { rowGap: 10, groupGap: 28, columnGap: 72 },
    lg: { rowGap: 14, groupGap: 36, columnGap: 96 }
};

const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '');

/**
 * A tree of cards laid out by the component's own function, `layoutTree` (`$.components.treeDiagram.functions.layoutTree`,
 * in `src/shared/diagram/layoutTree.ts`), in one pass: the cards are written to the runtime map `cards` unplaced (hidden),
 * measured, laid out, and placed; the edges go to the runtime map `edges` as SVG path data. A card's records come from
 * `nodes` (an array, or an object keyed by id), with `parentField`, `labelField` and `noteField`; `links` are the edges
 * across the tree ({ from, to, kind }), drawn faintly and lit when one of their ends is selected. The layout runs again
 * when the records, the links or the options change and when a card's size changes.
 *
 * A press on a card selects it (`selected`, the event `select` with { id }), and a press on the selected card lets it go
 * ({ id: '' }). A double press or Enter raises `open` with { id }; the + of an `addable` diagram raises `add` with { id }.
 * A parent loop leaves its cards out, reported once as `SUI-RUN-BINDING`
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const nodesPath = `${basePath}.nodes`;
    const linksPath = `${basePath}.links`;
    const selectedPath = `${basePath}.selected`;
    const cardsPath = `${basePath}.cards`;
    const edgesPath = `${basePath}.edges`;
    const fieldNames = ['key', 'parentField', 'labelField', 'noteField'] as const;
    const optionPaths = ['twoSided', 'columns', 'spacing', 'addable', '_add'].map((name) => `${basePath}.${name}`);
    let disposed = false;
    let scheduled = false;
    let cards = new Map<string, Card>();
    let edges: { from: string; to: string; kind: string; path: string }[] = [];
    let observer: ResizeObserver | undefined;
    let reportedLoop = '';
    const names = new Map<string, string>();

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

    /** The cards of the records, in their order; a record without an id is left out */
    const readCards = (): Map<string, Card> => {
        const records = store.get<unknown>(nodesPath);
        const key = text('key', 'id');
        const parentField = text('parentField', 'parent');
        const labelField = text('labelField', 'label');
        const noteField = text('noteField', '');
        const addTemplate = text('_add', 'Add to {label}');
        const entries: [string, unknown][] = Array.isArray(records)
            ? (records as unknown[]).map((record) => [textOf(isRecord(record) ? record[key] : undefined), record])
            : isRecord(records)
              ? Object.entries(records)
              : [];
        const found = new Map<string, Card>();
        const choice = selected();
        for (const [id, record] of entries) {
            if (id === '' || found.has(id) || !isRecord(record)) continue;
            const parent = textOf(record[parentField]);
            const label = textOf(record[labelField]) || id;
            found.set(id, {
                id,
                parent: parent === '' ? null : parent,
                label,
                note: noteField === '' ? '' : textOf(record[noteField]),
                addLabel: addTemplate.replace('{label}', label),
                x: 0,
                y: 0,
                side: 1,
                placed: false,
                selected: id === choice
            });
        }
        return found;
    };

    const readLinks = (): TreeLinkIn[] => {
        const value = store.get<unknown>(linksPath);
        if (!Array.isArray(value)) return [];
        return (value as unknown[]).flatMap((link) => {
            if (!isRecord(link) || typeof link['from'] !== 'string' || typeof link['to'] !== 'string') return [];
            return [{ from: link['from'], to: link['to'], ...(typeof link['kind'] === 'string' && { kind: link['kind'] }) }];
        });
    };

    const setIfChanged = (path: string, value: unknown): void => {
        if (store.get<unknown>(path) !== value) store.set(path, value);
    };

    const cardElements = (): HTMLElement[] => Array.from(element.shadowRoot?.querySelectorAll<HTMLElement>('.card') ?? []);

    /** Writes the cards: the whole map when the set of ids changed, else each changed field */
    const writeCards = (next: Map<string, Card>): void => {
        const same = next.size === cards.size && [...next.keys()].every((id, at) => [...cards.keys()][at] === id);
        if (!same) {
            const map: Record<string, Card> = {};
            for (const [id, card] of next) map[nameOf(id)] = { ...card };
            store.set(cardsPath, map);
        } else {
            for (const [id, card] of next) {
                const base = `${cardsPath}.${nameOf(id)}`;
                for (const field of ['label', 'note', 'addLabel', 'selected'] as const) setIfChanged(`${base}.${field}`, card[field]);
            }
        }
        cards = next;
        observe();
    };

    /** Measures the drawn cards, lays them out with `layoutTree`, and places them and the edges */
    const place = (): void => {
        const sizes = new Map<string, { width: number; height: number }>();
        for (const card of cardElements()) {
            const id = card.dataset['id'];
            if (id !== undefined) sizes.set(id, { width: card.offsetWidth, height: card.offsetHeight });
        }
        const nodes: TreeNodeIn[] = [...cards.values()].map((card) => ({ id: card.id, parent: card.parent, ...(sizes.get(card.id) ?? { width: 0, height: 0 }) }));
        const spacing = SPACING[text('spacing', 'md')] ?? SPACING['md'];
        const columns = store.get<unknown>(`${basePath}.columns`);
        const layout = layoutTree({
            nodes,
            links: readLinks(),
            options: { ...spacing, twoSided: store.get<unknown>(`${basePath}.twoSided`) === true, columns: typeof columns === 'number' ? columns : 0 }
        });
        const placed = new Set(layout.nodes.map((node) => node.id));
        const left = [...cards.keys()].filter((id) => !placed.has(id));
        const loop = left.join('\u0000');
        if (loop !== '' && loop !== reportedLoop) {
            report.warning('treeDiagram: some cards are their own ancestors, so they are not shown', { code: 'SUI-RUN-BINDING', path: basePath, count: left.length });
        }
        reportedLoop = loop;
        for (const node of layout.nodes) {
            const base = `${cardsPath}.${nameOf(node.id)}`;
            setIfChanged(`${base}.x`, node.x);
            setIfChanged(`${base}.y`, node.y);
            setIfChanged(`${base}.side`, node.side);
            setIfChanged(`${base}.placed`, true);
        }
        edges = [...layout.edges];
        const choice = selected();
        const map: Record<string, unknown> = {};
        edges.forEach((edge, index) => {
            map[`e${index}`] = { ...edge, lit: edge.kind !== 'tree' && choice !== '' && (edge.from === choice || edge.to === choice) };
        });
        store.set(edgesPath, map);
        setIfChanged(`${basePath}.width`, layout.width);
        setIfChanged(`${basePath}.height`, layout.height);
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
            setIfChanged(`${cardsPath}.${nameOf(id)}.selected`, card.selected);
        }
        edges.forEach((edge, index) => setIfChanged(`${edgesPath}.e${index}.lit`, edge.kind !== 'tree' && choice !== '' && (edge.from === choice || edge.to === choice)));
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
    store.on([selectedPath], onSelected);

    const raise = (name: string, id: string): void => {
        element.dispatchEvent(new CustomEvent(name, { detail: { id }, bubbles: true, composed: true }));
    };
    const idOf = (event: Event, selector: string): string | undefined => {
        for (const target of event.composedPath()) {
            if (target === element) return undefined;
            if (target instanceof HTMLElement && target.matches(selector)) return target.dataset['id'];
        }
        return undefined;
    };

    schedule();

    return {
        onClick: (event: MouseEvent) => {
            const added = idOf(event, '.add');
            if (added !== undefined) {
                raise('add', added);
                return;
            }
            const pressed = idOf(event, '.open');
            if (pressed === undefined || event.detail > 1) return;
            const next = selected() === pressed ? '' : pressed;
            store.set(selectedPath, next);
            raise('select', next);
        },
        onDoubleClick: (event: MouseEvent) => {
            const pressed = idOf(event, '.open');
            if (pressed !== undefined) raise('open', pressed);
        },
        onKeyDown: (event: KeyboardEvent) => {
            if (event.key !== 'Enter' || event.altKey || event.ctrlKey || event.metaKey) return;
            const pressed = idOf(event, '.open');
            if (pressed === undefined) return;
            event.preventDefault();
            raise('open', pressed);
        },
        dispose: () => {
            disposed = true;
            observer?.disconnect();
            store.off(watched, schedule);
            store.off(fieldPaths, onFields);
            store.off(linkPaths, schedule);
            store.off(optionPaths, schedule);
            store.off([selectedPath], onSelected);
        }
    };
}
