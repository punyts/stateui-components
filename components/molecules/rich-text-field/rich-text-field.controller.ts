import type { ControllerContext } from '@punyts/stateui';
import { QUERY_DELAY_MS, filterComboOptions, readComboOptions } from '../shared/field/combo.js';
import { createField } from '../shared/field/field.js';
import { createPopover } from '../shared/popover/popover.js';
import type { PopoverHandle } from '../shared/popover/popover.js';
import { IMAGE_FILE_TYPES, MAX_FILE_SIZE, isFileRef, mediaTypeOf, percentOf, storedFileUrl } from '../shared/field/files.js';
import { BLOCK_TYPES, IMAGE_WIDTHS, MARKS, MAX_IMAGES, compareBlocks, isThreadId, newBlockKey, readRichText, textLength } from '../shared/richtext/model.js';
import type { Block, BlockType, ImageWidth, KeyedBlock, Mark } from '../shared/richtext/model.js';
import {
    PICKER_TRIGGERS,
    activeState,
    chainEdits,
    clampSelection,
    commentSelection,
    commentsAt,
    deleteBackward,
    deleteForward,
    imageCount,
    indent,
    insertBlocks,
    insertDivider,
    insertImage,
    insertLineBreak,
    insertMention,
    insertTable,
    insertText,
    linkAt,
    linkTarget,
    opensPicker,
    pickerQuery,
    removeBlock,
    removeComment,
    replaceBlockText,
    setBlockKind,
    setImage,
    setLink,
    splitBlock,
    tableCommand,
    toggleCheck,
    toggleMark,
    touchesList
} from '../shared/richtext/edit.js';
import type { BlockKind, Edit, EditSettings, PickerKind, Point, TableCommand, TextSelection } from '../shared/richtext/edit.js';
import { createEditorView } from '../shared/richtext/editorView.js';
import type { EditorView } from '../shared/richtext/editorView.js';
import { createHistory } from '../shared/richtext/history.js';
import { allowedShapes, htmlToShapes, textToShapes } from '../shared/richtext/paste.js';
import type { EditKind, HistoryStep } from '../shared/richtext/history.js';
import type { DeleteUnit } from '../shared/richtext/runs.js';

interface CommandHost {
    commands?: Record<string, () => void>;
}

type Changes = Pick<Edit, 'blocks' | 'written' | 'removed' | 'selection'>;

const DELETES: Readonly<Record<string, { direction: 'backward' | 'forward'; unit: DeleteUnit }>> = {
    deleteContentBackward: { direction: 'backward', unit: 'character' },
    deleteWordBackward: { direction: 'backward', unit: 'word' },
    deleteSoftLineBackward: { direction: 'backward', unit: 'line' },
    deleteHardLineBackward: { direction: 'backward', unit: 'line' },
    deleteContentForward: { direction: 'forward', unit: 'character' },
    deleteWordForward: { direction: 'forward', unit: 'word' },
    deleteSoftLineForward: { direction: 'forward', unit: 'line' },
    deleteHardLineForward: { direction: 'forward', unit: 'line' }
};

/** Input types whose reach the browser knows better than a count of characters: their target range is used */
const RANGED = new Set(['deleteWordBackward', 'deleteWordForward', 'deleteSoftLineBackward', 'deleteSoftLineForward', 'deleteHardLineBackward', 'deleteHardLineForward', 'insertReplacementText', 'insertFromDrop']);

const FORMATS: Readonly<Record<string, Mark>> = { formatBold: 'bold', formatItalic: 'italic', formatStrikeThrough: 'strike' };

const BLOCK_COMMANDS: Readonly<Record<string, BlockKind>> = {
    heading1: { type: 'heading', level: 1 },
    heading2: { type: 'heading', level: 2 },
    heading3: { type: 'heading', level: 3 },
    bullet: { type: 'bullet' },
    numbered: { type: 'numbered' },
    check: { type: 'check' },
    quote: { type: 'quote' },
    codeBlock: { type: 'code' }
};

/** The slash menu's commands in order; each is offered when the field allows its block type */
const SLASH_COMMANDS: ReadonlyArray<{ name: string; type: BlockType }> = [
    { name: 'heading1', type: 'heading' },
    { name: 'heading2', type: 'heading' },
    { name: 'heading3', type: 'heading' },
    { name: 'bullet', type: 'bullet' },
    { name: 'numbered', type: 'numbered' },
    { name: 'check', type: 'check' },
    { name: 'quote', type: 'quote' },
    { name: 'codeBlock', type: 'code' },
    { name: 'divider', type: 'divider' },
    { name: 'table', type: 'table' },
    { name: 'image', type: 'image' }
];

const TABLE_COMMANDS: ReadonlySet<string> = new Set(['addRow', 'addColumn', 'removeRow', 'removeColumn', 'removeTable']);

/** The most options the picker shows */
const MAX_PICKER_ITEMS = 8;

interface PickerItem {
    id: string;
    label: string;
}

/** The open picker: its kind, the trigger's point, the query typed after it and the options it shows */
interface Picker {
    kind: PickerKind;
    from: Point;
    query: string;
    items: PickerItem[];
    active: number;
}

/** The CSS anchor name of the block the link panel and the picker open under (`.block.anchored` in the view's CSS) */
const LINK_ANCHOR = '--richtext-link';
const samePoint = (a: TextSelection | null, b: TextSelection | null): boolean => JSON.stringify(a) === JSON.stringify(b);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const stored = (block: KeyedBlock): Block => {
    const { key: _key, ...rest } = block;
    return rest;
};

const FILE_TRANSFER_EVENT = 'ui-file-transfer';
/** The most images that upload at once, and how long a refused or failed upload's notice shows */
const MAX_IMAGE_UPLOADS = 5;
const NOTICE_MS = 4000;

interface ImageUpload {
    name: string;
    loaded: number;
    total: number;
    abort: AbortController;
}

/**
 * The files a paste or drop brings that the field uploads as images: only when it brings no text or HTML, so a copy
 * from a document (which carries a picture of itself beside its text) pastes its text
 */
const imageFilesOf = (data: DataTransfer | null): File[] => {
    if (data === null || data.files.length === 0) return [];
    const types = [...data.types];
    return types.includes('text/plain') || types.includes('text/html') ? [] : [...data.files];
};

/** The longest comment or reply, and the most replies a thread and threads a field keep */
const MAX_COMMENT_TEXT = 2000;
const MAX_REPLIES = 100;
const MAX_THREADS = 500;

interface Author {
    id: string;
    label: string;
}

interface Entry {
    key: string;
    author: Author;
    text: string;
    at: string;
}

interface Thread extends Entry {
    resolved: boolean;
    /** In time order */
    replies: Entry[];
}

const readAuthor = (value: unknown): Author | null =>
    isRecord(value) && typeof value['id'] === 'string' && value['id'] !== '' && typeof value['label'] === 'string' ? { id: value['id'], label: value['label'] } : null;

const readEntry = (key: string, value: unknown): Entry | null => {
    if (!isRecord(value)) return null;
    const author = readAuthor(value['author']);
    if (author === null || typeof value['text'] !== 'string') return null;
    return { key, author, text: value['text'], at: typeof value['at'] === 'string' ? value['at'] : '' };
};

/** The threads of a stored map, by id; ids that are not thread ids and entries without an author and text are left out */
function readThreads(value: unknown): Map<string, Thread> {
    const threads = new Map<string, Thread>();
    if (!isRecord(value)) return threads;
    for (const [id, stored] of Object.entries(value)) {
        const entry = isThreadId(id) ? readEntry(id, stored) : null;
        if (entry === null || !isRecord(stored)) continue;
        const replies = isRecord(stored['replies'])
            ? Object.entries(stored['replies'])
                  .map(([key, reply]) => readEntry(key, reply))
                  .filter((reply): reply is Entry => reply !== null)
                  .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
            : [];
        threads.set(id, { ...entry, resolved: stored['resolved'] === true, replies });
    }
    return threads;
}

