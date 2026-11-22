import type { ControllerContext } from '@punyts/stateui';
import { createField } from '../shared/field/field.js';
import { ancestorsOf, pathLabel, readTreeOptions, visibleRows } from '../shared/field/treeOptions.js';
import type { TreeOptions, TreeRow } from '../shared/field/treeOptions.js';
import { createPopover } from '../shared/popover/popover.js';
import type { PopoverHandle } from '../shared/popover/popover.js';

interface CommandHost {
    commands?: Record<string, () => void>;
}

/** The id prefix of a row; a row's id is the prefix and its index among the shown rows */
const ROW_PREFIX = 'row-';

/**
 * A select whose options are a hierarchy, on the field base. The trigger is a select-only combobox button
 * (`aria-haspopup="tree"`) and the options are a `tree` of `treeitem`s in a popover, focus staying on the button with
 * `aria-activedescendant`. `options` is a keyed map or a list of records naming their parent by `parentField`
 * (`readTreeOptions`). `value` is the chosen option's key; the button shows its label, or its path of labels with
 * `showPath` (the path is its title either way). `expanded` holds the open options' keys, so a document can keep it;
 * opening the popup also opens the ancestors of the value. Keys while open: Up and Down move, Right opens an option or
 * moves to its first child, Left closes it or moves to its parent, Home and End, a letter moves to the next option
 * starting with it, Enter or Space chooses, Escape and Tab close. With `leafOnly` an option with children only opens
 * and closes. Pressing a row's arrow opens or closes it; pressing the row chooses it. `expand` is raised with
 * `{ key, expanded }`
 */
