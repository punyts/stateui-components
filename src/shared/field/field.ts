import type { ControllerContext } from '@punyts/stateui';

/** The names a field's controller members take in its view; every field of the family uses these */
export interface FieldMembers {
    /** The CSS length a field's `width` stands for: `fill` is the whole row, `auto` fits the content, a number is a `ch` count */
    widthOf(width: unknown): string;
    /** The `aria-describedby` of the control: the ids of the help and error text that are shown (null when neither is) */
    describedBy(help: unknown, message: unknown): string | null;
    dispose(): void;
}

/** The ids the field views give the help text and the error text; `describedBy` returns them */
export const FIELD_IDS = { help: 'help', error: 'error' } as const;

/** The field's width as a CSS length. A count that is not a positive integer, and any other word, mean `fill` */
export function fieldWidth(width: unknown): string {
    if (width === 'auto') return 'fit-content';
    if (typeof width === 'number' && Number.isInteger(width) && width > 0) return `${width}ch`;
    return '100%';
}

/** The message the `_errors` map holds for the rule named by `error` */
export function fieldMessage(errors: unknown, error: unknown): string {
    if (typeof error !== 'string' || error === '' || typeof errors !== 'object' || errors === null) return '';
    const message = Object.hasOwn(errors, error) ? (errors as Record<string, unknown>)[error] : undefined;
    return typeof message === 'string' ? message : '';
}

const isShown = (text: unknown): boolean => typeof text === 'string' && text !== '';

/** The ids of the help and error text for `aria-describedby`: only text that is rendered can describe the control */
export function fieldDescribedBy(help: unknown, message: unknown): string | null {
    const ids: string[] = [];
    if (isShown(help)) ids.push(FIELD_IDS.help);
    if (isShown(message)) ids.push(FIELD_IDS.error);
    return ids.length > 0 ? ids.join(' ') : null;
}

/**
 * The part of a field's controller every field has. It keeps two runtime properties in step with the node, because a
 * view binding on an object (`_errors`) does not re-run when only a message inside it changes:
 * - `glyph`: the field's view draws its icon with a `<ui-icon state=".glyph">`, so `icon` is copied to `glyph.name`;
 * - `message`: the text of `_errors` for the rule named by `error` (empty when there is none), which the view shows.
 * It returns the members the view calls (`widthOf`, `describedBy`); a field's own controller returns them, together
 * with anything its control needs
 */
export function createField({ store, basePath }: ControllerContext): FieldMembers {
    const iconPath = `${basePath}.icon`;
    const syncGlyph = (): void => {
        const icon = store.get<unknown>(iconPath);
        store.set(`${basePath}.glyph.name`, typeof icon === 'string' ? icon : '');
    };
    const messagePaths = [`${basePath}.error`, `${basePath}._errors`, `${basePath}._errors.$all`];
    const syncMessage = (): void => {
        store.set(`${basePath}.message`, fieldMessage(store.get<unknown>(`${basePath}._errors`), store.get<unknown>(`${basePath}.error`)));
    };
    store.on(iconPath, syncGlyph);
    store.on(messagePaths, syncMessage);
    syncGlyph();
    syncMessage();
    return {
        widthOf: fieldWidth,
        describedBy: fieldDescribedBy,
        dispose: () => {
            store.off(iconPath, syncGlyph);
            store.off(messagePaths, syncMessage);
        }
    };
}
