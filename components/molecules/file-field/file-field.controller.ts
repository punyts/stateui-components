import { report } from '@punyts/core';
import type { ControllerContext } from '@punyts/stateui';
import { createField, createWaiters } from '../shared/field/field.js';
import {
    ALLOWED_FILE_TYPES,
    acceptAttribute,
    bareType,
    effectiveAccept,
    effectiveMaxFiles,
    effectiveMaxSize,
    formatBytes,
    isFileRef,
    mediaTypeOf,
    percentOf,
    transferCode,
    typeFromName
} from '../shared/field/files.js';
import type { FileRef } from '../shared/field/files.js';
import { CROPPABLE_TYPES, clampZoom, cropRatio, cropRect, croppedName, croppedSize, croppedType } from '../shared/field/crop.js';

/** The event that hands a file to the host's `transferFile` hook (the dispatcher of `@punyts/stateui-app` answers it) */
const FILE_TRANSFER_EVENT = 'ui-file-transfer';

/** One row the view draws: a stored file, or a transfer under way */
interface Row {
    name: string;
    detail: string;
    state: 'done' | 'uploading';
    percent: number;
    removeLabel: string;
}

/** A transfer under way. The bytes pass through the runtime hook; this holds the progress only */
interface Upload {
    name: string;
    loaded: number;
    total: number;
    abort: AbortController;
}

/** The picture the crop step shows: the decoded file, the zoom and the centre of the frame in picture pixels */
interface Crop {
    bitmap: ImageBitmap;
    zoom: number;
    centerX: number;
    centerY: number;
}

/** The longest edge of the crop step's preview canvas, in canvas pixels */
const PREVIEW_EDGE = 480;
/** The quality a cropped JPEG or WebP is encoded at */
const CROP_QUALITY = 0.92;

interface CommandHost {
    commands?: Record<string, () => void>;
}

/**
 * A file field on the field base: `value` is a list of file references `{ id, name, size, type }`, never bytes. Files come
 * from the picker (the button) or are dropped on the field. Before a file is handed over its type is checked against `accept`
 * (narrowed to the types ADR-0017 allows; an `accept` entry outside them is ignored), its size against `maxSize` (at most
 * 10 MiB) and the count against `maxFiles` (stored files and transfers under way count); a failed check sets the error to
 * the rule's name (`accept`, `maxSize` or `maxFiles`) and the file is not sent. When the browser gives a file no type, the
 * type its extension stands for is used.
 *
 * Each accepted file goes to the host with the bubbling, composed `ui-file-transfer` event, which the dispatcher answers
 * with `hooks.transferFile(file, { onProgress, signal })`. The runtime property `rows` shows the files and the transfers
 * with their progress; the remove button of a transfer aborts it through the hook's `signal`. The reference the hook
 * resolves with is appended to `value`; a rejection sets the error to its code (`too_large`, `unsupported_type`, `quota`,
 * `offline`, ...), and so does a host that gives no hook (`offline`). The error stays until the next attempt, a removal or
 * a successful transfer. Nothing but the reference is written to the store. A form's submit waits for the transfers under
 * way (the field's `settle`), so it submits the files they add, or refuses with the error of one that failed.
 *
 * With `crop` set to a ratio (`1:1` for an avatar), an accepted PNG, JPEG, WebP or GIF opens the crop step first: the
 * picture fills a frame of that ratio, a drag or the arrow keys move it, the zoom slider (or `+` and `-`) enlarges it,
 * and "use" (or Enter) sends the framed part, re-encoded in its own type (a GIF as a PNG) and at most 2048 pixels on its
 * longest edge, while "cancel" (or Escape) drops the file. Several pictures are cropped one after another. The picture is
 * drawn on a canvas, so no URL of it is made and nothing of it reaches the store
 */
