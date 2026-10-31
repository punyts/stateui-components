import type { ControllerContext } from '@punyts/stateui';
import { failingRule } from './rules.js';
import type { FieldSettings } from './rules.js';

/** The event a field raises on its host when it connects; a form listens for it. Bubbles and is composed */
export const FIELD_CONNECT_EVENT = 'ui-field-connect';

/** Who runs the field's validation: the field itself (`none`) or a form that validates on `blur`, `change` or `submit` */
export type FieldManaged = 'none' | 'blur' | 'change' | 'submit';

/** The `detail` of `ui-field-connect`: what a form needs to find and drive a field without walking state */
export interface FieldConnect {
    /** The node key: the last segment of the field's path */
    readonly key: string;
    /** The field's host element (document order, focus) */
    readonly element: Element;
    /** The current failing rule's name, or an empty string */
    readonly error: string;
    /** The current value (`checked` for a field whose value lives there) */
    readonly value: unknown;
    /** Whether the value differs from the baseline */
    readonly dirty: boolean;
    /** Runs the rules and sets `error`; returns the failing rule's name or an empty string */
    validate(): string;
    /** Restores the baseline value and clears `error`, `touched` and `dirty` */
    reset(): void;
    /** Takes the current value as the new baseline and clears `dirty` */
    rebase(): void;
    /** Hands validation to a form (a mode other than `none` stops the field validating itself on `change`) */
    setManaged(mode: FieldManaged): void;
    /** Disables the control from outside, on top of the field's own `disabled` */
    setDisabled(flag: boolean): void;
    /** Moves focus to the control */
    focus(): void;
    /** Registers a function that runs once when the field is removed; a form drops the field there */
    onRelease(callback: () => void): void;
    /** Registers a function that runs whenever the field's `error` or `dirty` is written, whatever wrote it (a `clear`, a `reset`, a validation) */
    onStatus(callback: () => void): void;
}

/** The names a field's controller members take in its view; every field of the family uses these */
export interface FieldMembers {
    /** The CSS length a field's `width` stands for: `fill` is the whole row, `auto` fits the content, a number is a `ch` count */
    widthOf(width: unknown): string;
    /** The `aria-describedby` of the control: the ids of the help and error text that are shown (null when neither is) */
    describedBy(help: unknown, message: unknown): string | null;
    /** The control's `onblur`: the field has been touched */
    onBlur(): void;
    /** Runs the rules and sets `error`; returns the failing rule's name or an empty string */
    validate(): string;
    /** Restores the baseline value and clears `error`, `touched` and `dirty` */
    reset(): void;
    /** Moves focus to the control (the element with id `control`; for a group that cannot take focus, its checked or first enabled input) */
    focus(): void;
    /** Empties the value, writes data and clears `error` */
    clear(): void;
    dispose(): void;
}

/** What a field may add to the base behaviour */
export interface FieldOptions {
    /**
     * A rule of the field's own that comes before every other: a non-empty name fails validation with that name. A number
     * field uses it for text that is not a number, which is not in `value`, so the other rules cannot see it
     */
    readonly entryRule?: () => string;
}

