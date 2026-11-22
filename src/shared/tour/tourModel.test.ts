import { describe, expect, it } from 'vitest';
import { stepAfter, tourPosition, tourSteps } from './tourModel.js';

const steps = tourSteps({
    search: { target: '$.app.children.search', _title: 'Search', _text: 'Find anything' },
    filters: { target: '$.app.children.filters', side: 'end', _title: 'Filters' },
    broken: 7,
    done: { side: 'sideways', _title: 'All set' }
});

describe('tourSteps', () => {
    it('should read the steps in order, leaving out entries that are not objects and defaulting the side', () => {
        // Assert
        expect(steps.map((step) => [step.key, step.side])).toEqual([
            ['search', 'bottom'],
            ['filters', 'end'],
            ['done', 'bottom']
        ]);
        expect(steps[0]).toMatchObject({ target: '$.app.children.search', title: 'Search', text: 'Find anything' });
        expect(tourSteps(undefined)).toEqual([]);
    });
});

describe('tourPosition', () => {
    it('should place the step among the steps while the tour runs', () => {
        // Act
        const position = tourPosition(steps, 'filters', false);

        // Assert
        expect(position).toMatchObject({ index: 2, count: 3, first: false, last: false });
        expect(tourPosition(steps, 'done', false)?.last).toBe(true);
    });

    it('should give no position when done, before a start or for an unknown step', () => {
        // Assert
        expect(tourPosition(steps, 'search', true)).toBeUndefined();
        expect(tourPosition(steps, '', false)).toBeUndefined();
        expect(tourPosition(steps, 'broken', false)).toBeUndefined();
    });
});

describe('stepAfter', () => {
    it('should give the next and previous keys, and nothing past either end', () => {
        // Assert
        expect(stepAfter(steps, 'search', 1)).toBe('filters');
        expect(stepAfter(steps, 'filters', -1)).toBe('search');
        expect(stepAfter(steps, 'search', -1)).toBeUndefined();
        expect(stepAfter(steps, 'done', 1)).toBeUndefined();
    });
});
