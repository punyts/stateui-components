import { report } from '@punyts/core';
import type { ControllerContext } from '@punyts/stateui';
import { runtimePath } from '@punyts/stateui-app/core';
import { MOVE_KEYS, announce, columnAt, dropIndex, passedThreshold, placeAfterKey } from '../shared/drag/drag.js';
import type { ColumnBox, ColumnSize, Place } from '../shared/drag/drag.js';
import { toNumber } from '../shared/format/format.js';
import { buildBoard, planMove } from '../shared/records/board.js';
import type { RecordViewElement } from '../shared/records/recordView.js';
import { isUnrendered } from '../shared/records/viewport.js';

/** The properties of the board that a column body reads through a link, by the body's property name */
const PASSED: Readonly<Record<string, string>> = {
    records: 'records',
    row: 'card',
    key: 'key'
};

/** A column of the board: the value of `columnField` that puts a record in it, its title and its limit */
interface Column {
    readonly key: string;
    readonly title: string;
    readonly limit: number;
}

/** Elements in a card that act on a press themselves, so a press on them does not start a drag */
const INTERACTIVE = new Set(['a', 'button', 'input', 'label', 'select', 'summary', 'textarea']);

/** A press on a card that may become a drag */
interface Press {
    readonly pointer: number;
    readonly x: number;
    readonly y: number;
    readonly key: string;
    readonly column: string;
    readonly index: number;
    readonly slot: HTMLElement;
}

/** A card that is being moved: by the pointer, with the boxes measured at the start, or by the keyboard */
interface Held {
    readonly by: 'pointer' | 'keyboard';
    readonly key: string;
    readonly home: string;
    readonly homeIndex: number;
    readonly name: string;
    place: Place | undefined;
    readonly boxes: ColumnBox[];
    readonly slot?: HTMLElement;
    readonly pointer?: number;
}

const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The `badge` node that shows the number of cards of a column: warning and solid past the limit */
const badgeNode = (text: string, over: boolean): Record<string, unknown> => ({ component: 'badge', size: 'sm', tone: over ? 'warning' : 'neutral', variant: over ? 'solid' : 'soft', _text: text });

/** The `recordList` node of one column body: the card list, with no selection and the role `list` */
const bodyNode = (): Record<string, unknown> => ({
    component: 'recordList',
    rowHeight: 'md',
    overscan: 5,
    role: 'list',
    multiselectable: false,
    selectable: false,
    loading: false,
    count: 0,
    slots: {},
    loadingRows: 0,
    loadingFirst: 0
});

