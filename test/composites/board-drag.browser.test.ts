import { userEvent } from 'vitest/browser';
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
const COLUMNS = { todo: { _title: 'To do' }, doing: { _title: 'Doing' }, done: { _title: 'Done' } };

interface Card {
    id: string;
    title: string;
    status: string;
    rank?: number;
}
const card = (id: string, status: string, rank?: number): Card => ({ id, title: `Card ${id.toUpperCase()}`, status, ...(rank === undefined ? {} : { rank }) });
const cards = (): Card[] => [card('a', 'todo', 1), card('b', 'todo', 2), card('c', 'todo', 3), card('d', 'doing', 1), card('e', 'doing', 2)];

const root = (mounted: MountedComponent): ShadowRoot => mounted.element.shadowRoot as ShadowRoot;
const boardOf = (mounted: MountedComponent): HTMLElement => root(mounted).querySelector('.board') as HTMLElement;
const columnOf = (mounted: MountedComponent, key: string): HTMLElement =>
    Array.from(root(mounted).querySelectorAll<HTMLElement>('.column')).find((column) => column.dataset['key'] === key) as HTMLElement;
const bodyOf = (mounted: MountedComponent, key: string): HTMLElement => columnOf(mounted, key).querySelector('.body') as HTMLElement;
const slotsOf = (mounted: MountedComponent, key: string): HTMLElement[] =>
    Array.from(columnOf(mounted, key).querySelector('ui-record-list')?.shadowRoot?.querySelectorAll<HTMLElement>('.slot') ?? []).filter((slot) => !slot.hidden);
const slotText = (slot: HTMLElement): string => (slot.firstElementChild?.firstElementChild as Element | null)?.shadowRoot?.textContent?.trim() ?? '';
const styleNumber = (slot: HTMLElement, name: string): number => Number(new RegExp(`${name}:\\s*(-?\\d+)`).exec(slot.getAttribute('style') ?? '')?.[1] ?? -1);
const shown = (mounted: MountedComponent, key: string): string[] =>
    slotsOf(mounted, key)
        .sort((a, b) => styleNumber(a, '--sui-index') - styleNumber(b, '--sui-index'))
        .map(slotText);
const slotFor = (mounted: MountedComponent, key: string, title: string): HTMLElement => slotsOf(mounted, key).find((slot) => slotText(slot) === title) as HTMLElement;
const live = (mounted: MountedComponent): string => (root(mounted).querySelector('.live')?.textContent ?? '').trim();
const dropOf = (mounted: MountedComponent, key: string): HTMLElement | null => columnOf(mounted, key).querySelector('.drop');

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

const pointer = (type: string, target: EventTarget, x: number, y: number): void => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, button: 0, pointerType: 'mouse', isPrimary: true }));
};
const centre = (element: Element): { x: number; y: number } => {
    const box = element.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
};
/** The height of a card in the board, in pixels: the first slot of a column */
const cardHeight = (mounted: MountedComponent): number => slotsOf(mounted, 'todo')[0]?.getBoundingClientRect().height ?? 0;

/** Presses a card, moves the pointer to the card place `index` of a column and returns where it is, without releasing */
const dragTo = async (mounted: MountedComponent, from: HTMLElement, column: string, index: number): Promise<{ x: number; y: number }> => {
    const start = centre(from);
    pointer('pointerdown', from, start.x, start.y);
    const body = bodyOf(mounted, column).getBoundingClientRect();
    const target = { x: body.left + body.width / 2, y: body.top + (index + 0.5) * cardHeight(mounted) };
    pointer('pointermove', boardOf(mounted), target.x, target.y);
    await flush();
    return target;
};
const release = async (mounted: MountedComponent, at: { x: number; y: number }): Promise<void> => {
    pointer('pointerup', boardOf(mounted), at.x, at.y);
    await settle();
};