/** A new thread or reply id: the prefix and eight base-62 characters */
const newId = (prefix: string): string => prefix + newBlockKey().slice(1);

/**
 * The rich-text field: a `contenteditable` editor over a block value (docs/design/stateui-text-editor.md) on the field
 * contract (`createField`), so a form finds, validates and resets it. Every `beforeinput` is cancelled and turned into an
 * edit of the blocks (`src/shared/richtext/edit.ts`); the edit writes only the blocks it changed, at
 * `value.blocks.<key>`, and redraws them (`editorView.ts`). An input method's composition is left to the browser and its
 * block read back at `compositionend`. Selection, the toolbar's state (`active`, `canUndo`, `canRedo`) and `empty` are
 * runtime properties; the undo history (`history.ts`) is kept here and never written. A value with no blocks shows one
 * empty paragraph that is written with the first edit.
 *
 * A paste or drop brings HTML or Markdown in as blocks (`paste.ts`), keeping only what the field allows. Links are added
 * and changed in a panel that opens under the selection's block (Ctrl+K or the toolbar), whose address must pass
 * `safeHref`.
 *
 * Comments (with `commentAuthor` set): the `comment` tool or Ctrl+Alt+M on a selection opens the comment panel under its
 * block; saving writes the thread into `comments` (a keyed map the app links to its data) and puts the thread's id on
 * the text's runs as one undo step. Text under an open thread is `span.commented`; pressing it, or the tool with the
 * caret in it, opens the panel on its threads to reply, resolve, reopen or delete. Each write raises `comment` with
 * `{ thread, kind }`, never the text.
 *
 * Keys: Ctrl+B, Ctrl+I, Ctrl+E (code) and Ctrl+Shift+X (strike) toggle marks; Ctrl+K opens the link panel (Enter applies,
 * Escape returns to the text); Ctrl+Alt+M opens the comment panel (Ctrl+Enter in a box saves or replies); Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y undo and redo; Tab and Shift+Tab indent and outdent list
 * items (elsewhere Tab moves focus). Markdown shortcuts are in `edit.ts`. The field never logs its text
 */
