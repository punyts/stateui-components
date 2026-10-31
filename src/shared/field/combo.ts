import type { ControllerContext } from '@punyts/stateui';
import { createPopover } from '../popover/popover.js';
import type { PopoverHandle } from '../popover/popover.js';

/** One choice of a combobox: the value it stands for, its string form (how values are compared) and its shown label */
export interface ComboOption {
    readonly key: string;
    readonly value: unknown;
    readonly label: string;
}

type Entry = Record<string, unknown>;

const isEntry = (value: unknown): value is Entry => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The options of a combobox as one list. A keyed map (`{ open: { _label: 'Open' } }`) gives the key as the value and the
 * content `_label` as the label (the key when there is none); a data array gives each entry's `optionValue` field as the
 * value (its type is kept) and `optionLabel` field as the label, and a plain string or number entry is its own value and label
 */
export function readComboOptions(options: unknown, optionValue: string, optionLabel: string): ComboOption[] {
    const found: ComboOption[] = [];
    if (Array.isArray(options)) {
        for (const entry of options as unknown[]) {
            if (entry === null || entry === undefined) continue;
            if (isEntry(entry)) {
                const value = entry[optionValue];
                if (value === undefined || value === null) continue;
                found.push({ key: String(value), value, label: String(entry[optionLabel] ?? value) });
            } else {
                found.push({ key: String(entry), value: entry, label: String(entry) });
            }
        }
        return found;
    }
    if (isEntry(options)) {
        for (const [key, entry] of Object.entries(options)) {
            const label = isEntry(entry) && typeof entry._label === 'string' && entry._label !== '' ? entry._label : key;
            found.push({ key, value: key, label });
        }
    }
    return found;
}

const collators = new Map<string, Intl.Collator>();

/** The collator that treats case and accents as equal for a language; a code `Intl` refuses falls back to the default locale */
export function searchCollator(locale: string): Intl.Collator {
    const cached = collators.get(locale);
    if (cached) return cached;
    let collator: Intl.Collator;
    try {
        collator = new Intl.Collator(locale === '' ? undefined : locale, { sensitivity: 'base' });
    } catch {
        collator = new Intl.Collator(undefined, { sensitivity: 'base' });
    }
    collators.set(locale, collator);
    return collator;
}

/** True when the two texts are the same apart from case and accents in the language */
export function sameText(a: string, b: string, locale: string): boolean {
    return searchCollator(locale).compare(a.normalize('NFC'), b.normalize('NFC')) === 0;
}

/** True when `label` holds `query` somewhere, apart from case and accents in the language; an empty query is in every label */
export function labelContains(label: string, query: string, locale: string): boolean {
    const wanted = query.normalize('NFC');
    if (wanted === '') return true;
    const text = label.normalize('NFC');
    const collator = searchCollator(locale);
    for (let start = 0; start + wanted.length <= text.length; start++) {
        if (collator.compare(text.slice(start, start + wanted.length), wanted) === 0) return true;
    }
    return false;
}

/** The options whose label holds the query, in option order, at most `limit` of them, and whether more matched */
export function filterComboOptions(options: readonly ComboOption[], query: string, locale: string, limit: number): { shown: ComboOption[]; more: boolean } {
    const shown: ComboOption[] = [];
    for (const option of options) {
        if (!labelContains(option.label, query, locale)) continue;
        if (shown.length === limit) return { shown, more: true };
        shown.push(option);
    }
    return { shown, more: false };
}

/** What a field gives the list behaviour it shares with other comboboxes */
export interface ComboConfig {
    /** Whether an option is chosen: it is marked in the list */
    isSelected(option: ComboOption): boolean;
    /** The text the list filters by: what the user typed (empty while the input only shows the chosen label) */
    query(): string;
    /** Whether the first match is active as soon as the list is filtered (a field that takes custom text leaves it off) */
    autoActive(): boolean;
    /** An option was picked by the pointer or by Enter */
    choose(option: ComboOption): void;
    /** Whether picking an option closes the list */
    readonly closeOnChoose: boolean;
    /** Escape closed the list */
    onEscape?(): void;
}

export interface Combo {
    /** Every option as the field reads them now */
    options(): ComboOption[];
    /** The options the list shows now */
    shown(): readonly ComboOption[];
    /** The option the keyboard is on, if any */
    active(): ComboOption | undefined;
    isOpen(): boolean;
    /** Opens the list; `activate` puts the active option on the first chosen option, else the first (the last when `last`), as an arrow key does. Does nothing while the field cannot be changed or fewer than `minChars` were typed */
    open(activate?: boolean, last?: boolean): void;
    close(): void;
    /** Shows the list again from the field's state; called after the field's own state changed */
    refresh(): void;
    /** Handles ArrowDown, ArrowUp, Enter on an active option and Escape; true when the key was used */
    onKey(event: KeyboardEvent): boolean;
    /** The popup's pointerdown: keeps focus in the input */
    onPopupDown(event: Event): void;
    /** The popup's click: picks the option that was pressed */
    onPick(event: Event): void;
    dispose(): void;
}

const DEFAULT_MAX_RESULTS = 50;
const OPTION_PREFIX = 'option-';

/**
 * The list a combobox shares between `comboboxField` and `multiSelectField`: it reads the options, filters them by the
 * typed text with a collator for `$.locale`, writes the runtime properties the view draws (`results`, `hint`, `open`,
 * `activeId`), shows the `listbox` popup in the top layer (`src/shared/popover/`), keeps the active option by its
 * value across a replacement of the options, and moves it with the arrow keys. `aria-activedescendant` names the active
 * option while focus stays in the input. A field owns what choosing means
 */
