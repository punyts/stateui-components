import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));
const frames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};
const BODY = '$.runtime.nodes.app.body';

/** A JSON row template cannot write CSS, so the tree has to indent and mark the rows itself */
const rowTemplate = { component: 'text', '<-_text': '$row.label' };

/** A (open, with A1 and A2), B (a leaf), C (a record that may have children and has none loaded) */
const nodes = [
    { id: 'a', label: 'A', hasChildren: true },
    { id: 'a1', label: 'A1', parentId: 'a' },
    { id: 'a2', label: 'A2', parentId: 'a' },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C', hasChildren: true }
];

const recordList = (mounted: MountedComponent): Element | null => mounted.element.shadowRoot?.querySelector('ui-record-list') ?? null;
const slots = (mounted: MountedComponent): HTMLElement[] =>
    Array.from(recordList(mounted)?.shadowRoot?.querySelectorAll<HTMLElement>('.slot') ?? []).filter((slot) => !slot.hidden);
const row = (slot: HTMLElement): HTMLElement => slot.querySelector('sui-node')?.firstElementChild as HTMLElement;
const slotText = (slot: HTMLElement): string => row(slot)?.shadowRoot?.textContent?.trim() ?? '';
const slotOf = (mounted: MountedComponent, text: string): HTMLElement => {
    const slot = slots(mounted).find((candidate) => slotText(candidate) === text);
    if (slot === undefined) throw new Error(`no row shows "${text}"`);
    return slot;
};
/** The edges of the row's own content, which is what a user sees as the indent */
const contentLeft = (slot: HTMLElement): number => row(slot).getBoundingClientRect().left;
const contentRight = (slot: HTMLElement): number => row(slot).getBoundingClientRect().right;
const twisty = (slot: HTMLElement): HTMLElement | null => slot.querySelector<HTMLElement>('.twisty');
const glyphName = (slot: HTMLElement): string | null => twisty(slot)?.querySelector('ui-icon')?.getAttribute('name') ?? null;

const mountTree = async (extra: Record<string, unknown> = {}, direction = 'ltr'): Promise<MountedComponent> => {
    const mounted = mountComponent(
        'tree',
        { selectable: 'single', expanded: ['a'], '<-records': '$.data.nodes', row: rowTemplate, ...extra },
        { data: { nodes: structuredClone(nodes) } }
    );
    const element = mounted.element as HTMLElement;
    element.style.blockSize = '320px';
    element.dir = direction;
    await flush();
    await frames(3);
    mounted.store.set(`${BODY}.window`, { first: 0, count: 12 });
    await flush();
    return mounted;
};

describe('tree indent and expand glyph in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should start a child row further in than its parent', async () => {
        // Act
        const mounted = await mountTree();

        // Assert
        expect(contentLeft(slotOf(mounted, 'A1'))).toBeGreaterThan(contentLeft(slotOf(mounted, 'A')));
        expect(contentLeft(slotOf(mounted, 'A1'))).toBe(contentLeft(slotOf(mounted, 'A2')));
    });

    it('should line a leaf up with its siblings that have a glyph and draw no glyph for it', async () => {
        // Act
        const mounted = await mountTree();

        // Assert
        expect(contentLeft(slotOf(mounted, 'B'))).toBe(contentLeft(slotOf(mounted, 'A')));
        expect(contentLeft(slotOf(mounted, 'B'))).toBe(contentLeft(slotOf(mounted, 'C')));
        expect(twisty(slotOf(mounted, 'B'))).toBeNull();
        expect(twisty(slotOf(mounted, 'A1'))).toBeNull();
        expect(twisty(slotOf(mounted, 'A'))).not.toBeNull();
        expect(twisty(slotOf(mounted, 'C'))).not.toBeNull();
    });

    it('should draw a glyph that is hidden from assistive technology', async () => {
        // Act
        const mounted = await mountTree();
        const glyph = twisty(slotOf(mounted, 'A')) as HTMLElement;

        // Assert
        expect(glyph.getAttribute('aria-hidden')).toBe('true');
        expect(glyph.querySelector('ui-icon')?.shadowRoot?.querySelector('.glyph svg')).not.toBeNull();
    });

    it('should flip the glyph when a record opens and closes', async () => {
        // Arrange
        const mounted = await mountTree();
        expect(glyphName(slotOf(mounted, 'A'))).toBe('chevron-down');
        expect(glyphName(slotOf(mounted, 'C'))).toBe('chevron-right');

        // Act
        mounted.store.set('$.app.expanded', ['c']);
        await flush();

        // Assert
        expect(glyphName(slotOf(mounted, 'A'))).toBe('chevron-right');
        expect(glyphName(slotOf(mounted, 'C'))).toBe('chevron-down');
    });

    it('should mirror the layout and the closed glyph in right-to-left text', async () => {
        // Arrange
        const ltr = await mountTree();
        const ltrOffset = (twisty(slotOf(ltr, 'C')) as HTMLElement).getBoundingClientRect().left - slotOf(ltr, 'C').getBoundingClientRect().left;
        const ltrTransform = getComputedStyle(twisty(slotOf(ltr, 'C'))?.querySelector('ui-icon') as HTMLElement).transform;
        mountComponent.unmountAll();

        // Act
        const rtl = await mountTree({}, 'rtl');
        const slot = slotOf(rtl, 'C');
        const glyph = twisty(slot) as HTMLElement;

        // Assert
        expect(slot.getBoundingClientRect().right - glyph.getBoundingClientRect().right).toBeCloseTo(ltrOffset, 0);
        expect(contentRight(slotOf(rtl, 'A1'))).toBeLessThan(contentRight(slotOf(rtl, 'A')));
        expect(ltrTransform).toBe('none');
        expect(getComputedStyle(glyph.querySelector('ui-icon') as HTMLElement).transform).toBe('matrix(-1, 0, 0, 1, 0, 0)');
    });

    it('should toggle the record when the glyph is pressed', async () => {
        // Arrange
        const mounted = await mountTree();
        const shown = (): string[] => slots(mounted).map(slotText);
        expect(shown()).toEqual(expect.arrayContaining(['A1', 'A2']));

        // Act
        (twisty(slotOf(mounted, 'A')) as HTMLElement).click();
        await flush();
        const closed = shown();
        (twisty(slotOf(mounted, 'A')) as HTMLElement).click();
        await flush();

        // Assert
        expect(closed).not.toContain('A1');
        expect(shown()).toEqual(expect.arrayContaining(['A1', 'A2']));
        expect(mounted.store.get('$.app.expanded')).toEqual(['a']);
    });
});
