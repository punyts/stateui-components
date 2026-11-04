import type { ControllerContext } from '@punyts/stateui';

/**
 * Sets the document title from `_title` and follows it. An empty `_title` leaves the title the document had when the
 * page attached, and dispose puts that title back.
 *
 * Owns the responsive nav. The runtime property `compact` is true while `navPosition` is `start`, a `nav` is set,
 * `navBreakpoint` is above 0 and the page is narrower than `navBreakpoint` pixels (the width of the page element, not of
 * the window; an element with no box, such as a hidden page, leaves it as it was). A compact page draws a bar with a
 * menu button (`aria-expanded`, `aria-controls`) and shows the nav as a panel only while `navOpen` is true. The button
 * toggles `navOpen`; a press on the scrim, Escape (focus goes back to the button) and a `select` or `press` from inside
 * the nav close it. A page that stops being compact closes the nav. `navOpen` is plain state, so an agent can write it
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const page = element.ownerDocument;
    const titlePath = `${basePath}._title`;
    const compactPath = `${basePath}.compact`;
    const openPath = `${basePath}.navOpen`;
    const original = page.title;
    const apply = (): void => {
        const title = store.get<unknown>(titlePath);
        page.title = typeof title === 'string' && title !== '' ? title : original;
    };

    let width = 0;
    const evaluate = (): void => {
        const breakpoint = store.get<unknown>(`${basePath}.navBreakpoint`);
        const limit = typeof breakpoint === 'number' ? breakpoint : 768;
        const compact =
            width > 0 &&
            limit > 0 &&
            width < limit &&
            store.get<unknown>(`${basePath}.navPosition`) === 'start' &&
            Boolean(store.get<unknown>(`${basePath}.nav`));
        if (store.get<unknown>(compactPath) === compact) return;
        store.set(compactPath, compact);
        if (!compact && store.get<unknown>(openPath) === true) store.set(openPath, false);
    };
    const isCompact = (): boolean => store.get<unknown>(compactPath) === true;
    const isOpen = (): boolean => store.get<unknown>(openPath) === true;
    const close = (): void => {
        if (isOpen()) store.set(openPath, false);
    };

    const watched = [titlePath, `${basePath}.navBreakpoint`, `${basePath}.navPosition`, `${basePath}.nav`];
    const follow = (): void => {
        apply();
        evaluate();
    };
    store.on(watched, follow);
    apply();
    let frame = 0;
    const observer = new ResizeObserver((entries) => {
        const box = entries[entries.length - 1]?.contentRect;
        if (box === undefined || box.width <= 0) return;
        width = box.width;
        if (frame !== 0) return;
        // the layout change of compact must not land inside the observer callback (a resize loop)
        frame = requestAnimationFrame(() => {
            frame = 0;
            evaluate();
        });
    });
    observer.observe(element);
    return {
        onToggleNav: () => store.set(openPath, !isOpen()),
        onCloseNav: close,
        onNavChosen: () => {
            if (isCompact()) close();
        },
        onKeyDown: (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || !isCompact() || !isOpen()) return;
            event.preventDefault();
            close();
            element.shadowRoot?.querySelector<HTMLElement>('.toggle')?.focus();
        },
        dispose: () => {
            observer.disconnect();
            if (frame !== 0) cancelAnimationFrame(frame);
            store.off(watched, follow);
            page.title = original;
        }
    };
}
