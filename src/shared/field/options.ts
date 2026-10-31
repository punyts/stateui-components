import type { ControllerContext } from '@punyts/stateui';

type Entry = Record<string, unknown>;

/** The members the view of an option field calls, and what its controller needs to read and write the chosen value */
export interface OptionMembers {
    /** The native value of a repeat entry: a map entry (it holds `_label`) is keyed, a data entry carries its own value */
    optionKeyOf(key: string, entry: Entry, field: string): string;
    /** The label of a repeat entry: the translated content of a map entry, the `optionLabel` field of a data entry */
    labelOf(entry: Entry, field: string, content: unknown): string;
    /** True when the field takes several values */
    multiple(): boolean;
    /** The option values as strings, which is how the native controls hold them */
    selectedKeys(): Set<string>;
    /** The value an option stands for: the entry's own value for a data array (a number stays a number), the key for a map */
    resolveValue(key: string): unknown;
    /** The state paths whose change means the chosen options must be shown again */
    readonly watched: string[];
}

/**
 * The option handling `selectField` and `radioField` share (the `select` atom's approach): a controller function gives
 * each repeat entry its native value and label, because a dynamic indexer on a repeat local renders empty. `options` is a
 * data array (labels not translated) or a keyed map whose `_label` is content (translated by a locale overlay)
 */
export function createOptions({ store, basePath }: ControllerContext): OptionMembers {
    const multiple = (): boolean => store.get<boolean>(`${basePath}.multiple`) === true;
    const selectedKeys = (): Set<string> => {
        const value = store.get<unknown>(`${basePath}.value`);
        if (multiple()) return new Set(Array.isArray(value) ? value.map(String) : []);
        return new Set(value === null || value === undefined ? [] : [String(value)]);
    };
    const resolveValue = (key: string): unknown => {
        const options = store.get<unknown>(`${basePath}.options`);
        if (!Array.isArray(options)) return key;
        const field = store.get<string>(`${basePath}.optionValue`);
        const entry = options.find((candidate: unknown) => candidate !== null && typeof candidate === 'object' && String((candidate as Entry)[field]) === key);
        return entry === undefined ? key : (entry as Entry)[field];
    };
    return {
        optionKeyOf: (key, entry, field) => String('_label' in entry ? key : entry[field]),
        labelOf: (entry, field, content) => String('_label' in entry ? content : (entry[field] ?? '')),
        multiple,
        selectedKeys,
        resolveValue,
        watched: [`${basePath}.value`, `${basePath}.multiple`, `${basePath}.optionValue`, `${basePath}.options`, `${basePath}.options.$all`]
    };
}

/**
 * Runs `sync` whenever the rendered options change (the repeat renders after the controller attaches, so a value set
 * before the first render would otherwise not be shown). Returns the function that stops watching
 */
export function watchRenderedOptions(element: Element, sync: () => void): () => void {
    let observer: MutationObserver | null = null;
    const attach = (): void => {
        const root = element.shadowRoot;
        if (!root) return;
        observer = new MutationObserver(sync);
        observer.observe(root, { childList: true, subtree: true });
    };
    if (element.shadowRoot) attach();
    else queueMicrotask(attach);
    return () => observer?.disconnect();
}
