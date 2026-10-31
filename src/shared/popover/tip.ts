import type { PopoverHandle } from './popover.js';

/** How long a pointer must rest on a trigger before its tip shows, in milliseconds */
export const DEFAULT_TIP_DELAY = 500;

export interface TipOptions {
    /** The trigger region: pointer and focus events inside it (shadow trees included) drive the tip */
    readonly target: Element;
    readonly popover: PopoverHandle;
    /** The delay for pointer hover, read on each hover so a change of `delay` applies at once; `0` shows without waiting */
    readonly delay: () => number;
    /** False while the tip is switched off (an icon button that stopped being icon-only); nothing shows then */
    readonly enabled?: () => boolean;
}

export interface Tip {
    /** Cancels a pending show and hides the tip */
    hide(): void;
    /** Removes the listeners and the pending timer */
    dispose(): void;
}

/**
 * Shows a tip on pointer hover after `delay` and at once when the trigger takes focus; hides it on pointer leave and
 * blur. Escape while the tip is open is the popover's own business; Escape while a show is pending cancels it here.
 * A touch pointer never starts the timer: a tip that appears under a finger covers the trigger
 */
export function attachTip({ target, popover, delay, enabled = () => true }: TipOptions): Tip {
    const document = target.ownerDocument;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onPendingKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') cancel();
    };
    function cancel(): void {
        if (timer === undefined) return;
        clearTimeout(timer);
        timer = undefined;
        document.removeEventListener('keydown', onPendingKey, true);
    }
    const show = (): void => {
        cancel();
        if (enabled()) popover.open();
    };
    const hide = (): void => {
        cancel();
        popover.close();
    };
    const onEnter = (event: Event): void => {
        if ((event as PointerEvent).pointerType === 'touch') return;
        cancel();
        const wait = delay();
        if (wait <= 0) {
            show();
            return;
        }
        timer = setTimeout(show, wait);
        document.addEventListener('keydown', onPendingKey, true);
    };

    target.addEventListener('pointerenter', onEnter);
    target.addEventListener('pointerleave', hide);
    target.addEventListener('focusin', show);
    target.addEventListener('focusout', hide);

    return {
        hide,
        dispose: () => {
            hide();
            target.removeEventListener('pointerenter', onEnter);
            target.removeEventListener('pointerleave', hide);
            target.removeEventListener('focusin', show);
            target.removeEventListener('focusout', hide);
        }
    };
}