describe('board pointer drag in Chromium', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        mountComponent.unmountAll();
    });

    it('should move a card to another column: columnField and orderField are written through the record path', async () => {
        // Arrange
        const mounted = await mountBoard();
        const moves: unknown[] = [];
        mounted.element.addEventListener('move', (event) => moves.push((event as CustomEvent).detail));

        // Act
        const at = await dragTo(mounted, slotFor(mounted, 'todo', 'Card A'), 'doing', 1);
        await release(mounted, at);

        // Assert
        expect(mounted.store.get('$.data.cards.0.status')).toBe('doing');
        expect(mounted.store.get('$.data.cards.0.rank')).toBe(1.5);
        expect(shown(mounted, 'todo')).toEqual(['Card B', 'Card C']);
        expect(shown(mounted, 'doing')).toEqual(['Card D', 'Card A', 'Card E']);
        expect(moves).toEqual([{ key: 'a', from: 'todo', to: 'doing', index: 1 }]);
    });

    it('should move a card inside its column and write only the order field', async () => {
        // Arrange
        const mounted = await mountBoard();
        const moves: unknown[] = [];
        mounted.element.addEventListener('move', (event) => moves.push((event as CustomEvent).detail));

        // Act
        const at = await dragTo(mounted, slotFor(mounted, 'todo', 'Card A'), 'todo', 2);
        await release(mounted, at);

        // Assert
        expect(mounted.store.get('$.data.cards.0.status')).toBe('todo');
        expect(mounted.store.get('$.data.cards.0.rank')).toBe(4);
        expect(shown(mounted, 'todo')).toEqual(['Card B', 'Card C', 'Card A']);
        expect(moves).toEqual([{ key: 'a', from: 'todo', to: 'todo', index: 2 }]);
    });

    it('should put a card at the start of another column and at the end of an empty one', async () => {
        // Arrange
        const mounted = await mountBoard();

        // Act
        const first = await dragTo(mounted, slotFor(mounted, 'todo', 'Card C'), 'doing', 0);
        await release(mounted, first);
        const second = await dragTo(mounted, slotFor(mounted, 'doing', 'Card D'), 'done', 0);
        await release(mounted, second);

        // Assert
        expect(shown(mounted, 'doing')).toEqual(['Card C', 'Card E']);
        expect(shown(mounted, 'done')).toEqual(['Card D']);
        expect(mounted.store.get('$.data.cards.2.rank')).toBe(0);
    });

    it('should show a placeholder at the drop position while dragging, dim the card and mark the board', async () => {
        // Arrange
        const mounted = await mountBoard();
        const slot = slotFor(mounted, 'todo', 'Card A');

        // Act
        await dragTo(mounted, slot, 'doing', 1);
        await frames(2);
        const placeholder = dropOf(mounted, 'doing');

        // Assert
        expect(placeholder).not.toBeNull();
        expect(placeholder?.getAttribute('style')).toContain('--sui-drop-index: 1');
        expect(dropOf(mounted, 'todo')).toBeNull();
        expect(slot.style.opacity).toBe('0.4');
        expect(boardOf(mounted).hasAttribute('data-dragging')).toBe(true);
        const box = placeholder?.getBoundingClientRect() as DOMRect;
        const body = bodyOf(mounted, 'doing').getBoundingClientRect();
        expect(box.top).toBeCloseTo(body.top + cardHeight(mounted), 0);
        expect(box.height).toBeCloseTo(cardHeight(mounted), 0);

        // Act
        pointer('pointerup', boardOf(mounted), 0, 0);
        await settle();

        // Assert
        expect(boardOf(mounted).hasAttribute('data-dragging')).toBe(false);
        expect(slot.style.opacity).toBe('');
    });

    it('should move the placeholder with the pointer and read no layout while it moves', async () => {
        // Arrange
        const mounted = await mountBoard();
        const slot = slotFor(mounted, 'todo', 'Card A');
        const at = await dragTo(mounted, slot, 'doing', 0);
        const reads = vi.spyOn(Element.prototype, 'getBoundingClientRect');
        const body = bodyOf(mounted, 'doing');
        const boxTop = body.getBoundingClientRect().top;
        const height = cardHeight(mounted);
        reads.mockClear();

        // Act
        pointer('pointermove', boardOf(mounted), at.x, boxTop + 1.5 * height);
        await flush();

        // Assert
        expect(dropOf(mounted, 'doing')?.getAttribute('style')).toContain('--sui-drop-index: 1');
        expect(reads).not.toHaveBeenCalled();
        pointer('pointermove', boardOf(mounted), at.x, boxTop + 0.2 * height);
        await flush();
        expect(dropOf(mounted, 'doing')?.getAttribute('style')).toContain('--sui-drop-index: 0');
        expect(reads).not.toHaveBeenCalled();
    });

    it('should show the placeholder in the column the pointer is over and take it out of the one it left', async () => {
        // Arrange
        const mounted = await mountBoard();
        await dragTo(mounted, slotFor(mounted, 'todo', 'Card A'), 'doing', 0);
        const doing = bodyOf(mounted, 'doing').getBoundingClientRect();
        const done = bodyOf(mounted, 'done').getBoundingClientRect();

        // Act
        pointer('pointermove', boardOf(mounted), done.left + 10, doing.top + 5);
        await flush();

        // Assert
        expect(dropOf(mounted, 'done')).not.toBeNull();
        expect(dropOf(mounted, 'doing')).toBeNull();
    });

    it('should start no drag for a press that does not move, so a click still reaches the card', async () => {
        // Arrange
        const mounted = await mountBoard();
        const slot = slotFor(mounted, 'todo', 'Card A');
        const start = centre(slot);

        // Act
        pointer('pointerdown', slot, start.x, start.y);
        pointer('pointermove', boardOf(mounted), start.x + 2, start.y + 1);
        await flush();
        pointer('pointerup', boardOf(mounted), start.x + 2, start.y + 1);
        await settle();

        // Assert
        expect(boardOf(mounted).hasAttribute('data-dragging')).toBe(false);
        expect(dropOf(mounted, 'todo')).toBeNull();
        expect(mounted.store.get('$.data.cards.0.status')).toBe('todo');
    });

    it('should start no drag from a button inside a card', async () => {
        // Arrange
        const withButton = { component: 'button', '<-_title': '$row.title', icon: 'x' };
        const mounted = await mountBoard(cards(), { card: withButton });
        const slot = slotsOf(mounted, 'todo')[0] as HTMLElement;
        const button = slot.querySelector('ui-button')?.shadowRoot?.querySelector('button') as HTMLElement;
        const start = centre(button);

        // Act
        pointer('pointerdown', button, start.x, start.y);
        pointer('pointermove', boardOf(mounted), start.x + 200, start.y);
        await flush();

        // Assert
        expect(boardOf(mounted).hasAttribute('data-dragging')).toBe(false);
    });

    it('should move nothing when the card is dropped where it was, or cancelled by Escape or pointercancel', async () => {
        // Arrange
        const mounted = await mountBoard();
        const moves: unknown[] = [];
        mounted.element.addEventListener('move', (event) => moves.push((event as CustomEvent).detail));

        // Act: back to its own place
        const own = await dragTo(mounted, slotFor(mounted, 'todo', 'Card B'), 'todo', 1);
        await release(mounted, own);
        // Act: Escape
        const escaped = await dragTo(mounted, slotFor(mounted, 'todo', 'Card A'), 'doing', 0);
        boardOf(mounted).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
        await release(mounted, escaped);
        // Act: pointercancel
        const cancelled = await dragTo(mounted, slotFor(mounted, 'todo', 'Card A'), 'doing', 0);
        pointer('pointercancel', boardOf(mounted), cancelled.x, cancelled.y);
        await settle();

        // Assert
        expect(moves).toEqual([]);
        expect(mounted.store.get('$.data.cards.0.status')).toBe('todo');
        expect(dropOf(mounted, 'doing')).toBeNull();
        expect(boardOf(mounted).hasAttribute('data-dragging')).toBe(false);
    });

    it('should announce the drop in the live region', async () => {
        // Arrange
        const mounted = await mountBoard();

        // Act
        const at = await dragTo(mounted, slotFor(mounted, 'todo', 'Card A'), 'doing', 1);
        await release(mounted, at);

        // Assert
        expect(live(mounted)).toBe('Card A dropped at position 2 of 3 in Doing.');
    });

    it('should write only the column when the board has no order field, and do nothing inside a column', async () => {
        // Arrange
        const mounted = await mountBoard(cards(), { orderField: '' });
        const moves: unknown[] = [];
        mounted.element.addEventListener('move', (event) => moves.push((event as CustomEvent).detail));

        // Act
        const inside = await dragTo(mounted, slotFor(mounted, 'todo', 'Card A'), 'todo', 2);
        const placeholder = dropOf(mounted, 'todo');
        await release(mounted, inside);

        // Assert
        expect(placeholder).toBeNull();
        expect(moves).toEqual([]);
        expect(mounted.store.get('$.data.cards.0.rank')).toBe(1);

        // Act
        const across = await dragTo(mounted, slotFor(mounted, 'todo', 'Card A'), 'doing', 1);
        await release(mounted, across);

        // Assert
        expect(mounted.store.get('$.data.cards.0.status')).toBe('doing');
        expect(mounted.store.get('$.data.cards.0.rank')).toBe(1);
        expect(moves).toEqual([{ key: 'a', from: 'todo', to: 'doing', index: 0 }]);
    });

    it('should number the column when the neighbours cannot take a new order between them', async () => {
        // Arrange
        const mounted = await mountBoard([card('a', 'todo', 1), card('b', 'doing'), card('c', 'doing', 2)]);

        // Act
        const at = await dragTo(mounted, slotFor(mounted, 'todo', 'Card A'), 'doing', 1);
        await release(mounted, at);

        // Assert
        expect(shown(mounted, 'doing')).toEqual(['Card C', 'Card A', 'Card B']);
        expect(mounted.store.get('$.data.cards.2.rank')).toBe(1);
        expect(mounted.store.get('$.data.cards.0.rank')).toBe(2);
        expect(mounted.store.get('$.data.cards.1.rank')).toBe(3);
    });

});

