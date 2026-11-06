import { report } from '@punyts/core';
import type { ControllerContext } from '@punyts/stateui';
import { resolveColor } from '../shared/drawing/paint.js';
import { createField } from '../shared/field/field.js';
import { isFileRef } from '../shared/field/files.js';
import { createPainter } from '../shared/paint/draw.js';
import type { Painter } from '../shared/paint/draw.js';
import { clampBrushSize, clampDimension, clampSizes } from '../shared/paint/size.js';
import { isPaintTool, PAINT_TOOLS } from '../shared/paint/strokes.js';
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
 * and `value`, the reference `{ id, name, size, type }` of a saved PNG (saving is G2.8; an empty object until then).
 * `dirty` is `true` while the canvas holds strokes that are not saved, so here whenever it is not blank. A disabled,
 * readonly or locked field draws nothing and its buttons are disabled; the canvas takes no keyboard input. `required`
 * fails while `value` holds no file reference. A change of `value` raises `changed` with it (beside the field base's
 * `change`, which a form listens for). A change of `width` or `height` starts a new, empty painting at the new size
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

    /** Writes `dirty`: strokes on the canvas that are not saved (nothing is saved before G2.8, so a painting that is not blank) */
    const syncDirty = (): void => {
        const dirty = painter !== undefined && !painter.blank;
        if (store.get<unknown>(dirtyPath) !== dirty) store.set(dirtyPath, dirty);
    };

    const field = createField(context, 'value', {
        entryRule: () => (read('required') === true && !isFileRef(store.get<unknown>(valuePath)) ? 'required' : ''),
        exclusive: true,
        empty: () => ({}),
        //a reset (the command, or a form's) starts a new painting: the strokes and their undo go
        onReset: () => {
            gesture = undefined;
            painter?.reset();
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

    const finish = (): void => {
        if (gesture === undefined) return;
        const { canvas, pointerId } = gesture;
        gesture = undefined;
        painter?.end();
        if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
        syncDirty();
    };

    const undo = (): void => {
        gesture = undefined;
        if (ensurePainter()?.undo()) syncDirty();
    };
    const redo = (): void => {
        gesture = undefined;
        if (ensurePainter()?.redo()) syncDirty();
    };
    /** Wipes the painting (one undoable entry) and empties `value` through the field base */
    const clear = (): void => {
        gesture = undefined;
        ensurePainter()?.clear();
        baseClear?.();
        syncDirty();
    };

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
        },
        dispose: () => {
            disposed = true;
            gesture = undefined;
            store.off(toolbarPaths, drawToolbar);
            store.off([valuePath, `${valuePath}.$all`, dirtyPath], onValue);
            store.off(sizePaths, onResize);
            painter?.dispose();
            painter = undefined;
            field.dispose();
        }
    };
}
