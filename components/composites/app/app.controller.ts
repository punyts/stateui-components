import type { ControllerContext } from '@punyts/stateui';

/**
 * Sets the document title from `_title` and follows it. An empty `_title` leaves the title the document had when the
 * app attached, and dispose puts that title back. The screens are not the app's children: the mount appends each one to
 * the layout host, so the app's `layout` places them by the screen root's `placement`
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const page = element.ownerDocument;
    const titlePath = `${basePath}._title`;
    const original = page.title;
    const apply = (): void => {
        const title = store.get<unknown>(titlePath);
        page.title = typeof title === 'string' && title !== '' ? title : original;
    };
    store.on(titlePath, apply);
    apply();
    return {
        dispose: () => {
            store.off(titlePath, apply);
            page.title = original;
        }
    };
}
