import type { ControllerContext } from '@punyts/stateui';

interface CommandHost {
    commands?: Record<string, (value?: unknown) => void>;
}

/**
 * Owns the shown tab. `active` is the author's choice and the first key stands in while it is empty or names no child;
 * the runtime `shown` holds the result, which the view reads. Every change of `shown` after mount, whoever wrote
 * `active`, raises `change` with the new key. Panels are hidden by the view, never removed, so their state survives
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as Element & CommandHost;
    const activePath = `${basePath}.active`;
    const childrenPath = `${basePath}.children`;
    const shownPath = `${basePath}.shown`;
    const keys = (): string[] => {
        const children = store.get<unknown>(childrenPath);
        return children !== null && typeof children === 'object' ? Object.keys(children) : [];
    };
    const resolve = (): string => {
        const all = keys();
        const active = store.get<unknown>(activePath);
        return typeof active === 'string' && all.includes(active) ? active : (all[0] ?? '');
    };
    let last = resolve();
    store.set(shownPath, last);
    const sync = (): void => {
        const shown = resolve();
        store.set(shownPath, shown);
        if (shown === last) return;
        last = shown;
        element.dispatchEvent(new CustomEvent('change', { detail: shown, bubbles: true, composed: true }));
    };
    const select = (key: string): void => {
        if (!keys().includes(key)) return;
        store.set(activePath, key);
    };
    const tabs = (): HTMLElement[] => Array.from(element.shadowRoot?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
    const target = (event: KeyboardEvent, from: HTMLElement[]): HTMLElement | undefined => {
        const index = from.findIndex((tab) => tab === event.target || tab.contains(event.target as Node));
        const vertical = store.get<unknown>(`${basePath}.orientation`) === 'vertical';
        const reversed = !vertical && getComputedStyle(element).direction === 'rtl';
        const next = vertical ? 'ArrowDown' : reversed ? 'ArrowLeft' : 'ArrowRight';
        const previous = vertical ? 'ArrowUp' : reversed ? 'ArrowRight' : 'ArrowLeft';
        if (event.key === 'Home') return from[0];
        if (event.key === 'End') return from[from.length - 1];
        if (index < 0) return undefined;
        if (event.key === next) return from[(index + 1) % from.length];
        if (event.key === previous) return from[(index - 1 + from.length) % from.length];
        return undefined;
    };
    host.commands = {
        select: (value?: unknown) => {
            if (typeof value === 'string' || typeof value === 'number') select(String(value));
        }
    };
    const watched = [activePath, childrenPath, `${childrenPath}.$all`];
    store.on(watched, sync);
    return {
        onTab: (event: Event) => {
            const key = (event.currentTarget as HTMLElement | null)?.dataset.key;
            if (key !== undefined) select(key);
        },
        onKeydown: (event: KeyboardEvent) => {
            const tab = target(event, tabs());
            if (!tab?.dataset.key) return;
            event.preventDefault();
            select(tab.dataset.key);
            tab.focus();
        },
        dispose: () => {
            store.off(watched, sync);
            delete host.commands;
        }
    };
}