export default function controller(context: ControllerContext) {
    const { element, store, basePath } = context;
    const host = element as Element & CommandHost;
    const valuePath = `${basePath}.value`;
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const isLocked = (): boolean => read('disabled') === true || read('readonly') === true || read('locked') === true;

    const settings = (): EditSettings => {
        const listed = read('blocks');
        const allowed: BlockType[] = Array.isArray(listed) && listed.length > 0 ? BLOCK_TYPES.filter((type) => listed.includes(type)) : [...BLOCK_TYPES];
        const max = read('maxLength');
        return { allowed, maxLength: typeof max === 'number' && max > 0 ? Math.floor(max) : 0 };
    };

    const entryRule = (): string => {
        const length = textLength(readRichText(store.get<unknown>(valuePath)));
        if (length === 0) return read('required') === true ? 'required' : '';
        const min = read('minLength');
        const max = read('maxLength');
        if (typeof min === 'number' && min > 0 && length < min) return 'minLength';
        if (typeof max === 'number' && max > 0 && length > max) return 'maxLength';
        return '';
    };
    const field = createField(context, 'value', { entryRule, exclusive: true, empty: () => ({ blocks: {} }), deep: true });

    const history = createHistory();
    const phantom = newBlockKey();
    let blocks: KeyedBlock[] = [];
    let selection: TextSelection | null = null;
    let pending: { marks: Mark[]; at: TextSelection } | null = null;
    let composing: Point | null = null;
    let focused = false;
    let disposed = false;
    let view: EditorView | null = null;
    let editor: HTMLElement | null = null;
    let linkPanel: PopoverHandle | null = null;
    let linkInput: HTMLInputElement | null = null;
    /** The text the open link panel links: the selection, or the whole link the caret was in */
    let linkRange: TextSelection | null = null;
    let anchored: HTMLElement | undefined;
    let picker: Picker | null = null;
    let pickerPanel: PopoverHandle | null = null;
    let pickerList: HTMLElement | null = null;
    let queryTimer: ReturnType<typeof setTimeout> | undefined;

    const put = (name: string, value: unknown): void => {
        if (JSON.stringify(read(name)) !== JSON.stringify(value)) store.set(`${basePath}.${name}`, value as never);
    };
    const tool = (name: string): string => {
        const tools = read('_tools');
        const label = isRecord(tools) ? tools[name] : undefined;
        return typeof label === 'string' ? label : '';
    };

    /** The value's blocks, or one empty paragraph (not yet written) when it has none */
    const readBlocks = (): KeyedBlock[] => {
        const found = readRichText(store.get<unknown>(valuePath));
        return found.length > 0 ? found : [{ key: phantom, order: 'V', type: 'paragraph', runs: [] }];
    };

    const updateActive = (): void => {
        if (selection === null) {
            put('active', '');
            return;
        }
        const state = activeState(blocks, selection, pending !== null && samePoint(pending.at, selection) ? pending.marks : null);
        const words: string[] = [...state.marks];
        const kind = state.kind;
        if (kind !== null) words.push(kind.type === 'heading' ? `heading${kind.level ?? 1}` : kind.type === 'code' ? 'code-block' : kind.type);
        put('active', words.join(' '));
    };

    const publish = (): void => {
        const first = blocks[0];
        put('empty', blocks.length === 1 && first !== undefined && first.type === 'paragraph' && first.runs.length === 0);
        put('canUndo', history.canUndo());
        put('canRedo', history.canRedo());
        updateActive();
    };

    const showSelection = (): void => {
        if (view !== null && selection !== null && focused) view.select(selection);
    };

    /** The value changed in the store: an edit of this field (already drawn), another writer, a reset */
    const sync = (): void => {
        if (disposed || view === null || composing !== null) return;
        blocks = readBlocks();
        view.render(blocks);
        reanchor();
        if (selection !== null) {
            const kept = clampSelection(blocks, selection);
            if (!samePoint(kept, selection) || view.readSelection() === null || !samePoint(view.readSelection(), kept)) {
                selection = kept;
                showSelection();
            }
        }
        publish();
    };
    let scheduled = false;
    const scheduleSync = (): void => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            sync();
        });
    };

    /** Writes the changed blocks: each at its path, or the whole value when it has no block map yet */
    const write = (changes: Changes): void => {
        const value = store.get<unknown>(valuePath);
        const map = isRecord(value) && isRecord(value['blocks']) ? value['blocks'] : null;
        if (map === null) {
            const all: Record<string, Block> = {};
            for (const block of changes.blocks) all[block.key] = stored(block);
            store.set(valuePath, { blocks: all } as never);
            return;
        }
        for (const [key, block] of changes.written) store.set(`${valuePath}.blocks.${key}`, stored(block) as never);
        for (const key of changes.removed) if (Object.hasOwn(map, key)) store.delete(`${valuePath}.blocks.${key}`);
    };

    /** Marks the block a panel opens under (the link panel or the picker), so its CSS anchor name moves to it */
    const anchorTo = (key: string | null): void => {
        const next = key === null ? undefined : view?.elementOf(key);
        if (next === anchored) return;
        anchored?.classList.remove('anchored');
        anchored = next;
        anchored?.classList.add('anchored');
    };

    /** A redrawn block is a new element: the open panel's anchor moves to it */
    const reanchor = (): void => {
        if (anchored === undefined || anchored.isConnected) return;
        const key = anchored.dataset['key'] ?? null;
        anchored = undefined;
        anchorTo(key);
    };

    const text = (name: string): string => {
        const value = read(name);
        return typeof value === 'string' ? value : '';
    };

    const pickerItems = (kind: PickerKind, query: string): PickerItem[] => {
        if (kind === 'slash') {
            const allowed = settings().allowed;
            const wanted = query.toLowerCase();
            return SLASH_COMMANDS.filter((one) => allowed.includes(one.type))
                .map((one) => ({ id: one.name, label: tool(one.name) || one.name }))
                .filter((item) => wanted === '' || item.label.toLowerCase().includes(wanted) || item.id.toLowerCase().startsWith(wanted));
        }
        const options = readComboOptions(read('mentions'), text('mentionValue') || 'value', text('mentionLabel') || 'label');
        const locale = store.get<unknown>('$.locale');
        return filterComboOptions(options, query, typeof locale === 'string' ? locale : '', MAX_PICKER_ITEMS).shown.map((option) => ({ id: option.key, label: option.label }));
    };

    /** Draws the picker's options (built with `createElement`, labels as text) and shows it when it has any */
    const drawPicker = (): void => {
        if (pickerList === null || pickerPanel === null) return;
        const open = picker;
        const options = (open?.items ?? []).map((item, index) => {
            const option = document.createElement('div');
            option.className = 'option';
            option.id = `pick-${index}`;
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', index === open?.active ? 'true' : 'false');
            option.dataset['index'] = String(index);
            option.textContent = item.label;
            return option;
        });
        pickerList.replaceChildren(...options);
        if (open !== null && options.length > 0) {
            anchorTo(open.from.block);
            put('picker', open.kind);
            pickerPanel.open();
            editor?.setAttribute('aria-controls', 'picker');
            editor?.setAttribute('aria-activedescendant', `pick-${open.active}`);
            options[open.active]?.scrollIntoView({ block: 'nearest' });
            return;
        }
        put('picker', '');
        pickerPanel.close();
        editor?.removeAttribute('aria-activedescendant');
        editor?.removeAttribute('aria-controls');
        if (read('link') === '' && read('comment') === '' && imageKey === null) anchorTo(null);
    };

    const closePicker = (): void => {
        if (picker === null) return;
        picker = null;
        clearTimeout(queryTimer);
        drawPicker();
    };

    /** Raises `mentionQuery` with the typed query once typing pauses, so an app can load the records it names */
    const askMentions = (query: string): void => {
        clearTimeout(queryTimer);
        queryTimer = setTimeout(() => {
            if (!disposed) element.dispatchEvent(new CustomEvent('mentionQuery', { detail: query, bubbles: true, composed: true }));
        }, QUERY_DELAY_MS);
    };

    /** Follows the caret after an edit or a move: the picker's query is the text since its trigger, and it closes when the caret leaves it */
    const followPicker = (): void => {
        if (picker === null) return;
        const query = selection === null ? null : pickerQuery(blocks, picker.from, selection, picker.kind);
        if (query === null) {
            closePicker();
            return;
        }
        const changed = query !== picker.query;
        picker.query = query;
        picker.items = pickerItems(picker.kind, query);
        if (changed) picker.active = 0;
        picker.active = Math.min(picker.active, Math.max(0, picker.items.length - 1));
        //a slash query nothing matches closes the menu; a mention query may still be answered by the app
        if (picker.kind === 'slash' && picker.items.length === 0) {
            closePicker();
            return;
        }
        if (picker.kind === 'mention' && changed) askMentions(query);
        drawPicker();
    };

    const openPicker = (kind: PickerKind, from: Point): void => {
        picker = { kind, from, query: '', items: pickerItems(kind, ''), active: 0 };
        if (kind === 'mention') askMentions('');
        drawPicker();
    };

    /** Takes the trigger and query out and runs the chosen option: a block command, or a mention put in */
    const pick = (index: number): void => {
        const open = picker;
        const item = open?.items[index];
        closePicker();
        if (open === null || item === undefined || selection === null || isLocked()) return;
        const removed = deleteBackward(blocks, { anchor: open.from, focus: selection.focus }, 'character');
        if (removed === null) return;
        const current = settings();
        let next: Edit | null;
        if (open.kind === 'mention') next = insertMention(removed.blocks, removed.selection, item.id, item.label, current);
        else if (item.id === 'divider') next = insertDivider(removed.blocks, removed.selection, current);
        else if (item.id === 'table') next = insertTable(removed.blocks, removed.selection, current);
        else if (item.id === 'image') {
            apply(removed);
            chooseImages();
            return;
        } else {
            const kind = BLOCK_COMMANDS[item.id];
            next = kind === undefined ? null : setBlockKind(removed.blocks, removed.selection, kind, current);
        }
        apply(chainEdits(removed, next));
    };

    const commit = (changes: Changes, stale?: ReadonlySet<string>): void => {
        blocks = changes.blocks;
        selection = changes.selection;
        view?.render(blocks, stale);
        reanchor();
        write(changes);
        showSelection();
        publish();
        followPicker();
        followImage();
    };

    const apply = (edit: Edit | null, kind: EditKind = 'other'): boolean => {
        if (edit === null) return false;
        if (edit.written.size === 0 && edit.removed.size === 0) {
            //a move only (into a table's cell): no history, nothing written
            selection = edit.selection;
            showSelection();
            put('selection', selection);
            updateActive();
            followPicker();
            followImage();
            return true;
        }
        history.record(blocks, edit, selection ?? edit.selection, kind, Date.now());
        commit(edit);
        pending = edit.marks !== undefined ? { marks: edit.marks, at: edit.selection } : null;
        updateActive();
        return true;
    };

    const applyStep = (step: HistoryStep | null): void => {
        if (step === null) return;
        const next = blocks.filter((block) => !step.removed.has(block.key) && !step.written.has(block.key));
        next.push(...step.written.values());
        next.sort(compareBlocks);
        pending = null;
        commit({ blocks: next, written: step.written, removed: step.removed, selection: clampSelection(next, step.selection) });
    };
    const undo = (): void => applyStep(history.undo(blocks));
    const redo = (): void => applyStep(history.redo(blocks));

    /**
     * A paste or drop: HTML (parsed by `DOMParser` into an inert document) when the data has it, else plain text, which
     * is read as Markdown when it looks like it. Types the field leaves out become paragraphs. In a code block the plain
     * text goes in as it is
     */
    const paste = (at: TextSelection, data: DataTransfer | null, fallback: string): void => {
        const text = (data?.getData('text/plain') || fallback).replace(/\r\n?/gu, '\n');
        const current = settings();
        if (blocks.find((block) => block.key === at.focus.block)?.type === 'code') {
            apply(insertText(blocks, at, text, current));
            return;
        }
        const html = data?.getData('text/html') ?? '';
        const fromHtml = html !== '' ? htmlToShapes(new DOMParser().parseFromString(html, 'text/html')) : [];
        const shapes = fromHtml.length > 0 ? fromHtml : textToShapes(text);
        apply(insertBlocks(blocks, at, allowedShapes(shapes, current.allowed), current));
    };

    const pendingMarks = (): Mark[] | undefined => (pending !== null && selection !== null && samePoint(pending.at, selection) ? pending.marks : undefined);

    const mark = (name: Mark): void => {
        if (selection === null || isLocked()) return;
        if (apply(toggleMark(blocks, selection, name))) return;
        //a caret: the mark goes on what is typed next, until the caret moves
        const base = pendingMarks() ?? activeState(blocks, selection, null).marks;
        const marks = base.includes(name) ? base.filter((known) => known !== name) : MARKS.filter((known) => known === name || base.includes(known));
        pending = { marks, at: selection };
        updateActive();
    };

    const currentSelection = (): TextSelection | null => {
        const fromPage = focused ? view?.readSelection() ?? null : null;
        const chosen = fromPage ?? selection;
        return chosen === null ? null : clampSelection(blocks, chosen);
    };

    const command = (name: string): void => {
        if (isLocked() || view === null) return;
        //a key pressed right after the selection moved comes before the page's selectionchange
        const now = currentSelection();
        if (now !== null && !samePoint(now, selection)) {
            selection = now;
            if (pending !== null && !samePoint(pending.at, now)) pending = null;
        }
        const first = blocks[0];
        if (selection === null && first !== undefined) selection = { anchor: { block: first.key, offset: 0 }, focus: { block: first.key, offset: 0 } };
        if (selection === null) return;
        if (name === 'link') {
            openLink();
            return;
        }
        if (name === 'image') {
            chooseImages();
            return;
        }
        const current = settings();
        if (name === 'undo') undo();
        else if (name === 'redo') redo();
        else if (name === 'bold' || name === 'italic' || name === 'strike' || name === 'code') mark(name);
        else if (name === 'divider') apply(insertDivider(blocks, selection, current));
        else if (name === 'table') apply(insertTable(blocks, selection, current));
        else if (TABLE_COMMANDS.has(name)) apply(tableCommand(blocks, selection, name as TableCommand));
        else if (name === 'indent' || name === 'outdent') apply(indent(blocks, selection, name === 'indent' ? 1 : -1));
        else {
            const kind = BLOCK_COMMANDS[name];
            if (kind !== undefined) apply(setBlockKind(blocks, selection, kind, current));
        }
        if (!focused) editor?.focus();
        showSelection();
    };

    /** Reads a block back from the page after the browser wrote into it (an input method, an input that could not be cancelled) */
    const readBack = (point: Point | null): void => {
        if (view === null || point === null) return;
        const key = point.block;
        const text = view.textOf(key, point.cell);
        const result = text === null ? null : replaceBlockText(blocks, key, text, point.cell);
        if (result === null) {
            view.render(blocks, new Set([key]));
            showSelection();
            return;
        }
        history.record(blocks, result.edit, selection ?? result.edit.selection, 'typing', Date.now());
        commit(result.edit, new Set([key]));
    };

    /** Closes the link panel; with `refocus`, the editor takes the focus back with the selection it had */
    const closeLink = (refocus: boolean): void => {
        linkPanel?.close();
        anchorTo(null);
        linkRange = null;
        put('link', '');
        put('linkInvalid', false);
        if (refocus && editor !== null) {
            editor.focus();
            showSelection();
        }
    };

    /** Opens the link panel under the selection's block, filled with the link already there */
    const openLink = (): void => {
        if (selection === null || view === null || linkPanel === null || linkInput === null) return;
        const block = blocks.find((candidate) => candidate.key === selection?.focus.block);
        if (block === undefined || block.type === 'code' || block.type === 'divider' || block.type === 'image' || (block.type === 'table' && selection.focus.cell === undefined)) return;
        closePicker();
        const found = linkAt(blocks, selection);
        linkRange = found?.selection ?? selection;
        anchorTo(block.key);
        linkInput.value = found?.href ?? '';
        put('link', found !== null ? 'edit' : 'new');
        put('linkInvalid', false);
        linkPanel.open();
        linkInput.focus();
        linkInput.select();
    };

    const finishLink = (href: string | null): void => {
        const range = linkRange;
        closeLink(true);
        if (range !== null && !isLocked()) apply(setLink(blocks, clampSelection(blocks, range), href, settings()));
    };

    const applyLink = (): void => {
        const typed = linkInput?.value.trim() ?? '';
        if (typed === '') {
            finishLink(null);
            return;
        }
        const href = linkTarget(typed);
        if (href === undefined) {
            put('linkInvalid', true);
            return;
        }
        finishLink(href);
    };

    /** The image panel and the image it edits (null when closed) */
    let imagePanel: PopoverHandle | null = null;
    let imageBox: HTMLElement | null = null;
    let imageKey: string | null = null;
    let fileInput: HTMLInputElement | null = null;
    /** The block the file chooser's images go after: the caret's block when the chooser opened */
    let chooserAfter: string | null = null;
    const uploads = new Map<string, ImageUpload>();
    let uploadCounter = 0;
    let notice = '';
    let noticeTimer: ReturnType<typeof setTimeout> | undefined;

    const imageInput = (name: 'alt' | 'caption'): HTMLInputElement | null => imageBox?.querySelector<HTMLInputElement>(`input[data-image="${name}"]`) ?? null;
    const lastKey = (): string | null => blocks[blocks.length - 1]?.key ?? null;
    const takesImages = (): boolean => !isLocked() && settings().allowed.includes('image');

    /** Shows the uploads under way (name and progress), else the last notice */
    const drawUploads = (): void => {
        if (uploads.size > 0) {
            const files = [...uploads.values()].map((upload) => `${upload.name} ${percentOf(upload.loaded, upload.total)}%`).join(', ');
            put('upload', (tool('uploading') || '{files}').replace('{files}', files));
            put('uploadFailed', false);
            return;
        }
        put('upload', notice);
        put('uploadFailed', notice !== '');
    };

    /** A refused or failed upload: the notice names the file, never its content, and clears after a few seconds */
    const notify = (template: string, name: string): void => {
        notice = (tool(template) || '{name}').replace('{name}', name);
        clearTimeout(noticeTimer);
        noticeTimer = setTimeout(() => {
            notice = '';
            if (!disposed) drawUploads();
        }, NOTICE_MS);
        drawUploads();
    };

    /** Raises `ui-file-transfer`; the promise rejects when nothing answers (the host has no hook) */
    const handFile = (file: File, upload: ImageUpload): Promise<unknown> =>
        new Promise((resolve, reject) => {
            let answered = false;
            const detail = {
                file,
                signal: upload.abort.signal,
                onProgress: (progress: { loaded: number; total: number }): void => {
                    upload.loaded = progress.loaded;
                    upload.total = progress.total;
                    drawUploads();
                },
                respond: (result: Promise<unknown>): void => {
                    answered = true;
                    result.then(resolve, reject);
                }
            };
            element.dispatchEvent(new CustomEvent(FILE_TRANSFER_EVENT, { detail, bubbles: true, composed: true }));
            if (!answered) reject(new Error('offline'));
        });

    /** Uploads one image; when it ends the image goes in after `place.after`, which then moves to it so a batch keeps its order */
    const startUpload = (file: File, type: string, place: { after: string | null }): void => {
        const key = `u${uploadCounter}`;
        uploadCounter += 1;
        const upload: ImageUpload = { name: file.name, loaded: 0, total: file.size, abort: new AbortController() };
        uploads.set(key, upload);
        drawUploads();
        //a file the browser gave no type is sent with the type of its extension, because the host refuses a file with none
        const sent = file.type === '' ? new File([file], file.name, { type }) : file;
        handFile(sent, upload).then(
            (result) => {
                if (!uploads.delete(key) || disposed) return;
                const edit = isLocked() || !isFileRef(result) ? null : insertImage(blocks, place.after, result, settings());
                if (edit === null) {
                    notify(isFileRef(result) && !isLocked() ? 'imageLimit' : 'uploadFailed', file.name);
                    return;
                }
                const image = [...edit.written.values()].find((block) => block.type === 'image' && block.file?.id === result.id);
                apply(edit);
                if (image !== undefined) place.after = image.key;
                drawUploads();
            },
            () => {
                if (!uploads.delete(key) || disposed) return;
                notify('uploadFailed', file.name);
            }
        );
    };

    /** Uploads image files to go in after the block `after`; a file of another type, too large or past the limits is refused */
    const uploadImages = (files: readonly File[], after: string | null): void => {
        if (!takesImages()) return;
        const place = { after };
        for (const file of files) {
            const type = mediaTypeOf(file);
            if (!IMAGE_FILE_TYPES.includes(type) || file.size > MAX_FILE_SIZE) notify('imageRefused', file.name);
            else if (uploads.size >= MAX_IMAGE_UPLOADS || imageCount(blocks) + uploads.size >= MAX_IMAGES) notify('imageLimit', file.name);
            else startUpload(file, type, place);
        }
    };

    /** Opens the file chooser; its images go after the caret's block */
    const chooseImages = (): void => {
        if (!takesImages() || fileInput === null) return;
        chooserAfter = selection?.focus.block ?? lastKey();
        fileInput.click();
    };

    /** Closes the image panel; with `refocus`, the editor takes the focus back with the image selected */
    const closeImage = (refocus: boolean): void => {
        if (imageKey === null) return;
        imageKey = null;
        imagePanel?.close();
        put('image', '');
        if (read('link') === '' && read('comment') === '' && picker === null) anchorTo(null);
        if (refocus && editor !== null) {
            editor.focus();
            showSelection();
        }
    };

    /** Opens the image panel under an image, filled with its alt text, caption and width (a box being typed in keeps its text) */
    const openImage = (block: KeyedBlock): void => {
        if (imagePanel === null) return;
        closePicker();
        imageKey = block.key;
        anchorTo(block.key);
        const active = element.shadowRoot?.activeElement ?? null;
        for (const name of ['alt', 'caption'] as const) {
            const input = imageInput(name);
            if (input !== null && input !== active) input.value = block[name] ?? '';
        }
        put('imageWidth', block.width ?? 'full');
        put('image', 'open');
        imagePanel.open();
    };

    /** A caret on an image (and nothing else) opens its panel; any other selection closes it */
    const followImage = (): void => {
        const collapsedOn = selection !== null && samePoint({ anchor: selection.anchor, focus: selection.anchor }, selection) ? selection.focus.block : null;
        const block = collapsedOn === null || isLocked() ? undefined : blocks.find((candidate) => candidate.key === collapsedOn);
        if (block?.type === 'image') {
            if (imageKey !== block.key) movedOffImage = false;
            openImage(block);
        } else closeImage(false);
    };

    /** Moves the caret off a selected image to the start or end of its neighbour */
    const leaveImage = (key: string, forward: boolean): void => {
        const index = blocks.findIndex((block) => block.key === key);
        const target = blocks[index + (forward ? 1 : -1)];
        if (target === undefined) return;
        const point = { block: target.key, offset: forward ? 0 : Number.MAX_SAFE_INTEGER };
        selection = clampSelection(blocks, { anchor: point, focus: point });
        showSelection();
        put('selection', selection);
        updateActive();
        followImage();
    };

    /**
     * The keys on a selected image, where the page holds no range and the browser raises no input: Backspace and Delete
     * remove it, Enter puts a paragraph after it, the arrows leave it, and a typed character starts a paragraph after it
     */
    const imageKeys = (event: KeyboardEvent): boolean => {
        const at = selection;
        if (at === null || isLocked()) return false;
        const key = at.focus.block;
        if (event.key === 'Backspace' || event.key === 'Delete') apply(deleteBackward(blocks, at, 'character'));
        else if (event.key === 'Enter') apply(splitBlock(blocks, at, settings()));
        else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') leaveImage(key, false);
        else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') leaveImage(key, true);
        else if (event.key.length === 1) apply(insertText(blocks, at, event.key, settings()), 'typing');
        else return false;
        event.preventDefault();
        return true;
    };

    const changeImage = (change: { alt?: string; caption?: string; width?: ImageWidth }): void => {
        if (imageKey === null || isLocked()) return;
        apply(setImage(blocks, imageKey, change));
    };

    /** Whether the user pressed the editor, or a key the selected image does not take, since an image was selected */
    let movedOffImage = true;
    const holdsImage = (): boolean => imageKey !== null && selection !== null && selection.focus.block === imageKey && selection.anchor.block === imageKey;

    const onSelectionChange = (): void => {
        if (!focused || composing !== null || view === null) return;
        //the page holds no range on a selected image; a caret the browser puts back on its own is not a move
        if (holdsImage() && !movedOffImage) return;
        const next = view.readSelection();
        if (next === null || samePoint(next, selection)) return;
        selection = next;
        history.seal();
        if (pending !== null && !samePoint(pending.at, next)) pending = null;
        put('selection', next);
        updateActive();
        followPicker();
        followImage();
    };
    const document = element.ownerDocument;
    document.addEventListener('selectionchange', onSelectionChange);

    /** The comment panel: the threads it shows, the text a new comment anchors to (null when none is being added), and the active thread */
    let commentPanel: PopoverHandle | null = null;
    let commentBox: HTMLElement | null = null;
    let commentIds: string[] = [];
    let commentRange: TextSelection | null = null;
    let activeThread = '';

    const author = (): Author | null => readAuthor(read('commentAuthor'));
    const threads = (): Map<string, Thread> => readThreads(read('comments'));
    const openThreads = (): ReadonlySet<string> => {
        if (author() === null) return new Set();
        return new Set([...threads()].filter(([, thread]) => !thread.resolved).map(([id]) => id));
    };
    const commentsPath = (...parts: string[]): string => [`${basePath}.comments`, ...parts].join('.');

    /** Raises `comment`, so an app can notify people; never with the text */
    const raiseComment = (thread: string, kind: 'add' | 'reply' | 'resolve' | 'reopen' | 'delete', reply?: string): void => {
        const detail = reply === undefined ? { thread, kind } : { thread, kind, reply };
        element.dispatchEvent(new CustomEvent('comment', { detail, bubbles: true, composed: true }));
    };

    const when = (at: string): string => {
        const time = new Date(at);
        if (Number.isNaN(time.getTime())) return '';
        const locale = store.get<unknown>('$.locale');
        try {
            return new Intl.DateTimeFormat(typeof locale === 'string' && locale !== '' ? locale : undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(time);
        } catch {
            return time.toISOString();
        }
    };

    const button = (action: string, label: string, data: Record<string, string> = {}): HTMLButtonElement => {
        const made = document.createElement('button');
        made.type = 'button';
        made.className = 'commentButton';
        made.dataset['action'] = action;
        for (const [name, value] of Object.entries(data)) made.dataset[name] = value;
        made.textContent = label;
        return made;
    };

    const textBox = (name: string, label: string, thread?: string): HTMLTextAreaElement => {
        const box = document.createElement('textarea');
        box.className = 'commentText';
        box.dataset['box'] = name;
        if (thread !== undefined) box.dataset['thread'] = thread;
        box.rows = 2;
        box.maxLength = MAX_COMMENT_TEXT;
        box.placeholder = label;
        box.setAttribute('aria-label', label);
        return box;
    };

    /** One comment or reply: its author, time and text, and Delete when it is the author's own */
    const entryElement = (entry: Entry, me: Author, thread: string, reply: boolean): HTMLElement => {
        const made = document.createElement('div');
        made.className = reply ? 'entry reply' : 'entry';
        const head = document.createElement('div');
        head.className = 'entryHead';
        const name = document.createElement('span');
        name.className = 'author';
        name.textContent = entry.author.label;
        const time = document.createElement('time');
        time.className = 'at';
        if (entry.at !== '') time.dateTime = entry.at;
        time.textContent = when(entry.at);
        head.append(name, time);
        if (entry.author.id === me.id && read('disabled') !== true) head.appendChild(button('delete', tool('deleteComment'), reply ? { thread, reply: entry.key } : { thread }));
        const body = document.createElement('p');
        body.className = 'body';
        body.textContent = entry.text;
        made.append(head, body);
        return made;
    };

    /** Draws the panel (built with `createElement`, every text as text), keeping what was typed in its boxes */
    const drawComments = (): void => {
        if (commentBox === null) return;
        const me = author();
        const typed = new Map<string, string>();
        for (const box of commentBox.querySelectorAll<HTMLTextAreaElement>('textarea')) typed.set(`${box.dataset['box']}:${box.dataset['thread'] ?? ''}`, box.value);
        const parts: HTMLElement[] = [];
        if (me === null) {
            commentBox.replaceChildren();
            return;
        }
        const all = threads();
        const canWrite = read('disabled') !== true && read('locked') !== true;
        if (commentRange !== null) {
            const adding = document.createElement('div');
            adding.className = 'thread new';
            const actions = document.createElement('div');
            actions.className = 'actions';
            actions.append(button('add', tool('saveComment')), button('cancel', tool('cancelComment')));
            adding.append(textBox('new', tool('commentText')), actions);
            parts.push(adding);
        }
        const shown = commentIds.map((id) => [id, all.get(id)] as const).filter((pair): pair is readonly [string, Thread] => pair[1] !== undefined);
        for (const [id, thread] of shown.filter(([, one]) => !one.resolved)) {
            const article = document.createElement('article');
            article.className = id === activeThread ? 'thread active' : 'thread';
            article.dataset['thread'] = id;
            article.appendChild(entryElement(thread, me, id, false));
            for (const reply of thread.replies) article.appendChild(entryElement(reply, me, id, true));
            if (canWrite) {
                const actions = document.createElement('div');
                actions.className = 'actions';
                if (thread.replies.length < MAX_REPLIES) actions.appendChild(button('reply', tool('reply'), { thread: id }));
                actions.appendChild(button('resolve', tool('resolve'), { thread: id }));
                if (thread.replies.length < MAX_REPLIES) article.appendChild(textBox('reply', tool('replyText'), id));
                article.appendChild(actions);
            }
            parts.push(article);
        }
        const resolved = shown.filter(([, one]) => one.resolved);
        if (resolved.length > 0) {
            const heading = document.createElement('p');
            heading.className = 'resolvedHeading';
            heading.textContent = tool('resolved');
            parts.push(heading);
            for (const [id, thread] of resolved) {
                const article = document.createElement('article');
                article.className = 'thread resolved';
                article.dataset['thread'] = id;
                article.appendChild(entryElement(thread, me, id, false));
                if (canWrite) {
                    const actions = document.createElement('div');
                    actions.className = 'actions';
                    actions.appendChild(button('reopen', tool('reopen'), { thread: id }));
                    article.appendChild(actions);
                }
                parts.push(article);
            }
        }
        commentBox.replaceChildren(...parts);
        for (const box of commentBox.querySelectorAll<HTMLTextAreaElement>('textarea')) box.value = typed.get(`${box.dataset['box']}:${box.dataset['thread'] ?? ''}`) ?? '';
    };

    /** Redraws the blocks whose highlights changed */
    const redrawHighlights = (): void => {
        if (view === null) return;
        view.render(blocks);
        reanchor();
        showSelection();
    };

    /** Closes the comment panel; with `refocus`, the editor takes the focus back with the selection it had */
    const closeComments = (refocus: boolean): void => {
        const wasOpen = read('comment') !== '';
        commentPanel?.close();
        commentIds = [];
        commentRange = null;
        activeThread = '';
        put('comment', '');
        if (!wasOpen) return;
        anchorTo(null);
        redrawHighlights();
        if (refocus && editor !== null) {
            editor.focus();
            showSelection();
        }
    };

    /** Opens the comment panel under the selection's block on the threads `ids`, with a box for a new comment on `range` when it is given */
    const openComments = (ids: readonly string[], range: TextSelection | null): void => {
        if (commentPanel === null || commentBox === null || selection === null) return;
        closePicker();
        if (read('link') !== '') closeLink(false);
        const all = threads();
        commentIds = ids.filter((id) => all.has(id));
        commentRange = range;
        if (commentIds.length === 0 && range === null) {
            closeComments(false);
            return;
        }
        activeThread = commentIds.find((id) => all.get(id)?.resolved === false) ?? '';
        anchorTo(selection.focus.block);
        put('comment', range !== null ? 'new' : 'open');
        drawComments();
        redrawHighlights();
        commentPanel.open();
        commentBox.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    };

    /** The `comment` tool and Ctrl+Alt+M: a new comment on a selection, or the threads at the caret */
    const commentCommand = (): void => {
        if (view === null || author() === null || read('disabled') === true || read('locked') === true) return;
        const now = currentSelection();
        if (now !== null) selection = now;
        if (selection === null) return;
        const ids = commentsAt(blocks, selection);
        const ranged = !samePoint({ anchor: selection.anchor, focus: selection.anchor }, selection);
        if (ranged && !isLocked() && threads().size < MAX_THREADS) openComments(ids, selection);
        else openComments(ids, null);
    };

    const boxOf = (name: string, thread?: string): HTMLTextAreaElement | undefined =>
        Array.from(commentBox?.querySelectorAll<HTMLTextAreaElement>('textarea') ?? []).find((one) => one.dataset['box'] === name && (thread === undefined || one.dataset['thread'] === thread));
    const boxText = (name: string, thread?: string): string => (boxOf(name, thread)?.value ?? '').trim().slice(0, MAX_COMMENT_TEXT);

    /** Writes the thread, then puts its id on the text as one undo step */
    const addComment = (): void => {
        const me = author();
        const range = commentRange;
        const typed = boxText('new');
        if (me === null || range === null || typed === '' || isLocked() || threads().size >= MAX_THREADS) return;
        const id = newId('c');
        store.set(commentsPath(id), { author: me, text: typed, at: new Date().toISOString() } as never);
        closeComments(true);
        apply(commentSelection(blocks, clampSelection(blocks, range), id));
        raiseComment(id, 'add');
    };

    const replyTo = (id: string): void => {
        const me = author();
        const thread = threads().get(id);
        const typed = boxText('reply', id);
        if (me === null || thread === undefined || typed === '' || thread.replies.length >= MAX_REPLIES) return;
        const key = newId('r');
        //the box empties before the write redraws the panel, which keeps what boxes hold
        const box = boxOf('reply', id);
        if (box !== undefined) box.value = '';
        const reply = { author: me, text: typed, at: new Date().toISOString() };
        const stored = read('comments');
        const existing = isRecord(stored) && isRecord(stored[id]) ? stored[id]['replies'] : undefined;
        if (isRecord(existing)) store.set(commentsPath(id, 'replies', key), reply as never);
        else store.set(commentsPath(id, 'replies'), { [key]: reply } as never);
        raiseComment(id, 'reply');
    };

    const resolveThread = (id: string, resolved: boolean): void => {
        if (!threads().has(id)) return;
        if (resolved) store.set(commentsPath(id, 'resolved'), true as never);
        else store.delete(commentsPath(id, 'resolved'));
        raiseComment(id, resolved ? 'resolve' : 'reopen');
    };

    /** Deletes a thread (and takes its id off the text when the field may write) or one reply; only the author's own */
    const deleteEntry = (id: string, reply: string | undefined): void => {
        const me = author();
        const thread = threads().get(id);
        if (me === null || thread === undefined) return;
        if (reply !== undefined) {
            if (thread.replies.find((one) => one.key === reply)?.author.id !== me.id) return;
            store.delete(commentsPath(id, 'replies', reply));
            raiseComment(id, 'delete', reply);
            return;
        }
        if (thread.author.id !== me.id) return;
        commentIds = commentIds.filter((one) => one !== id);
        store.delete(commentsPath(id));
        if (!isLocked() && selection !== null) apply(removeComment(blocks, id, selection));
        raiseComment(id, 'delete');
    };

    /** The threads changed in the store: redraw the highlights, and the panel when it is open */
    const onComments = (): void => {
        if (disposed || view === null) return;
        redrawHighlights();
        if (read('comment') === '') return;
        const all = threads();
        commentIds = commentIds.filter((id) => all.has(id));
        if (commentIds.length === 0 && commentRange === null) {
            closeComments(true);
            return;
        }
        drawComments();
    };
    const commentPaths = [`${basePath}.comments`, `${basePath}.comments.$all`, `${basePath}.commentAuthor`, `${basePath}.commentAuthor.$all`];
    store.on(commentPaths, onComments);

    const valuePaths = [valuePath, `${valuePath}.$all`];
    store.on(valuePaths, scheduleSync);
    //the app answers `mentionQuery` by writing `mentions`
    const mentionPaths = [`${basePath}.mentions`, `${basePath}.mentions.$all`];
    const onMentions = (): void => {
        if (picker?.kind !== 'mention') return;
        picker.items = pickerItems('mention', picker.query);
        picker.active = Math.min(picker.active, Math.max(0, picker.items.length - 1));
        drawPicker();
    };
    store.on(mentionPaths, onMentions);

    const resetHistory = (): void => {
        history.clear();
        pending = null;
    };
    const fieldCommands = host.commands ?? {};
    host.commands = {
        ...fieldCommands,
        reset: () => {
            resetHistory();
            fieldCommands['reset']?.();
        },
        clear: () => {
            resetHistory();
            fieldCommands['clear']?.();
        }
    };

    //the view is drawn once the controller has returned, so the editor is found in a later microtask
    const start = (attempts: number): void => {
        if (disposed) return;
        const found = element.shadowRoot?.querySelector<HTMLElement>('#control') ?? null;
        if (found === null) {
            if (attempts > 0) queueMicrotask(() => start(attempts - 1));
            return;
        }
        editor = found;
        linkInput = element.shadowRoot?.querySelector<HTMLInputElement>('#linkInput') ?? null;
        const panel = element.shadowRoot?.querySelector<HTMLElement>('#linkPanel') ?? null;
        if (panel !== null) linkPanel = createPopover({ element: panel, placement: 'bottomStart', anchor: LINK_ANCHOR, onDismiss: (reason) => closeLink(reason === 'escape') });
        pickerList = element.shadowRoot?.querySelector<HTMLElement>('#picker') ?? null;
        if (pickerList !== null) pickerPanel = createPopover({ element: pickerList, placement: 'bottomStart', anchor: LINK_ANCHOR, onDismiss: () => closePicker() });
        commentBox = element.shadowRoot?.querySelector<HTMLElement>('#commentPanel') ?? null;
        if (commentBox !== null) commentPanel = createPopover({ element: commentBox, placement: 'bottomStart', anchor: LINK_ANCHOR, onDismiss: (reason) => closeComments(reason === 'escape') });
        imageBox = element.shadowRoot?.querySelector<HTMLElement>('#imagePanel') ?? null;
        if (imageBox !== null) imagePanel = createPopover({ element: imageBox, placement: 'bottomStart', anchor: LINK_ANCHOR, onDismiss: (reason) => closeImage(reason === 'escape') });
        fileInput = element.shadowRoot?.querySelector<HTMLInputElement>('#imageFile') ?? null;
        view = createEditorView(found, { checkLabel: () => tool('checkItem'), shownComments: openThreads, activeComment: () => activeThread, fileUrl: (id) => storedFileUrl(element, id) });
        sync();
    };
    queueMicrotask(() => start(8));

    return {
        ...field,
        allowed: (listed: unknown, type: string): boolean => !Array.isArray(listed) || listed.length === 0 || listed.includes(type),
        commenting: (who: unknown): boolean => readAuthor(who) !== null,
        pressed: (active: unknown, name: string): string => (typeof active === 'string' && active.split(' ').includes(name) ? 'true' : 'false'),
        uneditable: (disabled: unknown, readonly: unknown, locked: unknown): boolean => disabled === true || readonly === true || locked === true,
        onBeforeInput: (event: InputEvent) => {
            if (view === null) return;
            if (isLocked()) {
                event.preventDefault();
                return;
            }
            if (event.inputType === 'insertCompositionText' || composing !== null) return;
            const target = RANGED.has(event.inputType) ? event.getTargetRanges()[0] : undefined;
            const at = (target !== undefined ? view.selectionOfRange(target) : null) ?? currentSelection();
            event.preventDefault();
            if (at === null) return;
            selection = clampSelection(blocks, at);
            const current = settings();
            const type = event.inputType;
            const remove = DELETES[type];
            if (remove !== undefined) {
                const ranged = target !== undefined && !samePoint({ anchor: selection.anchor, focus: selection.anchor }, selection);
                const run = remove.direction === 'backward' || ranged ? deleteBackward : deleteForward;
                apply(run(blocks, selection, remove.unit));
                return;
            }
            const format = FORMATS[type];
            if (format !== undefined) {
                mark(format);
                return;
            }
            switch (type) {
                case 'insertText': {
                    const data = event.data ?? '';
                    const at = selection.focus;
                    const collapsedAt = samePoint({ anchor: selection.anchor, focus: selection.anchor }, selection);
                    const trigger = (['slash', 'mention'] as const).find((kind) => PICKER_TRIGGERS[kind] === data);
                    const opens = picker === null && trigger !== undefined && collapsedAt && opensPicker(blocks, at, trigger);
                    if (apply(insertText(blocks, selection, data, current, { marks: pendingMarks(), shortcuts: true }), 'typing') && opens && trigger !== undefined) openPicker(trigger, at);
                    return;
                }
                case 'insertReplacementText':
                    apply(insertText(blocks, selection, event.dataTransfer?.getData('text/plain') ?? event.data ?? '', current));
                    return;
                case 'insertParagraph':
                    apply(splitBlock(blocks, selection, current));
                    return;
                case 'insertLineBreak':
                    apply(insertLineBreak(blocks, selection, current));
                    return;
                case 'insertFromPaste':
                case 'insertFromDrop':
                case 'insertFromYank':
                    paste(selection, event.dataTransfer, event.data ?? '');
                    return;
                case 'deleteByCut':
                case 'deleteByDrag':
                case 'deleteContent':
                    if (!samePoint({ anchor: selection.anchor, focus: selection.anchor }, selection)) apply(deleteBackward(blocks, selection, 'character'));
                    return;
                case 'historyUndo':
                    undo();
                    return;
                case 'historyRedo':
                    redo();
                    return;
                default:
                    return;
            }
        },
        // The native input event is composed; the field raises its own `change`, so the native one stops here
        onInput: (event: InputEvent) => {
            event.stopPropagation();
            if (composing !== null || event.inputType === 'insertCompositionText' || event.isComposing) return;
            //an input the browser did not let the field cancel: its block is read back
            readBack(view?.readSelection()?.focus ?? selection?.focus ?? null);
        },
        onKeyDown: (event: KeyboardEvent) => {
            if (event.isComposing || composing !== null || view === null) return;
            const modifier = event.ctrlKey || event.metaKey;
            if (picker !== null && !modifier && !event.altKey) {
                const count = picker.items.length;
                if (event.key === 'Escape') {
                    event.preventDefault();
                    closePicker();
                    return;
                }
                if (count > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                    event.preventDefault();
                    picker.active = (picker.active + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
                    drawPicker();
                    return;
                }
                if (count > 0 && (event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
                    event.preventDefault();
                    pick(picker.active);
                    return;
                }
            }
            if (holdsImage() && !modifier && !event.altKey && imageKeys(event)) return;
            movedOffImage = true;
            const key = event.key.toLowerCase();
            if (modifier && event.altKey && !event.shiftKey && (key === 'm' || event.code === 'KeyM')) {
                event.preventDefault();
                commentCommand();
                return;
            }
            if (modifier && !event.altKey) {
                let handled = true;
                if (key === 'b' && !event.shiftKey) command('bold');
                else if (key === 'i' && !event.shiftKey) command('italic');
                else if (key === 'e' && !event.shiftKey) command('code');
                else if (key === 'x' && event.shiftKey) command('strike');
                else if (key === 'z') command(event.shiftKey ? 'redo' : 'undo');
                else if (key === 'y' && !event.shiftKey) command('redo');
                else if (key === 'k' && !event.shiftKey) command('link');
                else handled = false;
                if (handled) event.preventDefault();
                return;
            }
            if (event.key === 'Tab' && !modifier && !event.altKey) {
                const at = currentSelection();
                if (at === null || isLocked()) return;
                if (at.focus.cell !== undefined && at.anchor.cell !== undefined) {
                    event.preventDefault();
                    selection = at;
                    apply(tableCommand(blocks, at, event.shiftKey ? 'previous' : 'next'));
                    return;
                }
                if (!touchesList(blocks, at)) return;
                event.preventDefault();
                selection = at;
                apply(indent(blocks, at, event.shiftKey ? -1 : 1));
            }
        },
        onCompositionStart: () => {
            if (view === null || isLocked()) return;
            const at = currentSelection();
            if (at !== null && !samePoint({ anchor: at.anchor, focus: at.anchor }, at)) {
                selection = at;
                apply(deleteBackward(blocks, at, 'character'));
            }
            composing = (selection ?? at)?.focus ?? null;
        },
        onCompositionEnd: () => {
            const key = composing;
            composing = null;
            readBack(key);
            scheduleSync();
        },
        onEditorDown: (event: MouseEvent) => {
            movedOffImage = true;
            //a press on a check item's box must not move the caret, nor one on an image (the click selects it)
            if (event.target instanceof Element && event.target.closest('.marker, figure.image') !== null) event.preventDefault();
        },
        onEditorClick: (event: MouseEvent) => {
            const box = event.target instanceof Element ? event.target.closest('.marker') : null;
            const figure = event.target instanceof Element ? event.target.closest('figure.image') : null;
            if (figure !== null && view !== null) {
                //a press on an image selects it, which opens its panel
                const key = view.blockOf(figure);
                if (key === null || isLocked()) return;
                editor?.focus();
                selection = { anchor: { block: key, offset: 0 }, focus: { block: key, offset: 0 } };
                showSelection();
                put('selection', selection);
                updateActive();
                followImage();
                movedOffImage = false;
                return;
            }
            if (box === null && event.target instanceof Element && event.target.closest('.commented') !== null && view !== null && author() !== null) {
                //a press on commented text opens its threads (a drag that selected text does not)
                const at = currentSelection();
                if (at !== null && samePoint({ anchor: at.anchor, focus: at.anchor }, at)) {
                    selection = at;
                    openComments(commentsAt(blocks, at), null);
                }
                return;
            }
            if (box === null || view === null) return;
            event.preventDefault();
            const key = view.blockOf(box);
            if (key === null || isLocked()) return;
            const at = selection ?? { anchor: { block: key, offset: 0 }, focus: { block: key, offset: 0 } };
            apply(toggleCheck(blocks, key, at));
        },
        onFocus: () => {
            focused = true;
            queueMicrotask(onSelectionChange);
        },
        onBlur: () => {
            focused = false;
            history.seal();
            field.onBlur();
        },
        onToolbarDown: (event: MouseEvent) => {
            //the editor keeps its focus and selection while a tool is pressed
            if (event.target instanceof Element && event.target.closest('button') !== null) event.preventDefault();
        },
        onTool: (event: MouseEvent) => {
            const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-command]') : null;
            if (button === null || button.disabled) return;
            if (button.dataset['command'] === 'comment') commentCommand();
            else command(button.dataset['command'] ?? '');
        },
        onLinkKey: (event: KeyboardEvent) => {
            if (event.key === 'Enter' && event.target === linkInput) {
                event.preventDefault();
                applyLink();
            }
        },
        onPickerDown: (event: MouseEvent) => {
            //the editor keeps its focus and caret while an option is pressed
            event.preventDefault();
            const option = event.target instanceof Element ? event.target.closest<HTMLElement>('[role=option]') : null;
            const index = Number(option?.dataset['index']);
            if (option !== null && Number.isInteger(index)) pick(index);
        },
        onCommentClick: (event: MouseEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            const pressed = target?.closest<HTMLButtonElement>('button[data-action]') ?? null;
            if (pressed === null) {
                //a press on a thread makes it the active one
                const thread = target?.closest<HTMLElement>('article.thread[data-thread]')?.dataset['thread'];
                if (thread !== undefined && thread !== activeThread && threads().get(thread)?.resolved === false) {
                    activeThread = thread;
                    drawComments();
                    redrawHighlights();
                }
                return;
            }
            const thread = pressed.dataset['thread'] ?? '';
            const action = pressed.dataset['action'];
            if (action === 'add') addComment();
            else if (action === 'cancel') closeComments(true);
            else if (action === 'reply') replyTo(thread);
            else if (action === 'resolve') resolveThread(thread, true);
            else if (action === 'reopen') resolveThread(thread, false);
            else if (action === 'delete') deleteEntry(thread, pressed.dataset['reply']);
        },
        onCommentKey: (event: KeyboardEvent) => {
            const box = event.target instanceof HTMLTextAreaElement ? event.target : null;
            if (box === null || event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
            event.preventDefault();
            if (box.dataset['box'] === 'new') addComment();
            else if (box.dataset['thread'] !== undefined) replyTo(box.dataset['thread']);
        },
        onPaste: (event: ClipboardEvent) => {
            const files = imageFilesOf(event.clipboardData);
            if (files.length === 0 || view === null || !settings().allowed.includes('image')) return;
            event.preventDefault();
            uploadImages(files, currentSelection()?.focus.block ?? lastKey());
        },
        onDragOver: (event: DragEvent) => {
            if (event.dataTransfer?.types.includes('Files') === true && takesImages()) event.preventDefault();
        },
        onDrop: (event: DragEvent) => {
            const files = imageFilesOf(event.dataTransfer);
            if (files.length === 0 || view === null || !settings().allowed.includes('image')) return;
            event.preventDefault();
            const target = event.target instanceof Node ? view.blockOf(event.target) : null;
            uploadImages(files, target ?? currentSelection()?.focus.block ?? lastKey());
        },
        onImageFiles: () => {
            const files = fileInput?.files === null || fileInput?.files === undefined ? [] : [...fileInput.files];
            if (fileInput !== null) fileInput.value = '';
            uploadImages(files, chooserAfter);
        },
        onImageChange: (event: Event) => {
            const input = event.target instanceof HTMLInputElement ? event.target : null;
            const name = input?.dataset['image'];
            if (input !== null && (name === 'alt' || name === 'caption')) changeImage({ [name]: input.value });
        },
        onImageKey: (event: KeyboardEvent) => {
            const input = event.target instanceof HTMLInputElement ? event.target : null;
            const name = input?.dataset['image'];
            if (input === null || event.key !== 'Enter' || (name !== 'alt' && name !== 'caption')) return;
            event.preventDefault();
            changeImage({ [name]: input.value });
            closeImage(true);
        },
        onImageClick: (event: MouseEvent) => {
            const pressed = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
            if (pressed === null || imageKey === null) return;
            const width = pressed.dataset['width'];
            if (width !== undefined && (IMAGE_WIDTHS as readonly string[]).includes(width)) {
                changeImage({ width: width as ImageWidth });
                put('imageWidth', width);
                return;
            }
            if (pressed.dataset['action'] !== 'remove' || isLocked()) return;
            const key = imageKey;
            closeImage(true);
            apply(removeBlock(blocks, key));
        },
        onLinkInput: () => put('linkInvalid', false),
        onApplyLink: () => applyLink(),
        onRemoveLink: () => finishLink(null),
        dispose: () => {
            disposed = true;
            linkPanel?.dispose();
            linkPanel = null;
            clearTimeout(queryTimer);
            pickerPanel?.dispose();
            pickerPanel = null;
            commentPanel?.dispose();
            commentPanel = null;
            imagePanel?.dispose();
            imagePanel = null;
            clearTimeout(noticeTimer);
            for (const upload of uploads.values()) upload.abort.abort();
            uploads.clear();
            store.off(commentPaths, onComments);
            store.off(mentionPaths, onMentions);
            document.removeEventListener('selectionchange', onSelectionChange);
            store.off(valuePaths, scheduleSync);
            view = null;
            editor = null;
            field.dispose();
        }
    };
}