describe('board keyboard move in Chromium', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        mountComponent.unmountAll();
    });

    const focusCard = async (mounted: MountedComponent, key: string, title: string): Promise<HTMLElement> => {
        const slot = slotFor(mounted, key, title);
        slot.focus();
        await flush();
        return slot;
    };

    it('should pick a card up with Space, move it with the arrows and drop it with Space', async () => {
        // Arrange
        const mounted = await mountBoard();
        const moves: unknown[] = [];
        mounted.element.addEventListener('move', (event) => moves.push((event as CustomEvent).detail));
        await focusCard(mounted, 'todo', 'Card A');

        // Act and Assert
        await userEvent.keyboard(' ');
        expect(live(mounted)).toContain('Card A picked up, position 1 of 3 in To do.');
        expect(dropOf(mounted, 'todo')?.getAttribute('style')).toContain('--sui-drop-index: 0');
        await userEvent.keyboard('{ArrowDown}');
        expect(live(mounted)).toBe('Card A moved to position 2 of 3 in To do.');
        await userEvent.keyboard('{ArrowRight}');
        expect(live(mounted)).toBe('Card A moved to position 2 of 3 in Doing.');
        expect(dropOf(mounted, 'doing')?.getAttribute('style')).toContain('--sui-drop-index: 1');
        expect(dropOf(mounted, 'todo')).toBeNull();
        expect(mounted.store.get('$.data.cards.0.status')).toBe('todo');
        await userEvent.keyboard(' ');
        await settle();

        // Assert
        expect(live(mounted)).toBe('Card A dropped at position 2 of 3 in Doing.');
        expect(mounted.store.get('$.data.cards.0.status')).toBe('doing');
        expect(mounted.store.get('$.data.cards.0.rank')).toBe(1.5);
        expect(shown(mounted, 'doing')).toEqual(['Card D', 'Card A', 'Card E']);
        expect(moves).toEqual([{ key: 'a', from: 'todo', to: 'doing', index: 1 }]);
        expect(dropOf(mounted, 'doing')).toBeNull();
    });

    it('should keep the focus on the card after the drop', async () => {
        // Arrange
        const mounted = await mountBoard();
        await focusCard(mounted, 'todo', 'Card A');

        // Act
        await userEvent.keyboard(' ');
        await userEvent.keyboard('{ArrowRight}');
        await userEvent.keyboard(' ');
        await settle();
        const list = columnOf(mounted, 'doing').querySelector('ui-record-list') as Element;
        const active = list.shadowRoot?.activeElement as HTMLElement | null;

        // Assert
        expect(active === null ? '' : slotText(active)).toBe('Card A');
    });

    it('should cancel with Escape and leave the data as it was', async () => {
        // Arrange
        const mounted = await mountBoard();
        const moves: unknown[] = [];
        mounted.element.addEventListener('move', (event) => moves.push((event as CustomEvent).detail));
        await focusCard(mounted, 'todo', 'Card B');

        // Act
        await userEvent.keyboard(' ');
        await userEvent.keyboard('{ArrowRight}');
        await userEvent.keyboard('{Escape}');
        await settle();

        // Assert
        expect(live(mounted)).toBe('Move of Card B cancelled.');
        expect(mounted.store.get('$.data.cards.1.status')).toBe('todo');
        expect(dropOf(mounted, 'doing')).toBeNull();
        expect(dropOf(mounted, 'todo')).toBeNull();
        expect(moves).toEqual([]);
    });

    it('should stop at the ends and at the outer columns', async () => {
        // Arrange
        const mounted = await mountBoard();
        await focusCard(mounted, 'todo', 'Card A');

        // Act
        await userEvent.keyboard(' ');
        await userEvent.keyboard('{ArrowUp}');
        await userEvent.keyboard('{ArrowLeft}');

        // Assert
        expect(live(mounted)).toContain('picked up');
        expect(dropOf(mounted, 'todo')?.getAttribute('style')).toContain('--sui-drop-index: 0');

        // Act
        await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');

        // Assert
        expect(dropOf(mounted, 'done')?.getAttribute('style')).toContain('--sui-drop-index: 0');
    });

    it('should keep the arrow keys from moving the focus between cards while a card is picked up', async () => {
        // Arrange
        const mounted = await mountBoard();
        const slot = await focusCard(mounted, 'todo', 'Card A');

        // Act
        await userEvent.keyboard(' ');
        await userEvent.keyboard('{ArrowDown}');
        const list = columnOf(mounted, 'todo').querySelector('ui-record-list') as Element;

        // Assert
        expect(list.shadowRoot?.activeElement).toBe(slot);
    });

    it('should do nothing on Space for a focused element inside the card, and let the arrows move the focus when nothing is picked up', async () => {
        // Arrange
        const mounted = await mountBoard();
        await focusCard(mounted, 'todo', 'Card A');

        // Act
        await userEvent.keyboard('{ArrowDown}');
        await flush();
        const list = columnOf(mounted, 'todo').querySelector('ui-record-list') as Element;
        const active = list.shadowRoot?.activeElement as HTMLElement | null;

        // Assert
        expect(active === null ? '' : slotText(active)).toBe('Card B');
        expect(live(mounted)).toBe('');
    });

    it('should cancel a picked card when the focus leaves the board', async () => {
        // Arrange
        const mounted = await mountBoard();
        await focusCard(mounted, 'todo', 'Card A');
        await userEvent.keyboard(' ');

        // Act
        (columnOf(mounted, 'todo').querySelector('ui-record-list')?.shadowRoot?.activeElement as HTMLElement).blur();
        await settle();

        // Assert
        expect(live(mounted)).toBe('Move of Card A cancelled.');
        expect(dropOf(mounted, 'todo')).toBeNull();
    });

    it('should not move a card inside its column when the board has no order field, but still between columns', async () => {
        // Arrange
        const mounted = await mountBoard(cards(), { orderField: '' });
        const moves: unknown[] = [];
        mounted.element.addEventListener('move', (event) => moves.push((event as CustomEvent).detail));
        await focusCard(mounted, 'todo', 'Card A');

        // Act
        await userEvent.keyboard(' ');
        await userEvent.keyboard('{ArrowDown}');
        await userEvent.keyboard(' ');
        await settle();

        // Assert
        expect(moves).toEqual([]);

        // Act
        await focusCard(mounted, 'todo', 'Card A');
        await userEvent.keyboard(' ');
        await userEvent.keyboard('{ArrowRight}');
        await userEvent.keyboard(' ');
        await settle();

        // Assert
        expect(moves).toEqual([{ key: 'a', from: 'todo', to: 'doing', index: 0 }]);
    });

    it('should announce in German with the German card name and column titles', async () => {
        // Arrange
        const mounted = await mountBoard(cards(), {}, {
            locale: 'de',
            locales: { de: { columns: { todo: { _title: 'Zu erledigen' }, doing: { _title: 'In Arbeit' }, done: { _title: 'Erledigt' } } } }
        });
        await settle();
        await focusCard(mounted, 'todo', 'Card A');

        // Act
        await userEvent.keyboard(' ');

        // Assert
        expect(live(mounted)).toBe('Card A aufgenommen, Position 1 von 3 in Zu erledigen. Mit den Pfeiltasten verschieben, mit der Leertaste ablegen, mit Escape abbrechen.');

        // Act
        await userEvent.keyboard('{ArrowRight}');

        // Assert
        expect(live(mounted)).toBe('Card A verschoben auf Position 1 von 3 in In Arbeit.');
    });
});