export default function controller(context: ControllerContext) {
    const { element, store, basePath } = context;
    const host = element as Element & CommandHost;
    const path = (name: string): string => `${basePath}.${name}`;
    const read = (name: string): unknown => store.get<unknown>(path(name));
    const text = (name: string, fallback: string): string => {
        const value = read(name);
        return typeof value === 'string' && value !== '' ? value : fallback;
    };
    const part = (selector: string): HTMLElement | null => element.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
    const field = createField(context, 'value');
    const blocked = (): boolean => read('disabled') === true || read('locked') === true || read('readonly') === true;

    let popover: PopoverHandle | undefined;
    let isOpen = false;
    let activeKey: string | undefined;
    let shown: TreeRow[] = [];

    const tree = (): TreeOptions => readTreeOptions(read('options'), text('key', 'id'), text('parentField', 'parentId'), text('labelField', 'label'));
    const value = (): string => {
        const current = read('value');
        return typeof current === 'string' ? current : '';
    };
    const expandedSet = (): Set<string> => {
        const list = read('expanded');
        return new Set(Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []);
    };
    const choosable = (row: TreeRow): boolean => !(read('leafOnly') === true && row.hasChildren);

    const showValue = (options: TreeOptions): void => {
        const key = value();
        const option = options.byKey.get(key);
        const full = pathLabel(options, key);
        store.set(path('fullPath'), full);
        store.set(path('text'), option === undefined ? key : read('showPath') === true ? full : option.label);
    };
    const render = (): void => {
        const options = tree();
        showValue(options);
        if (!isOpen) return;
        shown = visibleRows(options, expandedSet());
        if (activeKey !== undefined && !shown.some((row) => row.key === activeKey)) activeKey = shown[0]?.key;
        const rows: Record<string, unknown> = {};
        shown.forEach((row, index) => {
            rows[`r${index}`] = { ...row, id: `${ROW_PREFIX}${index}`, selected: row.key === value(), active: row.key === activeKey };
        });
        store.set(path('rows'), rows);
        store.set(path('count'), shown.length);
        const index = shown.findIndex((row) => row.key === activeKey);
        store.set(path('activeId'), index < 0 ? '' : `${ROW_PREFIX}${index}`);
        if (index >= 0) queueMicrotask(() => part(`#${ROW_PREFIX}${index}`)?.scrollIntoView({ block: 'nearest' }));
    };

    const setExpanded = (key: string, open: boolean): void => {
        const set = expandedSet();
        if (set.has(key) === open) return;
        if (open) set.add(key);
        else set.delete(key);
        store.set(path('expanded'), [...set] as never);
        element.dispatchEvent(new CustomEvent('expand', { detail: { key, expanded: open }, bubbles: true, composed: true }));
    };

    const open = (): void => {
        if (isOpen || blocked()) return;
        const popup = part('.popup');
        if (popup === null) return;
        popover ??= createPopover({ element: popup, anchor: '--c', dismissible: () => false });
        const options = tree();
        const key = value();
        if (options.byKey.has(key)) {
            const set = expandedSet();
            const missing = ancestorsOf(options, key).filter((step) => !set.has(step));
            if (missing.length > 0) store.set(path('expanded'), [...set, ...missing] as never);
            activeKey = key;
        } else activeKey = options.roots[0];
        isOpen = true;
        store.set(path('open'), true);
        render();
        popover.open();
    };
    const close = (): void => {
        if (!isOpen) return;
        isOpen = false;
        activeKey = undefined;
        popover?.close();
        store.set(path('open'), false);
        store.set(path('activeId'), '');
    };
    const choose = (row: TreeRow): void => {
        if (!choosable(row)) {
            setExpanded(row.key, !row.expanded);
            return;
        }
        if (!blocked() && value() !== row.key) store.set(path('value'), row.key);
        close();
    };
    const activate = (key: string | undefined): void => {
        if (key === undefined) return;
        activeKey = key;
        render();
    };

    const onKey = (event: KeyboardEvent): boolean => {
        if (!isOpen) {
            if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
                open();
                return true;
            }
            return false;
        }
        const index = shown.findIndex((row) => row.key === activeKey);
        const row = shown[index];
        switch (event.key) {
            case 'ArrowDown':
                activate(shown[Math.min(shown.length - 1, index + 1)]?.key);
                return true;
            case 'ArrowUp':
                activate(shown[Math.max(0, index - 1)]?.key);
                return true;
            case 'Home':
                activate(shown[0]?.key);
                return true;
            case 'End':
                activate(shown[shown.length - 1]?.key);
                return true;
            case 'ArrowRight':
                if (row?.hasChildren && !row.expanded) setExpanded(row.key, true);
                else if (row?.expanded) activate(shown[index + 1]?.key);
                return true;
            case 'ArrowLeft':
                if (row?.expanded) setExpanded(row.key, false);
                else if (row !== undefined) activate(tree().byKey.get(row.key)?.parent);
                return true;
            case 'Enter':
            case ' ':
                if (row !== undefined) choose(row);
                return true;
            case 'Escape':
                event.stopPropagation();
                close();
                return true;
            case 'Tab':
                close();
                return false;
            default: {
                if (event.key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey) return false;
                const letter = event.key.toLocaleLowerCase();
                const order = [...shown.slice(index + 1), ...shown.slice(0, index + 1)];
                activate(order.find((candidate) => candidate.label.toLocaleLowerCase().startsWith(letter))?.key);
                return true;
            }
        }
    };

    const watched = [path('options'), path('options.$all'), path('key'), path('parentField'), path('labelField'), path('expanded'), path('value'), path('leafOnly'), path('showPath')];
    let scheduled = false;
    /** A write to `options` raises one event per changed entry, so the tree is drawn once, from the settled state */
    const schedule = (): void => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            render();
        });
    };
    store.on(watched, schedule);
    render();

    host.commands = { ...host.commands, open, close };

    return {
        ...field,
        onToggle: (): void => {
            if (isOpen) close();
            else open();
        },
        onKeyDown: (event: KeyboardEvent): void => {
            if (onKey(event)) event.preventDefault();
        },
        onBlur: (): void => {
            field.onBlur();
            close();
        },
        // a press in the popup keeps the focus on the button
        onPopupDown: (event: Event): void => event.preventDefault(),
        onPick: (event: Event): void => {
            const nodes = event.composedPath();
            const target = nodes.find((node): node is HTMLElement => node instanceof HTMLElement && node.dataset['key'] !== undefined);
            const row = shown.find((candidate) => candidate.key === target?.dataset['key']);
            if (row === undefined) return;
            const onToggle = nodes.some((node) => node instanceof HTMLElement && node.dataset['toggle'] !== undefined);
            if (onToggle) {
                activeKey = row.key;
                setExpanded(row.key, !row.expanded);
            } else choose(row);
        },
        dispose: (): void => {
            store.off(watched, schedule);
            popover?.dispose();
            field.dispose();
        }
    };
}
