import type { ControllerContext } from '@punyts/stateui';
import { keysOf, planSteps } from '../shared/steps/steps.js';

type Entry = Record<string, unknown>;

interface Item {
    key: string;
    label: string;
    description: string;
    number: number;
    done: boolean;
    current: boolean;
    disabled: boolean;
}

interface CommandHost {
    commands?: Record<string, (value?: unknown) => void>;
}

const isEntry = (value: unknown): value is Entry => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Lays the steps out in the runtime property `items`, which the view draws: each step's number, whether it is
 * completed, whether it is the active one and whether the user can select it (with `linear`, not after the first step
 * that is not completed). A press on a step writes `active` and raises `select` with the step's key. The command
 * `complete` (`value`: a step key) adds the key to `completed`; a key that is already there stays once. `active` is the
 * author's choice: while it is empty or names no step, the first step is the active one and nothing is written.
 * `complete` stands in for an `append` system command: the `on` commands are `set`, `toggle` and `emit`, so there is no
 * way to add one key to a list from an `on` entry
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as Element & CommandHost;
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const itemsPath = `${basePath}.items`;
    const stepKeys = (): string[] => {
        const steps = read('steps');
        return isEntry(steps) ? Object.keys(steps) : [];
    };

    const draw = (): void => {
        const steps = read('steps');
        const keys = stepKeys();
        const items: Record<string, Item> = {};
        for (const step of planSteps(keys, read('active'), read('completed'), read('linear') !== false)) {
            const entry = isEntry(steps) ? steps[step.key] : undefined;
            const label = isEntry(entry) ? text(entry['_label']) : '';
            items[step.key] = {
                ...step,
                label: label !== '' ? label : step.key,
                description: isEntry(entry) ? text(entry['_description']) : ''
            };
        }
        store.set(itemsPath, items);
    };
    let scheduled = false;
    const schedule = (): void => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            draw();
        });
    };
    const watched = [
        `${basePath}.steps`,
        `${basePath}.steps.$all`,
        `${basePath}.active`,
        `${basePath}.completed`,
        `${basePath}.completed.$all`,
        `${basePath}.linear`,
        '$.locale'
    ];
    store.on(watched, schedule);
    draw();

    host.commands = {
        complete: (value?: unknown) => {
            const key = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
            if (!stepKeys().includes(key)) throw new Error(`stepper: no step has the key "${key}"`);
            const completed = keysOf(read('completed'));
            if (completed.includes(key)) return;
            store.set(`${basePath}.completed`, [...completed, key]);
        }
    };
    return {
        onPick: (event: Event) => {
            const key = (event.currentTarget as HTMLElement | null)?.dataset['key'];
            if (key === undefined) return;
            const item = store.get<Item | undefined>(`${itemsPath}.${key}`);
            if (!item || item.disabled || item.current) return;
            store.set(`${basePath}.active`, key);
            element.dispatchEvent(new CustomEvent('select', { detail: key, bubbles: true, composed: true }));
        },
        dispose: () => {
            store.off(watched, schedule);
            delete host.commands;
        }
    };
}
