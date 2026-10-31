import { registerMixin } from '@punyts/stateui';
import type { Mixin } from '@punyts/stateui';
import { createPopover, isPlacement } from './popover.js';
import type { Placement } from './popover.js';
import { DEFAULT_TIP_DELAY, attachTip } from './tip.js';

/** The anchor name the trigger declares and the tip positions against; anchor names are scoped to the shadow tree */
export const TIP_ANCHOR = '--t';

type Scope = Parameters<Mixin>[2];

const FOCUSABLE = 'button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

const read = (scope: Scope, name: string): unknown => scope.store.get(`${scope.basePath}.${name}`);

/**
 * The element that carries the accessible description of a trigger: the first focusable element inside it, looking
 * through open shadow roots (a `button` component keeps its native button in its shadow root), or the trigger
 * itself when nothing inside can take focus
 */
export function describedElement(trigger: Element): Element {
    const visit = (root: ParentNode): Element | undefined => {
        for (const child of Array.from(root.children)) {
            if (child.matches(FOCUSABLE)) return child;
            const inner = (child.shadowRoot ? visit(child.shadowRoot) : undefined) ?? visit(child);
            if (inner) return inner;
        }
        return undefined;
    };
    return visit(trigger) ?? trigger;
}

/**
 * `tip="<mode>"` on a popover element makes the element before it the trigger of a tip. The tip shows after the
 * `delay` property on hover and at once on focus, hides on pointer leave, blur and Escape, and sits on the side
 * named by the `side` property (when the node has one; otherwise the element's own `position-area` rules).
 * With the value `iconOnly` it is on only while `iconPosition` is `only`, and `delay` is the default delay
 */
function tipMixin(element: Element, attrs: Readonly<Record<string, unknown>>, scope: Scope): () => void {
    const tip = element as HTMLElement;
    const trigger = tip.previousElementSibling;
    if (!trigger) return () => undefined;
    const iconOnly = attrs.tip === 'iconOnly';
    const placementOf = (): Placement | undefined => {
        const value = read(scope, 'side');
        return isPlacement(value) ? value : undefined;
    };
    const popover = createPopover({ element: tip, placement: placementOf(), anchor: TIP_ANCHOR, inside: [trigger] });
    const behaviour = attachTip({
        target: trigger,
        popover,
        delay: () => {
            const value = read(scope, 'delay');
            return typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_TIP_DELAY;
        },
        enabled: () => !iconOnly || read(scope, 'iconPosition') === 'only'
    });
    const subscription = scope.subscribe(['$.side'], () => {
        const placement = placementOf();
        if (placement) popover.setPlacement(placement);
    });
    return () => {
        subscription.dispose();
        behaviour.dispose();
        popover.dispose();
    };
}

/**
 * `tip-describes="<property>"` on the popover element describes the trigger before it with the text of that property,
 * as `aria-description` on the trigger's focusable element. An `aria-describedby` cannot reach a popover in the
 * component's shadow root, and the browser takes `aria-description` through the shadow boundary of the trigger's own
 * component. The description follows the property (a language switch included) and is removed on dispose
 */
function describesMixin(element: Element, attrs: Readonly<Record<string, unknown>>, scope: Scope): () => void {
    const trigger = element.previousElementSibling;
    const name = String(attrs['tip-describes']);
    if (!trigger) return () => undefined;
    let described: Element | undefined;
    const apply = (): void => {
        const value = read(scope, name);
        const text = typeof value === 'string' ? value : '';
        const target = describedElement(trigger);
        if (described && described !== target) described.removeAttribute('aria-description');
        described = target;
        if (text === '') target.removeAttribute('aria-description');
        else if (target.getAttribute('aria-description') !== text) target.setAttribute('aria-description', text);
    };
    const subscription = scope.subscribe([`$.${name}`], apply);
    const observer = new MutationObserver(apply);
    observer.observe(trigger, { childList: true, subtree: true });
    apply();
    return () => {
        subscription.dispose();
        observer.disconnect();
        described?.removeAttribute('aria-description');
    };
}

/** Registers the `tip` and `tip-describes` attribute directives once; a second call is a no-op */
export function registerTipMixins(): void {
    for (const [name, mixin] of [
        ['tip', tipMixin],
        ['tip-describes', describesMixin]
    ] as const) {
        try {
            registerMixin(name, mixin as never);
        } catch (error) {
            if (!String(error).includes('already registered')) throw error;
        }
    }
}
