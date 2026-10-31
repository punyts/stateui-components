import type { ControllerContext } from '@punyts/stateui';
import { watchRenderedOptions } from '../shared/field/options.js';
import { registerTipMixins } from '../shared/popover/tipMixin.js';

registerTipMixins();

interface CommandHost {
    commands?: Record<string, () => void>;
}

/**
 * Owns the choice. Single: the segments are `role="radio"` in a `radiogroup`, `value` is the chosen key (empty for none),
 * the chosen segment (else the first) is the one tab stop, and the arrow keys move focus and choose, wrapping. Multiple:
 * the segments are toggle buttons with `aria-pressed`, every one is a tab stop, and `value` is the list of chosen keys in
 * option order. Pressing the chosen segment of a single group changes nothing. `change` (`detail`: the new value) is
 * raised for what the user does, not for a write to `value`. With `iconOnly` the view names each segment by its label and
 * shows it as a tip (the `tip` directive, `src/shared/popover/`)
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const valuePath = `${basePath}.value`;
    const optionsPath = `${basePath}.options`;
    const multiple = (): boolean => store.get<unknown>(`${basePath}.multiple`) === true;
    const segments = (): HTMLButtonElement[] => Array.from(element.shadowRoot?.querySelectorAll<HTMLButtonElement>('.segment') ?? []);
    const keysOf = (): string[] => {
        const options = store.get<unknown>(optionsPath);
        return options !== null && typeof options === 'object' ? Object.keys(options) : [];
    };
    const chosen = (): Set<string> => {
        const value = store.get<unknown>(valuePath);
        if (multiple()) return new Set(Array.isArray(value) ? value.map(String) : []);
        return new Set(value === null || value === undefined || value === '' ? [] : [String(value)]);
    };

    const sync = (): void => {
        const on = chosen();
        const all = segments();
        const group = multiple();
        const stop = all.find((segment) => on.has(segment.dataset.key ?? '') && !segment.disabled) ?? all.find((segment) => !segment.disabled);
        for (const segment of all) {
            const active = on.has(segment.dataset.key ?? '');
            segment.removeAttribute(group ? 'aria-checked' : 'aria-pressed');
            segment.setAttribute(group ? 'aria-pressed' : 'aria-checked', active ? 'true' : 'false');
            segment.tabIndex = group || segment === stop ? 0 : -1;
        }
    };
    const resync = (): void => queueMicrotask(sync);
    const watched = [valuePath, `${basePath}.multiple`, `${basePath}.disabled`, optionsPath, `${optionsPath}.$all`];
    store.on(watched, resync);
    resync();
    const stopWatching = watchRenderedOptions(element, sync);

    const raise = (value: unknown): void => {
        element.dispatchEvent(new CustomEvent('change', { detail: value, bubbles: true, composed: true }));
    };
    const pick = (key: string): void => {
        if (multiple()) {
            const on = chosen();
            if (on.has(key)) on.delete(key);
            else on.add(key);
            const value = keysOf().filter((candidate) => on.has(candidate));
            store.set(valuePath, value);
            raise(value);
            return;
        }
        if (chosen().has(key)) return;
        store.set(valuePath, key);
        raise(key);
    };

    const host = element as Element & CommandHost;
    host.commands = {
        focus: () => (segments().find((segment) => segment.tabIndex === 0 && !segment.disabled) ?? segments().find((segment) => !segment.disabled))?.focus()
    };
    return {
        onPick: (event: Event) => {
            const key = (event.currentTarget as HTMLElement | null)?.dataset.key;
            if (key !== undefined) pick(key);
        },
        onKeyDown: (event: KeyboardEvent) => {
            if (multiple()) return;
            const enabled = segments().filter((segment) => !segment.disabled);
            const index = enabled.findIndex((segment) => segment === event.target || segment.contains(event.target as Node));
            if (index < 0) return;
            const reversed = getComputedStyle(element).direction === 'rtl';
            const next = event.key === 'ArrowDown' || event.key === (reversed ? 'ArrowLeft' : 'ArrowRight');
            const previous = event.key === 'ArrowUp' || event.key === (reversed ? 'ArrowRight' : 'ArrowLeft');
            if (!next && !previous) return;
            event.preventDefault();
            const target = enabled[(index + (next ? 1 : -1) + enabled.length) % enabled.length];
            const key = target?.dataset.key;
            if (!target || key === undefined) return;
            pick(key);
            target.focus();
        },
        dispose: () => {
            store.off(watched, resync);
            stopWatching();
            delete host.commands;
        }
    };
}
