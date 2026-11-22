import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};

const SKILLS = [
    { skill: 'Speed', ada: 8, ben: 5 },
    { skill: 'Range', ada: 6, ben: 9 },
    { skill: 'Cost', ada: 4, ben: 7 },
    { skill: 'Comfort', ada: 9, ben: 3 }
];
const POINTS = [
    { weight: 1.2, price: 10 },
    { weight: 2.5, price: 18 },
    { weight: 4, price: 31 }
];
const PEOPLE = { ada: { field: 'ada', _label: 'Ada' }, ben: { field: 'ben', _label: 'Ben' } };

const marks = (mounted: MountedComponent, selector: string): SVGElement[] => Array.from(mounted.element.shadowRoot?.querySelector('svg')?.querySelectorAll<SVGElement>(selector) ?? []);

const mountChart = async (properties: Record<string, unknown>, records: unknown[]): Promise<MountedComponent> => {
    const mounted = mountComponent('chart', { '<-records': '$.data.rows', _title: 'Chart', ...properties }, { data: { rows: records } });
    (mounted.element as HTMLElement).style.inlineSize = '480px';
    await flush();
    await frames(3);
    return mounted;
};

describe('chart types scatter, radar and heatmap in Chromium', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should draw a scatter chart with a named point per record', async () => {
        // Arrange and Act
        const mounted = await mountChart({ type: 'scatter', x: 'weight', series: { price: { field: 'price', _label: 'Price' } } }, POINTS);
        const dots = marks(mounted, 'circle.dot');

        // Assert
        expect(dots).toHaveLength(3);
        expect(dots[0]?.getAttribute('aria-label')).toBe('Price, 1.2: 10');
        expect(Number(dots[2]?.getAttribute('cx'))).toBeGreaterThan(Number(dots[0]?.getAttribute('cx')));
    });

    it('should draw a radar chart with a spoke per record and an outline per series', async () => {
        // Arrange and Act
        const mounted = await mountChart({ type: 'radar', x: 'skill', series: PEOPLE }, SKILLS);

        // Assert
        expect(marks(mounted, 'text.tick.x').map((tick) => tick.textContent)).toEqual(['Speed', 'Range', 'Cost', 'Comfort']);
        expect(marks(mounted, 'path.web').length).toBeGreaterThan(0);
        expect(marks(mounted, 'path.area')).toHaveLength(2);
        expect(marks(mounted, 'circle.dot')).toHaveLength(8);
    });

    it('should draw a heatmap with a cell per series and record whose strength follows its value', async () => {
        // Arrange and Act
        const mounted = await mountChart({ type: 'heatmap', x: 'skill', series: PEOPLE }, SKILLS);
        const cells = marks(mounted, 'rect.cell');
        const strongest = cells.find((cell) => cell.getAttribute('aria-label') === 'Ada, Comfort: 9');
        const faintest = cells.find((cell) => cell.getAttribute('aria-label') === 'Ben, Comfort: 3');

        // Assert
        expect(cells).toHaveLength(8);
        expect(Number(strongest?.getAttribute('opacity') ?? 1)).toBeGreaterThan(Number(faintest?.getAttribute('opacity') ?? 1));
        expect(mounted.store.get<Record<string, unknown>>('$.app.legendItems')).toEqual({});
    });
});
