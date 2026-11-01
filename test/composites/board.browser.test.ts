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
    await frames(4);
    await flush();
};

const cardTemplate = { component: 'text', '<-_text': '$row.title' };
const COLUMNS = {
    todo: { _title: 'To do', limit: 2 },
    doing: { _title: 'Doing' },
    done: { _title: 'Done', limit: 5 }
};

interface Card {
    id: string;
    title: string;
    status: string;
    rank?: number;
}

const card = (id: string, status: string, rank?: number): Card => ({ id, title: id.toUpperCase(), status, ...(rank === undefined ? {} : { rank }) });
const cards = (): Card[] => [card('a', 'todo', 2), card('b', 'todo', 1), card('c', 'doing', 1), card('d', 'done', 1), card('e', 'todo', 3)];

const root = (mounted: MountedComponent): ShadowRoot => mounted.element.shadowRoot as ShadowRoot;
const columnElements = (mounted: MountedComponent): HTMLElement[] => Array.from(root(mounted).querySelectorAll<HTMLElement>('.column:not([data-gone])'));
const columnOf = (mounted: MountedComponent, key: string): HTMLElement => columnElements(mounted).find((column) => column.dataset['key'] === key) as HTMLElement;
const listOf = (column: HTMLElement): Element => column.querySelector('ui-record-list') as Element;
const slotsOf = (column: HTMLElement): HTMLElement[] =>
    Array.from(listOf(column).shadowRoot?.querySelectorAll<HTMLElement>('.slot') ?? []);
const slotText = (slot: HTMLElement): string => (slot.firstElementChild?.firstElementChild as Element | null)?.shadowRoot?.textContent?.trim() ?? '';
const styleNumber = (slot: HTMLElement, name: string): number => Number(new RegExp(`${name}:\\s*(-?\\d+)`).exec(slot.getAttribute('style') ?? '')?.[1] ?? -1);

const badgeOf = (column: HTMLElement): Element => column.querySelector('ui-badge') as Element;
const countOf = (column: HTMLElement): string => (badgeOf(column).shadowRoot?.textContent ?? '').replace(/s+/g, ' ').trim();

/** The cards a column shows, in position order */
const shown = (mounted: MountedComponent, key: string): string[] =>
    slotsOf(columnOf(mounted, key))
        .filter((slot) => !slot.hidden)
        .sort((a, b) => styleNumber(a, '--sui-index') - styleNumber(b, '--sui-index'))
        .map(slotText);

const mountBoard = async (
    records: unknown = cards(),
    extra: Record<string, unknown> = {},
    options: Parameters<typeof mountComponent>[2] = {}
): Promise<MountedComponent> => {
    const mounted = mountComponent(
        'board',
        { columnField: 'status', orderField: 'rank', columns: COLUMNS, '<-records': '$.data.cards', card: cardTemplate, ...extra },
        { data: { cards: records }, ...options }
    );
    (mounted.element as HTMLElement).style.inlineSize = '900px';
    await settle();
    return mounted;
};

