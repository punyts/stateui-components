/** A step of a tour as its node holds it */
export interface TourStep {
    readonly key: string;
    readonly target: string;
    readonly side: 'bottom' | 'top' | 'start' | 'end';
    readonly title: string;
    readonly text: string;
}

/** Where a tour stands: the step shown, its place among the steps, or nothing when the tour is not running */
export interface TourPosition {
    readonly step: TourStep;
    /** From 1 */
    readonly index: number;
    readonly count: number;
    readonly first: boolean;
    readonly last: boolean;
}

const SIDES = new Set(['bottom', 'top', 'start', 'end']);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The steps of a `steps` map in order; an entry that is not an object is left out */
export function tourSteps(steps: unknown): TourStep[] {
    if (!isRecord(steps)) return [];
    return Object.keys(steps).flatMap((key) => {
        const step = steps[key];
        if (!isRecord(step)) return [];
        const side = SIDES.has(step['side'] as string) ? (step['side'] as TourStep['side']) : 'bottom';
        return [{ key, target: text(step['target']), side, title: text(step['_title']), text: text(step['_text']) }];
    });
}

/** The position of `step` among `steps` while the tour runs: not done, and `step` names one of them */
export function tourPosition(steps: readonly TourStep[], step: unknown, done: unknown): TourPosition | undefined {
    if (done === true) return undefined;
    const index = steps.findIndex((candidate) => candidate.key === step);
    if (index < 0) return undefined;
    return { step: steps[index] as TourStep, index: index + 1, count: steps.length, first: index === 0, last: index === steps.length - 1 };
}

/** The key of the step `by` places from `step` (1 next, -1 back), or undefined past either end */
export function stepAfter(steps: readonly TourStep[], step: unknown, by: 1 | -1): string | undefined {
    const index = steps.findIndex((candidate) => candidate.key === step);
    if (index < 0) return undefined;
    return steps[index + by]?.key;
}

/**
 * The element a node is drawn as: the component element inside the `sui-node` whose `state` is `path`, looked for
 * through every open shadow root under `root`. A `sui-node` without a component element is returned itself
 */
export function nodeElement(root: ParentNode, path: string): Element | undefined {
    if (path === '') return undefined;
    const stack: ParentNode[] = [root];
    while (stack.length > 0) {
        const scope = stack.pop() as ParentNode;
        for (const node of Array.from(scope.querySelectorAll('sui-node'))) {
            if (node.getAttribute('state') === path) return node.firstElementChild ?? node;
        }
        for (const element of Array.from(scope.querySelectorAll('*'))) {
            if (element.shadowRoot) stack.push(element.shadowRoot);
        }
    }
    return undefined;
}
