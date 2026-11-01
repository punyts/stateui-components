import type { ControllerContext } from '@punyts/stateui';
import { DEFAULT_MAX_LENGTH, parseMarkdown } from '../shared/markdown/markdown.js';
import type { MarkdownProfile } from '../shared/markdown/markdown.js';
import { renderMarkdown } from '../shared/markdown/render.js';

const wholeNumber = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback);

/**
 * Renders `_text` as Markdown into the view's `.markdown` element: the source goes through `parseMarkdown` and the tree is
 * built with `createElement` and `textContent` (`src/shared/markdown/render.ts`), so there is no HTML path and a raw tag in
 * the source is shown as its characters. A change of `_text`, `profile`, `headingOffset` or `maxLength` replaces the
 * rendered tree once per microtask, and only when one of the four differs from what is shown.
 *
 * A link is a `span` with `role="link"` and `data-href` and no `href`, so it cannot navigate or open a window. A click, or
 * Enter on the focused link, raises `press` with `{ href }`; the application may connect `press` to an `emit`. The source
 * is cut at a block boundary by `maxLength`, and the host gets `data-truncated` when it was cut
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const paths = ['profile', 'headingOffset', 'maxLength', '_text'].map((name) => `${basePath}.${name}`);
    let disposed = false;
    let scheduled = false;
    let target: HTMLElement | null = null;
    let shown = '';

    const render = (): void => {
        scheduled = false;
        if (disposed || target === null) return;
        const text = read('_text');
        const source = typeof text === 'string' ? text : '';
        const profile: MarkdownProfile = read('profile') === 'inline' ? 'inline' : 'basic';
        const headingOffset = Math.min(5, wholeNumber(read('headingOffset'), 1));
        const maxLength = wholeNumber(read('maxLength'), DEFAULT_MAX_LENGTH);
        const key = JSON.stringify([source, profile, headingOffset, maxLength]);
        if (key === shown) return;
        shown = key;
        const parsed = parseMarkdown(source, { profile, maxLength });
        renderMarkdown(target, parsed.children, { headingOffset }, profile === 'inline');
        element.toggleAttribute('data-truncated', parsed.truncated);
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

    //the view is drawn once the controller has returned, so the tree is first built in the next microtask
    const start = (attempts: number): void => {
        if (disposed) return;
        const part = element.shadowRoot?.querySelector<HTMLElement>('.markdown') ?? null;
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
