import { report } from '@punyts/core';
import type { ControllerContext } from '@punyts/stateui';
import { resolveColor } from '../shared/drawing/paint.js';
import { createField, createWaiters } from '../shared/field/field.js';
import { isFileRef, MAX_FILE_SIZE, transferCode } from '../shared/field/files.js';
import type { FileRef } from '../shared/field/files.js';
import { createPainter } from '../shared/paint/draw.js';
import type { Painter } from '../shared/paint/draw.js';
import { clampBrushSize, clampDimension, clampSizes } from '../shared/paint/size.js';
import { isPaintTool, PAINT_TOOLS, strokeColor } from '../shared/paint/strokes.js';
import type { PaintTool } from '../shared/paint/strokes.js';

/** The width and height of a painting when the node gives none that can be used */
const DEFAULT_WIDTH = 480;
const DEFAULT_HEIGHT = 200;

/** The colours when `colors` gives none that can be used */
const DEFAULT_COLORS: readonly string[] = ['{color.text.base}'];

/** The icon of each tool's button */
const TOOL_ICONS: Readonly<Record<PaintTool, string>> = { brush: 'brush', eraser: 'eraser' };

/** The widest dot a size button shows, in pixels */
const MAX_DOT = 16;

/** The event that hands a file to the host's `transferFile` hook (the dispatcher of `@punyts/stateui-app` answers it) */
const FILE_TRANSFER_EVENT = 'ui-file-transfer';

/** The event that gives a stored file back through the host's `releaseFile` hook (G2.5; unanswered when there is none) */
const FILE_RELEASE_EVENT = 'ui-file-release';

/** How long painting must pause before the field saves, in milliseconds */
const SAVE_DELAY_MS = 1500;

/** The codes a failed save sets as the field's error; any other failure is `internal` */
const SAVE_CODES: readonly string[] = ['too_large', 'unsupported_type', 'quota', 'offline', 'internal'];

/** The name of the saved file when `_label` gives none */
const DEFAULT_NAME = 'painting.png';

