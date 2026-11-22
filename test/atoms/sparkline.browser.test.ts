import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;

describe('sparkline in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should draw a line through the values and name it with a summary', () => {
        // Arrange and Act
        const mounted = mountComponent('sparkline', { _label: 'Visits', values: [3, 9, 4, 12] });
        const line = root(mounted.element).querySelector('path.line');

        // Assert
        expect(line?.getAttribute('d')).toMatch(/^M0 \S+ L33\.33 \S+ L66\.67 \S+ L100 \S+$/);
        expect(root(mounted.element).querySelector('.sparkline')?.getAttribute('aria-label')).toBe('Visits: 4 values from 3 to 12, lowest 3, highest 12');
        expect(root(mounted.element).querySelector('path.area')).toBeNull();
    });

    it('should follow linked values and draw bars from zero for the bar type', () => {
        // Arrange
        const mounted = mountComponent('sparkline', { type: 'bar', '<-values': '$.data.trend' }, { data: { trend: [2, -1] } });

        // Act
        mounted.store.set('$.data.trend', [2, -1, 4]);

        // Assert
        const bars = Array.from(root(mounted.element).querySelectorAll('rect.bar'));
        expect(bars).toHaveLength(3);
        expect(bars[1]?.hasAttribute('data-negative')).toBe(true);
        expect(root(mounted.element).querySelector('path.line')).toBeNull();
    });

    it('should fill the area under the line for the area type', () => {
        // Arrange and Act
        const mounted = mountComponent('sparkline', { type: 'area', values: [1, 2, 3] });

        // Assert
        expect(root(mounted.element).querySelector('path.area')?.getAttribute('d')).toMatch(/Z$/);
        expect(root(mounted.element).querySelector('path.line')).not.toBeNull();
    });
});
