import type { ControllerContext } from '@punyts/stateui';
import { createOverlayController, registerOverlayMixin } from '../shared/overlay/overlay.js';
import { groupCommands, readCommands } from '../shared/palette/palette.js';
import type { PaletteCommand } from '../shared/palette/palette.js';

registerOverlayMixin();

/** One listed command as the view draws it */
interface Option {
    readonly key: string;
    readonly id: string;
    readonly label: string;
    readonly icon: string;
    readonly shortcut: string;
}

/** One group of listed commands as the view draws it: its heading's id and text (empty for none) and its options */
interface Group {
    readonly id: string;
    readonly label: string;
    readonly options: Record<string, Option>;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * A command palette on the `overlay` directive (`src/shared/overlay/`), as `modal` is: `open` is the open state, the
 * commands `open`, `close` and `toggle` only write it, Escape and a press on the backdrop close it, focus returns to the
 * opener on close, and `open` and `close` are raised once per change. The search input is an ARIA 1.2 combobox over a
 * `listbox`: it has focus when the palette opens, with an empty query and the first command active. Typing filters
 * `commands` (a map of `{ _label, icon, group, shortcut, keywords }`) by label and keywords, case- and
 * accent-insensitive for `$.locale` (`src/shared/palette/`); the matches are listed by `group`, each group under its
 * heading, in the order the groups first appear. ArrowDown and ArrowUp move the active option (round at either end),
 * Ctrl+Home and Ctrl+End go to the first and last; Enter or a press on an option closes the palette and raises `run` with the
 * command's key. With nothing matching, `_empty` shows; a polite status speaks the number found (`_found`, `{count}`)
 */
export default function controller(context: ControllerContext) {
    const { element, store, basePath } = context;
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const overlay = createOverlayController(context);
    let listed: PaletteCommand[] = [];
    let active = '';

    const optionId = (index: number): string => `option-${index}`;
    const activeIndex = (): number => listed.findIndex((command) => command.key === active);
    const showActive = (): void => {
        const index = activeIndex();
        store.set(`${basePath}.activeId`, index < 0 ? '' : optionId(index));
        if (index >= 0) element.shadowRoot?.getElementById(optionId(index))?.scrollIntoView?.({ block: 'nearest' });
    };
    const refresh = (): void => {
        const groups = groupCommands(readCommands(read('commands')), text(read('query')), text(store.get<unknown>('$.locale')));
        listed = groups.flatMap((group) => [...group.commands]);
        const results: Record<string, Group> = {};
        let index = 0;
        groups.forEach((group, position) => {
            const options: Record<string, Option> = {};
            for (const command of group.commands) {
                options[command.key] = { key: command.key, id: optionId(index), label: command.label, icon: command.icon, shortcut: command.shortcut };
                index++;
            }
            results[`g${position}`] = { id: `group-${position}`, label: group.label, options };
        });
        store.set(`${basePath}.results`, results);
        store.set(`${basePath}.found`, listed.length);
        if (activeIndex() < 0) active = listed[0]?.key ?? '';
        showActive();
    };
    const input = (): HTMLInputElement | null => element.shadowRoot?.querySelector<HTMLInputElement>('#query') ?? null;
    const onOpen = (): void => {
        if (read('open') !== true) return;
        store.set(`${basePath}.query`, '');
        const field = input();
        if (field) field.value = '';
        active = '';
        refresh();
        // The directive shows the dialog in the same write; focus goes to the search once it is open
        queueMicrotask(() => input()?.focus());
    };
    const watched = [`${basePath}.commands`, `${basePath}.commands.$all`, `${basePath}.query`, '$.locale'];
    store.on(watched, refresh);
    store.on(`${basePath}.open`, onOpen);
    refresh();

    const moveTo = (index: number): void => {
        const command = listed[index];
        if (!command) return;
        active = command.key;
        showActive();
    };
    const run = (key: string): void => {
        if (!listed.some((command) => command.key === key)) return;
        store.set(`${basePath}.open`, false);
        element.dispatchEvent(new CustomEvent('run', { detail: key, bubbles: true, composed: true }));
    };
    const keyOf = (event: Event): string | undefined => {
        const origin = event.target as Element | null;
        return origin?.closest<HTMLElement>('[role=option]')?.dataset['key'];
    };

    return {
        ...overlay,
        /** The count the status speaks: `_found` with `{count}`, or `_empty` */
        foundText: (found: unknown, template: unknown, empty: unknown): string => (found === 0 ? text(empty) : text(template).replaceAll('{count}', String(found))),
        onInput: (event: Event) => {
            // The native input event is composed; the palette raises only its own events
            event.stopPropagation();
            const field = event.currentTarget as HTMLInputElement | null;
            if (!field) return;
            active = '';
            store.set(`${basePath}.query`, field.value);
        },
        onKeyDown: (event: KeyboardEvent) => {
            const index = activeIndex();
            const last = listed.length - 1;
            if (event.key === 'ArrowDown') moveTo(index < 0 || index >= last ? 0 : index + 1);
            else if (event.key === 'ArrowUp') moveTo(index <= 0 ? last : index - 1);
            else if (event.key === 'Home' && event.ctrlKey) moveTo(0);
            else if (event.key === 'End' && event.ctrlKey) moveTo(last);
            else if (event.key === 'Enter') {
                if (active !== '') run(active);
            } else return;
            event.preventDefault();
        },
        onPointerMove: (event: Event) => {
            const key = keyOf(event);
            if (key === undefined || key === active) return;
            active = key;
            showActive();
        },
        // A press keeps focus in the search
        onListDown: (event: Event) => {
            event.preventDefault();
        },
        onPick: (event: Event) => {
            const key = keyOf(event);
            if (key !== undefined) run(key);
        },
        dispose: () => {
            store.off(watched, refresh);
            store.off(`${basePath}.open`, onOpen);
            overlay.dispose();
        }
    };
}
