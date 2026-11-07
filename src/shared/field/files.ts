/** The media types ADR-0017 allows for an app's files; `fileField.accept` can narrow this list, never widen it. The host (`previewFiles.ts`) and the server check the same list */
export const ALLOWED_FILE_TYPES: readonly string[] = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
    'text/markdown',
    'application/json'
];

/** The largest file, in bytes: 10 MiB, which is also the default of `maxSize` */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** The file extensions of each allowed type, for the picker's `accept` hint and for a file the browser gives no type */
const EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
    'image/png': ['png'],
    'image/jpeg': ['jpg', 'jpeg'],
    'image/gif': ['gif'],
    'image/webp': ['webp'],
    'application/pdf': ['pdf'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
    'text/plain': ['txt'],
    'text/csv': ['csv'],
    'text/markdown': ['md', 'markdown'],
    'application/json': ['json']
};

/** The reference a stored file leaves in `value`: never the bytes */
export interface FileRef {
    readonly id: string;
    readonly name: string;
    readonly size: number;
    readonly type: string;
}

/** True when the value has the shape of a file reference */
export function isFileRef(value: unknown): value is FileRef {
    if (typeof value !== 'object' || value === null) return false;
    const entry = value as Record<string, unknown>;
    return (
        typeof entry.id === 'string' &&
        entry.id !== '' &&
        typeof entry.name === 'string' &&
        typeof entry.size === 'number' &&
        Number.isFinite(entry.size) &&
        typeof entry.type === 'string'
    );
}

/** The media type without parameters, in lower case */
export function bareType(mediaType: string): string {
    return (mediaType.split(';')[0] ?? '').trim().toLowerCase();
}

/** The allowed type a file name's extension stands for, or an empty string */
export function typeFromName(name: string): string {
    const dot = name.lastIndexOf('.');
    if (dot < 0) return '';
    const extension = name.slice(dot + 1).toLowerCase();
    for (const [type, extensions] of Object.entries(EXTENSIONS)) if (extensions.includes(extension)) return type;
    return '';
}

/** The media type of a file: the type the browser gave, or (when it gave none) the one its extension stands for */
export function mediaTypeOf(file: { readonly name: string; readonly type: string }): string {
    const given = bareType(file.type);
    return given !== '' ? given : typeFromName(file.name);
}

/**
 * The types a field takes: `accept` narrowed to the allowed list (an entry outside it is dropped), or the whole list when
 * `accept` is empty or not a list. An `accept` whose entries are all outside the list takes nothing
 */
export function effectiveAccept(accept: unknown): readonly string[] {
    if (!Array.isArray(accept) || accept.length === 0) return ALLOWED_FILE_TYPES;
    const wanted = accept.filter((entry): entry is string => typeof entry === 'string').map(bareType);
    return ALLOWED_FILE_TYPES.filter((type) => wanted.includes(type));
}

/** The value of the picker's `accept` attribute for the types: each type and its extensions */
export function acceptAttribute(types: readonly string[]): string {
    return types.flatMap((type) => [type, ...(EXTENSIONS[type] ?? []).map((extension) => `.${extension}`)]).join(',');
}

/** The largest file the field takes: `maxSize` when it is a positive number, never more than `MAX_FILE_SIZE` */
export function effectiveMaxSize(maxSize: unknown): number {
    return typeof maxSize === 'number' && Number.isFinite(maxSize) && maxSize > 0 ? Math.min(maxSize, MAX_FILE_SIZE) : MAX_FILE_SIZE;
}

/** The most files the field holds: `maxFiles` when it is a positive integer, else 1 */
export function effectiveMaxFiles(maxFiles: unknown): number {
    return typeof maxFiles === 'number' && Number.isInteger(maxFiles) && maxFiles > 0 ? maxFiles : 1;
}

/** A size in the locale's number form: `812 B`, `1.5 KB`, `10 MB` (units of 1024) */
export function formatBytes(bytes: number, locale: string): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = Math.max(0, bytes);
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    const options = { maximumFractionDigits: unit === 0 ? 0 : 1 };
    let format: Intl.NumberFormat;
    try {
        format = new Intl.NumberFormat(locale === '' ? 'en' : locale, options);
    } catch {
        format = new Intl.NumberFormat('en', options);
    }
    return `${format.format(value)} ${units[unit] as string}`;
}

/** Whole percent of a transfer, 0 to 100 */
export function percentOf(loaded: number, total: number): number {
    if (!(total > 0)) return 0;
    return Math.max(0, Math.min(100, Math.floor((loaded / total) * 100)));
}

/** The codes `transferFile` rejects with (the runtime's `FILE_ERROR_CODES`) */
export const TRANSFER_CODES: readonly string[] = ['too_large', 'unsupported_type', 'quota', 'not_found', 'unauthorized', 'offline', 'cancelled', 'internal'];

/** The code of a rejected transfer: the error's own `code` when it is one the runtime names, else `internal` */
export function transferCode(error: unknown): string {
    const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
    return typeof code === 'string' && TRANSFER_CODES.includes(code) ? code : 'internal';
}

/** The event that reads a stored file through the host's `readFile` hook (G1.9; the dispatcher answers it, unanswered when there is no hook) */
export const FILE_READ_EVENT = 'ui-file-read';

/** The types of the app's files that are pictures: what a `paintField` background and a `drawImage` file may be */
export const IMAGE_FILE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** A stored file as the host's `readFile` hook gives it: its reference and its bytes */
export interface StoredFile {
    readonly file: FileRef;
    readonly data: ArrayBuffer;
}

/** Reads a stored file by its id; rejects with an object whose `code` names the failure */
export type ReadStoredFile = (id: string, signal: AbortSignal) => Promise<StoredFile>;

/**
 * Reads a stored file with the bubbling, composed `ui-file-read` event raised on `target` (the dispatcher answers it
 * with `hooks.readFile`); the promise rejects with `{ code: 'offline' }` when nothing answers (the host has no hook)
 */
export function readStoredFile(target: EventTarget, id: string, signal: AbortSignal): Promise<StoredFile> {
    return new Promise((resolve, reject) => {
        let answered = false;
        const detail = {
            id,
            signal,
            respond: (result: Promise<StoredFile>): void => {
                answered = true;
                result.then(resolve, reject);
            }
        };
        target.dispatchEvent(new CustomEvent(FILE_READ_EVENT, { detail, bubbles: true, composed: true }));
        if (!answered) reject({ code: 'offline' });
    });
}

/**
 * Reads a stored picture and decodes it to an `ImageBitmap` (`createImageBitmap` on a `Blob`, which the frame's
 * `img-src` does not govern). Rejects with `{ reason }`: the read's code (`transferCode`), or `not_an_image` when the
 * bytes do not decode
 */
export function readImageBitmap(read: ReadStoredFile, id: string, signal: AbortSignal): Promise<ImageBitmap> {
    return read(id, signal).then(
        ({ file, data }) =>
            createImageBitmap(new Blob([data], { type: file.type })).catch(() => {
                throw { reason: 'not_an_image' };
            }),
        (error: unknown) => {
            throw { reason: transferCode(error) };
        }
    );
}