export default function controller(context: ControllerContext) {
    const { element, store, basePath } = context;
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const valuePath = `${basePath}.value`;
    const uploads = new Map<string, Upload>();
    let counter = 0;
    let failure = '';
    let disposed = false;
    /** The pictures waiting for the crop step, the one it shows, and the crops being encoded */
    const queue: File[] = [];
    let cropFile: File | null = null;
    let crop: Crop | null = null;
    let encoding = 0;
    /** Raised whenever the crop step closes, so a picture that finishes decoding after that is dropped */
    let generation = 0;
    let drag: { id: number; x: number; y: number } | null = null;
    /** The promises of `settle` (a form's submit): woken whenever a transfer ends or is dropped */
    const waiters = createWaiters();

    const refs = (): unknown[] => {
        const value = read('value');
        return Array.isArray(value) ? [...(value as unknown[])] : [];
    };
    const blocked = (): boolean => read('disabled') === true || read('readonly') === true || read('locked') === true;
    const locale = (): string => {
        const value = store.get<unknown>('$.locale');
        return typeof value === 'string' ? value : '';
    };
    const accepted = (): readonly string[] => effectiveAccept(read('accept'));
    const limitSize = (): number => effectiveMaxSize(read('maxSize'));
    const limitFiles = (): number => effectiveMaxFiles(read('maxFiles'));

    /** The rule the stored list breaks (written from outside), or an empty string */
    const listRule = (): string => {
        const list = refs();
        if (list.length > limitFiles()) return 'maxFiles';
        const types = accepted();
        for (const item of list) {
            if (!isFileRef(item)) continue;
            if (!types.includes(item.type)) return 'accept';
            if (item.size > limitSize()) return 'maxSize';
        }
        return '';
    };
    const field = createField(context, 'value', {
        entryRule: () => (failure !== '' ? failure : listRule()),
        empty: () => [],
        //a form's submit waits while transfers are under way
        settle: () => (uploads.size > 0 && !disposed ? waiters.wait() : undefined),
        //a reset (the command, or a form's) stops the transfers, so a late result cannot append a file to the restored list
        onReset: () => {
            dropCrops();
            for (const upload of uploads.values()) upload.abort.abort();
            uploads.clear();
            failure = '';
            draw();
            waiters.wake();
        }
    });
    const reported = new Set<string>();
    /** Reports each `accept` entry outside the allowed list once, as a `SUI-STATE` warning; the entry is ignored */
    const reportAccept = (): void => {
        const entries = Array.isArray(read('accept')) ? (read('accept') as unknown[]).map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry))) : [];
        const outside = new Set(entries.filter((entry) => !ALLOWED_FILE_TYPES.includes(bareType(entry))));
        for (const entry of [...reported]) if (!outside.has(entry)) reported.delete(entry);
        for (const entry of outside) {
            if (reported.has(entry)) continue;
            reported.add(entry);
            report.warning(`fileField: the accept entry "${entry}" is not an allowed file type, so it is ignored`, { code: 'SUI-STATE', path: basePath });
        }
    };

    const draw = (): void => {
        const template = typeof read('_remove') === 'string' ? (read('_remove') as string) : '{name}';
        const rows: Record<string, Row> = {};
        refs().forEach((item, index) => {
            if (!isFileRef(item)) return;
            rows[`f${index}`] = { name: item.name, detail: formatBytes(item.size, locale()), state: 'done', percent: 100, removeLabel: template.replace('{name}', item.name) };
        });
        for (const [key, upload] of uploads) {
            const percent = percentOf(upload.loaded, upload.total);
            rows[key] = { name: upload.name, detail: `${percent}%`, state: 'uploading', percent, removeLabel: template.replace('{name}', upload.name) };
        }
        store.set(`${basePath}.rows`, rows);
        store.set(`${basePath}.count`, Object.keys(rows).length);
        store.set(`${basePath}.types`, acceptAttribute(accepted()));
        reportAccept();
    };

    const fail = (code: string): void => {
        failure = code;
        field.validate();
    };
    const succeed = (): void => {
        failure = '';
        if (read('error') !== '') field.validate();
    };

    /** The rule a file breaks before it is sent, or an empty string */
    const check = (file: File): string => {
        if (!accepted().includes(mediaTypeOf(file))) return 'accept';
        if (file.size > limitSize()) return 'maxSize';
        if (refs().length + uploads.size + queue.length + encoding + (cropFile !== null ? 1 : 0) >= limitFiles()) return 'maxFiles';
        return '';
    };

    /** Raises `ui-file-transfer`; the promise rejects with `offline` when nothing answers (the host has no hook) */
    const hand = (file: File, upload: Upload): Promise<unknown> =>
        new Promise((resolve, reject) => {
            let answered = false;
            const detail = {
                file,
                signal: upload.abort.signal,
                onProgress: (progress: { loaded: number; total: number }): void => {
                    upload.loaded = progress.loaded;
                    upload.total = progress.total;
                    draw();
                },
                respond: (result: Promise<unknown>): void => {
                    answered = true;
                    result.then(resolve, reject);
                }
            };
            element.dispatchEvent(new CustomEvent(FILE_TRANSFER_EVENT, { detail, bubbles: true, composed: true }));
            if (!answered) reject({ code: 'offline' });
        });

    const start = (file: File): void => {
        const key = `u${counter}`;
        counter += 1;
        const upload: Upload = { name: file.name, loaded: 0, total: file.size, abort: new AbortController() };
        uploads.set(key, upload);
        draw();
        //a file the browser gave no type is sent with the type of its extension, because the host refuses a file with none
        const inferred = file.type === '' ? typeFromName(file.name) : '';
        const sent = inferred === '' ? file : new File([file], file.name, { type: inferred });
        hand(sent, upload).then(
            (result) => {
                if (!uploads.delete(key) || disposed) return;
                if (!isFileRef(result)) {
                    draw();
                    fail('internal');
                    waiters.wake();
                    return;
                }
                const reference: FileRef = { id: result.id, name: result.name, size: result.size, type: result.type };
                store.set(valuePath, [...refs(), reference] as never);
                draw();
                succeed();
                waiters.wake();
            },
            (error: unknown) => {
                if (!uploads.delete(key) || disposed) return;
                draw();
                fail(transferCode(error));
                waiters.wake();
            }
        );
    };

    const add = (files: readonly File[]): void => {
        if (blocked() || files.length === 0) return;
        failure = '';
        let rejected = '';
        const cropping = cropRatio(read('crop')) > 0;
        for (const file of files) {
            const rule = check(file);
            if (rule !== '') {
                if (rejected === '') rejected = rule;
            } else if (cropping && CROPPABLE_TYPES.includes(mediaTypeOf(file))) {
                queue.push(file);
            } else {
                start(file);
            }
        }
        if (rejected !== '') fail(rejected);
        else succeed();
        openCrop();
    };

    const frame = (): HTMLCanvasElement | null => element.shadowRoot?.querySelector<HTMLCanvasElement>('.crop-frame') ?? null;
    const ratio = (): number => cropRatio(read('crop')) || 1;
    /** The frame over the picture, its centre clamped into it */
    const framed = (current: Crop): ReturnType<typeof cropRect> => {
        const rect = cropRect(current.bitmap.width, current.bitmap.height, ratio(), current.zoom, current.centerX, current.centerY);
        current.centerX = rect.centerX;
        current.centerY = rect.centerY;
        return rect;
    };
    const paint = (): void => {
        const canvas = frame();
        const context2d = canvas?.getContext('2d');
        if (!canvas || !context2d || crop === null) return;
        const rect = framed(crop);
        context2d.clearRect(0, 0, canvas.width, canvas.height);
        context2d.drawImage(crop.bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
    };
    const closeCrop = (): void => {
        generation += 1;
        crop?.bitmap.close();
        crop = null;
        cropFile = null;
        drag = null;
        store.set(`${basePath}.cropping`, false);
    };
    const dropCrops = (): void => {
        queue.length = 0;
        closeCrop();
    };
    /** Decodes the next waiting picture and shows it in the crop step; a file that does not decode is refused */
    const openCrop = (): void => {
        if (cropFile !== null || disposed) return;
        const next = queue.shift();
        if (next === undefined) return;
        cropFile = next;
        const token = generation;
        createImageBitmap(next).then(
            (bitmap) => {
                if (token !== generation || disposed) {
                    bitmap.close();
                    return;
                }
                crop = { bitmap, zoom: 1, centerX: bitmap.width / 2, centerY: bitmap.height / 2 };
                const shape = ratio();
                const template = typeof read('_crop') === 'string' ? (read('_crop') as string) : '{name}';
                store.set(`${basePath}.cropWidth`, shape >= 1 ? PREVIEW_EDGE : Math.round(PREVIEW_EDGE * shape));
                store.set(`${basePath}.cropHeight`, shape >= 1 ? Math.round(PREVIEW_EDGE / shape) : PREVIEW_EDGE);
                store.set(`${basePath}.cropZoom`, 1);
                store.set(`${basePath}.cropLabel`, template.replace('{name}', next.name));
                store.set(`${basePath}.cropping`, true);
                paint();
                frame()?.focus();
            },
            () => {
                if (token !== generation || disposed) return;
                cropFile = null;
                fail('unsupported_type');
                openCrop();
            }
        );
    };
    const focusControl = (): void => {
        if (cropFile === null) element.shadowRoot?.querySelector<HTMLElement>('#control')?.focus();
    };
    /** Draws the framed part at its size, closes the step and sends the encoded picture; then opens the next */
    const useCrop = (): void => {
        if (crop === null || cropFile === null) return;
        const source = cropFile;
        const rect = framed(crop);
        const size = croppedSize(rect);
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        canvas.getContext('2d')?.drawImage(crop.bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, size.width, size.height);
        const from = mediaTypeOf(source);
        const type = croppedType(from);
        const name = croppedName(source.name, from, type);
        encoding += 1;
        closeCrop();
        canvas.toBlob(
            (blob) => {
                encoding -= 1;
                if (disposed) return;
                if (blob === null) fail('internal');
                else if (blob.size > limitSize()) fail('maxSize');
                else {
                    start(new File([blob], name, { type }));
                    succeed();
                }
                openCrop();
                focusControl();
            },
            type,
            CROP_QUALITY
        );
    };
    const cancelCrop = (): void => {
        closeCrop();
        openCrop();
        focusControl();
    };
    const zoomTo = (zoom: number): void => {
        if (crop === null) return;
        crop.zoom = clampZoom(zoom);
        store.set(`${basePath}.cropZoom`, crop.zoom);
        paint();
    };
    /** Moves the picture under the frame by a distance in frame pixels (the frame's centre moves the other way) */
    const panBy = (dx: number, dy: number, frameWidth: number): void => {
        if (crop === null || frameWidth <= 0) return;
        const scale = framed(crop).width / frameWidth;
        crop.centerX -= dx * scale;
        crop.centerY -= dy * scale;
        paint();
    };

    const abortAll = (): void => {
        for (const upload of uploads.values()) upload.abort.abort();
        uploads.clear();
        waiters.wake();
    };

    const removeKey = (key: string): void => {
        if (blocked()) return;
        const upload = uploads.get(key);
        if (upload) {
            uploads.delete(key);
            upload.abort.abort();
            draw();
            waiters.wake();
        } else if (key.startsWith('f')) {
            const index = Number(key.slice(1));
            const next = refs();
            if (!Number.isInteger(index) || index < 0 || index >= next.length) return;
            next.splice(index, 1);
            store.set(valuePath, next as never);
        } else {
            return;
        }
        failure = '';
        if (read('error') !== '') field.validate();
    };

    const picker = (): HTMLInputElement | null => element.shadowRoot?.querySelector<HTMLInputElement>('.picker') ?? null;
    const hasFiles = (event: DragEvent): boolean => event.dataTransfer?.types.includes('Files') === true;

    //clear drops the transfers too; the command object belongs to the field base, so its `clear` is wrapped here
    const host = element as Element & CommandHost;
    const baseClear = host.commands?.clear;
    if (host.commands) {
        host.commands.clear = () => {
            dropCrops();
            abortAll();
            failure = '';
            draw();
            baseClear?.();
        };
    }

    const watched = [valuePath, `${valuePath}.$all`, `${basePath}.accept`, `${basePath}.accept.$all`, `${basePath}._remove`, '$.locale'];
    store.on(watched, draw);
    draw();

    return {
        ...field,
        onChoose: () => {
            if (!blocked()) picker()?.click();
        },
        onPicked: (event: Event) => {
            event.stopPropagation();
            const input = event.currentTarget as HTMLInputElement | null;
            if (!input) return;
            const files = Array.from(input.files ?? []);
            input.value = '';
            add(files);
        },
        onDragOver: (event: DragEvent) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = blocked() ? 'none' : 'copy';
            if (!blocked()) store.set(`${basePath}.dragging`, true);
        },
        onDragLeave: (event: DragEvent) => {
            const box = event.currentTarget as HTMLElement | null;
            if (box && event.relatedTarget instanceof Node && box.contains(event.relatedTarget)) return;
            store.set(`${basePath}.dragging`, false);
        },
        onDrop: (event: DragEvent) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            store.set(`${basePath}.dragging`, false);
            add(Array.from(event.dataTransfer?.files ?? []));
        },
        onRemove: (event: Event) => {
            const key = (event.currentTarget as HTMLElement | null)?.dataset.key;
            if (key === undefined) return;
            removeKey(key);
            if (!blocked()) element.shadowRoot?.querySelector<HTMLElement>('#control')?.focus();
        },
        onCropDown: (event: PointerEvent) => {
            const canvas = event.currentTarget as HTMLCanvasElement | null;
            if (crop === null || !canvas || event.button !== 0) return;
            event.preventDefault();
            canvas.focus();
            try {
                canvas.setPointerCapture(event.pointerId);
            } catch {
                //a synthetic pointer cannot be captured; the drag still follows the canvas's own moves
            }
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
        },
        onCropMove: (event: PointerEvent) => {
            const canvas = event.currentTarget as HTMLCanvasElement | null;
            if (drag === null || drag.id !== event.pointerId || !canvas) return;
            const dx = event.clientX - drag.x;
            const dy = event.clientY - drag.y;
            drag.x = event.clientX;
            drag.y = event.clientY;
            panBy(dx, dy, canvas.getBoundingClientRect().width);
        },
        onCropUp: (event: PointerEvent) => {
            if (drag !== null && drag.id === event.pointerId) drag = null;
        },
        onCropKey: (event: KeyboardEvent) => {
            const canvas = event.currentTarget as HTMLCanvasElement | null;
            if (crop === null || !canvas || event.ctrlKey || event.metaKey || event.altKey) return;
            const width = canvas.getBoundingClientRect().width;
            const step = width / 20;
            const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
            const move = moves[event.key];
            if (move) panBy(move[0], move[1], width);
            else if (event.key === '+' || event.key === '=') zoomTo(crop.zoom + 0.25);
            else if (event.key === '-') zoomTo(crop.zoom - 0.25);
            else if (event.key === 'Enter') useCrop();
            else if (event.key === 'Escape') cancelCrop();
            else return;
            event.preventDefault();
            event.stopPropagation();
        },
        onCropZoom: (event: Event) => {
            zoomTo(Number((event.currentTarget as HTMLInputElement).value));
        },
        onCropUse: useCrop,
        onCropCancel: cancelCrop,
        dispose: () => {
            disposed = true;
            dropCrops();
            abortAll();
            store.off(watched, draw);
            field.dispose();
        }
    };
}