/** The element of a field as the command dispatcher sees it */
interface CommandHost {
    commands?: Record<string, () => void>;
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

/** The empty value of the same kind as the baseline: `false`, an empty list or an empty string */
function emptyLike(value: unknown): unknown {
    if (typeof value === 'boolean') return false;
    return Array.isArray(value) ? [] : '';
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
 * It also owns the field's validation: the baseline value (taken at mount), the rules, the runtime properties `error`,
 * `touched` and `dirty`, the commands `validate` and `reset` and the `change` event (`detail: { value }`, raised on every
 * change of `value`). A field validates itself on `change` once it is touched. A field whose value lives in another
 * property (`checked`) passes `valueName`.
 * It returns the members the view calls (`widthOf`, `describedBy`, `onBlur`); a field's own controller returns them,
 * together with anything its control needs.
 * The field also raises `invalid` (`detail: { rule }`) on every failing validation and `valid` (`detail: { value }`) when
 * a validation passes after one failed; `options.entryRule` adds a rule that is checked first; it answers the commands `focus` and `clear`; and on attach it dispatches the
 * bubbling, composed `ui-field-connect` event whose detail is a `FieldConnect`, so a form finds it. With no form
 * listening nothing happens. On dispose the connect interface is released (`onRelease` callbacks run once)
 */
export function createField({ element, store, basePath }: ControllerContext, valueName = 'value', options: FieldOptions = {}): FieldMembers {
    const iconPath = `${basePath}.icon`;
    const syncGlyph = (): void => {
        const icon = store.get<unknown>(iconPath);
        store.set(`${basePath}.glyph.name`, typeof icon === 'string' ? icon : '');
    };
    const messagePaths = [`${basePath}.error`, `${basePath}._errors`, `${basePath}._errors.$all`];
    const syncMessage = (): void => {
        store.set(`${basePath}.message`, fieldMessage(store.get<unknown>(`${basePath}._errors`), store.get<unknown>(`${basePath}.error`)));
    };
    const valuePath = `${basePath}.${valueName}`;
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);
    let baseline = store.get<unknown>(valuePath);
    let announced = JSON.stringify(baseline);
    const settings = (): FieldSettings => ({
        required: read('required') === true,
        minLength: typeof read('minLength') === 'number' ? (read('minLength') as number) : 0,
        maxLength: typeof read('maxLength') === 'number' ? (read('maxLength') as number) : 0,
        min: read('min'),
        max: read('max'),
        step: typeof read('step') === 'number' ? (read('step') as number) : 0,
        minSelected: typeof read('minSelected') === 'number' ? (read('minSelected') as number) : 0,
        maxSelected: typeof read('maxSelected') === 'number' ? (read('maxSelected') as number) : 0,
        pattern: typeof read('pattern') === 'string' ? (read('pattern') as string) : ''
    });
    const raise = (name: string, detail: unknown): void => {
        element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
    };
    const validate = (): string => {
        const before = read('error');
        const value = store.get<unknown>(valuePath);
        const entry = options.entryRule?.() ?? '';
        const rule = entry !== '' ? entry : failingRule(value, settings());
        store.set(`${basePath}.error`, rule);
        if (rule !== '') raise('invalid', { rule });
        else if (typeof before === 'string' && before !== '') raise('valid', { value });
        return rule;
    };
    let managed: FieldManaged = 'none';
    const releases: Array<() => void> = [];
    const watchers: Array<() => void> = [];
    const statusPaths = [`${basePath}.error`, `${basePath}.dirty`];
    const onStatus = (): void => {
        for (const watcher of watchers) watcher();
    };
    const focus = (): void => {
        const control = element.shadowRoot?.querySelector<HTMLElement>('#control');
        if (!control) return;
        if (control.tabIndex >= 0) control.focus();
        else (control.querySelector<HTMLElement>('input:checked:not(:disabled)') ?? control.querySelector<HTMLElement>('input:not(:disabled)'))?.focus();
    };
    const clear = (): void => {
        const empty: unknown = emptyLike(baseline);
        store.set(valuePath, empty as never);
        store.set(`${basePath}.error`, '');
    };
    const rebase = (): void => {
        baseline = store.get<unknown>(valuePath);
        store.set(`${basePath}.dirty`, false);
    };
    const reset = (): void => {
        store.set(`${basePath}.touched`, false);
        store.set(`${basePath}.error`, '');
        store.set(valuePath, baseline);
        store.set(`${basePath}.dirty`, false);
    };
    const onValue = (): void => {
        const value = store.get<unknown>(valuePath);
        const snapshot = JSON.stringify(value);
        if (snapshot === announced) return;
        announced = snapshot;
        store.set(`${basePath}.dirty`, !same(value, baseline));
        if (read('touched') === true && managed === 'none') validate();
        raise('change', { value: Array.isArray(value) ? [...(value as unknown[])] : value });
    };
    const onBlur = (): void => {
        store.set(`${basePath}.touched`, true);
    };
    const host = element as Element & CommandHost;
    host.commands = { validate: () => void validate(), reset, focus, clear };
    store.on(valuePath, onValue);
    store.on(iconPath, syncGlyph);
    store.on(messagePaths, syncMessage);
    store.on(statusPaths, onStatus);
    syncGlyph();
    syncMessage();
    const connect: FieldConnect = {
        key: basePath.slice(basePath.lastIndexOf('.') + 1),
        element,
        get error(): string {
            const error = read('error');
            return typeof error === 'string' ? error : '';
        },
        get value(): unknown {
            return store.get<unknown>(valuePath);
        },
        get dirty(): boolean {
            return read('dirty') === true;
        },
        validate,
        reset,
        rebase,
        setManaged: (mode) => {
            managed = mode;
        },
        setDisabled: (flag) => {
            store.set(`${basePath}.locked`, flag);
        },
        focus,
        onRelease: (callback) => {
            releases.push(callback);
        },
        onStatus: (callback) => {
            watchers.push(callback);
        }
    };
    raise(FIELD_CONNECT_EVENT, connect);
    return {
        widthOf: fieldWidth,
        describedBy: fieldDescribedBy,
        onBlur,
        validate,
        reset,
        focus,
        clear,
        dispose: () => {
            delete host.commands;
            managed = 'none';
            watchers.length = 0;
            store.off(statusPaths, onStatus);
            for (const callback of releases.splice(0)) callback();
            store.off(valuePath, onValue);
            store.off(iconPath, syncGlyph);
            store.off(messagePaths, syncMessage);
        }
    };
}
