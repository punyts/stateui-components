import { registerMixin } from '@punyts/stateui';
import type { ControllerContext, Mixin } from '@punyts/stateui';

type Scope = Parameters<Mixin>[2];

interface CommandHost {
    commands?: Record<string, () => void>;
}

const read = (scope: Scope, name: string): unknown => scope.store.get(`${scope.basePath}.${name}`);

/** The element that has focus in the document, looking through open shadow roots */
export function deepActiveElement(root: Document | ShadowRoot): Element | null {
    const active = root.activeElement;
    return active?.shadowRoot ? (deepActiveElement(active.shadowRoot) ?? active) : active;
}

/**
 * `overlay` on a `<dialog>` in a component's view makes the `open` property of that component the open state of the
 * dialog. A write to `open`, by whoever, shows the dialog with `showModal()` (the page behind becomes inert and focus
 * moves in) or closes it (focus returns to the element that had it), and the component raises `open` or `close` once
 * per change of the value: the commands, the close button, Escape, a backdrop press and a plain state write all end in
 * the same write and so in the same single event. Escape and a press on the backdrop (the dialog element itself, which
 * the view's frame fills completely) close the dialog only while `dismissible` is not false; a dialog that is open at
 * load raises nothing. The dialog and its slots stay in the DOM while it is closed
 */
function overlayMixin(element: Element, _attrs: Readonly<Record<string, unknown>>, scope: Scope): () => void {
    const dialog = element as HTMLDialogElement;
    const openPath = `${scope.basePath}.open`;
    const wantsOpen = (): boolean => read(scope, 'open') === true;
    const dismissible = (): boolean => read(scope, 'dismissible') !== false;
    let last = wantsOpen();
    let opener: Element | null = null;
    let pressedBackdrop = false;
    let retry = false;
    let disposed = false;

    const host = (): Element | null => {
        const root = dialog.getRootNode();
        return root instanceof ShadowRoot ? root.host : null;
    };
    const raise = (name: 'open' | 'close'): void => {
        host()?.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
    };
    const show = (): void => {
        if (dialog.open) return;
        if (!dialog.isConnected) {
            if (retry) return;
            retry = true;
            requestAnimationFrame(() => {
                retry = false;
                if (!disposed) sync();
            });
            return;
        }
        opener = deepActiveElement(dialog.ownerDocument);
        dialog.showModal();
    };
    const hide = (): void => {
        if (!dialog.open) return;
        dialog.close();
        const target = opener;
        opener = null;
        if (target?.isConnected && deepActiveElement(dialog.ownerDocument) !== target) (target as HTMLElement).focus?.();
    };
    function sync(): void {
        const open = wantsOpen();
        if (open) show();
        else hide();
        if (open === last) return;
        last = open;
        raise(open ? 'open' : 'close');
    }
    const requestClose = (): void => {
        if (dismissible()) scope.store.set(openPath, false);
    };

    const onCancel = (event: Event): void => {
        event.preventDefault();
        requestClose();
    };
    const onNativeClose = (): void => {
        if (wantsOpen()) scope.store.set(openPath, false);
    };
    const onPointerDown = (event: Event): void => {
        pressedBackdrop = event.target === dialog;
    };
    const onClick = (event: Event): void => {
        const fromBackdrop = pressedBackdrop && event.target === dialog;
        pressedBackdrop = false;
        if (fromBackdrop) requestClose();
    };

    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onNativeClose);
    dialog.addEventListener('pointerdown', onPointerDown);
    dialog.addEventListener('click', onClick);
    const subscription = scope.subscribe(['$.open'], sync);
    if (last) show();
    return () => {
        disposed = true;
        subscription.dispose();
        dialog.removeEventListener('cancel', onCancel);
        dialog.removeEventListener('close', onNativeClose);
        dialog.removeEventListener('pointerdown', onPointerDown);
        dialog.removeEventListener('click', onClick);
        if (dialog.open) dialog.close();
    };
}

/** Registers the `overlay` attribute directive once; a second call is a no-op */
export function registerOverlayMixin(): void {
    try {
        registerMixin('overlay', overlayMixin as never);
    } catch (error) {
        if (!String(error).includes('already registered')) throw error;
    }
}

/**
 * The controller of `modal` and `drawer`: the commands `open`, `close` and `toggle` and the close button's handler
 * `onClose`, all of which only write `open`. Showing the dialog and raising `open` and `close` is the `overlay`
 * directive's job, so every path converges on one write
 */
export function createOverlayController({ element, store, basePath }: ControllerContext) {
    const host = element as Element & CommandHost;
    const openPath = `${basePath}.open`;
    const write = (value: boolean): void => {
        store.set(openPath, value);
    };
    const close = (): void => write(false);
    host.commands = {
        open: () => write(true),
        close,
        toggle: () => write((store.get(openPath) as unknown) !== true)
    };
    return {
        onClose: close,
        dispose: () => {
            delete host.commands;
        }
    };
}
