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
 * links already hold the data
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
    const submit = (): void => {
        submitting = true;
        submitted = false;
        sync();
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
            values[field.key] = Array.isArray(field.value) ? [...field.value] : field.value;
        }
        submitted = true;
        sync();
        element.dispatchEvent(new CustomEvent('submitted', { detail: { values }, bubbles: true, composed: true }));
    };
    const reset = (): void => {
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
