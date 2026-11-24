import type { ControllerContext } from '@punyts/stateui';
import { createPopover } from '../shared/popover/popover.js';
import type { PopoverHandle } from '../shared/popover/popover.js';
import { nodeElement, stepAfter, tourPosition, tourSteps } from '../shared/tour/tourModel.js';

interface CommandHost {
    commands?: Record<string, () => void>;
}

/** The room the ring leaves around the node it marks, in pixels */
const RING_PADDING = 4;
/** How many frames to wait for a step's node to be drawn (a screen that is still mounting) before showing it unanchored */
const FIND_FRAMES = 30;

/**
 * Walks through the keyed `steps` one at a time. The progress is state: `step` is the key of the step shown and `done`
 * is set when the tour is finished or skipped, so a person's instance remembers both. The tour runs while `step` names
 * a step and `done` is false; `start` begins at the first step. Each step's `target` is the state path of a node
 * (`$.screens.home.children.search`): the controller finds the element drawn for it through the open shadow roots,
 * scrolls it into view and measures it, puts a ring around it and anchors the card beside it on the step's `side`
 * (the card flips to stay on screen). A target that is not drawn after half a second shows the card in the middle.
 * The ring follows scrolling and resizing. The card is a non-modal dialog that takes the focus on each step and gives it
 * back when the tour ends; Escape skips. `change` is raised with the step's key on each move and `finish` with
 * `{ skipped }` once at the end
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as Element & CommandHost;
    const path = (name: string): string => `${basePath}.${name}`;
    const read = (name: string): unknown => store.get<unknown>(path(name));
    const write = (name: string, value: unknown): void => {
        if (read(name) !== value) store.set(path(name), value);
    };
    const part = (selector: string): HTMLElement | null => element.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
    const steps = () => tourSteps(read('steps'));
    const raise = (name: string, detail?: unknown): void => {
        element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
    };

    let ring: PopoverHandle | undefined;
    let card: PopoverHandle | undefined;
    const handles = (): boolean => {
        const ringElement = part('.ring');
        const cardElement = part('.card');
        if (!ringElement || !cardElement) return false;
        ring ??= createPopover({ element: ringElement, dismissible: () => false });
        card ??= createPopover({ element: cardElement, dismissible: () => false });
        return true;
    };

    let target: Element | undefined;
    let frame = 0;
    const place = (): void => {
        frame = 0;
        const box = part('.ring');
        if (!target || !box || !target.isConnected) return;
        const rect = target.getBoundingClientRect();
        box.style.setProperty('--sui-x', `${rect.left - RING_PADDING}px`);
        box.style.setProperty('--sui-y', `${rect.top - RING_PADDING}px`);
        box.style.setProperty('--sui-w', `${rect.width + RING_PADDING * 2}px`);
        box.style.setProperty('--sui-h', `${rect.height + RING_PADDING * 2}px`);
    };
    const follow = (): void => {
        if (frame === 0) frame = requestAnimationFrame(place);
    };
    let following = false;
    const listen = (on: boolean): void => {
        if (on === following) return;
        following = on;
        const view = element.ownerDocument.defaultView;
        if (on) {
            view?.addEventListener('scroll', follow, true);
            view?.addEventListener('resize', follow);
        } else {
            view?.removeEventListener('scroll', follow, true);
            view?.removeEventListener('resize', follow);
            if (frame !== 0) cancelAnimationFrame(frame);
            frame = 0;
        }
    };

    let returnFocus: HTMLElement | null = null;
    let search = 0;
    let shownKey = '';
    let running = false;
    const show = (attempt: number): void => {
        search = 0;
        const position = tourPosition(steps(), read('step'), read('done'));
        if (!position) return;
        const found = nodeElement(element.ownerDocument, position.step.target);
        if (!found && position.step.target !== '' && attempt < FIND_FRAMES) {
            search = requestAnimationFrame(() => show(attempt + 1));
            return;
        }
        target = found;
        write('found', found !== undefined);
        ring?.close();
        if (found) {
            found.scrollIntoView({ block: 'center', inline: 'nearest' });
            place();
            ring?.open();
        }
        card?.close();
        card?.open();
        part('.next')?.focus();
    };

    const sync = (): void => {
        const list = steps();
        const position = tourPosition(list, read('step'), read('done'));
        write('running', position !== undefined);
        write('first', position?.first ?? true);
        write('last', position?.last ?? false);
        write('side', position?.step.side ?? 'bottom');
        write('title', position?.step.title ?? '');
        write('text', position?.step.text ?? '');
        const template = typeof read('_progress') === 'string' ? (read('_progress') as string) : '';
        write('progressText', position ? template.replace('{index}', String(position.index)).replace('{count}', String(position.count)) : '');
        if (!position) {
            if (search !== 0) cancelAnimationFrame(search);
            search = 0;
            target = undefined;
            ring?.close();
            card?.close();
            listen(false);
            shownKey = '';
            if (running) returnFocus?.focus();
            running = false;
            returnFocus = null;
            return;
        }
        if (!handles()) return;
        if (!running) {
            const active = element.ownerDocument.activeElement;
            returnFocus = active instanceof HTMLElement ? active : null;
        }
        running = true;
        listen(true);
        if (position.step.key === shownKey) return;
        shownKey = position.step.key;
        if (search !== 0) cancelAnimationFrame(search);
        show(0);
    };
    const watched = [path('steps'), path('steps.$all'), path('step'), path('done'), path('_progress')];
    store.on(watched, sync);
    queueMicrotask(sync);

    const go = (key: string): void => {
        write('step', key);
        raise('change', key);
    };
    const finish = (skipped: boolean): void => {
        if (!tourPosition(steps(), read('step'), read('done'))) return;
        write('done', true);
        raise('finish', { skipped });
    };
    const next = (): void => {
        const key = stepAfter(steps(), read('step'), 1);
        if (key === undefined) finish(false);
        else go(key);
    };
    const back = (): void => {
        const key = stepAfter(steps(), read('step'), -1);
        if (key !== undefined) go(key);
    };
    host.commands = {
        start: () => {
            const first = steps()[0];
            if (!first) return;
            write('done', false);
            go(first.key);
        },
        next,
        back,
        skip: () => finish(true)
    };
    return {
        onNext: next,
        onBack: back,
        onSkip: () => finish(true),
        onKeyDown: (event: KeyboardEvent): void => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            finish(true);
        },
        dispose: (): void => {
            store.off(watched, sync);
            if (search !== 0) cancelAnimationFrame(search);
            listen(false);
            ring?.dispose();
            card?.dispose();
            delete host.commands;
        }
    };
}
