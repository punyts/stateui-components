import { report } from '@punyts/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};
const settle = async (): Promise<void> => {
    await flush();
    await frames(3);
};

type Kind = 'list' | 'recordGrid';

const viewPath = (kind: Kind): string => (kind === 'list' ? '$.runtime.nodes.app.body' : '$.runtime.nodes.app');

/** A panel carries German default content (`_toggleLabel`), which a row template without its own text relies on */
const rowTemplate = { component: 'panel', collapsible: true, '<-_description': '$row.description' };

const records = (count: number): { id: string; description: string }[] =>
    Array.from({ length: count }, (_v, i) => ({ id: `r${i}`, description: `Row ${i}` }));

/** Every element matching `selector` in `root` and in the shadow roots below it */
const deepAll = (root: ParentNode, selector: string): Element[] => {
    const found: Element[] = Array.from(root.querySelectorAll(selector));
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        if (candidate.shadowRoot) found.push(...deepAll(candidate.shadowRoot, selector));
    }
    return found;
};

/** The aria-label of the toggle button of every panel that is shown: the panel's own default content */
const toggleLabels = (mounted: MountedComponent): string[] =>
    deepAll(mounted.host, 'ui-panel')
        .filter((panel) => !panel.closest('[hidden]') && panel.getAttribute('state') !== null)
        .flatMap((panel) => Array.from(panel.shadowRoot?.querySelectorAll('button.toggle') ?? []))
        .map((button) => button.getAttribute('aria-label') ?? '');

const shownDescriptions = (mounted: MountedComponent): string[] =>
    deepAll(mounted.host, 'ui-panel')
        .map((panel) => panel.shadowRoot?.querySelector('.description')?.textContent?.trim() ?? '')
        .filter((text) => text !== '');

const missing = (spy: { mock: { calls: unknown[][] } }): unknown[][] =>
    spy.mock.calls.filter((call) => JSON.stringify(call).includes('SUI-NODE-MISSING'));

const resize = (mounted: MountedComponent, size: string): void => {
    mounted.host.style.blockSize = size;
    (mounted.element as HTMLElement).style.blockSize = size;
};

const scroller = (mounted: MountedComponent): HTMLElement =>
    deepAll(mounted.host, 'ui-record-list, ui-record-grid')
        .map((view) => view.shadowRoot?.querySelector<HTMLElement>('.list, .grid'))
        .find((candidate) => candidate) as HTMLElement;

const slotCount = (mounted: MountedComponent, kind: Kind): number =>
    Object.keys(mounted.store.get<Record<string, unknown>>(`${viewPath(kind)}.slots`) ?? {}).length;

const mountView = async (kind: Kind, count: number): Promise<MountedComponent> => {
    const link = kind === 'list' ? { '<-items': '$.data.rows' } : { '<-records': '$.data.rows' };
    const mounted = mountComponent(kind, { ...link, row: rowTemplate }, { data: { rows: records(count) } });
    mounted.host.style.display = 'block';
    mounted.host.style.blockSize = '320px';
    (mounted.element as HTMLElement).style.display = 'block';
    (mounted.element as HTMLElement).style.blockSize = '320px';
    await flush();
    await frames(3);
    await settle();
    return mounted;
};

describe.each<Kind>(['list', 'recordGrid'])('%s with a panel row template and a language switch', (kind) => {
    afterEach(() => {
        vi.restoreAllMocks();
        mountComponent.unmountAll();
    });

    it('should log no SUI-NODE-MISSING and show German content in the slots that exist at the switch, then English again', async () => {
        // Arrange
        const error = vi.spyOn(report, 'error');
        const mounted = await mountView(kind, 300);
        const before = toggleLabels(mounted);

        // Act
        mounted.setLocale('de');
        await settle();
        const german = toggleLabels(mounted);
        mounted.setLocale('en');
        await settle();
        const english = toggleLabels(mounted);

        // Assert
        expect(before.length).toBeGreaterThan(0);
        expect(new Set(before)).toEqual(new Set(['Toggle section']));
        expect(german.length).toBe(before.length);
        expect(new Set(german)).toEqual(new Set(['Bereich umschalten']));
        expect(new Set(english)).toEqual(new Set(['Toggle section']));
        expect(missing(error)).toEqual([]);
    });

    it('should show German content in slots created after the switch', async () => {
        // Arrange
        const error = vi.spyOn(report, 'error');
        const mounted = await mountView(kind, 300);
        mounted.setLocale('de');
        await settle();
        const slotsBefore = slotCount(mounted, kind);

        // Act
        resize(mounted, '640px');
        await settle();
        const german = toggleLabels(mounted);
        mounted.setLocale('en');
        await settle();

        // Assert
        expect(slotCount(mounted, kind)).toBeGreaterThan(slotsBefore);
        expect(german.length).toBeGreaterThan(0);
        expect(new Set(german)).toEqual(new Set(['Bereich umschalten']));
        expect(new Set(toggleLabels(mounted))).toEqual(new Set(['Toggle section']));
        expect(missing(error)).toEqual([]);
    });

    it('should show German content in recycled slots after a scroll', async () => {
        // Arrange
        const error = vi.spyOn(report, 'error');
        const mounted = await mountView(kind, 300);
        mounted.setLocale('de');
        await settle();

        // Act
        scroller(mounted).scrollTop = scroller(mounted).scrollHeight / 3;
        await settle();
        const german = toggleLabels(mounted);

        // Assert
        expect(scroller(mounted).scrollTop).toBeGreaterThan(0);
        expect(shownDescriptions(mounted)).not.toContain('Row 0');
        expect(german.length).toBeGreaterThan(0);
        expect(new Set(german)).toEqual(new Set(['Bereich umschalten']));
        expect(missing(error)).toEqual([]);
    });
});

describe.each<Kind>(['list', 'recordGrid'])('%s when the pool shrinks', (kind) => {
    afterEach(() => {
        vi.restoreAllMocks();
        mountComponent.unmountAll();
    });

    it('should log no SUI-NODE-MISSING when the viewport gets smaller and surplus slots are removed', async () => {
        // Arrange
        const error = vi.spyOn(report, 'error');
        const mounted = await mountView(kind, 300);
        resize(mounted, '640px');
        await settle();
        const slotsBefore = slotCount(mounted, kind);

        // Act
        resize(mounted, '160px');
        await settle();

        // Assert
        expect(slotCount(mounted, kind)).toBeLessThan(slotsBefore);
        expect(missing(error)).toEqual([]);
    });
});