export function createCombo({ element, store, basePath }: ControllerContext, config: ComboConfig): Combo {
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const text = (name: string): string => {
        const value = read(name);
        return typeof value === 'string' ? value : '';
    };
    const whole = (name: string, fallback: number): number => {
        const value = read(name);
        return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
    };
    const part = (selector: string): HTMLElement | null => element.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
    const locale = (): string => {
        const value = store.get<unknown>('$.locale');
        return typeof value === 'string' ? value : '';
    };
    const options = (): ComboOption[] => readComboOptions(read('options'), text('optionValue') || 'value', text('optionLabel') || 'label');
    const blocked = (): boolean => read('disabled') === true || read('locked') === true || read('readonly') === true;

    let popover: PopoverHandle | undefined;
    let listed: ComboOption[] = [];
    let activeKey: string | undefined;
    let open = false;

    const popoverOf = (): PopoverHandle | undefined => {
        if (popover) return popover;
        const popup = part('.popup');
        if (!popup) return undefined;
        popover = createPopover({ element: popup, anchor: '--c', dismissible: () => false });
        return popover;
    };
    const gated = (): boolean => config.query().length < whole('minChars', 0);
    const activeIndex = (): number => (activeKey === undefined ? -1 : listed.findIndex((option) => option.key === activeKey));

    const render = (): void => {
        const { shown, more } = filterComboOptions(gated() ? [] : options(), config.query(), locale(), Math.max(1, whole('maxResults', DEFAULT_MAX_RESULTS)));
        listed = shown;
        if (activeIndex() < 0) activeKey = config.autoActive() ? shown[0]?.key : undefined;
        const results: Record<string, { id: string; label: string; selected: boolean; active: boolean }> = {};
        shown.forEach((option, index) => {
            results[`r${index}`] = { id: `${OPTION_PREFIX}${index}`, label: option.label, selected: config.isSelected(option), active: option.key === activeKey };
        });
        store.set(`${basePath}.results`, results);
        store.set(`${basePath}.hint`, shown.length === 0 ? 'empty' : more ? 'more' : '');
        const index = activeIndex();
        store.set(`${basePath}.activeId`, index < 0 ? '' : `${OPTION_PREFIX}${index}`);
        if (index >= 0) queueMicrotask(() => part(`#${OPTION_PREFIX}${index}`)?.scrollIntoView({ block: 'nearest' }));
    };

    const close = (): void => {
        const was = open;
        open = false;
        activeKey = undefined;
        popover?.close();
        if (!was) return;
        store.set(`${basePath}.open`, false);
        store.set(`${basePath}.activeId`, '');
    };
    const openList = (activate = false, last = false): void => {
        if (blocked() || gated()) return;
        if (!open && activate) {
            activeKey = options().find(config.isSelected)?.key;
            render();
            if (activeIndex() < 0) activeKey = last ? listed[listed.length - 1]?.key : listed[0]?.key;
        }
        const handle = popoverOf();
        if (!handle) return;
        open = true;
        render();
        store.set(`${basePath}.open`, true);
        handle.open();
    };
    const refresh = (): void => {
        if (!open) return;
        if (blocked() || gated()) {
            close();
            return;
        }
        render();
    };

    const move = (direction: 1 | -1): void => {
        if (listed.length === 0) return;
        const current = activeIndex();
        const next = current < 0 ? (direction === 1 ? 0 : listed.length - 1) : (current + direction + listed.length) % listed.length;
        activeKey = listed[next]?.key;
        render();
    };
    const pick = (option: ComboOption): void => {
        config.choose(option);
        if (config.closeOnChoose) close();
        else refresh();
    };

    const watched = [
        `${basePath}.options`,
        `${basePath}.options.$all`,
        `${basePath}.optionValue`,
        `${basePath}.optionLabel`,
        `${basePath}.minChars`,
        `${basePath}.maxResults`,
        `${basePath}.disabled`,
        `${basePath}.readonly`,
        `${basePath}.locked`,
        `${basePath}.text`,
        `${basePath}.value`,
        `${basePath}.value.$all`,
        '$.locale'
    ];
    store.on(watched, refresh);

    return {
        options,
        shown: () => listed,
        active: () => listed[activeIndex()],
        isOpen: () => open,
        open: openList,
        close,
        refresh,
        onKey: (event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (!open) openList(true, event.key === 'ArrowUp');
                else move(event.key === 'ArrowDown' ? 1 : -1);
                return true;
            }
            if (event.key === 'Enter' && open) {
                const option = listed[activeIndex()];
                if (!option) return false;
                event.preventDefault();
                pick(option);
                return true;
            }
            if (event.key === 'Escape' && open) {
                event.preventDefault();
                event.stopPropagation();
                close();
                config.onEscape?.();
                return true;
            }
            return false;
        },
        onPopupDown: (event) => event.preventDefault(),
        onPick: (event) => {
            const target = event.composedPath().find((node): node is HTMLElement => node instanceof HTMLElement && node.dataset.index !== undefined);
            const option = target?.dataset.index === undefined ? undefined : listed[Number(target.dataset.index.slice(1))];
            if (option) pick(option);
        },
        dispose: () => {
            store.off(watched, refresh);
            popover?.dispose();
        }
    };
}