/**
 * Draws a column per key of `columns`; the key is the value of `columnField` that puts a record in the column. Each column
 * body is a `recordList` node in the runtime property `cols` (`cols.<name>.body.main`), drawn with `<sui-node>` like the
 * body of a `list`: its `records`, `row` and `key` are store aliases of the board's `records`, `card` and `key`, so the slot
 * pool, the `$row` links and the recycling are the record view's, and a column of 2,000 cards holds only the slots that fit
 * the viewport. The board turns the records into one `order` per column (`buildBoard`, in `src/shared/records/board.ts`: the
 * records with that column value, sorted by `orderField`), written as a runtime array aliased as the body's `order`, so
 * writing a record's `columnField` in the data moves its card by changing two orders.
 *
 * A column keeps its body for as long as the board lives. A key that leaves `columns` hides its column (`gone`, laid out of the flow but at its size, with an empty
 * order) and a key that returns shows it again, because taking a record view out of the document while it is drawn would
 * delete its slot nodes before the view has let go of them. The columns are drawn in the order of `columns` (`position`,
 * a CSS `order`), so a column added later is placed by its key, not by when it appeared.
 *
 * A record whose value matches no column is not shown, and the board reports it once per distinct value as `SUI-RUN-BINDING`
 * (a warning), because the data is not known to the static validator. The header of a column shows its title (the content
 * `_title` of the column), the number of cards, and the limit when `limit` is above 0, in a `badge` (so the tone colours are the
 * shared articulation's, not this board's); past the limit the badge has `tone="warning"`, the header is `data-tone="warning"` and
 * carries the content `_limitExceeded` as hidden text
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const runtime = runtimePath(basePath);
    const colsPath = `${basePath}.cols`;
    const ordersPath = `${runtime}.orders`;
    const recordsPath = `${basePath}.records`;
    const columnsPath = `${basePath}.columns`;
    const fieldNames = ['key', 'columnField', 'orderField'] as const;
    let disposed = false;
    let scheduled = false;
    let started = false;
    const reported = new Set<string>();
    const names = new Map<string, string>();
    const aliases: string[] = [];

    const text = (name: string, fallback: string): string => {
        const value = store.get<unknown>(`${basePath}.${name}`);
        return typeof value === 'string' && value !== '' ? value : fallback;
    };
    const readColumns = (): Column[] => {
        const map = store.get<unknown>(columnsPath);
        const entries = isRecord(map) ? Object.entries(map) : [];
        return entries.map(([key, entry]) => {
            const spec = isRecord(entry) ? entry : {};
            const limit = typeof spec['limit'] === 'number' && Number.isFinite(spec['limit']) ? Math.max(0, Math.floor(spec['limit'])) : 0;
            const title = typeof spec['_title'] === 'string' && spec['_title'] !== '' ? spec['_title'] : key;
            return { key, title, limit };
        });
    };
    /** The name a column is stored under: its key when a path can hold it, otherwise a number; it never changes for a key */
    const nameOf = (key: string): string => {
        const known = names.get(key);
        if (known !== undefined) return known;
        const name = SAFE_KEY.test(key) ? `k_${key}` : `u${names.size}`;
        names.set(key, name);
        return name;
    };

    //the store creates no parents, so each missing object between `$.runtime.nodes` and the board's branch is written first
    const segments = runtime.split('.');
    for (let length = 3; length <= segments.length; length++) {
        const prefix = segments.slice(0, length).join('.');
        if (store.get<unknown>(prefix) === undefined) store.set(prefix, {});
    }

    /**
     * The column is stored with `ready: false` and its body node, which the view does not draw yet; the aliases of the body
     * are linked, and only then `ready` is written, so the record view finds its data when it starts, also for a column
     * added after the board is drawn
     */
    const addColumn = (column: Column, name: string): void => {
        store.set(`${colsPath}.${name}`, { key: column.key, title: column.title, count: 0, limit: column.limit, over: false, gone: false, position: 0, ready: false, badge: { main: badgeNode('0', false) }, drop: -1, dropScroll: 0, body: { main: bodyNode() } });
        const bodyPath = `${colsPath}.${name}.body.main`;
        for (const [property, source] of Object.entries(PASSED)) {
            const alias = `${bodyPath}.${property}`;
            if (store.link(alias, `${basePath}.${source}`, { allowMissing: true })) aliases.push(alias);
        }
        store.set(`${ordersPath}.${name}`, []);
        const orderAlias = `${bodyPath}.order`;
        if (store.link(orderAlias, `${ordersPath}.${name}`, { allowMissing: true })) aliases.push(orderAlias);
        store.set(`${colsPath}.${name}.ready`, true);
    };

    const setIfChanged = (path: string, value: unknown): void => {
        if (store.get<unknown>(path) !== value) store.set(path, value);
    };
    const showBadge = (base: string, label: string, over: boolean): void => {
        const badge = badgeNode(label, over);
        for (const property of ['_text', 'tone', 'variant']) setIfChanged(`${base}.badge.main.${property}`, badge[property]);
    };
    const writeOrder = (name: string, keys: readonly string[]): void => {
        const path = `${ordersPath}.${name}`;
        const current = store.get<unknown>(path);
        if (Array.isArray(current) && current.length === keys.length && keys.every((key, at) => current[at] === key)) return;
        //a replace announces the new order once; a set would announce every position
        store.replace(path, [...keys]);
    };

    const show = (): void => {
        if (!started) {
            started = true;
            store.set(colsPath, {});
            store.set(ordersPath, {});
        }
        const columns = readColumns();
        const current = new Set(columns.map((column) => column.key));
        const model = buildBoard(store.get<unknown>(recordsPath), {
            key: text('key', 'id'),
            columnField: text('columnField', 'column'),
            orderField: text('orderField', ''),
            columns: columns.map((column) => column.key)
        });
        columns.forEach((column, position) => {
            const name = nameOf(column.key);
            if (store.get<unknown>(`${colsPath}.${name}`) === undefined) addColumn(column, name);
            const keys = model.orders.get(column.key) ?? [];
            writeOrder(name, keys);
            const base = `${colsPath}.${name}`;
            setIfChanged(`${base}.title`, column.title);
            setIfChanged(`${base}.limit`, column.limit);
            setIfChanged(`${base}.count`, keys.length);
            const over = column.limit > 0 && keys.length > column.limit;
            setIfChanged(`${base}.over`, over);
            showBadge(base, column.limit > 0 ? `${keys.length} / ${column.limit}` : String(keys.length), over);
            setIfChanged(`${base}.position`, position);
            setIfChanged(`${base}.gone`, false);
        });
        for (const [key, name] of names) {
            if (current.has(key) || store.get<unknown>(`${colsPath}.${name}`) === undefined) continue;
            writeOrder(name, []);
            setIfChanged(`${colsPath}.${name}.count`, 0);
            setIfChanged(`${colsPath}.${name}.over`, false);
            showBadge(`${colsPath}.${name}`, '0', false);
            setIfChanged(`${colsPath}.${name}.gone`, true);
        }
        for (const value of [...reported]) if (!model.unmatched.includes(value)) reported.delete(value);
        for (const value of model.unmatched) {
            if (reported.has(value)) continue;
            reported.add(value);
            report.warning(`board: the records with ${text('columnField', 'column')} "${value}" are in no column, so they are not shown`, { code: 'SUI-RUN-BINDING', path: basePath });
        }
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

    const recordPaths = (): string[] => [
        recordsPath,
        `${recordsPath}.$every`,
        ...fieldNames.map((name) => `${recordsPath}.$every.${text(name, '')}`).filter((path) => !path.endsWith('.'))
    ];
    let watchedRecords = recordPaths();
    const onFields = (): void => {
        store.off(watchedRecords, schedule);
        watchedRecords = recordPaths();
        store.on(watchedRecords, schedule);
        schedule();
    };
    const fieldPaths = fieldNames.map((name) => `${basePath}.${name}`);
    const columnPaths = [columnsPath, `${columnsPath}.$all`];
    store.on(watchedRecords, schedule);
    store.on(fieldPaths, onFields);
    store.on(columnPaths, schedule);
    //---- moving cards, by pointer and by keyboard (the model is recorded in the README: "Decision: drag and drop")
    const orderField = (): string => text('orderField', '');
    const columnField = (): string => text('columnField', 'column');
    const part = (selector: string): HTMLElement | null => element.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
    let boardElement: HTMLElement | null = null;
    let observer: ResizeObserver | undefined;
    let cardPx = 0;
    let press: Press | undefined;
    let held: Held | undefined;

    const columnElement = (key: string): HTMLElement | undefined =>
        Array.from(element.shadowRoot?.querySelectorAll<HTMLElement>('.column') ?? []).find((candidate) => candidate.dataset['key'] === key);
    const bodyOf = (key: string): RecordViewElement | undefined => columnElement(key)?.querySelector<Element>('ui-record-list') as RecordViewElement | undefined;
    const ordersOf = (key: string): string[] => {
        const value = store.get<unknown>(`${ordersPath}.${nameOf(key)}`);
        return Array.isArray(value) ? (value as unknown[]).filter((item): item is string => typeof item === 'string') : [];
    };
    const titleOf = (key: string): string => {
        const value = store.get<unknown>(`${colsPath}.${nameOf(key)}.title`);
        return typeof value === 'string' && value !== '' ? value : key;
    };
    const sizes = (): ColumnSize[] => readColumns().map((column) => ({ key: column.key, size: ordersOf(column.key).length }));
    const labelOf = (recordKey: string, column: string): string => {
        const path = bodyOf(column)?.locate?.(recordKey);
        const value = path === undefined ? undefined : store.get<unknown>(`${path}.${text('labelField', 'title')}`);
        if (typeof value === 'string' && value !== '') return value;
        return typeof value === 'number' && Number.isFinite(value) ? String(value) : recordKey;
    };
    const isInside = (target: EventTarget | null): boolean => {
        let node: Node | null = target instanceof Node ? target : null;
        while (node !== null) {
            if (node === boardElement) return true;
            node = node.parentNode ?? (node as ShadowRoot).host ?? null;
        }
        return false;
    };

    /** The card an event passed through: its column, its key and its place, and whether a press on the spot may start a drag */
    const cardAt = (event: Event): { column: string; key: string; index: number; slot: HTMLElement; pressable: boolean } | undefined => {
        const root = element.shadowRoot;
        let slot: HTMLElement | undefined;
        let pressable = true;
        for (const node of event.composedPath()) {
            if (!(node instanceof HTMLElement)) continue;
            if (slot === undefined && node.classList.contains('slot') && node.dataset['slot'] !== undefined && node.getRootNode() !== root) {
                slot = node;
                continue;
            }
            if (slot === undefined) {
                if (INTERACTIVE.has(node.localName) || node.isContentEditable) pressable = false;
                continue;
            }
            if (node.classList.contains('column') && node.getRootNode() === root) {
                const column = node.dataset['key'] ?? '';
                const position = store.get<unknown>(`${colsPath}.${nameOf(column)}.body.main.slots.${slot.dataset['slot']}.slotIndex`);
                const key = typeof position === 'number' && position >= 0 ? bodyOf(column)?.keyAt?.(position) : undefined;
                return key === undefined || typeof position !== 'number' ? undefined : { column, key, index: position, slot, pressable };
            }
        }
        return undefined;
    };

    /** Shows the placeholder in one column (or none): written as state, so the view only draws it */
    const showDrop = (place: Place | undefined, scroll: number): void => {
        for (const [key, name] of names) {
            const on = place?.column === key;
            setIfChanged(`${colsPath}.${name}.drop`, on ? place.index : -1);
            setIfChanged(`${colsPath}.${name}.dropScroll`, on ? scroll : 0);
        }
    };
    const say = (kind: string, name: string, place: Place, count: number): void => {
        const templates = store.get<unknown>(`${basePath}._moveAnnouncements`);
        const template = isRecord(templates) ? templates[kind] : undefined;
        store.set(`${basePath}.announcement`, announce(template, { name, position: place.index + 1, count, column: titleOf(place.column) }));
    };
    const positionIn = (): ((key: string) => number) => {
        const records = store.get<unknown>(recordsPath);
        const field = text('key', 'id');
        const keys = Array.isArray(records)
            ? (records as unknown[]).map((record) => (isRecord(record) ? String(record[field]) : ''))
            : isRecord(records)
              ? Object.keys(records)
              : [];
        return (key) => keys.indexOf(key);
    };

    /** Writes the move through the record paths and raises `move`; `undefined` when nothing had to change, else the index the card has now */
    const commit = (from: string, key: string, place: Place): number | undefined => {
        const locate = bodyOf(from)?.locate;
        if (locate === undefined) return undefined;
        const field = orderField();
        const orderOf = (candidate: string): number | undefined => (field === '' ? undefined : toNumber(store.get<unknown>(`${locate(candidate)}.${field}`)));
        const plan = planMove({ key, from, to: place.column, index: place.index, targetKeys: ordersOf(place.column), orderOf, ordered: field !== '', positionOf: positionIn() });
        if (plan.writes.length === 0) return undefined;
        for (const write of plan.writes) {
            const path = locate(write.key);
            if (write.field === 'order') {
                store.set(`${path}.${field}`, write.value);
                continue;
            }
            store.set(`${path}.${columnField()}`, write.value);
        }
        element.dispatchEvent(new CustomEvent('move', { detail: { key, from, to: place.column, index: plan.index }, bubbles: true, composed: true }));
        return plan.index;
    };

    const finish = (): void => {
        if (held?.slot !== undefined) held.slot.style.opacity = '';
        boardElement?.removeAttribute('data-dragging');
        showDrop(undefined, 0);
        held = undefined;
        press = undefined;
    };
    /** Drops the held card at its place: writes, announces, and keeps the focus on the card */
    const drop = (): void => {
        const current = held;
        if (current === undefined) return;
        const place = current.place;
        finish();
        if (place === undefined) return;
        const index = commit(current.home, current.key, place);
        if (index === undefined) return;
        const count = ordersOf(place.column).filter((key) => key !== current.key).length + 1;
        say('dropped', current.name, { column: place.column, index }, count);
        if (current.by === 'keyboard') {
            requestAnimationFrame(() => {
                if (!disposed) bodyOf(place.column)?.focusKey?.(current.key);
            });
        }
    };
    const cancel = (announceIt: boolean): void => {
        const current = held;
        if (current === undefined) return;
        finish();
        if (announceIt) say('cancelled', current.name, { column: current.home, index: current.homeIndex }, ordersOf(current.home).length);
    };

    const moveDrag = (event: PointerEvent): void => {
        const current = held;
        if (current === undefined) return;
        const box = columnAt(event.clientX, current.boxes);
        if (box === undefined) return;
        const own = box.key === current.home;
        const place: Place = !own || orderField() !== '' ? { column: box.key, index: dropIndex(event.clientY, box, cardPx, own) } : { column: current.home, index: current.homeIndex };
        if (place.column === current.place?.column && place.index === current.place.index) return;
        current.place = place;
        //a board with no order field cannot put a card at a place inside its own column, so it shows no placeholder there
        showDrop(own && orderField() === '' ? undefined : place, box.scroll);
    };
    /** Starts the drag: the column boxes and the scroll of the bodies are read here, once, and never while the pointer moves */
    const startPointerDrag = (event: PointerEvent, from: Press): void => {
        const boxes: ColumnBox[] = [];
        for (const column of readColumns()) {
            const body = columnElement(column.key)?.querySelector<HTMLElement>('.body');
            if (body === undefined || body === null) continue;
            const box = body.getBoundingClientRect();
            const scroller = body.querySelector('ui-record-list')?.shadowRoot?.querySelector<HTMLElement>('.list');
            boxes.push({ key: column.key, left: box.left, right: box.right, top: box.top, scroll: scroller?.scrollTop ?? 0, size: ordersOf(column.key).length });
        }
        try {
            boardElement?.setPointerCapture(event.pointerId);
        } catch {
            //a pointer the browser does not know (a synthetic event) cannot be captured; the drag still follows the moves over the board
        }
        boardElement?.setAttribute('data-dragging', '');
        from.slot.style.opacity = '0.4';
        held = { by: 'pointer', key: from.key, home: from.column, homeIndex: from.index, name: labelOf(from.key, from.column), place: undefined, slot: from.slot, boxes, pointer: event.pointerId };
        moveDrag(event);
    };

    const onPointerDown = (event: PointerEvent): void => {
        if (held !== undefined || event.button !== 0) return;
        const card = cardAt(event);
        if (card?.pressable !== true) return;
        press = { pointer: event.pointerId, x: event.clientX, y: event.clientY, key: card.key, column: card.column, index: card.index, slot: card.slot };
    };
    const onPointerMove = (event: PointerEvent): void => {
        if (held?.by === 'pointer') {
            if (event.pointerId === held.pointer) moveDrag(event);
            return;
        }
        if (press === undefined || event.pointerId !== press.pointer || held !== undefined) return;
        if (passedThreshold(press.x, press.y, event.clientX, event.clientY)) startPointerDrag(event, press);
    };
    const onPointerUp = (event: PointerEvent): void => {
        if (held?.by === 'pointer' && event.pointerId === held.pointer) {
            if (boardElement?.hasPointerCapture(event.pointerId) === true) boardElement.releasePointerCapture(event.pointerId);
            drop();
        }
        press = undefined;
    };
    const onPointerCancel = (event: PointerEvent): void => {
        if (held?.by === 'pointer' && event.pointerId === held.pointer) cancel(false);
        press = undefined;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const consume = (): void => {
            event.preventDefault();
            event.stopPropagation();
        };
        const current = held;
        if (current !== undefined) {
            if (event.key === 'Escape') {
                consume();
                cancel(true);
            } else if (current.by === 'keyboard' && event.key === ' ') {
                consume();
                drop();
            } else if (current.by === 'keyboard' && MOVE_KEYS.includes(event.key)) {
                consume();
                const from = current.place ?? { column: current.home, index: current.homeIndex };
                const next = placeAfterKey(from, event.key, sizes(), current.home, { rtl: getComputedStyle(element).direction === 'rtl', reorder: orderField() !== '' });
                if (next === undefined) return;
                current.place = next;
                showDrop(next, 0);
                say('moved', current.name, next, ordersOf(next.column).filter((key) => key !== current.key).length + 1);
            }
            return;
        }
        if (event.key !== ' ') return;
        const card = cardAt(event);
        if (card === undefined || event.composedPath()[0] !== card.slot) return;
        consume();
        const place = { column: card.column, index: card.index };
        const name = labelOf(card.key, card.column);
        held = { by: 'keyboard', key: card.key, home: card.column, homeIndex: card.index, name, place, boxes: [] };
        showDrop(place, 0);
        say('pickedUp', name, place, ordersOf(card.column).length);
    };
    const onFocusOut = (event: FocusEvent): void => {
        if (held?.by === 'keyboard' && !isInside(event.relatedTarget)) cancel(true);
    };

    const startMoving = (attempts: number): void => {
        if (disposed) return;
        const board = part('.board');
        const probe = part('.probe');
        if (!board || !probe) {
            if (attempts > 0) queueMicrotask(() => startMoving(attempts - 1));
            return;
        }
        boardElement = board;
        observer = new ResizeObserver((entries) => {
            for (const entry of entries) if (!isUnrendered(entry)) cardPx = entry.contentRect.height;
        });
        observer.observe(probe);
        board.addEventListener('pointerdown', onPointerDown);
        board.addEventListener('pointermove', onPointerMove);
        board.addEventListener('pointerup', onPointerUp);
        board.addEventListener('pointercancel', onPointerCancel);
        board.addEventListener('keydown', onKeyDown, true);
        board.addEventListener('focusout', onFocusOut);
    };
    queueMicrotask(() => startMoving(8));

    show();

    return {
        dispose: () => {
            disposed = true;
            observer?.disconnect();
            if (boardElement !== null) {
                boardElement.removeEventListener('pointerdown', onPointerDown);
                boardElement.removeEventListener('pointermove', onPointerMove);
                boardElement.removeEventListener('pointerup', onPointerUp);
                boardElement.removeEventListener('pointercancel', onPointerCancel);
                boardElement.removeEventListener('keydown', onKeyDown, true);
                boardElement.removeEventListener('focusout', onFocusOut);
            }
            store.off(watchedRecords, schedule);
            store.off(fieldPaths, onFields);
            store.off(columnPaths, schedule);
            for (const alias of aliases) store.unlink(alias);
            aliases.length = 0;
        }
    };
}