/** Characters a file name cannot hold: control characters and the path and wildcard characters */
const NAME_UNSAFE = /[\u0000-\u001f\u007f/\\:*?"<>|]+/g;

/** One button of the toolbar as the view draws it; `pressed` is the `aria-pressed` text */
interface ToolButton {
    label: string;
    icon: string;
    pressed: 'true' | 'false';
}

interface ColorButton {
    label: string;
    css: string;
    pressed: 'true' | 'false';
}

interface SizeButton {
    label: string;
    dot: number;
    pressed: 'true' | 'false';
}

interface CommandHost {
    commands?: Record<string, () => void>;
}

/** The pointer a stroke follows: the one that pressed on the canvas, until it is lifted */
interface Gesture {
    pointerId: number;
    canvas: HTMLCanvasElement;
}

const fill = (template: unknown, value: string): string => (typeof template === 'string' ? template : '{value}').replace('{value}', value);

/**
 * A painting field on the field base (G2.7 of the graphics epic 2): a canvas of `width` by `height` pixels (each 1..4096,
 * scaled to its container by CSS, drawn at its own size) on which a person paints with a pointer, using the painting
 * engine of `src/shared/paint/` (`createPainter`). The toolbar has a button per entry of `tools` (`brush`, `eraser`), of
 * `colors` (literals or tokens, the first is the default) and of `sizes`, each with `aria-pressed` for the current
 * `tool`, `color` and `brushSize`, which are writable: a write from outside moves the choice, a press writes it. The
 * buttons and the commands `undo`, `redo` and `clear` work the stroke log; `clear` also empties `value`.
 *
 * Pixels never enter the store: the field writes only its runtime properties (the button rows, `dirty`, `error`, ...)
 * and `value`, the reference `{ id, name, size, type }` of the saved PNG, or an empty object. `dirty` is `true` while
 * the painting has changed since it was last saved (with no file in `value`: while it is not blank). A disabled,
 * readonly or locked field draws nothing and its buttons are disabled; the canvas takes no keyboard input. `required`
 * fails while `value` holds no file reference. A change of `value` raises `changed` with it (beside the field base's
 * `change`, which a form listens for). A change of `width` or `height` starts a new, empty painting at the new size.
 *
 * Saving (G2.8): when painting pauses for `SAVE_DELAY_MS` (after a stroke, an undo or a redo) or focus leaves the field,
 * and the field is `dirty`, the canvas is encoded as a PNG (`toBlob('image/png')`, over the `background` colour when
 * there is one, else transparent) and handed to the host as a `File` named `<_label>.png` (`painting.png` without a
 * label) with the bubbling, composed `ui-file-transfer` event, which the dispatcher answers with `hooks.transferFile`.
 * The next stroke aborts a pending save through its `AbortSignal`; the next pause starts it again. On success `value`
 * becomes the returned reference, `dirty` goes `false`, `changed` is raised, and the file it replaced is given back
 * with the bubbling, composed `ui-file-release` event (`hooks.releaseFile`; an event nobody answers leaves the file to
 * the host's sweep). A PNG over 10 MiB fails as `too_large` before it is sent; a rejection sets the error to its code
 * (`too_large`, `unsupported_type`, `quota`, `offline`, else `internal`), and so does a host with no hook
 * (`offline`). A failed save keeps the strokes and `dirty`, and the field does not try again until the painting
 * changes. `clear` empties `value` and gives back the file it held; a reset aborts the save, restores the baseline
 * value and gives back every file the field saved that the restored value does not reference; dispose aborts the save,
 * and no late result reaches the store. Only files this field saved are given back: a file the value held when the
 * field mounted (the document's) may come back with a reset, so it is left to the host's sweep.
 *
 * In a form (G2.9): the field's `settle` (the form's submit asks it) saves a dirty painting at once instead of after the
 * pause, and returns a promise that resolves when the save (or a stroke under way) ends; the form then validates, so a
 * failed save is the field's error and refuses the submit, and a finished one submits the new reference
 */
export default function controller(context: ControllerContext) {
    const { element, store, basePath } = context;
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const valuePath = `${basePath}.value`;
    const dirtyPath = `${basePath}.dirty`;
    let painter: Painter | undefined;
    let surface: HTMLCanvasElement | undefined;
    let gesture: Gesture | undefined;
    let disposed = false;

    const blocked = (): boolean => read('disabled') === true || read('readonly') === true || read('locked') === true;
    const size = (): { width: number; height: number } => ({ width: clampDimension(read('width'), DEFAULT_WIDTH), height: clampDimension(read('height'), DEFAULT_HEIGHT) });

    /** The usable tools of `tools`, in order, repeats left out; none usable gives both */
    const tools = (): PaintTool[] => {
        const list = read('tools');
        const found: PaintTool[] = [];
        if (Array.isArray(list)) for (const entry of list) if (isPaintTool(entry) && !found.includes(entry)) found.push(entry);
        return found.length > 0 ? found : [...PAINT_TOOLS];
    };
    /** The usable colours of `colors` (a literal or a token), repeats left out */
    const colors = (): string[] => {
        const list = read('colors');
        const found: string[] = [];
        if (Array.isArray(list)) {
            for (const entry of list) {
                if (typeof entry !== 'string' || found.includes(entry)) continue;
                if (resolveColor(entry).kind === 'color') found.push(entry);
            }
        }
        return found.length > 0 ? found : [...DEFAULT_COLORS];
    };
    const sizes = (): number[] => clampSizes(read('sizes'));
    const currentTool = (): PaintTool => {
        const list = tools();
        const tool = read('tool');
        return isPaintTool(tool) && list.includes(tool) ? tool : (list[0] as PaintTool);
    };
    const currentColor = (): string => {
        const color = read('color');
        return typeof color === 'string' && color !== '' && resolveColor(color).kind === 'color' ? color : (colors()[0] as string);
    };
    const currentSize = (): number => {
        const value = read('brushSize');
        return (typeof value === 'number' && value > 0 ? clampBrushSize(value) : undefined) ?? (sizes()[0] as number);
    };

    const reported = new Set<string>();
    /** Reports each entry of `tools` the field cannot use once, as a `SUI-STATE` warning; the entry is left out */
    const reportTools = (): void => {
        const list = read('tools');
        const outside = new Set(Array.isArray(list) ? list.filter((entry) => !isPaintTool(entry)).map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry))) : []);
        for (const entry of [...reported]) if (!outside.has(entry)) reported.delete(entry);
        for (const entry of outside) {
            if (reported.has(entry)) continue;
            reported.add(entry);
            report.warning(`paintField: the tool "${entry}" is not a painting tool, so it is left out`, { code: 'SUI-STATE', path: basePath });
        }
    };

    /** Writes the button rows the view draws */
    const drawToolbar = (): void => {
        const labels = read('_tools');
        const tool = currentTool();
        const toolButtons: Record<string, ToolButton> = {};
        for (const name of tools()) {
            const label = typeof labels === 'object' && labels !== null && typeof (labels as Record<string, unknown>)[name] === 'string' ? ((labels as Record<string, unknown>)[name] as string) : name;
            toolButtons[name] = { label, icon: TOOL_ICONS[name], pressed: name === tool ? 'true' : 'false' };
        }
        const color = currentColor();
        const colorButtons: Record<string, ColorButton> = {};
        colors().forEach((entry, index) => {
            const resolved = resolveColor(entry);
            colorButtons[`c${index}`] = { label: fill(read('_color'), entry), css: resolved.kind === 'color' ? resolved.css : 'transparent', pressed: entry === color ? 'true' : 'false' };
        });
        const brush = currentSize();
        const sizeButtons: Record<string, SizeButton> = {};
        sizes().forEach((entry, index) => {
            sizeButtons[`s${index}`] = { label: fill(read('_size'), String(entry)), dot: Math.min(entry, MAX_DOT), pressed: entry === brush ? 'true' : 'false' };
        });
        store.set(`${basePath}.toolButtons`, toolButtons as never);
        store.set(`${basePath}.colorButtons`, colorButtons as never);
        store.set(`${basePath}.sizeButtons`, sizeButtons as never);
        reportTools();
    };

    /** Counts the changes of the painting (strokes, undo, redo, clear, a new painting); `saved` is the count `value` shows */
    let revision = 0;
    let saved = 0;
    /** The pause before the next save */
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** The save under way: aborting it stops the encoding and the transfer */
    let saving: AbortController | undefined;
    /** The code of the last failed save, or an empty string; the field does not try again until the painting changes */
    let failure = '';
    /** The ids of the files this field saved and has not given back */
    const owned = new Set<string>();
    /** The promises of `settle` (a form's submit): woken whenever a save or a stroke ends, so the form asks again */
    const waiters = createWaiters();

    /** Whether the painting changed since it was last saved: with no file in `value`, whether it is not blank */
    const isDirty = (): boolean => {
        if (painter === undefined) return false;
        return isFileRef(store.get<unknown>(valuePath)) ? revision !== saved : !painter.blank;
    };
    /** Writes `dirty` from `isDirty` */
    const syncDirty = (): void => {
        const dirty = isDirty();
        if (store.get<unknown>(dirtyPath) !== dirty) store.set(dirtyPath, dirty);
    };

    /** Stops the pause timer and aborts the save under way */
    const cancelSave = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        saving?.abort();
        saving = undefined;
        waiters.wake();
    };

    /**
     * Gives a stored file back with `ui-file-release`, one task later, so the write of the value that let go of it
     * reaches the host first. A failed or unanswered release leaves the file to the host's sweep
     */
    const release = (id: string): void => {
        owned.delete(id);
        setTimeout(() => {
            const detail = {
                id,
                respond: (result: Promise<void>): void => {
                    result.catch(() => undefined);
                }
            };
            element.dispatchEvent(new CustomEvent(FILE_RELEASE_EVENT, { detail, bubbles: true, composed: true }));
        }, 0);
    };
    /** The id of the file `value` holds, or undefined. An id, not the object: the store writes an object value into the one it holds, key by key */
    const heldId = (): string | undefined => {
        const value = store.get<unknown>(valuePath);
        return isFileRef(value) ? value.id : undefined;
    };
    /** Gives back every file this field saved except the one `value` holds now */
    const releaseUnheld = (): void => {
        const kept = heldId();
        for (const id of [...owned]) if (id !== kept) release(id);
    };

    const field = createField(context, 'value', {
        entryRule: () => {
            if (failure !== '') return failure;
            return read('required') === true && !isFileRef(store.get<unknown>(valuePath)) ? 'required' : '';
        },
        exclusive: true,
        empty: () => ({}),
        //a form's submit: save a dirty painting now, and wait while a save or a stroke is under way. A failed save stays
        //failed (its code is the error the form's validation finds) until the painting changes
        settle: () => {
            if (disposed) return undefined;
            save();
            return saving !== undefined || gesture !== undefined ? waiters.wait() : undefined;
        },
        //a reset (the command, or a form's) aborts the save and starts a new painting: the strokes and their undo go. Once
        //the baseline value is back, the files the field saved that it does not hold are given back
        onReset: () => {
            gesture = undefined;
            cancelSave();
            failure = '';
            painter?.reset();
            revision += 1;
            saved = revision;
            queueMicrotask(() => {
                if (!disposed) releaseUnheld();
            });
        }
    });

    /** Finds the canvas, sizes its bitmap and makes the painter for it; a new size makes a new, empty painting */
    const ensurePainter = (): Painter | undefined => {
        if (disposed) return undefined;
        surface ??= element.shadowRoot?.querySelector<HTMLCanvasElement>('canvas.canvas') ?? undefined;
        if (surface === undefined) return undefined;
        const { width, height } = size();
        if (painter !== undefined && painter.width === width && painter.height === height && surface.width === width && surface.height === height) return painter;
        painter?.dispose();
        painter = undefined;
        gesture = undefined;
        //a new painting: a save of the old one stops, and the value stands for the new, blank painting
        cancelSave();
        revision += 1;
        saved = revision;
        surface.width = width;
        surface.height = height;
        const canvas = surface;
        const context2d = canvas.getContext('2d');
        if (context2d === null) return undefined;
        const view = canvas.ownerDocument.defaultView;
        painter = createPainter({
            context: context2d,
            width,
            height,
            read: (name) => view?.getComputedStyle(canvas).getPropertyValue(name)
        });
        return painter;
    };

    /** The point of a pointer event in canvas pixels: the canvas is drawn at `width` by `height` and scaled by CSS */
    const pointOf = (canvas: HTMLCanvasElement, event: PointerEvent): { x: number; y: number } => {
        const box = canvas.getBoundingClientRect();
        const scaleX = box.width > 0 ? canvas.width / box.width : 1;
        const scaleY = box.height > 0 ? canvas.height / box.height : 1;
        return { x: (event.clientX - box.left) * scaleX, y: (event.clientY - box.top) * scaleY };
    };

    /** The name of the saved file: `<_label>.png`, or `painting.png` when the label gives no usable name */
    const fileName = (): string => {
        const label = read('_label');
        const base = typeof label === 'string' ? label.replace(NAME_UNSAFE, ' ').trim().slice(0, 100).trim() : '';
        return base === '' ? DEFAULT_NAME : `${base}.png`;
    };

    /** Encodes the painting as a PNG: the visible canvas drawn over the `background` colour (none: transparent) */
    const encode = (canvas: HTMLCanvasElement): Promise<Blob> =>
        new Promise((resolve, reject) => {
            const flat = canvas.ownerDocument.createElement('canvas');
            flat.width = canvas.width;
            flat.height = canvas.height;
            const context2d = flat.getContext('2d');
            if (context2d === null) {
                reject({ code: 'internal' });
                return;
            }
            const view = canvas.ownerDocument.defaultView;
            const background = strokeColor(read('background'), (name) => view?.getComputedStyle(canvas).getPropertyValue(name));
            if (background !== undefined) {
                context2d.fillStyle = background;
                context2d.fillRect(0, 0, flat.width, flat.height);
            }
            context2d.drawImage(canvas, 0, 0);
            flat.toBlob((blob) => (blob === null ? reject({ code: 'internal' }) : resolve(blob)), 'image/png');
        });

    /** Raises `ui-file-transfer`; the promise rejects with `offline` when nothing answers (the host has no hook) */
    const hand = (file: File, signal: AbortSignal): Promise<unknown> =>
        new Promise((resolve, reject) => {
            let answered = false;
            const detail = {
                file,
                signal,
                respond: (result: Promise<unknown>): void => {
                    answered = true;
                    result.then(resolve, reject);
                }
            };
            element.dispatchEvent(new CustomEvent(FILE_TRANSFER_EVENT, { detail, bubbles: true, composed: true }));
            if (!answered) reject({ code: 'offline' });
        });

    /** A save failed: the error shows its code, the strokes and `dirty` stay */
    const fail = (code: string): void => {
        failure = SAVE_CODES.includes(code) ? code : 'internal';
        field.validate();
        syncDirty();
    };

    /** Saves the painting when it is dirty and no stroke, save or earlier failure is in the way */
    const save = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        const canvas = surface;
        if (disposed || failure !== '' || gesture !== undefined || saving !== undefined || canvas === undefined || !isDirty()) return;
        const at = revision;
        const abort = new AbortController();
        saving = abort;
        const name = fileName();
        encode(canvas)
            .then((blob) => {
                if (abort.signal.aborted) return undefined;
                if (blob.size > MAX_FILE_SIZE) throw { code: 'too_large' };
                return hand(new File([blob], name, { type: 'image/png' }), abort.signal);
            })
            .then(
                (result) => {
                    if (saving === abort) saving = undefined;
                    if (abort.signal.aborted || disposed) {
                        //a file that arrived after its save was stopped is held by nothing: give it back
                        if (!disposed && isFileRef(result)) release(result.id);
                        return;
                    }
                    if (!isFileRef(result)) {
                        fail('internal');
                        waiters.wake();
                        return;
                    }
                    const previous = heldId();
                    const reference: FileRef = { id: result.id, name: result.name, size: result.size, type: result.type };
                    owned.add(reference.id);
                    saved = at;
                    failure = '';
                    store.set(valuePath, reference as never);
                    syncDirty();
                    if (read('error') !== '') field.validate();
                    if (previous !== undefined && previous !== reference.id && owned.has(previous)) release(previous);
                    waiters.wake();
                },
                (error: unknown) => {
                    if (saving === abort) saving = undefined;
                    if (abort.signal.aborted || disposed) return;
                    fail(transferCode(error));
                    waiters.wake();
                }
            );
    };

    /** Starts the pause after which the field saves */
    const schedule = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        timer = disposed ? undefined : setTimeout(save, SAVE_DELAY_MS);
    };

    /** The painting changed: a save under way is stale, an earlier failure may be tried again, and the pause starts */
    const changed = (): void => {
        revision += 1;
        failure = '';
        cancelSave();
        syncDirty();
        schedule();
    };

    const finish = (): void => {
        if (gesture === undefined) return;
        const { canvas, pointerId } = gesture;
        gesture = undefined;
        const stroke = painter?.end();
        if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
        if (stroke !== undefined) changed();
        else syncDirty();
        waiters.wake();
    };

    const undo = (): void => {
        gesture = undefined;
        if (ensurePainter()?.undo()) changed();
        waiters.wake();
    };
    const redo = (): void => {
        gesture = undefined;
        if (ensurePainter()?.redo()) changed();
        waiters.wake();
    };
    /** Wipes the painting (one undoable entry), empties `value` through the field base and gives back the file it held */
    const clear = (): void => {
        gesture = undefined;
        const previous = heldId();
        cancelSave();
        if (ensurePainter()?.clear()) revision += 1;
        failure = '';
        baseClear?.();
        syncDirty();
        if (previous !== undefined && owned.has(previous)) release(previous);
    };

    /** Focus left the field (not only moved inside it): save now */
    const onFocusOut = (event: Event): void => {
        const next = (event as FocusEvent).relatedTarget;
        if (next instanceof Node && (next === element || element.contains(next) || element.shadowRoot?.contains(next) === true)) return;
        save();
    };
    element.addEventListener('focusout', onFocusOut);

    //the command object belongs to the field base: `clear` is wrapped so it wipes the painting too, `undo` and `redo` are added
    const host = element as Element & CommandHost;
    const baseClear = host.commands?.clear;
    if (host.commands) {
        host.commands.clear = clear;
        host.commands.undo = undo;
        host.commands.redo = redo;
    }

    /**
     * After every write of `value` (the field base sets `dirty` from the value there) and of `dirty` from outside (a form's
     * rebase), `dirty` goes back to what the canvas holds. A new value raises `changed` once, after the microtask: the
     * store writes an object key by key, so a value written whole passes through partial ones first
     */
    let announced = JSON.stringify(store.get<unknown>(valuePath) ?? {});
    let announcing = false;
    const announce = (): void => {
        announcing = false;
        if (disposed) return;
        const value = store.get<unknown>(valuePath);
        const text = JSON.stringify(value ?? {});
        if (text === announced) return;
        announced = text;
        element.dispatchEvent(new CustomEvent('changed', { detail: { value: isFileRef(value) ? { id: value.id, name: value.name, size: value.size, type: value.type } : {} }, bubbles: true, composed: true }));
    };
    const onValue = (): void => {
        syncDirty();
        if (announcing) return;
        announcing = true;
        queueMicrotask(announce);
    };
    const onResize = (): void => {
        if (ensurePainter() !== undefined) syncDirty();
    };

    const toolbarPaths = ['tools', 'colors', 'sizes', 'tool', 'color', 'brushSize', '_tools', '_color', '_size'].flatMap((name) => [`${basePath}.${name}`, `${basePath}.${name}.$all`]);
    const sizePaths = [`${basePath}.width`, `${basePath}.height`];
    store.on(toolbarPaths, drawToolbar);
    store.on([valuePath, `${valuePath}.$all`, dirtyPath], onValue);
    store.on(sizePaths, onResize);
    drawToolbar();

    //the view is stamped after the controller runs: find the canvas once it is there
    const start = (attempts: number): void => {
        if (disposed) return;
        if (ensurePainter() === undefined && attempts > 0) queueMicrotask(() => start(attempts - 1));
        else syncDirty();
    };
    queueMicrotask(() => start(8));

    const fromKey = (event: Event): string | undefined => (event.currentTarget as HTMLElement | null)?.dataset.key;

    return {
        ...field,
        /** The CSS colour behind the painting: `background` (a literal or a token), or the field's surface token when it has none */
        backgroundOf: (background: unknown): string => {
            const resolved = typeof background === 'string' ? resolveColor(background) : undefined;
            return resolved?.kind === 'color' ? resolved.css : 'var(--ui-paintfield-surface)';
        },
        onTool: (event: Event) => {
            const key = fromKey(event);
            if (blocked() || key === undefined || !isPaintTool(key)) return;
            store.set(`${basePath}.tool`, key);
        },
        onColor: (event: Event) => {
            const key = fromKey(event);
            const color = key === undefined ? undefined : colors()[Number(key.slice(1))];
            if (blocked() || color === undefined) return;
            store.set(`${basePath}.color`, color);
        },
        onSize: (event: Event) => {
            const key = fromKey(event);
            const brush = key === undefined ? undefined : sizes()[Number(key.slice(1))];
            if (blocked() || brush === undefined) return;
            store.set(`${basePath}.brushSize`, brush);
        },
        onUndo: () => {
            if (!blocked()) undo();
        },
        onRedo: () => {
            if (!blocked()) redo();
        },
        onClear: () => {
            if (!blocked()) clear();
        },
        onPointerDown: (event: PointerEvent) => {
            const canvas = event.currentTarget as HTMLCanvasElement | null;
            if (canvas === null || blocked() || !event.isPrimary || event.button !== 0) return;
            const engine = ensurePainter();
            if (engine === undefined) return;
            finish();
            if (!engine.begin({ tool: currentTool(), color: currentColor(), size: currentSize() }, pointOf(canvas, event))) return;
            //a new stroke stops a pending save; the pause after it starts the save again
            cancelSave();
            event.preventDefault();
            gesture = { pointerId: event.pointerId, canvas };
            try {
                canvas.setPointerCapture(event.pointerId);
            } catch {
                //a synthetic pointer cannot be captured; the stroke still follows its events on the canvas
            }
        },
        onPointerMove: (event: PointerEvent) => {
            if (gesture === undefined || event.pointerId !== gesture.pointerId) return;
            if (blocked()) {
                gesture = undefined;
                painter?.cancel();
                waiters.wake();
                return;
            }
            const canvas = gesture.canvas;
            const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
            const points = (events.length > 0 ? events : [event]).map((each) => pointOf(canvas, each));
            painter?.extend(...points);
        },
        onPointerUp: (event: PointerEvent) => {
            if (gesture === undefined || event.pointerId !== gesture.pointerId) return;
            finish();
        },
        onPointerCancel: (event: PointerEvent) => {
            if (gesture === undefined || event.pointerId !== gesture.pointerId) return;
            gesture = undefined;
            painter?.cancel();
            waiters.wake();
        },
        dispose: () => {
            disposed = true;
            gesture = undefined;
            cancelSave();
            element.removeEventListener('focusout', onFocusOut);
            store.off(toolbarPaths, drawToolbar);
            store.off([valuePath, `${valuePath}.$all`, dirtyPath], onValue);
            store.off(sizePaths, onResize);
            painter?.dispose();
            painter = undefined;
            field.dispose();
        }
    };
}
