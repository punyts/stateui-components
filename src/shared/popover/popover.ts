/** Where a popover sits next to its anchor. `start` and `end` follow the writing direction */
export const PLACEMENTS = ['top', 'bottom', 'start', 'end'] as const;

export type Placement = (typeof PLACEMENTS)[number];

/** A side of the anchor plus the edge the popover lines up with: `bottomStart` sits below and starts at the anchor's start edge */
export const ALIGNED_PLACEMENTS = ['bottomStart', 'bottomEnd', 'topStart', 'topEnd'] as const;

export type AlignedPlacement = (typeof ALIGNED_PLACEMENTS)[number];

/** Every value `createPopover` takes as a placement */
export type AnyPlacement = Placement | AlignedPlacement;

/** Why a popover closed itself: the Escape key, or a press outside it and its trigger */
export type PopoverDismissReason = 'escape' | 'outside';

export interface PopoverOptions {
    /** The element to show; it gets `popover="manual"` when it has no `popover` attribute. It must be connected to open */
    readonly element: HTMLElement;
    /** The side of the anchor to sit on; without it the element keeps whatever `position-area` its stylesheet gives */
    readonly placement?: AnyPlacement;
    /** The CSS anchor name (`--name`) the element positions against; the anchor itself declares `anchor-name` in CSS */
    readonly anchor?: string;
    /** Elements whose presses are not outside presses (the trigger), because they toggle the popover themselves */
    readonly inside?: readonly EventTarget[];
    /** Runs after the popover dismissed itself (not after `close()`) */
    readonly onDismiss?: (reason: PopoverDismissReason) => void;
}

export interface PopoverHandle {
    /** Shows the element in the top layer; does nothing when it is open or not connected */
    open(): void;
    /** Hides the element; does nothing when it is closed */
    close(): void;
    isOpen(): boolean;
    /** Moves the element to another side of its anchor, while open or not */
    setPlacement(placement: AnyPlacement): void;
    /** Points the element at another anchor name */
    setAnchor(anchor: string): void;
    /** Closes the popover and removes every listener; the handle does nothing afterwards */
    dispose(): void;
}

const POSITION_AREAS: Readonly<Record<Placement, string>> = {
    top: 'top',
    bottom: 'bottom',
    start: 'inline-start',
    end: 'inline-end'
};

const ALIGNED_AREAS: Readonly<Record<AlignedPlacement, string>> = {
    bottomStart: 'block-end span-inline-end',
    bottomEnd: 'block-end span-inline-start',
    topStart: 'block-start span-inline-end',
    topEnd: 'block-start span-inline-start'
};

const ANCHOR_NAME = /^--[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * The CSS `position-area` value of a placement: `top` and `bottom` as they are, `start` and `end` as `inline-start` and
 * `inline-end`, and an aligned placement as the side plus the span that keeps the popover on the named edge
 */
export function positionAreaOf(placement: AnyPlacement): string {
    return isAlignedPlacement(placement) ? ALIGNED_AREAS[placement] : POSITION_AREAS[placement];
}

/** True for one of the four aligned placements (`bottomStart`, `bottomEnd`, `topStart`, `topEnd`) */
export function isAlignedPlacement(value: unknown): value is AlignedPlacement {
    return typeof value === 'string' && (ALIGNED_PLACEMENTS as readonly string[]).includes(value);
}

/** True for one of the four placements */
export function isPlacement(value: unknown): value is Placement {
    return typeof value === 'string' && (PLACEMENTS as readonly string[]).includes(value);
}

/** True for a CSS dashed identifier such as `--menu-anchor` */
export function isAnchorName(value: unknown): value is string {
    return typeof value === 'string' && ANCHOR_NAME.test(value);
}

/**
 * Opens and closes `options.element` with the popover API and positions it with CSS anchor positioning: the
 * placement becomes `position-area` and the anchor name becomes `position-anchor`, both as inline styles, so the
 * browser places it and keeps it in place when the anchor moves. Nothing here reads layout.
 *
 * While open it listens on the document for Escape and for presses outside the element and `inside`, and closes
 * itself on either. It does not depend on a component: any element in a document can be a popover
 *
 * @throws TypeError when `anchor` is not a dashed identifier or `placement` is not a placement
 */
export function createPopover(options: PopoverOptions): PopoverHandle {
    const { element, inside = [], onDismiss } = options;
    const document = element.ownerDocument;
    let disposed = false;
    let listening = false;

    if (!element.hasAttribute('popover')) element.setAttribute('popover', 'manual');

    const setPlacement = (placement: AnyPlacement): void => {
        if (!isPlacement(placement) && !isAlignedPlacement(placement)) throw new TypeError(`Unknown popover placement "${String(placement)}"`);
        element.style.setProperty('position-area', positionAreaOf(placement));
    };
    const setAnchor = (anchor: string): void => {
        if (!isAnchorName(anchor)) throw new TypeError(`A popover anchor is a dashed identifier such as "--anchor", got "${String(anchor)}"`);
        element.style.setProperty('position-anchor', anchor);
    };
    if (options.placement !== undefined) setPlacement(options.placement);
    if (options.anchor !== undefined) setAnchor(options.anchor);

    const isOpen = (): boolean => element.matches(':popover-open');

    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return;
        close();
        onDismiss?.('escape');
    };
    const onPointerDown = (event: PointerEvent): void => {
        const path = event.composedPath();
        if (path.includes(element) || inside.some((target) => path.includes(target))) return;
        close();
        onDismiss?.('outside');
    };

    const unlisten = (): void => {
        if (!listening) return;
        listening = false;
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('pointerdown', onPointerDown, true);
    };

    function open(): void {
        if (disposed || !element.isConnected || isOpen()) return;
        element.showPopover();
        if (listening) return;
        listening = true;
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('pointerdown', onPointerDown, true);
    }
    function close(): void {
        unlisten();
        if (isOpen()) element.hidePopover();
    }

    return {
        open,
        close,
        isOpen,
        setPlacement,
        setAnchor,
        dispose: () => {
            close();
            disposed = true;
        }
    };
}