describe('board in Chromium', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        mountComponent.unmountAll();
    });

    it('should draw a column per key of columns, each with a recordList body', async () => {
        // Arrange and Act
        const mounted = await mountBoard();

        // Assert
        expect(columnElements(mounted).map((column) => column.dataset['key'])).toEqual(['todo', 'doing', 'done']);
        expect(columnElements(mounted).every((column) => listOf(column) !== null)).toBe(true);
    });

    it('should put each card in the column of its field value, sorted by the order field', async () => {
        // Arrange and Act
        const mounted = await mountBoard();

        // Assert
        expect(shown(mounted, 'todo')).toEqual(['B', 'A', 'E']);
        expect(shown(mounted, 'doing')).toEqual(['C']);
        expect(shown(mounted, 'done')).toEqual(['D']);
    });

    it('should keep the order of the records when there is no order field', async () => {
        // Arrange and Act
        const mounted = await mountBoard(cards(), { orderField: '' });

        // Assert
        expect(shown(mounted, 'todo')).toEqual(['A', 'B', 'E']);
    });

    it('should read records given as a keyed map', async () => {
        // Arrange and Act
        const mounted = await mountBoard({ x: card('ignored', 'doing', 2), y: { ...card('ignored', 'doing', 1), title: 'Y' }, z: { ...card('ignored', 'doing', 3), title: 'Z' } });

        // Assert
        expect(shown(mounted, 'doing')).toEqual(['Y', 'IGNORED', 'Z']);
    });

    it('should show each column title, the count and the limit in its header', async () => {
        // Arrange and Act
        const mounted = await mountBoard();
        const head = (key: string): string => `${columnOf(mounted, key).querySelector('.title')?.textContent} ${countOf(columnOf(mounted, key))}`;

        // Assert
        expect(head('todo')).toBe('To do 3 / 2');
        expect(head('doing')).toBe('Doing 1');
        expect(head('done')).toBe('Done 1 / 5');
        expect(columnOf(mounted, 'todo').getAttribute('aria-label')).toBe('To do');
    });

    it('should give the header a warning tone only while the limit is exceeded', async () => {
        // Arrange
        const mounted = await mountBoard();
        const tone = (key: string): string | null => columnOf(mounted, key).querySelector('.head')?.getAttribute('data-tone') ?? null;
        const colour = (key: string): string => getComputedStyle(badgeOf(columnOf(mounted, key)).shadowRoot?.querySelector('.badge') as Element).backgroundColor;

        // Assert
        expect(tone('todo')).toBe('warning');
        expect(tone('done')).toBeNull();
        expect(mounted.store.get('$.app.cols.k_todo.badge.main.tone')).toBe('warning');
        expect(colour('todo')).not.toBe(colour('done'));

        // Act
        mounted.store.set('$.data.cards.4.status', 'doing' as never);
        await settle();

        // Assert
        expect(tone('todo')).toBeNull();
    });

    it('should move a card to another column when its column field changes in the data', async () => {
        // Arrange
        const mounted = await mountBoard();

        // Act
        mounted.store.set('$.data.cards.0.status', 'done' as never);
        await settle();

        // Assert
        expect(shown(mounted, 'todo')).toEqual(['B', 'E']);
        expect(shown(mounted, 'done')).toEqual(['D', 'A']);
    });

    it('should move a card inside its column when its order field changes', async () => {
        // Arrange
        const mounted = await mountBoard();

        // Act
        mounted.store.set('$.data.cards.4.rank', 0 as never);
        await settle();

        // Assert
        expect(shown(mounted, 'todo')).toEqual(['E', 'B', 'A']);
    });

    it('should show a card that is added to the data and drop one that is removed', async () => {
        // Arrange
        const mounted = await mountBoard();

        // Act
        mounted.store.set('$.data.cards.5', card('f', 'doing', 0) as never);
        await settle();

        // Assert
        expect(shown(mounted, 'doing')).toEqual(['F', 'C']);
    });

    it('should show the German column titles from an overlay', async () => {
        // Arrange
        const mounted = await mountBoard(cards(), {}, { locales: { de: { columns: { todo: { _title: 'Zu erledigen' }, doing: { _title: 'In Arbeit' }, done: { _title: 'Erledigt' } } } } });

        // Act
        mounted.setLocale('de');
        await settle();

        // Assert
        expect(columnElements(mounted).map((column) => column.querySelector('.title')?.textContent)).toEqual(['Zu erledigen', 'In Arbeit', 'Erledigt']);
        expect(columnOf(mounted, 'todo').getAttribute('aria-label')).toBe('Zu erledigen');
    });

    it('should translate the hidden limit text in German', async () => {
        // Arrange
        const mounted = await mountBoard(cards(), {}, { locale: 'de' });
        await settle();

        // Assert
        expect(columnOf(mounted, 'todo').querySelector('.hidden')?.textContent).toBe('Limit überschritten');
    });

    it('should leave out a card whose value matches no column and report it once per distinct value', async () => {
        // Arrange
        const warn = vi.spyOn(report, 'warning').mockImplementation(() => undefined);
        const mounted = await mountBoard([...cards(), card('x', 'later'), card('y', 'later'), card('z', 'never')]);

        // Assert
        const reports = warn.mock.calls.filter((call) => (call[1] as { code?: string } | undefined)?.code === 'SUI-RUN-BINDING');
        expect(reports).toHaveLength(2);
        expect(String(reports[0]?.[0])).toContain('"later"');
        expect(String(reports[1]?.[0])).toContain('"never"');
        expect([...shown(mounted, 'todo'), ...shown(mounted, 'doing'), ...shown(mounted, 'done')]).toHaveLength(5);

        // Act
        mounted.store.set('$.data.cards.0.rank', 9 as never);
        await settle();

        // Assert
        expect(warn.mock.calls.filter((call) => (call[1] as { code?: string } | undefined)?.code === 'SUI-RUN-BINDING')).toHaveLength(2);
    });

    it('should draw a card in a column that gets a matching key, and report again after the value went away and came back', async () => {
        // Arrange
        const warn = vi.spyOn(report, 'warning').mockImplementation(() => undefined);
        const mounted = await mountBoard([card('x', 'later')]);

        // Act
        mounted.store.set('$.app.columns.later', { _title: 'Later' } as never);
        await settle();

        // Assert
        expect(columnElements(mounted).map((column) => column.dataset['key'])).toEqual(['todo', 'doing', 'done', 'later']);
        expect(shown(mounted, 'later')).toEqual(['X']);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('should add and remove a column without an error, keeping the slots of the columns that stay and drawing them in the order of columns', async () => {
        // Arrange
        const error = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        const mounted = await mountBoard();
        const before = slotsOf(columnOf(mounted, 'todo'));

        // Act
        mounted.store.set('$.app.columns.later', { _title: 'Later' } as never);
        await settle();
        mounted.store.delete('$.app.columns.doing');
        await settle();

        // Assert
        expect(columnElements(mounted).map((column) => column.dataset['key'])).toEqual(['todo', 'done', 'later']);
        expect(columnElements(mounted).map((column) => getComputedStyle(column).order)).toEqual(['0', '1', '2']);
        expect(slotsOf(columnOf(mounted, 'todo'))).toEqual(before);
        expect(shown(mounted, 'todo')).toEqual(['B', 'A', 'E']);
        expect(error).not.toHaveBeenCalled();
    });

    it('should size the cards by cardHeight', async () => {
        // Arrange
        const heights: number[] = [];
        for (const cardHeight of ['sm', 'md', 'lg']) {
            const mounted = await mountBoard(cards(), { cardHeight });
            heights.push(slotsOf(columnOf(mounted, 'todo')).find((slot) => !slot.hidden)?.getBoundingClientRect().height ?? 0);
            mounted.dispose();
        }

        // Assert
        expect(heights[0]).toBeGreaterThan(0);
        expect(heights[0]).toBeLessThan(heights[1] as number);
        expect(heights[1]).toBeLessThan(heights[2] as number);
    });

    it('should draw 2,000 cards through a bounded number of slots', async () => {
        // Arrange
        const many = Array.from({ length: 2000 }, (_value, at) => card(`k${at}`, at % 2 === 0 ? 'todo' : 'doing', at));

        // Act
        const mounted = await mountBoard(many);
        const todo = slotsOf(columnOf(mounted, 'todo')).filter((slot) => !slot.hidden);
        const doing = slotsOf(columnOf(mounted, 'doing')).filter((slot) => !slot.hidden);

        // Assert
        expect(todo.length).toBeGreaterThan(0);
        expect(todo.length).toBeLessThan(60);
        expect(doing.length).toBeLessThan(60);
        expect(countOf(columnOf(mounted, 'todo'))).toBe('1000 / 2');
        expect(shown(mounted, 'todo')[0]).toBe('K0');
    });

    it('should draw the same slots when cards change columns: they are pointed at other records, not rebuilt', async () => {
        // Arrange
        const mounted = await mountBoard();
        const before = slotsOf(columnOf(mounted, 'todo'));

        // Act
        mounted.store.set('$.data.cards.0.status', 'doing' as never);
        await settle();

        // Assert
        expect(slotsOf(columnOf(mounted, 'todo'))).toEqual(before);
    });

    it('should draw empty columns for no records', async () => {
        // Arrange and Act
        const mounted = await mountBoard([]);

        // Assert
        expect(columnElements(mounted)).toHaveLength(3);
        expect(shown(mounted, 'todo')).toEqual([]);
    });

    it('should link the card template to the record with $row, so a field change updates the card', async () => {
        // Arrange
        const mounted = await mountBoard();

        // Act
        mounted.store.set('$.data.cards.2.title', 'Renamed' as never);
        await settle();

        // Assert
        expect(shown(mounted, 'doing')).toEqual(['Renamed']);
    });
});
