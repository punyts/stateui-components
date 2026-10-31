import { describe, expect, it } from 'vitest';
import { currentStep, keysOf, planSteps } from './steps.js';

const keys = ['details', 'options', 'review'];

describe('currentStep', () => {
    it('should name the active step, and the first one when active is empty or unknown', () => {
        // Assert
        expect(currentStep(keys, 'options')).toBe('options');
        expect(currentStep(keys, '')).toBe('details');
        expect(currentStep(keys, 'missing')).toBe('details');
        expect(currentStep([], 'a')).toBe('');
    });
});

describe('keysOf', () => {
    it('should read a list of keys as text and anything else as none', () => {
        // Assert
        expect(keysOf(['a', 2, null, {}])).toEqual(['a', '2']);
        expect(keysOf('a')).toEqual([]);
        expect(keysOf(undefined)).toEqual([]);
    });
});

describe('planSteps', () => {
    it('should number the steps from 1 and mark the current one', () => {
        // Act
        const plan = planSteps(keys, 'options', [], false);

        // Assert
        expect(plan.map((step) => step.number)).toEqual([1, 2, 3]);
        expect(plan.map((step) => step.current)).toEqual([false, true, false]);
    });

    it('should disable every step after the first incomplete one when linear', () => {
        // Assert
        expect(planSteps(keys, '', [], true).map((step) => step.disabled)).toEqual([false, true, true]);
        expect(planSteps(keys, '', ['details'], true).map((step) => step.disabled)).toEqual([false, false, true]);
        expect(planSteps(keys, '', ['details', 'options'], true).map((step) => step.disabled)).toEqual([false, false, false]);
    });

    it('should keep a completed step before an incomplete one selectable, whatever the order of completion', () => {
        // Act
        const plan = planSteps(keys, '', ['review'], true);

        // Assert
        expect(plan.map((step) => step.disabled)).toEqual([false, true, true]);
        expect(plan.map((step) => step.done)).toEqual([false, false, true]);
    });

    it('should disable nothing when not linear', () => {
        // Assert
        expect(planSteps(keys, '', [], false).every((step) => !step.disabled)).toBe(true);
    });
});
