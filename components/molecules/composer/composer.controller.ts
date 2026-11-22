import type { ControllerContext } from '@punyts/stateui';
import {
    acceptAttribute,
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

/** The event that hands a file to the host's `transferFile` hook (the dispatcher of `@punyts/stateui-app` answers it) */
const FILE_TRANSFER_EVENT = 'ui-file-transfer';

interface Row {
    name: string;
    detail: string;
    state: 'done' | 'uploading';
    removeLabel: string;
}

interface Upload {
    name: string;
    loaded: number;
    total: number;
    abort: AbortController;
}

interface CommandHost {
    commands?: Record<string, (value?: unknown) => void>;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const isEntry = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Where the next chat message is written. `value` is the text and `attachments` the file references `{ id, name, size,
 * type }` already handed to the host (`ui-file-transfer`, as `fileField` does; never bytes). Files come from the
 * attach button, a drop or a paste, checked against `accept`, `maxSize` and `maxFiles`; a failed check or transfer
 * shows its message from `_errors` until the next attempt.
 *
 * Send (the button, Enter without Shift and not while an input method composes, or the command) raises `send` with
 * `{ text, attachments }` (text trimmed) when there is text or an attachment and no transfer is under way, then clears
 * both, so the application only handles the message. A suggestion chip, shown while the text is empty, sends its
 * `_prompt` (else its label) the same way. While `streaming` the send button gives way to a stop button, which raises
 * `stop`, and Enter does not send
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const put = (name: string, value: unknown): void => {
        if (JSON.stringify(read(name)) !== JSON.stringify(value)) store.set(`${basePath}.${name}`, value as never);
    };
    const uploads = new Map<string, Upload>();
    let counter = 0;
    let disposed = false;

    const refs = (): FileRef[] => {
        const value = read('attachments');
        return Array.isArray(value) ? (value as unknown[]).filter(isFileRef) : [];
    };
    const locale = (): string => text(store.get<unknown>('$.locale'));
    const raise = (name: string, detail?: unknown): void => {
        element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
    };

    const fail = (code: string): void => {
        const errors = read('_errors');
        put('error', code);
        put('message', code === '' ? '' : (isEntry(errors) ? text(errors[code]) : '') || code);
    };

    const draw = (): void => {
        const template = text(read('_remove')) || '{name}';
        const rows: Record<string, Row> = {};
        refs().forEach((item, index) => {
            rows[`f${index}`] = { name: item.name, detail: formatBytes(item.size, locale()), state: 'done', removeLabel: template.replace('{name}', item.name) };
        });
        for (const [key, upload] of uploads) {
            rows[key] = { name: upload.name, detail: `${percentOf(upload.loaded, upload.total)}%`, state: 'uploading', removeLabel: template.replace('{name}', upload.name) };
        }
        put('rows', rows);
        put('uploading', uploads.size > 0);
        put('types', acceptAttribute(effectiveAccept(read('accept'))));
        put('canSend', uploads.size === 0 && (text(read('value')).trim() !== '' || refs().length > 0));
    };

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
        const inferred = file.type === '' ? typeFromName(file.name) : '';
        const sent = inferred === '' ? file : new File([file], file.name, { type: inferred });
        hand(sent, upload).then(
            (result) => {
                if (!uploads.delete(key) || disposed) return;
                if (!isFileRef(result)) {
                    fail('internal');
                } else {
                    store.set(`${basePath}.attachments`, [...refs(), { id: result.id, name: result.name, size: result.size, type: result.type }] as never);
                }
                draw();
            },
            (error: unknown) => {
                if (!uploads.delete(key) || disposed) return;
                fail(transferCode(error));
                draw();
            }
        );
    };

    const add = (files: readonly File[]): void => {
        if (read('disabled') === true || read('attach') !== true || files.length === 0) return;
        fail('');
        const accepted = effectiveAccept(read('accept'));
        for (const file of files) {
            const rule = !accepted.includes(mediaTypeOf(file))
                ? 'accept'
                : file.size > effectiveMaxSize(read('maxSize'))
                  ? 'maxSize'
                  : refs().length + uploads.size >= effectiveMaxFiles(read('maxFiles'))
                    ? 'maxFiles'
                    : '';
            if (rule === '') start(file);
            else fail(rule);
        }
    };

    const abortAll = (): void => {
        for (const upload of uploads.values()) upload.abort.abort();
        uploads.clear();
    };

    const clear = (): void => {
        abortAll();
        store.set(`${basePath}.value`, '');
        store.set(`${basePath}.attachments`, [] as never);
        fail('');
        draw();
    };

    const send = (prompt?: string): void => {
        if (read('disabled') === true || read('streaming') === true || uploads.size > 0) return;
        const typed = (prompt ?? text(read('value'))).trim();
        const attachments = prompt === undefined ? refs() : [];
        if (typed === '' && attachments.length === 0) return;
        raise('send', { text: typed, attachments });
        if (prompt === undefined) clear();
    };

    const stop = (): void => {
        if (read('streaming') === true) raise('stop');
    };

    const input = (): HTMLTextAreaElement | null => element.shadowRoot?.querySelector<HTMLTextAreaElement>('.input') ?? null;
    const host = element as Element & CommandHost;
    host.commands = {
        send: () => send(),
        stop,
        clear,
        focus: () => input()?.focus()
    };

    const watched = [`${basePath}.value`, `${basePath}.attachments`, `${basePath}.accept`, `${basePath}._remove`];
    store.on(watched, draw);
    draw();

    return {
        onKeyDown: (event: KeyboardEvent) => {
            if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
            event.preventDefault();
            send();
        },
        onSend: () => send(),
        onStop: stop,
        onSuggest: (event: Event) => {
            const key = (event.currentTarget as HTMLElement | null)?.dataset['key'];
            const suggestions = read('suggestions');
            const item = key !== undefined && isEntry(suggestions) ? suggestions[key] : undefined;
            if (!isEntry(item)) return;
            send(text(item['_prompt']) || text(item['_label']) || key);
        },
        onPick: () => element.shadowRoot?.querySelector<HTMLInputElement>('.picker')?.click(),
        onPicked: (event: Event) => {
            const picker = event.currentTarget as HTMLInputElement;
            add(Array.from(picker.files ?? []));
            picker.value = '';
        },
        onDragOver: (event: DragEvent) => {
            if (event.dataTransfer?.types.includes('Files') === true && read('attach') === true) event.preventDefault();
        },
        onDrop: (event: DragEvent) => {
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (files.length === 0) return;
            event.preventDefault();
            add(files);
        },
        onPaste: (event: ClipboardEvent) => {
            const files = Array.from(event.clipboardData?.files ?? []);
            if (files.length === 0) return;
            event.preventDefault();
            add(files);
        },
        onRemove: (event: Event) => {
            const key = (event.currentTarget as HTMLElement | null)?.dataset['key'];
            if (key === undefined || read('disabled') === true) return;
            const upload = uploads.get(key);
            if (upload) {
                uploads.delete(key);
                upload.abort.abort();
            } else if (key.startsWith('f')) {
                const index = Number(key.slice(1));
                const next = refs();
                if (!Number.isInteger(index) || index < 0 || index >= next.length) return;
                next.splice(index, 1);
                store.set(`${basePath}.attachments`, next as never);
            }
            fail('');
            draw();
        },
        dispose: () => {
            disposed = true;
            abortAll();
            store.off(watched, draw);
            delete host.commands;
        }
    };
}
