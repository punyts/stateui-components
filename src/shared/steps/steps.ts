/** What a step looks like for a given progress */
export interface StepPlan {
    readonly key: string;
    /** 1-based position, shown when the step is not completed */
    readonly number: number;
    /** The key is in `completed` */
    readonly done: boolean;
    /** The step is the active one */
    readonly current: boolean;
    /** The user cannot select the step: a `linear` stepper blocks every step after the first incomplete one */
    readonly disabled: boolean;
}

/** The keys of a list value, as text; anything else is an empty list */
export function keysOf(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string | number => typeof item === 'string' || typeof item === 'number').map(String);
}

/** The active key: `active` when it names a step, otherwise the first step (empty without steps) */
export function currentStep(keys: readonly string[], active: unknown): string {
    const wanted = typeof active === 'string' || typeof active === 'number' ? String(active) : '';
    return keys.includes(wanted) ? wanted : (keys[0] ?? '');
}

/**
 * The plan of every step in order. With `linear`, the steps after the first one that is not completed are disabled (the
 * first incomplete step itself, and every completed one, can be selected); without it nothing is disabled
 */
export function planSteps(keys: readonly string[], active: unknown, completed: unknown, linear: boolean): StepPlan[] {
    const done = new Set(keysOf(completed));
    const current = currentStep(keys, active);
    const firstIncomplete = keys.findIndex((key) => !done.has(key));
    const reach = firstIncomplete < 0 ? keys.length : firstIncomplete;
    return keys.map((key, index) => ({
        key,
        number: index + 1,
        done: done.has(key),
        current: key === current,
        disabled: linear && index > reach
    }));
}
