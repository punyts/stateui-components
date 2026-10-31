import type { ControllerContext } from '@punyts/stateui';

/**
 * Sets the document title from `_title` and follows it. An empty `_title` leaves the title the document had when the
 * page attached, and dispose puts that title back
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const page = element.ownerDocument;
    const titlePath = `${basePath}._title`;
    const original = page.title;
    const apply = (): void => {
        const title = store.get<unknown>(titlePath);
        page.title = typeof title === 'string' && title !== '' ? title : original;
    };
    store.on([titlePath], apply);
    apply();
    return {
        dispose: () => {
            store.off([titlePath], apply);
            page.title = original;
        }
    };
}
