import type { ControllerContext } from '@punyts/stateui';
import { storedFileUrl } from '../shared/field/files.js';
import { readRichText } from '../shared/richtext/model.js';
import { renderRichText } from '../shared/richtext/render.js';

const wholeNumber = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback);

/**
 * Draws `value`, a rich-text value, into the view's `.rich-text` element: the value is read with `readRichText` (blocks in
 * order, every field checked, unsafe links dropped) and built with `createElement` and text nodes
 * (`src/shared/richtext/render.ts`), so nothing in it is read as markup. A change of `value` or anything inside it,
 * `headingOffset` or `_empty` redraws once per microtask, and only when what would be shown differs from what is.
 * With no blocks the element shows `_empty` and the host gets `data-empty`.
 *
 * A link is a `span` with `role="link"` and `data-href` and no `href`, so it cannot navigate. A click, or Enter on the
 * focused link, raises `press` with `{ href }`, as `markdown` does
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const paths = [`${basePath}.value`, `${basePath}.value.$all`, `${basePath}.headingOffset`, `${basePath}._empty`];
    let disposed = false;
    let scheduled = false;
    let target: HTMLElement | null = null;
    let shown = '';

    const render = (): void => {
        scheduled = false;
        if (disposed || target === null) return;
        const blocks = readRichText(read('value'));
        const headingOffset = Math.min(5, wholeNumber(read('headingOffset'), 1));
        const empty = typeof read('_empty') === 'string' ? (read('_empty') as string) : '';
        const key = JSON.stringify([blocks, headingOffset, blocks.length === 0 ? empty : '']);
        if (key === shown) return;
        shown = key;
        element.toggleAttribute('data-empty', blocks.length === 0);
        if (blocks.length === 0) {
            const note = target.ownerDocument.createElement('p');
            note.className = 'empty';
            note.textContent = empty;
            target.replaceChildren(...(empty === '' ? [] : [note]));
            return;
        }
        renderRichText(target, blocks, { headingOffset, fileUrl: (id) => storedFileUrl(element, id) });
    };
    const schedule = (): void => {
        if (scheduled || disposed) return;
        scheduled = true;
        queueMicrotask(render);
    };

    const press = (event: Event): void => {
        const link = event.target instanceof Element ? event.target.closest<HTMLElement>('[role=link]') : null;
        if (link === null || target === null || !target.contains(link)) return;
        event.preventDefault();
        element.dispatchEvent(new CustomEvent('press', { detail: { href: link.dataset['href'] ?? '' }, bubbles: true, composed: true }));
    };
    const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey) press(event);
    };

    store.on(paths, schedule);

    //the view is drawn once the controller has returned, so the blocks are first drawn in the next microtask
    const start = (attempts: number): void => {
        if (disposed) return;
        const part = element.shadowRoot?.querySelector<HTMLElement>('.rich-text') ?? null;
        if (part === null) {
            if (attempts > 0) queueMicrotask(() => start(attempts - 1));
            return;
        }
        target = part;
        part.addEventListener('click', press);
        part.addEventListener('keydown', onKey);
        render();
    };
    queueMicrotask(() => start(8));

    return {
        dispose: () => {
            disposed = true;
            store.off(paths, schedule);
            target?.removeEventListener('click', press);
            target?.removeEventListener('keydown', onKey);
            target?.replaceChildren();
            target = null;
        }
    };
}
