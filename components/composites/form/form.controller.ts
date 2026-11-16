import { report } from '@punyts/core';
import type { ControllerContext } from '@punyts/stateui';
import { buildError } from '@punyts/stateui-app';
import { FIELD_CONNECT_EVENT } from '../shared/field/field.js';
import type { FieldConnect, FieldManaged } from '../shared/field/field.js';
import { inDocumentOrder } from '../shared/field/order.js';

interface CommandHost {
    commands?: Record<string, () => void>;
}

const MODES: readonly FieldManaged[] = ['blur', 'change', 'submit'];

/** How many times a submit asks the fields again for work under way before it validates what they hold */
const MAX_SETTLE_ROUNDS = 20;

/** A copy of a field's value for `submitted`: a list or a plain object is copied, so a later write does not change it */
function copyValue(value: unknown): unknown {
    if (Array.isArray(value)) return [...(value as unknown[])];
    if (typeof value === 'object' && value !== null) return { ...(value as Record<string, unknown>) };
    return value;
}

/**
 * Finds the fields inside the form through the bubbling `ui-field-connect` event and validates them together. The form
 * takes over each field's validation (`setManaged(validateOn)`): `blur` and `change` validate a field on that event,
 * `submit` leaves fields alone until the first validation (the `validate` command), after which a field that has an
 * error is checked again on each change so the error clears when the value is fixed.
 * It keeps the runtime properties `errorCount` (fields with an error) and `status` (`invalid` after a failed validation
 * while errors remain, else `dirty` when a field is dirty, else `pristine`), and raises `changed` (`{ key, value }`) on a
 * field change and `invalid` (`{ keys }`, the keys of the failing fields) when the `validate` command fails.
 * The commands `submit`, `reset` and `commit` add the reset point and the submission: `submit` validates, then raises
 * `submitted` with the values keyed by child key (`status` goes `submitting` then `submitted`) or `invalid`; `reset` restores
 * every field to its baseline; `commit` takes the current values as the new baseline. The form saves nothing: the fields'
 * links already hold the data.
 * A field with work under way (a file transfer, a painting not yet saved) answers `settle()` with a promise: `submit` then
 * stays `submitting` until every such promise has resolved (asking again after each round, since a field may start new
 * work), and validates and collects the values only then, so a failed save makes the field invalid and a finished one
 * submits its new value. A second `submit` while one waits does nothing; a `reset` or dispose drops the waiting submit.
 * With no work under way a submit runs at once, as before
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as Element & CommandHost;
    const fields = new Map<Element, FieldConnect>();
    const path = (name: string): string => `${basePath}.${name}`;
    let failed = false;
    let validated = false;
    let submitting = false;
    let submitted = false;
    let busy = false;
    /** Whether a submit waits for the fields' work under way */
    let waiting = false;
    /** Counts the resets and the dispose; a waiting submit that sees it change raises nothing */
    let generation = 0;

    const mode = (): FieldManaged => {
        const value = store.get<unknown>(path('validateOn'));
        return MODES.find((candidate) => candidate === value) ?? 'blur';
    };
    const disabled = (): boolean => store.get<unknown>(path('disabled')) === true;
    const sync = (): void => {
        let count = 0;
        let dirty = false;
        for (const field of fields.values()) {
            if (field.error !== '') count += 1;
            if (field.dirty) dirty = true;
        }
        if (count === 0) failed = false;
        const status = failed ? 'invalid' : submitting ? 'submitting' : submitted ? 'submitted' : dirty ? 'dirty' : 'pristine';
        if (store.get<unknown>(path('errorCount')) !== count) store.set(path('errorCount'), count);
        if (store.get<unknown>(path('status')) !== status) store.set(path('status'), status);
    };
    const ordered = (): FieldConnect[] => {
        const root = element.shadowRoot;
        return root ? inDocumentOrder(root, fields) : [...fields.values()];
    };
    const check = (field: FieldConnect): void => {
        if (field.validate() !== '') failed = true;
        validated = true;
        sync();
    };
    const validate = (): string[] => {
        const keys: string[] = [];
        for (const field of fields.values()) if (field.validate() !== '') keys.push(field.key);
        failed = keys.length > 0;
        validated = true;
        sync();
        if (keys.length > 0) element.dispatchEvent(new CustomEvent('invalid', { detail: { keys }, bubbles: true, composed: true }));
        return keys;
    };
    const focusFirstError = (): void => {
        const failing = new Map<Element, FieldConnect>();
        for (const [target, field] of fields) if (field.error !== '') failing.set(target, field);
        const root = element.shadowRoot;
        if (root) inDocumentOrder(root, failing)[0]?.focus();
    };
    /** The promises of the fields that have work under way (`settle` starts it at once), in no order */
    const unsettled = (): Promise<void>[] => {
        const works: Promise<void>[] = [];
        for (const field of fields.values()) {
            const work = field.settle();
            if (work !== undefined) works.push(work.catch(() => undefined));
        }
        return works;
    };
    /** Waits for the fields' work under way, round after round, then finishes the submit unless a reset or dispose came first */
    const awaitFields = async (works: Promise<void>[], at: number): Promise<void> => {
        let pending = works;
        for (let round = 0; pending.length > 0 && round < MAX_SETTLE_ROUNDS; round += 1) {
            await Promise.all(pending);
            if (at !== generation) return;
            pending = unsettled();
        }
        waiting = false;
        finishSubmit();
    };
    const submit = (): void => {
        //a submit while one waits for the fields is the same submit: it raises nothing more
        if (waiting) return;
        submitting = true;
        submitted = false;
        sync();
        const works = unsettled();
        if (works.length === 0) {
            finishSubmit();
            return;
        }
        waiting = true;
        failed = false;
        sync();
        void awaitFields(works, generation);
    };
    /** Validates, then raises `invalid` or `submitted` with the values the fields hold now */
    const finishSubmit = (): void => {
        const keys = validate();
        submitting = false;
        if (keys.length > 0) {
            sync();
            return;
        }
        const values: Record<string, unknown> = {};
        for (const field of ordered()) {
            if (Object.hasOwn(values, field.key)) {
                const message = buildError('SUI-RUN-BINDING', { component: 'form', path: basePath, statePath: basePath }).message;
                report.error(`${message}: two fields share the key "${field.key}", the later one wins`, { code: 'SUI-RUN-BINDING', path: basePath });
            }
            values[field.key] = copyValue(field.value);
        }
        submitted = true;
        sync();
        element.dispatchEvent(new CustomEvent('submitted', { detail: { values }, bubbles: true, composed: true }));
    };
    /** Drops a submit that waits for the fields: it raises nothing when their work ends */
    const dropWaiting = (): void => {
        generation += 1;
        if (!waiting) return;
        waiting = false;
        submitting = false;
    };
    const reset = (): void => {
        dropWaiting();
        busy = true;
        for (const field of fields.values()) field.reset();
        busy = false;
        failed = false;
        validated = false;
        submitted = false;
        sync();
    };
    const commit = (): void => {
        busy = true;
        for (const field of fields.values()) field.rebase();
        busy = false;
        submitted = false;
        sync();
    };
    const onConnect = (event: Event): void => {
        const field = (event as CustomEvent<FieldConnect>).detail;
        event.stopPropagation();
        fields.set(field.element, field);
        field.setManaged(mode());
        field.setDisabled(disabled());
        field.onStatus(() => {
            if (!busy) sync();
        });
        field.onRelease(() => {
            fields.delete(field.element);
            sync();
        });
        sync();
    };
    const onChange = (event: Event): void => {
        const origin = event.composedPath()[0];
        const field = origin instanceof Element ? fields.get(origin) : undefined;
        if (!field || busy) return;
        submitted = false;
        if (mode() === 'change' || (validated && field.error !== '')) check(field);
        else sync();
        element.dispatchEvent(new CustomEvent('changed', { detail: { key: field.key, value: field.value }, bubbles: true, composed: true }));
    };
    const onBlur = (event: Event): void => {
        const origin = event.composedPath().find((target): target is Element => target instanceof Element && fields.has(target));
        const field = origin ? fields.get(origin) : undefined;
        if (field && mode() === 'blur') check(field);
    };
    const onMode = (): void => {
        for (const field of fields.values()) field.setManaged(mode());
    };
    const onDisabled = (): void => {
        for (const field of fields.values()) field.setDisabled(disabled());
    };
    element.addEventListener(FIELD_CONNECT_EVENT, onConnect);
    element.addEventListener('change', onChange);
    element.addEventListener('focusout', onBlur);
    store.on([path('validateOn')], onMode);
    store.on([path('disabled')], onDisabled);
    host.commands = { validate: () => void validate(), focusFirstError, submit, reset, commit };
    return {
        dispose: () => {
            dropWaiting();
            element.removeEventListener(FIELD_CONNECT_EVENT, onConnect);
            element.removeEventListener('change', onChange);
            element.removeEventListener('focusout', onBlur);
            store.off([path('validateOn')], onMode);
            store.off([path('disabled')], onDisabled);
            delete host.commands;
            fields.clear();
        }
    };
}
