import type { ControllerContext } from '@punyts/stateui';
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
 * field change and `invalid` (`{ keys }`, the keys of the failing fields) when the `validate` command fails
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as Element & CommandHost;
    const fields = new Map<Element, FieldConnect>();
    const path = (name: string): string => `${basePath}.${name}`;
    let failed = false;
    let validated = false;

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
        const status = failed ? 'invalid' : dirty ? 'dirty' : 'pristine';
        if (store.get<unknown>(path('errorCount')) !== count) store.set(path('errorCount'), count);
        if (store.get<unknown>(path('status')) !== status) store.set(path('status'), status);
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
    const onConnect = (event: Event): void => {
        const field = (event as CustomEvent<FieldConnect>).detail;
        event.stopPropagation();
        fields.set(field.element, field);
        field.setManaged(mode());
        field.setDisabled(disabled());
        field.onRelease(() => {
            fields.delete(field.element);
            sync();
        });
        sync();
    };
    const onChange = (event: Event): void => {
        const origin = event.composedPath()[0];
        const field = origin instanceof Element ? fields.get(origin) : undefined;
        if (!field) return;
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
    host.commands = { validate: () => void validate(), focusFirstError };
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
